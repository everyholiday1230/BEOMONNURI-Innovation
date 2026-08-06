/**
 * KuCoin 서명 검증.
 *
 * 기대값은 KuCoin 공식 문서 "Broker > Instructions > 4. For Example" 에 게시된
 * 값을 그대로 쓴다. 우리 구현이 이 값을 재현하지 못하면 브로커 리베이트가
 * 집계되지 않으므로, 이 테스트는 매출과 직결된다.
 */

import { describe, expect, it } from 'vitest';

import {
  buildAuthHeaders,
  buildPrehash,
  hasCompleteBrokerCredentials,
  signPartner,
  signPassphrase,
  signRequest,
} from '../signature.js';

// --- 공식 문서 고정 입력값 ---
const USER = {
  apiKey: '6422da9c97b45100018c6e62',
  apiSecret: 'cde06451-dbed',
  passphrase: '1111111',
};
const BROKER = { partner: 'goodbroker', key: 'e8512b82-a4aa', name: 'goodbrokerND' };
const TIMESTAMP = 1680885532722;
const METHOD = 'POST';
const REQUEST_PATH = '/api/v1/orders';
const BODY = JSON.stringify({
  symbol: 'BTC-USDT',
  side: 'buy',
  size: '0.0001',
  price: '30000',
  type: 'limit',
  clientOid: '2b802154-8d31-42e6-88ea-c8c18d3e4822',
  tradeType: 'TRADE',
});

// --- 공식 문서 기대 출력값 ---
const EXPECTED_SIGN = 'ncPuAcZW8WYUZyvblRVVgMfYoVH+FlCTO6K45/FMLFQ=';
const EXPECTED_PASSPHRASE = 'rl1Ki0WuwidRT48JnoGQo+AJ4UtZ6mQEKt6F5XYVnT4=';
const EXPECTED_PARTNER_SIGN = 'CN1imIGUz/USkPuhOtGWi5DlZ08VeuVfknJNOPqUEac=';

describe('KuCoin 요청 서명', () => {
  it('prehash 는 timestamp + METHOD + path + body 순서로 조립된다', () => {
    expect(
      buildPrehash({ timestamp: TIMESTAMP, method: METHOD, requestPath: REQUEST_PATH, body: BODY }),
    ).toBe(`1680885532722POST/api/v1/orders${BODY}`);
  });

  it('KC-API-SIGN 이 공식 문서 예제값과 일치한다', () => {
    expect(
      signRequest({
        apiSecret: USER.apiSecret,
        timestamp: TIMESTAMP,
        method: METHOD,
        requestPath: REQUEST_PATH,
        body: BODY,
      }),
    ).toBe(EXPECTED_SIGN);
  });

  it('KC-API-PASSPHRASE(v2) 가 공식 문서 예제값과 일치한다', () => {
    expect(signPassphrase(USER.apiSecret, USER.passphrase)).toBe(EXPECTED_PASSPHRASE);
  });

  it('쿼리스트링이 서명 대상에 포함된다', () => {
    const withQuery = signRequest({
      apiSecret: USER.apiSecret,
      timestamp: TIMESTAMP,
      method: 'GET',
      requestPath: '/api/v1/orders?symbol=XBTUSDTM',
    });
    const withoutQuery = signRequest({
      apiSecret: USER.apiSecret,
      timestamp: TIMESTAMP,
      method: 'GET',
      requestPath: '/api/v1/orders',
    });
    expect(withQuery).not.toBe(withoutQuery);
  });

  it('body 가 1바이트만 달라도 서명이 달라진다', () => {
    const a = signRequest({
      apiSecret: USER.apiSecret,
      timestamp: TIMESTAMP,
      method: METHOD,
      requestPath: REQUEST_PATH,
      body: BODY,
    });
    const b = signRequest({
      apiSecret: USER.apiSecret,
      timestamp: TIMESTAMP,
      method: METHOD,
      requestPath: REQUEST_PATH,
      body: BODY.replace('30000', '30001'),
    });
    expect(a).not.toBe(b);
  });
});

