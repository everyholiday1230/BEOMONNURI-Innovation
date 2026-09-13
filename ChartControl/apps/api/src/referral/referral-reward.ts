/**
 * 초대 보상 지급 — **거래소 연결 시점**.
 *
 * ═══ 왜 별도 모듈인가 ═══
 *
 * ★★★ 처음에는 `index.ts` 안의 모듈 함수로 썼다. 그런데 그러면 **시험할 수 없다.**
 *   프로덕션에서 확인하려면 실제 거래소 API 키가 필요하고, 우리는 고객 키를 쓸 수
 *   없다. 즉 "지급이 실제로 되는가" 를 배포 전에 확인할 방법이 없었다.
 *
 *   이건 돈이 오가는 로직이다. 확인할 수 없는 상태로 두면, 예전과 똑같은 실패를
 *   반복한다 — 화면은 2,000포인트를 약속하는데 코드는 아무에게도 주지 않았고,
 *   그 사실을 **실제로 가입시켜 볼 때까지 아무도 몰랐다.**
 *
 * ★ 그래서 의존성을 주입받는 순수 함수로 분리한다. 저장소를 가짜로 넣으면
 *   상한·멱등·미초대 등 모든 분기를 시험할 수 있다.
 *
 * ═══ 운영 결정 (2026-09-13) ═══
 *
 * · 보상 조건: 가입이 아니라 **거래소 연결**.
 *   가입만으로 주면 남용이 쉽다 — 지메일 두 개로 5분 만에 자기추천 귀속을 만들 수
 *   있었다. 거래소 연결은 거래소가 검증한 실계정이 필요하다.
 * · **추천인·피추천인 양쪽** 각 `referralPoints`(현재 2,000).
 * · 추천인 **월 3명 상한**. 매월 1일 00:00 UTC 로 초기화.
 */

/** 이 모듈이 쓰는 원장 사유. DB CHECK 제약이 허용하는 값이어야 한다. */
const REASON = 'referral_signup' as const;

/**
 * 원장 `ref_type`. 추천인·피추천인을 구분한다.
 *
 * ★★ `refId` 는 **피추천인 userId** 로 고정한다. 그러면 유일 인덱스
 *   `uq_points_ref (user_id, reason, ref_type, ref_id)` 가 한 사람의 연결로 두 번
 *   지급되는 것을 막는다. 추천인·피추천인은 `user_id` 가 달라 각자 한 건씩 남는다.
 */
export const REF_TYPE_REFERRER = 'referral_referrer';
export const REF_TYPE_REFEREE = 'referral_referee';

/** 추천인이 한 달에 받을 수 있는 보상 건수. */
export const REFERRAL_MONTHLY_CAP = 3;

export interface ReferralRewardDeps {
  /** 단계 기록. 지급이 막혀도 '언제 연결했는지' 는 남아야 한다. */
  markKeysConnected(userId: string): Promise<unknown>;
  /** 이 사용자를 누가 초대했는지. 없으면 null. */
  findByReferee(userId: string): Promise<{ code: string; referrerUserId: string | null } | null>;
  /** 포인트 제도 설정. */
  getPointSettings(): Promise<{ enabled: boolean; referralAsPoints: boolean; referralPoints: number }>;
  /** 기간 내 지급 건수 (상한 판정용). */
  countGrants(input: { userId: string; reason: string; refType: string; sinceMs: number }): Promise<number>;
  /** 적립. 중복이면 null 을 돌려준다(멱등). */
  grant(input: {
    userId: string; amount: number; reason: typeof REASON;
    refType: string; refId: string; memo: string;
  }): Promise<unknown | null>;
  /** 현재 시각. 시험에서 달 경계를 고정하기 위해 주입한다. */
  now?: () => number;
}

