/**
 * 정규화 어댑터 검증.
 *
 * 입력 픽스처는 모두 2026-08-04 KuCoin 실응답에서 그대로 따온 값이다.
 * 특히 캔들 필드 순서(REST vs WS)는 실측으로 확정한 것이며, 여기서 회귀를 막는다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeInstrument,
  normalizeOrderBook,
  normalizeRestCandle,
  normalizeRestCandles,
  normalizeTicker,
  normalizeTickerFromContract,
  normalizeTrade,
  normalizeWsCandle,
} from '../src/exchanges/kucoin/adapter.js';

/** XBTUSDTM contracts/active 실응답 발췌 */
const XBT_CONTRACT = {
  symbol: 'XBTUSDTM',
  baseCurrency: 'XBT',
  quoteCurrency: 'USDT',
  multiplier: 0.001,
  tickSize: 0.1,
  lotSize: 1,
  maxLeverage: 125,
  makerFeeRate: 0.0002,
  takerFeeRate: 0.0006,
  status: 'Open',
  lastTradePrice: 63752.2,
  markPrice: 63752.2,
  indexPrice: 63773.0,
  highPrice: 64229.2,
  lowPrice: 62415.8,
  priceChg: 1075.7,
  priceChgPct: 0.0171,
  volumeOf24h: 5804.766,
  turnoverOf24h: 368879607.0544,
  openInterest: 21328636,
  fundingFeeRate: 3.8e-5,
  nextFundingRateDateTime: 1785859200000,
};

const XBT = normalizeInstrument(XBT_CONTRACT);

test('계약 사양 정규화: XBT -> BTC 로 base 를 되돌린다', () => {
  assert.equal(XBT.symbol, 'BTCUSDT');
  assert.equal(XBT.exchangeSymbol, 'XBTUSDTM');
  assert.equal(XBT.base, 'BTC'); // XBT 가 아니라 BTC
  assert.equal(XBT.quote, 'USDT');
  assert.equal(XBT.multiplier, 0.001);
  assert.equal(XBT.tickSize, 0.1);
  assert.equal(XBT.tradable, true);
});

test('status 가 Open 이 아니면 tradable=false', () => {
  const paused = normalizeInstrument({ ...XBT_CONTRACT, status: 'Pause' });
  assert.equal(paused.tradable, false);
});

test('24h 티커: priceChgPct 비율을 퍼센트로 변환한다', () => {
  const t = normalizeTickerFromContract(XBT_CONTRACT);
  // 0.0171 (비율) -> 1.71 (%). UI 는 퍼센트 숫자를 그대로 찍는다.
  assert.ok(Math.abs(t.chg24hPct - 1.71) < 1e-9, `got ${t.chg24hPct}`);
  assert.equal(t.high24h, 64229.2);
  assert.equal(t.low24h, 62415.8);
});

test('24h 거래대금은 turnover(USDT), 거래량은 base 수량으로 분리한다', () => {
  const t = normalizeTickerFromContract(XBT_CONTRACT);
  assert.equal(t.vol24hQuote, 368879607.0544); // USDT 명목가치
  assert.equal(t.vol24hBase, 5804.766); // BTC 수량
  // 정합성: turnover ≈ volume * 평균가. 대략적으로만 확인.
  const impliedPrice = t.vol24hQuote / t.vol24hBase;
  assert.ok(impliedPrice > 50000 && impliedPrice < 80000, `implied ${impliedPrice}`);
});

test('ticker ts 는 나노초이므로 밀리초로 변환한다', () => {
  const t = normalizeTicker({
    symbol: 'XBTUSDTM',
    price: '63747',
    bestBidPrice: '63741.8',
    bestAskPrice: '63741.9',
    sequence: 1746282431049,
    ts: 1785841375712000000, // ns
  });
  assert.equal(t.symbol, 'BTCUSDT');
  assert.equal(t.ts, 1785841375712); // ms
  assert.equal(t.last, 63747);
  assert.equal(t.bid, 63741.8);
  assert.equal(t.ask, 63741.9);
});

test('이미 밀리초인 타임스탬프는 그대로 둔다', () => {
  const t = normalizeTicker({ symbol: 'XBTUSDTM', price: '1', ts: 1785841375712 });
  assert.equal(t.ts, 1785841375712);
});

