/*
   ═══ 초대 보상 지급 로직 ═══

   ★★★ 이 시험이 존재하는 이유

     감사(2026-09-13)에서 초대 보상이 **아무에게도 지급되지 않는다**는 것을 발견했다.
     고객 화면은 "추천인과 신규 회원 둘 다 2,000포인트" 를 약속했지만, 실제로
     가입시켜 확인하니 양쪽 모두 0 이었다. 지급 조건이 직원(`team_leader`) 코드였고
     그 태그를 가진 사용자가 0명이었기 때문이다.

     그리고 그 사실을 **실제로 가입시켜 볼 때까지 아무도 몰랐다.** 지급 로직이
     `index.ts` 안에 있어 시험할 수 없었고, 프로덕션 확인에는 실제 거래소 API 키가
     필요했다(고객 키는 쓸 수 없다).

   ★ 그래서 로직을 주입 가능한 형태로 분리하고, 여기서 **모든 분기**를 확인한다.
     돈이 오가는 분기는 배포 전에 확인할 수 있어야 한다.
*/
import { describe, it, expect } from 'vitest';
import {
  payReferralReward, REFERRAL_MONTHLY_CAP,
  REF_TYPE_REFERRER, REF_TYPE_REFEREE,
  type ReferralRewardDeps,
} from '../referral/referral-reward';

const REFERRER = 'user-referrer';
const REFEREE = 'user-referee';

/** 2026-09-13 06:00 UTC — 9월 중순. 달 경계 계산을 고정한다. */
const NOW = Date.UTC(2026, 8, 13, 6, 0, 0);

interface Harness {
  deps: ReferralRewardDeps;
  grants: Array<{ userId: string; amount: number; refType: string; refId: string }>;
  milestones: string[];
  countCalls: Array<{ userId: string; refType: string; sinceMs: number }>;
}

function harness(over: {
  referred?: boolean;
  referrerUserId?: string | null;
  monthUsed?: number;
  points?: number;
  enabled?: boolean;
  referralAsPoints?: boolean;
  /** 이미 있는 (userId, refType) 조합. grant 가 null 을 돌려준다(멱등). */
  existing?: Array<{ userId: string; refType: string }>;
} = {}): Harness {
  const grants: Harness['grants'] = [];
  const milestones: string[] = [];
  const countCalls: Harness['countCalls'] = [];
  const existing = over.existing ?? [];

  const deps: ReferralRewardDeps = {
    markMilestone: async (uid, m) => { milestones.push(`${uid}:${m}`); },
    findByReferee: async () => (over.referred === false
      ? null
      : { code: 'ABC12345', referrerUserId: over.referrerUserId === undefined ? REFERRER : over.referrerUserId }),
    getPointSettings: async () => ({
      enabled: over.enabled ?? true,
      referralAsPoints: over.referralAsPoints ?? true,
      referralPoints: over.points ?? 2000,
    }),
    countGrants: async (x) => {
      countCalls.push({ userId: x.userId, refType: x.refType, sinceMs: x.sinceMs });
      return over.monthUsed ?? 0;
    },
    grant: async (x) => {
      if (existing.some((e) => e.userId === x.userId && e.refType === x.refType)) return null;
      grants.push({ userId: x.userId, amount: x.amount, refType: x.refType, refId: x.refId });
      return { id: 'entry' };
    },
    now: () => NOW,
  };
  return { deps, grants, milestones, countCalls };
}