export interface ReferralRewardResult {
  /** 지급을 시도했는지. 초대받지 않은 사용자면 false. */
  attempted: boolean;
  refereePaid: boolean;
  referrerPaid: boolean;
  /** 추천인이 이번 달에 이미 받은 건수(상한 판정 시점). */
  monthUsed: number;
  /** 지급하지 않은 이유. 사람이 로그에서 읽는 값이다. */
  reason?:
  | 'not-referred'
  | 'self-referral'
  | 'points-disabled'
  | 'referrer-cap-reached'
  | 'already-paid';
}

/**
 * 거래소 키가 VERIFIED 로 확정된 직후 부른다.
 *
 * ★ 예외를 던지지 않는다. 호출부(거래소 연결)가 이것 때문에 실패하면 안 된다 —
 *   연결은 고객이 돈을 다루기 위한 것이고 보상은 부수적이다.
 */
export async function payReferralReward(
  d: ReferralRewardDeps,
  userId: string,
): Promise<ReferralRewardResult> {
  const nowMs = (d.now ?? Date.now)();
  const base: ReferralRewardResult = { attempted: false, refereePaid: false, referrerPaid: false, monthUsed: 0 };

  /* ★ 단계 기록을 먼저 한다. 아래에서 무엇이 막히든 연결 시각은 남는다. */
  await d.markKeysConnected(userId);

  const row = await d.findByReferee(userId);
  if (!row || !row.referrerUserId) return { ...base, reason: 'not-referred' };
  /*
     ★★ 자기추천 방어. 지금 구조에서는 일어날 수 없지만(코드 소유자와 가입자가
       같을 수 없다) 명시해 둔다 — 나중에 코드 발급 규칙이 바뀌면 여기가 유일한 방벽이다.
  */
  if (row.referrerUserId === userId) return { ...base, reason: 'self-referral' };

  const ps = await d.getPointSettings();
  if (!ps.enabled || !ps.referralAsPoints || ps.referralPoints <= 0) {
    return { ...base, attempted: true, reason: 'points-disabled' };
  }

  /* ★ 이번 달 1일 00:00 UTC. 달이 바뀌면 상한이 초기화된다. */
  const dt = new Date(nowMs);
  const monthStart = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1);

  const monthUsed = await d.countGrants({
    userId: row.referrerUserId,
    reason: REASON,
    refType: REF_TYPE_REFERRER,
    sinceMs: monthStart,
  });

  /*
     ★★★ 상한을 넘으면 **추천인에게만** 주지 않는다.

       피추천인은 자기가 그 추천인의 몇 번째 초대인지 알 수 없다. 그 사정으로
       신규 고객의 보상을 빼앗으면, 같은 조건으로 가입한 사람들이 서로 다른 대우를
       받게 된다. 상한은 **추천인의 남용을 막는 장치**이므로 추천인에게만 적용한다.
  */
  const referrerAllowed = monthUsed < REFERRAL_MONTHLY_CAP;

  const refereeEntry = await d.grant({
    userId,
    amount: ps.referralPoints,
    reason: REASON,
    refType: REF_TYPE_REFEREE,
    refId: userId,
    memo: 'referral bonus (referee · exchange connected)',
  });

  let referrerEntry: unknown | null = null;
  if (referrerAllowed) {
    referrerEntry = await d.grant({
      userId: row.referrerUserId,
      amount: ps.referralPoints,
      reason: REASON,
      refType: REF_TYPE_REFERRER,
      refId: userId,
      memo: `referral bonus (referrer · ${row.code})`,
    });
  }

  const refereePaid = refereeEntry !== null;
  const referrerPaid = referrerEntry !== null;

  return {
    attempted: true,
    refereePaid,
    referrerPaid,
    monthUsed,
    ...(referrerAllowed
      /*
         ★ 둘 다 중복이면 '이미 지급' 이다. 재검증(사용자가 키를 다시 검증)에서
           흔히 일어나며 오류가 아니다. 로그에서 구분되도록 이유를 남긴다.
      */
      ? (!refereePaid && !referrerPaid ? { reason: 'already-paid' as const } : {})
      : { reason: 'referrer-cap-reached' as const }),
  };
}
