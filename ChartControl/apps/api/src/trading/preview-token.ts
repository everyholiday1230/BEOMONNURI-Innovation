/**
 * 주문 미리보기 토큰 — 서명되고 만료되며, 주문 내용에 묶인다.
 *
 * ★★ 왜 필요한가 — 게이트가 없는 보호를 있다고 말하고 있었다
 *
 *   실주문 게이트에는 두 항목이 있었다.
 *
 *     previewExpired: false          ← **하드코딩.** 만료를 판정한 적이 없다.
 *     confirmationTokenValid: Boolean(body.confirmationToken)
 *                                    ← **존재 여부만.** 아무 문자열이나 통과한다.
 *
 *   게다가 그 확인 토큰은 `/api/sim/order-drafts` 가 발급하는데 이 경로는 **인증이
 *   없다.** 즉 토큰은 누구나 얻을 수 있고, 서버는 서명도 만료도 소유자도 보지 않았다.
 *   "최종 확인 게이트" 와 "미리보기 만료" 는 이름만 있고 실체가 없었다.
 *
 * ★★ 무엇을 막는가
 *
 *   고객이 미리보기를 띄운 뒤 자리를 비웠다가 한참 뒤 확인을 누르는 경우, 그 사이 가격이
 *   움직였는데 화면이 보여준 예상 수수료·청산가·최대손실은 옛 숫자다. 만료가 있으면
 *   "다시 계산해 주세요" 로 끊을 수 있다.
 *
 *   또 토큰을 **주문 내용에 묶기** 때문에, 작은 주문으로 받은 토큰으로 큰 주문을 확인할
 *   수 없다. 묶지 않으면 만료만 있고 내용 보증은 없다.
 *
 * ★ 서버 상태를 쓰지 않는다(HMAC). 초안을 메모리 맵에 들고 있으면 재시작이나 인스턴스
 *   증설에서 사라져, 고객에게는 "확인을 눌렀는데 초안이 없다" 로 보인다.
 * ★ 비교는 **길이 무관 상수시간**으로 한다 — 서명 비교에서 조기 반환은 정보를 흘린다.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** 기본 유효시간. 확인 창이 열려 있는 현실적인 시간을 감안한다. */
export const PREVIEW_TOKEN_TTL_MS = 120_000;

const VERSION = 'p1';

/** 토큰에 묶는 주문의 본질. 이 중 하나라도 바뀌면 토큰이 무효가 된다. */
export interface PreviewBinding {
  userId: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: string;
  /** 지정가일 때만 의미가 있다. 시장가는 빈 문자열. */
  price: string;
  leverage: string;
  marginMode: string;
}

/**
 * 묶을 내용을 한 줄로 만든다.
 *
 * ★ 구분자로 `\u0000` 을 쓴다. 값에 나타날 수 없는 문자라야 "a|b" 와 "a" + "|b" 가
 *   같은 문자열이 되는 혼동(연결 공격)을 막을 수 있다.
 */
function canonical(b: PreviewBinding): string {
  return [
    b.userId, b.symbol, b.side, b.orderType,
    b.quantity, b.price, b.leverage, b.marginMode,
  ].join('\u0000');
}

function sign(secret: string, issuedAt: number, b: PreviewBinding): string {
  return createHmac('sha256', secret)
    .update(`${VERSION}\u0000${issuedAt}\u0000${canonical(b)}`)
    .digest('base64url');
}

/** 미리보기 토큰을 발급한다. `issuedAt` 은 시험을 위해서만 넘긴다. */
export function issuePreviewToken(
  secret: string,
  binding: PreviewBinding,
  issuedAt: number = Date.now(),
): string {
  return `${VERSION}.${issuedAt}.${sign(secret, issuedAt, binding)}`;
}

export type PreviewTokenResult =
  /** 서명·소유자·주문내용이 모두 맞고 아직 유효하다. */
  | { ok: true; issuedAt: number; ageMs: number }
  /** 형식이 아니다 — 없거나 조각 수가 다르거나 버전이 다르다. */
  | { ok: false; reason: 'MALFORMED' }
  /** 서명이 맞지 않다 — 위조이거나 주문 내용이 발급 때와 다르다. */
  | { ok: false; reason: 'MISMATCH' }
  /** 서명은 맞지만 시간이 지났다. */
  | { ok: false; reason: 'EXPIRED'; issuedAt: number; ageMs: number };

/**
 * 토큰을 검증한다.
 *
 * ★ 만료와 불일치를 **구분해서** 돌려준다. 고객에게 보일 문장이 달라야 한다 —
 *   만료는 "다시 계산해 주세요", 불일치는 "주문 내용이 바뀌었습니다" 다.
 */
export function verifyPreviewToken(
  secret: string,
  token: string | undefined | null,
  binding: PreviewBinding,
  now: number = Date.now(),
  ttlMs: number = PREVIEW_TOKEN_TTL_MS,
): PreviewTokenResult {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'MALFORMED' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: 'MALFORMED' };

  const issuedAt = Number(parts[1]);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return { ok: false, reason: 'MALFORMED' };

  const expected = sign(secret, issuedAt, binding);
  const got = parts[2] ?? '';
  /*
     ★ 길이가 다르면 timingSafeEqual 이 던진다. 먼저 길이를 보고, 같을 때만 비교한다.
       길이 자체는 서명 알고리즘으로 정해져 비밀이 아니다.
  */
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'MISMATCH' };

  /*
     ★ 미래 시각으로 발급된 토큰도 만료로 본다. 시계가 어긋난 상태에서 무한히 유효한
       토큰이 생기면 만료가 없는 것과 같다.
  */
  const ageMs = now - issuedAt;
  if (ageMs < 0 || ageMs > ttlMs) return { ok: false, reason: 'EXPIRED', issuedAt, ageMs };

  return { ok: true, issuedAt, ageMs };
}