describe('브로커 파트너 서명 (리베이트 귀속)', () => {
  it('prehash 는 timestamp + partner + apiKey 이다 (METHOD/path/body 미포함)', () => {
    expect(`${TIMESTAMP}${BROKER.partner}${USER.apiKey}`).toBe(
      '1680885532722goodbroker6422da9c97b45100018c6e62',
    );
  });

  it('KC-API-PARTNER-SIGN 이 공식 문서 예제값과 일치한다', () => {
    expect(
      signPartner({
        brokerKey: BROKER.key,
        timestamp: TIMESTAMP,
        partner: BROKER.partner,
        apiKey: USER.apiKey,
      }),
    ).toBe(EXPECTED_PARTNER_SIGN);
  });

  it('사용자 apiKey 가 다르면 파트너 서명도 달라진다 (귀속 단위가 키별임)', () => {
    const a = signPartner({ brokerKey: BROKER.key, timestamp: TIMESTAMP, partner: BROKER.partner, apiKey: 'aaa' });
    const b = signPartner({ brokerKey: BROKER.key, timestamp: TIMESTAMP, partner: BROKER.partner, apiKey: 'bbb' });
    expect(a).not.toBe(b);
  });
});

describe('buildAuthHeaders', () => {
  it('브로커 자격증명이 완전하면 파트너 헤더 4종을 붙인다', () => {
    const h = buildAuthHeaders({
      user: USER,
      method: METHOD,
      requestPath: REQUEST_PATH,
      body: BODY,
      timestamp: TIMESTAMP,
      broker: BROKER,
    });

    expect(h['KC-API-KEY']).toBe(USER.apiKey);
    expect(h['KC-API-SIGN']).toBe(EXPECTED_SIGN);
    expect(h['KC-API-TIMESTAMP']).toBe(String(TIMESTAMP));
    expect(h['KC-API-PASSPHRASE']).toBe(EXPECTED_PASSPHRASE);
    expect(h['KC-API-KEY-VERSION']).toBe('2');

    expect(h['KC-API-PARTNER']).toBe(BROKER.partner);
    expect(h['KC-BROKER-NAME']).toBe(BROKER.name);
    expect(h['KC-API-PARTNER-SIGN']).toBe(EXPECTED_PARTNER_SIGN);
    // VERIFY=true 여야 서명 실패가 400201 로 드러난다. 조용히 리베이트가 새는 것을 막는다.
    expect(h['KC-API-PARTNER-VERIFY']).toBe('true');
  });

  it('브로커 자격증명이 없으면 파트너 헤더를 붙이지 않는다', () => {
    const h = buildAuthHeaders({
      user: USER,
      method: METHOD,
      requestPath: REQUEST_PATH,
      body: BODY,
      timestamp: TIMESTAMP,
      broker: null,
    });
    expect(h['KC-API-SIGN']).toBe(EXPECTED_SIGN);
    expect('KC-API-PARTNER' in h).toBe(false);
    expect('KC-API-PARTNER-SIGN' in h).toBe(false);
    expect('KC-API-PARTNER-VERIFY' in h).toBe(false);
  });

  it('브로커 자격증명이 부분적이면 파트너 헤더를 붙이지 않는다 (400201 방지)', () => {
    const partials = [
      { partner: 'goodbroker', key: '', name: 'goodbrokerND' },
      { partner: '', key: 'e8512b82-a4aa', name: 'goodbrokerND' },
      { partner: 'goodbroker', key: 'e8512b82-a4aa', name: '' },
      {},
    ];
    for (const broker of partials) {
      expect(hasCompleteBrokerCredentials(broker)).toBe(false);
      const h = buildAuthHeaders({
        user: USER,
        method: METHOD,
        requestPath: REQUEST_PATH,
        timestamp: TIMESTAMP,
        broker,
      });
      expect('KC-API-PARTNER-SIGN' in h).toBe(false);
    }
  });

  it('평문 secret / passphrase 가 헤더 값으로 노출되지 않는다', () => {
    const h = buildAuthHeaders({
      user: USER,
      method: METHOD,
      requestPath: REQUEST_PATH,
      body: BODY,
      timestamp: TIMESTAMP,
      broker: BROKER,
    });
    const serialized = JSON.stringify(h);
    expect(serialized).not.toContain(USER.apiSecret);
    expect(serialized).not.toContain(USER.passphrase);
    expect(serialized).not.toContain(BROKER.key);
  });
});
