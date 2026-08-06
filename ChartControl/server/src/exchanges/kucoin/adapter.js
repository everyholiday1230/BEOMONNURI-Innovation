/**
 * KuCoin 원형 응답 -> 내부 정규 모델 변환.
 *
 * 내부 정규 모델은 거래소에 독립적이다. 거래소를 갈아끼울 때
 * 이 파일만 새로 쓰면 되고, market/ 과 프론트엔드는 손대지 않는다.
 *
 * ── 반드시 지켜야 할 실측 사실 (2026-08-04 확인) ─────────────────────
 *
 * 1) 캔들 필드 순서가 REST 와 WS 에서 다르다.
 *      REST /api/v1/kline/query :
 *        [ timeMs,  open, high,  low,  close, volumeContracts, turnoverUSDT ]
 *      WS  /contractMarket/limitCandle :
 *        [ timeSec, open, close, high, low,   turnoverUSDT,    volumeContracts ]
 *    표본 7/7 이 WS 해석 B 와 일치했고 A 는 1/7 이었다.
 *    섞어 쓰면 고가/저가가 뒤바뀌어 차트가 조용히 깨진다.
 *
 * 2) 수량 단위는 "계약 수(contracts)" 이다. 기초자산 수량으로 바꾸려면
 *    multiplier 를 곱해야 한다. 예) XBTUSDTM multiplier=0.001
 *      808 contracts -> 0.808 BTC
 *    UI 는 기초자산 수량을 기대하므로 반드시 변환한다.
 *
 * 3) 타임스탬프 단위가 엔드포인트마다 다르다.
 *      ticker.ts, trade.ts        : 나노초(ns)
 *      limitCandle.time           : 밀리초(ms)
 *      limitCandle.candles[0]     : 초(s)
 *      kline/query 의 [0]         : 밀리초(ms)
 *      depth20.timestamp          : 밀리초(ms)
 *
 * 4) side 는 taker(체결 주도) 방향이며 'buy' | 'sell' 로 명시된다.
 *    추론이 필요 없다.
 * ─────────────────────────────────────────────────────────────────
 */

import { toInternal } from './symbols.js';

const NS_PER_MS = 1e6;

