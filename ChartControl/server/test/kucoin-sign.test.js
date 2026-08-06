/**
 * KuCoin 서명 검증.
 *
 * 기대값은 KuCoin 공식 문서 "Broker > Instructions > 4. For Example" 의
 * 게시된 값을 그대로 사용한다. 우리 구현이 이 값을 재현하지 못하면
 * 브로커 리베이트가 집계되지 않으므로, 이 테스트는 매출과 직결된다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAuthHeaders,
  buildPrehash,
  signPartner,
  signPassphrase,
  signRequest,
} from '../src/exchanges/kucoin/sign.js';

// --- 공식 문서 고정 입력값 ---
const API_KEY = '6422da9c97b45100018c6e62';
const API_SECRET = 'cde06451-dbed';
const PASSPHRASE = '1111111';

const BROKER = {
  partner: 'goodbroker',
  key: 'e8512b82-a4aa',
  name: 'goodbrokerND',
};

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
const EXPECTED_PARTNER_PREHASH = '1680885532722goodbroker6422da9c97b45100018c6e62';

test('요청 prehash 문자열이 timestamp+METHOD+path+body 순서로 조립된다', () => {
  assert.equal(
    buildPrehash({ timestamp: TIMESTAMP, method: METHOD, requestPath: REQUEST_PATH, body: BODY }),
    `1680885532722POST/api/v1/orders${BODY}`,
  );
});

test('KC-API-SIGN 이 공식 문서 예제값과 일치한다', () => {
  assert.equal(
    signRequest({
      apiSecret: API_SECRET,
      timestamp: TIMESTAMP,
      method: METHOD,
      requestPath: REQUEST_PATH,
      body: BODY,
    }),
    EXPECTED_SIGN,
  );
});

test('KC-API-PASSPHRASE(v2) 가 공식 문서 예제값과 일치한다', () => {
  assert.equal(signPassphrase(API_SECRET, PASSPHRASE), EXPECTED_PASSPHRASE);
});

test('파트너 prehash 는 timestamp+partner+apiKey 이다 (METHOD/path/body 미포함)', () => {
  assert.equal(`${TIMESTAMP}${BROKER.partner}${API_KEY}`, EXPECTED_PARTNER_PREHASH);
});

test('KC-API-PARTNER-SIGN 이 공식 문서 예제값과 일치한다', () => {
  assert.equal(
    signPartner({
      brokerKey: BROKER.key,
      timestamp: TIMESTAMP,
      partner: BROKER.partner,
      apiKey: API_KEY,
    }),
    EXPECTED_PARTNER_SIGN,
  );
});

test('buildAuthHeaders 가 브로커 헤더 6종을 모두 붙인다', () => {
  const h = buildAuthHeaders({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    passphrase: PASSPHRASE,
    method: METHOD,
    requestPath: REQUEST_PATH,
    body: BODY,
    timestamp: TIMESTAMP,
    broker: BROKER,
  });

  assert.equal(h['KC-API-KEY'], API_KEY);
  assert.equal(h['KC-API-SIGN'], EXPECTED_SIGN);
  assert.equal(h['KC-API-TIMESTAMP'], String(TIMESTAMP));
  assert.equal(h['KC-API-PASSPHRASE'], EXPECTED_PASSPHRASE);
  assert.equal(h['KC-API-KEY-VERSION'], '2');

  assert.equal(h['KC-API-PARTNER'], BROKER.partner);
  assert.equal(h['KC-BROKER-NAME'], BROKER.name);
  assert.equal(h['KC-API-PARTNER-SIGN'], EXPECTED_PARTNER_SIGN);
  assert.equal(h['KC-API-PARTNER-VERIFY'], 'true');
});

test('브로커 자격증명이 없으면 파트너 헤더를 붙이지 않는다', () => {
  const h = buildAuthHeaders({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    passphrase: PASSPHRASE,
    method: METHOD,
    requestPath: REQUEST_PATH,
    body: BODY,
    timestamp: TIMESTAMP,
    broker: null,
  });

  assert.equal(h['KC-API-SIGN'], EXPECTED_SIGN);
  assert.equal('KC-API-PARTNER' in h, false);
  assert.equal('KC-API-PARTNER-SIGN' in h, false);
  assert.equal('KC-API-PARTNER-VERIFY' in h, false);
});

test('브로커 자격증명이 부분적이면 파트너 헤더를 붙이지 않는다 (400201 방지)', () => {
  for (const partial of [
    { partner: 'goodbroker', key: '', name: 'goodbrokerND' },
    { partner: '', key: 'e8512b82-a4aa', name: 'goodbrokerND' },
    { partner: 'goodbroker', key: 'e8512b82-a4aa', name: '' },
  ]) {
    const h = buildAuthHeaders({
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      passphrase: PASSPHRASE,
      method: METHOD,
      requestPath: REQUEST_PATH,
      timestamp: TIMESTAMP,
      broker: partial,
    });
    assert.equal('KC-API-PARTNER-SIGN' in h, false);
  }
});

test('쿼리스트링은 requestPath 에 포함되어 서명 대상이 된다', () => {
  const withQuery = signRequest({
    apiSecret: API_SECRET,
    timestamp: TIMESTAMP,
    method: 'GET',
    requestPath: '/api/v1/orders?symbol=XBTUSDTM',
  });
  const withoutQuery = signRequest({
    apiSecret: API_SECRET,
    timestamp: TIMESTAMP,
    method: 'GET',
    requestPath: '/api/v1/orders',
  });
  assert.notEqual(withQuery, withoutQuery);
});
