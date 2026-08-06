/**
 * 심볼/타임프레임 매핑 검증.
 * 기대값은 2026-08-04 KuCoin contracts/active (679건) 실측 조회에 근거한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTED_TIMEFRAMES,
  UNSUPPORTED,
  toGranularity,
  toInternal,
  toKucoin,
  toWsCandleSuffix,
} from '../src/exchanges/kucoin/symbols.js';

test('BTC 는 KuCoin 에서 XBT 표기를 쓴다', () => {
  assert.equal(toKucoin('BTCUSDT'), 'XBTUSDTM');
  assert.equal(toInternal('XBTUSDTM'), 'BTCUSDT');
});

test('MATIC 은 POL 로 리브랜딩되어 POLUSDTM 에 매핑된다', () => {
  assert.equal(toKucoin('MATICUSDT'), 'POLUSDTM');
  assert.equal(toInternal('POLUSDTM'), 'MATICUSDT');
});

test('일반 심볼은 <BASE>USDTM 규칙을 따른다', () => {
  const cases = {
    ETHUSDT: 'ETHUSDTM',
    SOLUSDT: 'SOLUSDTM',
    BNBUSDT: 'BNBUSDTM',
    XRPUSDT: 'XRPUSDTM',
    DOGEUSDT: 'DOGEUSDTM',
    AVAXUSDT: 'AVAXUSDTM',
    LINKUSDT: 'LINKUSDTM',
    ARBUSDT: 'ARBUSDTM',
    OPUSDT: 'OPUSDTM',
    ATOMUSDT: 'ATOMUSDTM',
    DOTUSDT: 'DOTUSDTM',
    ADAUSDT: 'ADAUSDTM',
    NEARUSDT: 'NEARUSDTM',
    INJUSDT: 'INJUSDTM',
    APTUSDT: 'APTUSDTM',
    SUIUSDT: 'SUIUSDTM',
    FILUSDT: 'FILUSDTM',
    LTCUSDT: 'LTCUSDTM',
  };
  for (const [internal, kucoin] of Object.entries(cases)) {
    assert.equal(toKucoin(internal), kucoin, `${internal} -> ${kucoin}`);
    assert.equal(toInternal(kucoin), internal, `${kucoin} -> ${internal}`);
  }
});

test('왕복 변환이 항등이다 (지원 심볼 전체)', () => {
  const symbols = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT',
    'AVAXUSDT', 'LINKUSDT', 'MATICUSDT', 'ARBUSDT', 'OPUSDT', 'ATOMUSDT',
    'DOTUSDT', 'ADAUSDT', 'NEARUSDT', 'INJUSDT', 'APTUSDT', 'SUIUSDT',
    'FILUSDT', 'LTCUSDT',
  ];
  for (const s of symbols) {
    assert.equal(toInternal(toKucoin(s)), s, `왕복 실패: ${s}`);
  }
});

test('TON 은 KuCoin 선물 미상장이라 null 을 반환한다', () => {
  assert.ok(UNSUPPORTED.has('TONUSDT'));
  assert.equal(toKucoin('TONUSDT'), null);
});

test('USDT 마켓이 아니면 null', () => {
  assert.equal(toKucoin('BTCUSD'), null);
  assert.equal(toKucoin('BTCBUSD'), null);
  assert.equal(toKucoin(''), null);
  assert.equal(toKucoin(null), null);
  assert.equal(toKucoin('USDT'), null); // base 가 비어 있음
});

test('KuCoin 심볼 파싱이 USDTM 접미사를 요구한다', () => {
  assert.equal(toInternal('XBTUSDT'), null);
  assert.equal(toInternal('USDTM'), null);
  assert.equal(toInternal(''), null);
});

test('타임프레임 -> granularity(분) 매핑', () => {
  assert.equal(toGranularity('1m'), 1);
  assert.equal(toGranularity('5m'), 5);
  assert.equal(toGranularity('15m'), 15);
  assert.equal(toGranularity('30m'), 30);
  assert.equal(toGranularity('1H'), 60);
  assert.equal(toGranularity('4H'), 240);
  assert.equal(toGranularity('1D'), 1440);
});

test('KuCoin 에 없는 3m 은 5m 으로 승격된다', () => {
  // 프론트엔드 mock-data.js 의 tfMinutes 에는 3m 이 있으나
  // KuCoin 선물 granularity 허용값(1,5,15,30,60,120,240,480,720,1440,10080)에는 없다.
  assert.equal(toGranularity('3m'), 5);
});

test('알 수 없는 타임프레임은 null', () => {
  assert.equal(toGranularity('7m'), null);
  assert.equal(toGranularity('1Y'), null);
  assert.equal(toGranularity(''), null);
});

test('WS 캔들 채널 접미사 매핑', () => {
  assert.equal(toWsCandleSuffix('1m'), '1min');
  assert.equal(toWsCandleSuffix('15m'), '15min');
  assert.equal(toWsCandleSuffix('1H'), '1hour');
  assert.equal(toWsCandleSuffix('4H'), '4hour');
  assert.equal(toWsCandleSuffix('1D'), '1day');
  assert.equal(toWsCandleSuffix('1W'), '1week');
  assert.equal(toWsCandleSuffix('7m'), null);
});

test('프론트엔드 차트 툴바의 7개 타임프레임을 모두 지원한다', () => {
  // app.jsx ChartWidget: ['1m','5m','15m','30m','1H','4H','1D']
  for (const tf of ['1m', '5m', '15m', '30m', '1H', '4H', '1D']) {
    assert.ok(SUPPORTED_TIMEFRAMES.includes(tf), `미지원 타임프레임: ${tf}`);
    assert.ok(toGranularity(tf) > 0);
    assert.ok(toWsCandleSuffix(tf));
  }
});