function num(v) {
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** 나노초 -> 밀리초. 이미 ms 범위면 그대로 둔다(방어적). */
function nsToMs(ts) {
  const n = num(ts);
  if (n <= 0) return Date.now();
  // 2001-09-09 이후의 ms 는 1e12 이상. ns 는 1e18 규모.
  return n > 1e15 ? Math.round(n / NS_PER_MS) : n;
}

function secToMs(ts) {
  const n = num(ts);
  return n > 1e12 ? n : Math.round(n * 1000);
}

// ---------------------------------------------------------------------------
// 계약 사양
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Instrument
 * @property {string} symbol         내부 심볼 (BTCUSDT)
 * @property {string} exchangeSymbol KuCoin 심볼 (XBTUSDTM)
 * @property {string} base
 * @property {string} quote
 * @property {number} multiplier     계약 1개당 기초자산 수량
 * @property {number} tickSize       최소 호가 단위
 * @property {number} lotSize        최소 주문 계약 수
 * @property {number} maxLeverage
 * @property {number} makerFeeRate
 * @property {number} takerFeeRate
 * @property {string} status         Open | Pause | Close ...
 * @property {boolean} tradable
 */

/** contracts/active 의 한 항목을 Instrument 로 변환. */
export function normalizeInstrument(c) {
  const symbol = toInternal(c.symbol);
  if (!symbol) return null;
  return {
    symbol,
    exchangeSymbol: c.symbol,
    // KuCoin 은 BTC 를 XBT 로 표기하므로 내부 심볼에서 base 를 역산한다.
    base: symbol.slice(0, -4),
    quote: 'USDT',
    multiplier: num(c.multiplier),
    tickSize: num(c.tickSize),
    lotSize: num(c.lotSize) || 1,
    maxLeverage: num(c.maxLeverage),
    makerFeeRate: num(c.makerFeeRate),
    takerFeeRate: num(c.takerFeeRate),
    status: c.status,
    tradable: c.status === 'Open',
  };
}

/**
 * contracts/active 항목에서 24시간 통계 티커를 만든다.
 * allTickers 에는 24h 필드가 없어서 이쪽을 쓴다.
 */
export function normalizeTickerFromContract(c) {
  const symbol = toInternal(c.symbol);
  if (!symbol) return null;
  const last = num(c.lastTradePrice);
  return {
    symbol,
    exchangeSymbol: c.symbol,
    last,
    mark: num(c.markPrice) || last,
    index: num(c.indexPrice) || last,
    high24h: num(c.highPrice),
    low24h: num(c.lowPrice),
    // priceChgPct 는 비율(0.0171 = +1.71%). UI 는 퍼센트 숫자를 기대한다.
    chg24hPct: num(c.priceChgPct) * 100,
    chg24hAbs: num(c.priceChg),
    // volumeOf24h = 기초자산 수량, turnoverOf24h = USDT 명목가치.
    // UI 의 vol24h 는 USD 명목가치이므로 turnover 를 쓴다.
    vol24hBase: num(c.volumeOf24h),
    vol24hQuote: num(c.turnoverOf24h),
    openInterest: num(c.openInterest),
    fundingRate: num(c.fundingFeeRate),
    nextFundingTime: num(c.nextFundingRateDateTime) || null,
    tradable: c.status === 'Open',
    ts: Date.now(),
  };
}

/** /api/v1/ticker (최근 체결 + BBO). 24h 필드는 없다. */
export function normalizeTicker(t) {
  const symbol = toInternal(t.symbol);
  if (!symbol) return null;
  return {
    symbol,
    exchangeSymbol: t.symbol,
    last: num(t.price),
    bid: num(t.bestBidPrice),
    ask: num(t.bestAskPrice),
    sequence: t.sequence,
    ts: nsToMs(t.ts),
  };
}

/** WS /contractMarket/ticker 페이로드. REST ticker 와 동일 형태. */
export const normalizeWsTicker = normalizeTicker;

// ---------------------------------------------------------------------------
// 오더북
// ---------------------------------------------------------------------------

/**
 * 호가를 누적수량까지 계산해 정규화한다.
 * 입력 levels: [[price, sizeContracts], ...]
 * bids 는 내림차순, asks 는 오름차순으로 정렬해 반환한다.
 */
function normalizeLevels(levels, multiplier, descending) {
  const rows = (levels || [])
    .map((l) => ({ price: num(l[0]), size: num(l[1]) }))
    .filter((l) => l.price > 0 && l.size > 0);

  rows.sort((a, b) => (descending ? b.price - a.price : a.price - b.price));

  let cumulative = 0;
  return rows.map((l) => {
    const amount = l.size * multiplier;
    cumulative += amount;
    return {
      price: l.price,
      amount,
      cumulative,
      contracts: l.size,
    };
  });
}

/**
 * @param {object} raw depth20/depth100 또는 WS level2Depth5 페이로드
 * @param {Instrument} instrument
 */
export function normalizeOrderBook(raw, instrument) {
  const multiplier = instrument?.multiplier || 1;
  const bids = normalizeLevels(raw.bids, multiplier, true);
  const asks = normalizeLevels(raw.asks, multiplier, false);

  const bestBid = bids[0]?.price ?? 0;
  const bestAsk = asks[0]?.price ?? 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;

  return {
    symbol: instrument?.symbol ?? toInternal(raw.symbol),
    bids,
    asks,
    mid,
    spread: bestBid && bestAsk ? bestAsk - bestBid : 0,
    sequence: raw.sequence,
    ts: num(raw.timestamp) || Date.now(),
  };
}

// ---------------------------------------------------------------------------
// 체결
// ---------------------------------------------------------------------------

/**
 * trade/history 항목 또는 WS execution 페이로드를 정규화.
 * side 는 taker 방향이므로 그대로 사용한다.
 */
export function normalizeTrade(raw, instrument) {
  const multiplier = instrument?.multiplier || 1;
  return {
    symbol: instrument?.symbol ?? toInternal(raw.symbol),
    id: String(raw.tradeId ?? raw.sequence ?? ''),
    time: nsToMs(raw.ts),
    price: num(raw.price),
    amount: num(raw.size) * multiplier,
    contracts: num(raw.size),
    side: raw.side === 'buy' ? 'buy' : 'sell',
  };
}

export function normalizeTrades(rawList, instrument) {
  return (rawList || []).map((r) => normalizeTrade(r, instrument));
}

// ---------------------------------------------------------------------------
// 캔들 — 경로별로 파서가 분리되어 있다. 절대 합치지 말 것.
// ---------------------------------------------------------------------------

/**
 * REST /api/v1/kline/query 한 행.
 * 순서: [ timeMs, open, high, low, close, volumeContracts, turnoverUSDT ]
 */
export function normalizeRestCandle(row, instrument) {
  const multiplier = instrument?.multiplier || 1;
  return {
    time: num(row[0]),
    open: num(row[1]),
    high: num(row[2]),
    low: num(row[3]),
    close: num(row[4]),
    volume: num(row[5]) * multiplier,
    turnover: num(row[6]),
  };
}

export function normalizeRestCandles(rows, instrument) {
  return (rows || [])
    .map((r) => normalizeRestCandle(r, instrument))
    .filter((c) => c.time > 0 && c.close > 0)
    .sort((a, b) => a.time - b.time);
}

/**
 * WS /contractMarket/limitCandle 한 행.
 * 순서: [ timeSec, open, close, high, low, turnoverUSDT, volumeContracts ]
 *
 * REST 와 순서가 다르다. 이 함수는 REST 행에 절대 사용하지 말 것.
 */
export function normalizeWsCandle(row, instrument) {
  const multiplier = instrument?.multiplier || 1;
  const open = num(row[1]);
  const close = num(row[2]);
  let high = num(row[3]);
  let low = num(row[4]);

  // 방어: KuCoin 이 순서를 바꾸더라도 OHLC 불변식은 지킨다.
  high = Math.max(high, open, close);
  low = low > 0 ? Math.min(low, open, close) : Math.min(open, close);

  return {
    time: secToMs(row[0]),
    open,
    high,
    low,
    close,
    volume: num(row[6]) * multiplier,
    turnover: num(row[5]),
  };
}
