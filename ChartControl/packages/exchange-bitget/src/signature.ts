/**
 * Bitget 서명.
 *
 * ★★ 규칙(문서 + 실측 오류 메시지로 확인):
 *      prehash = timestamp + METHOD + requestPath(쿼리 포함) + body
 *      sign    = base64(hmac_sha256(apiSecret, prehash))
 *      헤더    = ACCESS-KEY · ACCESS-SIGN · ACCESS-TIMESTAMP · ACCESS-PASSPHRASE
 *
 * ★★★ KuCoin 과 **거의 같지만 passphrase 를 그대로 보낸다.** KuCoin 은 passphrase 도
 *   HMAC 으로 서명해 보낸다 — 같다고 가정하면 `40009`(signature error)가 난다.
 *   거래소마다 확인해야 하는 종류의 차이다.
 */
import { createHmac } from 'node:crypto';

export interface BitgetCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

/**
 * 서명 문자열을 만든다.
 *
 * ★ `requestPath` 에는 **쿼리까지** 포함해야 한다. 빼면 서명이 맞지 않는다.
 * ★ body 는 GET 이면 빈 문자열이다. `'{}'` 를 넣으면 틀린다.
 */
export function prehash(timestamp: string, method: HttpMethod, requestPath: string, body = ''): string {
  return `${timestamp}${method}${requestPath}${body}`;
}

export function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64');
}

/**
 * 요청 헤더.
 *
 * ★★★ **비밀은 이 함수 밖으로 나가지 않는다.** 반환값에 `apiSecret` 이 없다 —
 *   헤더 객체를 로그로 찍는 일이 흔하고, 그때 비밀이 새면 되돌릴 수 없다.
 * ★ `locale` 을 보낸다 — 없으면 오류 메시지가 중국어로 올 수 있다. 우리가 로그로
 *   읽어야 하므로 영어로 고정한다.
 */
export function authHeaders(
  cred: BitgetCredentials,
  method: HttpMethod,
  requestPath: string,
  body = '',
  now: () => number = Date.now,
): Record<string, string> {
  const ts = String(now());
  return {
    'ACCESS-KEY': cred.apiKey,
    'ACCESS-SIGN': sign(cred.apiSecret, prehash(ts, method, requestPath, body)),
    'ACCESS-TIMESTAMP': ts,
    /* ★ KuCoin 과 달리 **원문 그대로**다. 서명하면 40009 가 난다. */
    'ACCESS-PASSPHRASE': cred.passphrase,
    'Content-Type': 'application/json',
    locale: 'en-US',
  };
}