// ---------------------------------------------------------------------------
// 오더북
// ---------------------------------------------------------------------------

test('오더북: 계약 수를 multiplier 로 기초자산 수량으로 변환한다', () => {
  const book = normalizeOrderBook(
    {
      symbol: 'XBTUSDTM',
      sequence: 1,
      timestamp: 1785841052100,
      bids: [[63738.2, 454], [63736.6, 28]],
      asks: [[63738.3, 508], [63738.4, 129]],
    },
    XBT,
  );

  // 454 계약 * 0.001 = 0.454 BTC
  assert.ok(Math.abs(book.bids[0].amount - 0.454) < 1e-12, `got ${book.bids[0].amount}`);
  assert.equal(book.bids[0].contracts, 454);
  assert.ok(Math.abs(book.asks[0].amount - 0.508) < 1e-12);
});

test('오더북: 누적수량이 단조증가한다', () => {
  const book = normalizeOrderBook(
    {
      symbol: 'XBTUSDTM',
      bids: [[100, 10], [99, 20], [98, 30]],
      asks: [[101, 5], [102, 15]],
    },
    XBT,
  );
  assert.deepEqual(
    book.bids.map((b) => b.cumulative),
    [0.01, 0.03, 0.06],
  );
  assert.deepEqual(
    book.asks.map((a) => a.cumulative),
    [0.005, 0.02],
  );
});

test('오더북: bids 는 내림차순, asks 는 오름차순으로 정렬된다', () => {
  const book = normalizeOrderBook(
    {
      symbol: 'XBTUSDTM',
      bids: [[98, 1], [100, 1], [99, 1]], // 뒤섞인 입력
      asks: [[103, 1], [101, 1], [102, 1]],
    },
    XBT,
  );
  assert.deepEqual(book.bids.map((b) => b.price), [100, 99, 98]);
  assert.deepEqual(book.asks.map((a) => a.price), [101, 102, 103]);
  assert.equal(book.mid, 100.5);
  assert.equal(book.spread, 1);
});

test('오더북: 수량 0 또는 가격 0 호가는 제거한다', () => {
  const book = normalizeOrderBook(
    { symbol: 'XBTUSDTM', bids: [[100, 0], [99, 5]], asks: [[0, 5], [101, 5]] },
    XBT,
  );
  assert.equal(book.bids.length, 1);
  assert.equal(book.bids[0].price, 99);
  assert.equal(book.asks.length, 1);
  assert.equal(book.asks[0].price, 101);
});

test('오더북: 한쪽이 비어도 터지지 않는다', () => {
  const book = normalizeOrderBook({ symbol: 'XBTUSDTM', bids: [], asks: [[101, 5]] }, XBT);
  assert.equal(book.bids.length, 0);
  assert.equal(book.mid, 101);
  assert.equal(book.spread, 0);
});

// ---------------------------------------------------------------------------
// 체결
// ---------------------------------------------------------------------------

test('체결: side 는 taker 방향을 그대로 쓰고 수량을 변환한다', () => {
  const t = normalizeTrade(
    {
      symbol: 'XBTUSDTM',
      tradeId: '1939870872382',
      ts: 1785841369694000000, // ns
      size: 31,
      price: '63748',
      side: 'sell',
    },
    XBT,
  );
  assert.equal(t.symbol, 'BTCUSDT');
  assert.equal(t.id, '1939870872382');
  assert.equal(t.time, 1785841369694);
  assert.equal(t.price, 63748);
  assert.ok(Math.abs(t.amount - 0.031) < 1e-12);
  assert.equal(t.contracts, 31);
  assert.equal(t.side, 'sell');
});

test('체결: side 가 buy 가 아니면 sell 로 정규화한다', () => {
  for (const raw of ['sell', 'SELL', undefined, null, 'x']) {
    assert.equal(normalizeTrade({ symbol: 'XBTUSDTM', size: 1, price: '1', side: raw }, XBT).side, 'sell');
  }
  assert.equal(normalizeTrade({ symbol: 'XBTUSDTM', size: 1, price: '1', side: 'buy' }, XBT).side, 'buy');
});

// ---------------------------------------------------------------------------
// 캔들 — REST 와 WS 의 필드 순서가 다르다. 이 구역이 회귀 방지의 핵심.
// ---------------------------------------------------------------------------

