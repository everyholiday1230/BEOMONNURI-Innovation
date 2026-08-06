/**
 * KuCoin 서명.
 *
 * 두 종류의 서명이 있고 둘은 목적이 다르다.
 *
 * 1) KC-API-SIGN — 요청 인증. 사용자의 apiSecret으로 서명.
 *      prehash = timestamp + METHOD + requestPath(+query) + body
 *      sign    = base64(hmac_sha256(apiSecret, prehash))
 *      passphrase도 v2에서는 apiSecret으로 서명해 전달한다.
 *
 * 2) KC-API-PARTNER-SIGN — 브로커 리베이트 귀속. 브로커 key로 서명.
 *      prehash = timestamp + partner + apiKey
 *      sign    = base64(hmac_sha256(brokerKey, prehash))
 *
 * 출처: KuCoin Broker > Instructions (2026-03-13 개정).
 * 이 파일의 값은 test/kucoin-sign.test.js 에서 공식 문서 예제값으로 검증한다.
 *
 * 주의: 브로커 헤더는 "모든 REST 요청"에 붙여야 리베이트가 정상 집계된다.
 * KC-API-PARTNER-VERIFY=true 를 넣으면 서명이 틀렸을 때 조용히 넘어가지 않고
 * 400201 에러가 나므로, 수수료가 새는 것을 즉시 감지할 수 있다. 반드시 켠다.
 */

import crypto from 'node:crypto';

function hmacBase64(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64');
}

/**
 * KuCoin API v2 passphrase. 평문 passphrase를 apiSecret으로 HMAC 후 base64.
 */
export function signPassphrase(apiSecret, passphrase) {
  return hmacBase64(apiSecret, passphrase);
}

/**
 * 요청 서명용 prehash 문자열.
 * requestPath 는 쿼리스트링을 포함해야 한다 (예: '/api/v1/orders?symbol=XBTUSDTM').
 * body 는 POST/PUT의 JSON 문자열이며, 실제 전송 바이트와 정확히 일치해야 한다.
 */
export function buildPrehash({ timestamp, method, requestPath, body = '' }) {
  return `${timestamp}${String(method).toUpperCase()}${requestPath}${body}`;
}

export function signRequest({ apiSecret, timestamp, method, requestPath, body = '' }) {
  return hmacBase64(apiSecret, buildPrehash({ timestamp, method, requestPath, body }));
}

/**
 * 브로커 파트너 서명. prehash = timestamp + partner + apiKey
 */
export function signPartner({ brokerKey, timestamp, partner, apiKey }) {
  return hmacBase64(brokerKey, `${timestamp}${partner}${apiKey}`);
}

/**
 * 인증 헤더 일괄 생성.
 *
 * @param {object}  p
 * @param {string}  p.apiKey            사용자 KuCoin API key
 * @param {string}  p.apiSecret         사용자 KuCoin API secret
 * @param {string}  p.passphrase        사용자 평문 passphrase
 * @param {string}  p.method            HTTP 메서드
 * @param {string}  p.requestPath       쿼리 포함 경로
 * @param {string} [p.body]             요청 바디 문자열
 * @param {number} [p.timestamp]        ms 타임스탬프 (테스트 주입용)
 * @param {object} [p.broker]           { partner, key, name } — 있으면 리베이트 헤더 추가
 */
export function buildAuthHeaders({
  apiKey,
  apiSecret,
  passphrase,
  method,
  requestPath,
  body = '',
  timestamp = Date.now(),
  broker = null,
}) {
  const ts = String(timestamp);
  const headers = {
    'KC-API-KEY': apiKey,
    'KC-API-SIGN': signRequest({ apiSecret, timestamp: ts, method, requestPath, body }),
    'KC-API-TIMESTAMP': ts,
    'KC-API-PASSPHRASE': signPassphrase(apiSecret, passphrase),
    'KC-API-KEY-VERSION': '2',
  };

  // 브로커 자격증명이 완전할 때만 붙인다. 부분 설정은 서명 실패를 유발한다.
  if (broker && broker.partner && broker.key && broker.name) {
    headers['KC-API-PARTNER'] = broker.partner;
    headers['KC-BROKER-NAME'] = broker.name;
    headers['KC-API-PARTNER-SIGN'] = signPartner({
      brokerKey: broker.key,
      timestamp: ts,
      partner: broker.partner,
      apiKey,
    });
    headers['KC-API-PARTNER-VERIFY'] = 'true';
  }

  return headers;
}
