/**
 * KuCoin 서명.
 *
 * 두 종류가 있고 목적이 다르다.
 *
 * 1) KC-API-SIGN — 요청 인증. 사용자의 apiSecret 으로 서명.
 *      prehash = timestamp + METHOD + requestPath(쿼리 포함) + body
 *      sign    = base64(hmac_sha256(apiSecret, prehash))
 *
 * 2) KC-API-PARTNER-SIGN — 브로커 리베이트 귀속. 브로커 key 로 서명.
 *      prehash = timestamp + partner + apiKey
 *      sign    = base64(hmac_sha256(brokerKey, prehash))
 *
 * 출처: KuCoin Broker > Instructions (문서 2026-03-13 개정).
 * 문서에 게시된 예제 입출력을 __tests__/signature.test.ts 에서 재현해 검증한다.
 * 이 서명이 틀리면 리베이트가 집계되지 않으므로 매출과 직결된다.
 *
 * 운영 주의 2가지:
 *  - 브로커 헤더는 "모든 REST 요청"에 붙여야 한다. 일부만 붙이면 그 요청들의
 *    거래가 귀속되지 않는다.
 *  - KC-API-PARTNER-VERIFY=true 를 넣으면 파트너 서명이 틀렸을 때 조용히
 *    통과하지 않고 400201 을 돌려준다. 수수료가 새는 것을 즉시 알 수 있으므로
 *    반드시 켠다.
 */

import { createHmac } from 'node:crypto';

export interface BrokerCredentials {
  /** KuCoin 이 발급한 partner 식별자 */
  partner: string;
  /** KuCoin 이 발급한 broker-key (서명 키) */
  key: string;
  /** KuCoin 이 발급한 broker-name */
  name: string;
}

export interface UserCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
}

function hmacBase64(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64');
}

/** API v2 passphrase: 평문 passphrase 를 apiSecret 으로 HMAC 후 base64. */
export function signPassphrase(apiSecret: string, passphrase: string): string {
  return hmacBase64(apiSecret, passphrase);
}

/**
 * 요청 서명용 prehash.
 * requestPath 는 쿼리스트링을 포함해야 한다 (예: '/api/v1/orders?symbol=XBTUSDTM').
 * body 는 실제 전송 바이트와 정확히 일치해야 한다.
 */
export function buildPrehash(input: {
  timestamp: number | string;
  method: string;
  requestPath: string;
  body?: string;
}): string {
  const { timestamp, method, requestPath, body = '' } = input;
  return `${timestamp}${method.toUpperCase()}${requestPath}${body}`;
}

export function signRequest(input: {
  apiSecret: string;
  timestamp: number | string;
  method: string;
  requestPath: string;
  body?: string;
}): string {
  return hmacBase64(input.apiSecret, buildPrehash(input));
}

/** 브로커 파트너 서명. prehash = timestamp + partner + apiKey */
export function signPartner(input: {
  brokerKey: string;
  timestamp: number | string;
  partner: string;
  apiKey: string;
}): string {
  return hmacBase64(input.brokerKey, `${input.timestamp}${input.partner}${input.apiKey}`);
}

/** 브로커 자격증명이 완전한지. 부분 설정은 400201 을 유발하므로 붙이지 않는다. */
export function hasCompleteBrokerCredentials(
  broker: Partial<BrokerCredentials> | null | undefined,
): broker is BrokerCredentials {
  return Boolean(broker && broker.partner && broker.key && broker.name);
}

/**
 * 인증 헤더 일괄 생성.
 *
 * @param timestamp 테스트에서 고정값을 주입하기 위해 노출한다.
 */
export function buildAuthHeaders(input: {
  user: UserCredentials;
  method: string;
  requestPath: string;
  body?: string;
  timestamp?: number;
  broker?: Partial<BrokerCredentials> | null;
}): Record<string, string> {
  const { user, method, requestPath, body = '', timestamp = Date.now(), broker = null } = input;
  const ts = String(timestamp);

  const headers: Record<string, string> = {
    'KC-API-KEY': user.apiKey,
    'KC-API-SIGN': signRequest({
      apiSecret: user.apiSecret,
      timestamp: ts,
      method,
      requestPath,
      body,
    }),
    'KC-API-TIMESTAMP': ts,
    'KC-API-PASSPHRASE': signPassphrase(user.apiSecret, user.passphrase),
    'KC-API-KEY-VERSION': '2',
  };

  if (hasCompleteBrokerCredentials(broker)) {
    headers['KC-API-PARTNER'] = broker.partner;
    headers['KC-BROKER-NAME'] = broker.name;
    headers['KC-API-PARTNER-SIGN'] = signPartner({
      brokerKey: broker.key,
      timestamp: ts,
      partner: broker.partner,
      apiKey: user.apiKey,
    });
    headers['KC-API-PARTNER-VERIFY'] = 'true';
  }

  return headers;
}
