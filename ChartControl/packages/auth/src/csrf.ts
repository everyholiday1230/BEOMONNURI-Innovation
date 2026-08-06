import { createHmac, timingSafeEqual } from 'node:crypto';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Signed double-submit CSRF (req §4). The token is an HMAC over the session-bound secret keyed by a
 * server secret — an attacker cannot forge it without the server key, and it is bound to the
 * session. Verification recomputes the HMAC and does constant-time comparison of
 * header == cookie == expected.
 */
export function csrfTokenFor(sessionSecret: string, serverKey: string): string {
  return createHmac('sha256', serverKey).update(sessionSecret).digest('base64url');
}

export function verifyCsrf(
  headerToken: string | undefined,
  cookieToken: string | undefined,
  sessionSecret: string,
  serverKey: string,
): boolean {
  if (!headerToken || !cookieToken) return false;
  const expected = csrfTokenFor(sessionSecret, serverKey);
  return safeEqual(headerToken, cookieToken) && safeEqual(cookieToken, expected);
}

/** Origin/Referer allowlist check (defense in depth for unsafe methods). */
export function originAllowed(
  origin: string | undefined,
  referer: string | undefined,
  allowlist: string[],
  /**
   * 이 서버 자신의 오리진. 넘기면 same-origin 요청을 허용한다.
   *
   * 왜 필요한가: API 가 프론트엔드를 직접 서빙하면(단일 오리진) 브라우저가 보내는
   * Origin 은 서버 자신의 오리진이다. 그걸 allowlist 에 넣어두는 것을 잊으면
   * 로그인 이후 모든 변경 요청이 403 CSRF_FAILED 로 막힌다 — 원인을 찾기 어려운
   * 실패다 (실제로 겪었다).
   *
   * 보안상 안전한 이유: Origin 이 서버 자신과 같다는 것은 곧 same-origin 요청이라는
   * 뜻이고, CSRF 는 정의상 cross-origin 공격이다. 표준적인 검사 방식이다.
   * ★ 주의 — 이 값은 반드시 신뢰할 수 있는 출처(설정 또는 프록시가 검증한 호스트)에서
   *   와야 한다. Host 헤더를 그대로 넣으면 공격자가 조작할 수 있다.
   */
  selfOrigin?: string,
): boolean {
  const candidate = origin ?? (referer ? safeOrigin(referer) : undefined);
  if (!candidate) return false; // unsafe method without Origin/Referer → reject
  if (selfOrigin && candidate === selfOrigin) return true;
  return allowlist.includes(candidate);
}

function safeOrigin(url: string): string | undefined {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}