test('REST 캔들 순서는 [tMs, o, h, l, c, volContracts, turnover] 이다', () => {
  // 실응답 1행
  const row = [1785000600000, 64242.7, 64287.4, 64225.0, 64259.8, 9486, 609487.4003];
  const c = normalizeRestCandle(row, XBT);

  assert.equal(c.time, 1785000600000);
  assert.equal(c.open, 64242.7);
  assert.equal(c.high, 64287.4);
  assert.equal(c.low, 64225.0);
  assert.equal(c.close, 64259.8);
  // 9486 계약 * 0.001 = 9.486 BTC
  assert.ok(Math.abs(c.volume - 9.486) < 1e-9, `got ${c.volume}`);
  assert.equal(c.turnover, 609487.4003);

  // OHLC 불변식
  assert.ok(c.high >= Math.max(c.open, c.close));
  assert.ok(c.low <= Math.min(c.open, c.close));
});

test('WS 캔들 순서는 [tSec, o, c, h, l, turnover, volContracts] 이다 (REST 와 다름)', () => {
  // 실측 WS 1행: 초 단위 시각, open=63735.8, close=63745, high=63748.1, low=63732.1
  const row = [1785841080, 63735.8, 63745, 63748.1, 63732.1, 9815.4693, 154];
  const c = normalizeWsCandle(row, XBT);

  assert.equal(c.time, 1785841080000); // 초 -> 밀리초
  assert.equal(c.open, 63735.8);
  assert.equal(c.close, 63745);
  assert.equal(c.high, 63748.1);
  assert.equal(c.low, 63732.1);
  // 154 계약 * 0.001 = 0.154 BTC
  assert.ok(Math.abs(c.volume - 0.154) < 1e-12, `got ${c.volume}`);
  assert.equal(c.turnover, 9815.4693);

  assert.ok(c.high >= Math.max(c.open, c.close));
  assert.ok(c.low <= Math.min(c.open, c.close));
});

test('두 파서를 서로 바꿔 쓰면 값이 달라진다 (혼용 금지 근거)', () => {
  const wsRow = [1785841080, 63735.8, 63745, 63748.1, 63732.1, 9815.4693, 154];
  const correct = normalizeWsCandle(wsRow, XBT);
  const wrong = normalizeRestCandle(wsRow, XBT);

  // REST 파서로 WS 행을 읽으면 high/low/close 가 뒤섞인다.
  assert.notEqual(wrong.close, correct.close);
  assert.notEqual(wrong.high, correct.high);
  // 그리고 시각 단위도 초로 잘못 해석되어 1970년대가 된다.
  assert.ok(wrong.time < 2e9, 'REST 파서는 초를 밀리초로 승격하지 않는다');
  assert.ok(correct.time > 1e12);
});

test('WS 캔들: OHLC 불변식을 방어적으로 강제한다', () => {
  // 만약 KuCoin 이 순서를 바꿔 high < open 인 행이 오더라도 차트를 깨지 않는다.
  const c = normalizeWsCandle([1785841080, 100, 110, 90, 95, 0, 0], XBT);
  assert.ok(c.high >= Math.max(c.open, c.close), `high=${c.high}`);
  assert.ok(c.low <= Math.min(c.open, c.close), `low=${c.low}`);
});

test('REST 캔들 배열: 시간 오름차순 정렬 + 불량행 제거', () => {
  const rows = [
    [3000, 3, 4, 2, 3.5, 10, 1],
    [1000, 1, 2, 0.5, 1.5, 10, 1],
    [2000, 2, 3, 1.5, 2.5, 10, 1],
    [0, 0, 0, 0, 0, 0, 0], // 불량
  ];
  const out = normalizeRestCandles(rows, XBT);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((c) => c.time), [1000, 2000, 3000]);
});

test('빈 입력에 대해 빈 배열을 반환한다', () => {
  assert.deepEqual(normalizeRestCandles(null, XBT), []);
  assert.deepEqual(normalizeRestCandles([], XBT), []);
});

test('instrument 가 없으면 multiplier 1 로 동작한다 (수량 변환만 생략)', () => {
  const c = normalizeRestCandle([1000, 1, 2, 0.5, 1.5, 10, 1], null);
  assert.equal(c.volume, 10);
});