describe('초대 보상 — 거래소 연결 시점 지급', () => {
  it('양쪽에 각각 지급한다 — 화면이 약속한 그대로', async () => {
    /*
       ★★★ 이것이 고쳐야 했던 핵심이다. 예전에는 이 경우에도 **아무도 못 받았다.**
    */
    const h = harness();
    const r = await payReferralReward(h.deps, REFEREE);

    expect(r.attempted).toBe(true);
    expect(r.refereePaid, '신규 회원이 못 받았다').toBe(true);
    expect(r.referrerPaid, '추천인이 못 받았다').toBe(true);
    expect(h.grants).toHaveLength(2);

    const referee = h.grants.find((g) => g.refType === REF_TYPE_REFEREE);
    const referrer = h.grants.find((g) => g.refType === REF_TYPE_REFERRER);
    expect(referee?.userId).toBe(REFEREE);
    expect(referrer?.userId).toBe(REFERRER);
    expect(referee?.amount).toBe(2000);
    expect(referrer?.amount).toBe(2000);

    /*
       ★★ `refId` 는 **양쪽 모두 피추천인 userId** 여야 한다. 이것이 멱등 키다 —
         한 사람의 연결로 두 번 지급되지 않게 만드는 유일한 장치다.
    */
    expect(referee?.refId).toBe(REFEREE);
    expect(referrer?.refId).toBe(REFEREE);
  });

  it('첫 거래 단계는 지급 전에 기록한다', async () => {
    /*
       ★★ `markMilestone` 은 예전에 **호출하는 곳이 하나도 없었다.** 그래서
         `keys_connected_at` 이 영원히 null 이었다. 지급이 막히더라도 이 기록은
         남아야 한다 — 나중에 수동으로 지급할 때 근거가 된다.
    */
    const h = harness({ referred: false });
    await payReferralReward(h.deps, REFEREE);
    /*
       ★★ 2026-09-13: 보상 조건이 '거래소 연결' → '첫 거래' 로 바뀌었다. 그래서
         지급 시점에 기록하는 단계도 `first_trade` 다. 단계 이름을 함께 확인한다 —
         이름이 어긋나면 `referral_signups.first_trade_at` 이 채워지지 않고,
         나중에 수동 지급할 근거가 사라진다.
    */
    expect(h.milestones, '초대받지 않은 사용자도 단계 기록은 남아야 한다')
      .toEqual([`${REFEREE}:first_trade`]);
  });

  it('초대로 오지 않은 사용자에게는 지급하지 않는다', async () => {
    const h = harness({ referred: false });
    const r = await payReferralReward(h.deps, REFEREE);
    expect(r.attempted).toBe(false);
    expect(r.reason).toBe('not-referred');
    expect(h.grants).toHaveLength(0);
  });

  it('추천인이 기록되지 않은 귀속에는 지급하지 않는다', async () => {
    /* ★ 코드만 남고 추천인이 사라진 경우(계정 삭제 등). null 을 사람으로 착각하면 안 된다. */
    const h = harness({ referrerUserId: null });
    const r = await payReferralReward(h.deps, REFEREE);
    expect(r.attempted).toBe(false);
    expect(h.grants).toHaveLength(0);
  });

  it('자기추천은 막는다', async () => {
    const h = harness({ referrerUserId: REFEREE });
    const r = await payReferralReward(h.deps, REFEREE);
    expect(r.reason).toBe('self-referral');
    expect(h.grants).toHaveLength(0);
  });

  it('포인트 제도가 꺼져 있으면 지급하지 않는다', async () => {
    for (const off of [{ enabled: false }, { referralAsPoints: false }, { points: 0 }]) {
      const h = harness(off);
      const r = await payReferralReward(h.deps, REFEREE);
      expect(r.reason, JSON.stringify(off)).toBe('points-disabled');
      expect(h.grants, JSON.stringify(off)).toHaveLength(0);
    }
  });

  it(`추천인 월 상한 ${REFERRAL_MONTHLY_CAP}명 — 넘으면 추천인만 못 받는다`, async () => {
    /*
       ★★★ 상한 초과 시 **피추천인은 그대로 받는다.**

         피추천인은 자기가 그 추천인의 몇 번째 초대인지 알 수 없다. 그 사정으로
         신규 고객의 보상을 빼앗으면 같은 조건으로 가입한 사람들이 서로 다른 대우를
         받는다. 상한은 추천인의 남용을 막는 장치다.
    */
    const h = harness({ monthUsed: REFERRAL_MONTHLY_CAP });
    const r = await payReferralReward(h.deps, REFEREE);

    expect(r.reason).toBe('referrer-cap-reached');
    expect(r.refereePaid, '신규 회원은 상한과 무관하게 받아야 한다').toBe(true);
    expect(r.referrerPaid, '추천인은 상한을 넘으면 못 받는다').toBe(false);
    expect(h.grants).toHaveLength(1);
    expect(h.grants[0]?.refType).toBe(REF_TYPE_REFEREE);
  });

  it(`상한 직전(${REFERRAL_MONTHLY_CAP - 1}건)에는 추천인도 받는다`, async () => {
    /* ★ 경계를 함께 확인한다. `<=` 로 잘못 쓰면 3명이 아니라 4명이 된다. */
    const h = harness({ monthUsed: REFERRAL_MONTHLY_CAP - 1 });
    const r = await payReferralReward(h.deps, REFEREE);
    expect(r.referrerPaid).toBe(true);
    expect(h.grants).toHaveLength(2);
  });

  it('상한은 추천인의 지급 원장을 이번 달 1일 00:00 UTC 부터 센다', async () => {
    /*
       ★★ 상한을 어디서 세는지가 중요하다. `referral_signups` 를 세면 **가입 수**를
         세는 것이고, 보상 조건은 거래소 연결이므로 둘은 다르다. 실제로 **지급된**
         건수를 세야 한다.
       ★ 추천인 기준이어야 한다 — 피추천인 기준으로 세면 상한이 아무 의미가 없다.
    */
    const h = harness();
    await payReferralReward(h.deps, REFEREE);

    expect(h.countCalls).toHaveLength(1);
    expect(h.countCalls[0]?.userId, '추천인 기준으로 세야 한다').toBe(REFERRER);
    expect(h.countCalls[0]?.refType).toBe(REF_TYPE_REFERRER);
    expect(h.countCalls[0]?.sinceMs, '이번 달 1일 00:00 UTC 여야 한다')
      .toBe(Date.UTC(2026, 8, 1));
  });

  it('같은 연결로 두 번 지급하지 않는다 (멱등)', async () => {
    /*
       ★★ 고객이 키를 다시 검증하면 이 경로가 또 불린다. 실제로 흔하다.
         `uq_points_ref` 가 막아 `grant` 가 null 을 돌려주고, 그것은 **오류가 아니다.**
    */
    const h = harness({
      existing: [
        { userId: REFEREE, refType: REF_TYPE_REFEREE },
        { userId: REFERRER, refType: REF_TYPE_REFERRER },
      ],
    });
    const r = await payReferralReward(h.deps, REFEREE);

    expect(r.attempted).toBe(true);
    expect(r.refereePaid).toBe(false);
    expect(r.referrerPaid).toBe(false);
    expect(r.reason).toBe('already-paid');
    expect(h.grants).toHaveLength(0);
  });

  it('설정된 포인트 금액을 그대로 쓴다 — 화면과 어긋나면 안 된다', async () => {
    /*
       ★ 금액을 코드에 박지 않는다. 운영자가 `point_settings.referral_points` 로
         조정하고, 고객 화면(`/api/referral/me`)도 같은 값을 보여준다. 여기서
         다른 수를 쓰면 화면의 약속과 실제 지급이 어긋난다 — 그것이 이번 사고였다.
    */
    const h = harness({ points: 5000 });
    await payReferralReward(h.deps, REFEREE);
    expect(h.grants.map((g) => g.amount)).toEqual([5000, 5000]);
  });
});
