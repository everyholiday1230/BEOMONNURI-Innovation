/**
 * KuCoin 원형 응답 -> @quantumtrade/schemas 정규 모델.
 *
 * 이 파일이 KuCoin API 표류(drift)의 단일 지점이다. 거래소 응답 형태가 바뀌면
 * 여기만 고친다. 모든 출력은 Zod 로 검증한 뒤 통과시킨다 — 검증 실패한 한 행이
 * 전체 화면을 비우지 않도록 행 단위로 버린다.
 *
 * ══ 실측으로 확정한 사실 (2026-08-04). 추측 아님 ══════════════════════
 *
 * 1) 캔들 필드 순서가 REST 와 WS 에서 다르다.
 *      REST /api/v1/kline/query
 *        [ timeMs,  open, high,  low,  close, volumeContracts, turnoverUSDT ]
 *      WS  /contractMarket/limitCandle
 *        [ timeSec, open, close, high, low,   turnoverUSDT,    volumeContracts ]
 *    표본 7개 중 7개가 WS 해석과 일치했고, REST 해석은 1개만 우연히 맞았다.
 *    두 파서를 섞으면 고가/저가/종가가 뒤바뀌어 차트가 조용히 왜곡된다.
 *
 * 2) 수량 단위는 계약 수(contracts)다. 기초자산 수량으로 바꾸려면 multiplier 를
 *    곱해야 한다. 예) XBTUSDTM multiplier=0.001 → 808 계약 = 0.808 BTC
 *
 * 3) 타임스탬프 단위가 엔드포인트마다 다르다.
 *      ticker.ts, trade.ts     : 나노초
 *      limitCandle.candles[0]  : 초
 *      kline/query 행의 [0]    : 밀리초
 *      depth20.timestamp       : 밀리초
 *
 * 4) side 는 taker(체결 주도) 방향이며 'buy' | 'sell' 로 명시된다. 추론 불필요.
 *
 * 5) 24시간 통계(highPrice/lowPrice/priceChgPct/volumeOf24h/turnoverOf24h)는
 *    /api/v1/allTickers 에 없고 /api/v1/contracts/active 에 있다.
 *    선물에는 /api/v1/market/stats 가 아예 없다 (404).
 * ═══════════════════════════════════════════════════════════════════
 */

import {
  CandleSchema,
  OrderBookSchema,
  SymbolSchema,
  TickerSchema,
  TradeSchema,
  type Candle,
  type OrderBook,
  type SymbolInfo,
  type Ticker,
  type Trade,
} from '@quantumtrade/schemas';

import { nanosToMs, precisionFromStep, secondsToMs, toDecimalString } from './decimal.js';
import { toInternalSymbol } from './symbols.js';

// ---------------------------------------------------------------------------
// 원형 응답 타입 (KuCoin 이 실제로 주는 형태)
// ---------------------------------------------------------------------------

export interface KucoinContract {
  symbol: string;
  baseCurrency?: string;
  quoteCurrency?: string;
  multiplier?: number;
  tickSize?: number;
  lotSize?: number;
  maxLeverage?: number;
  makerFeeRate?: number;
  takerFeeRate?: number;
  /** 개시증거금률 (레버리지 한도의 역수에 가깝다). */
  initialMargin?: number;
  /** 유지증거금률. 이 아래로 떨어지면 청산된다. */
  maintainMargin?: number;
  status?: string;
  lastTradePrice?: number;
  markPrice?: number;
  indexPrice?: number;
  highPrice?: number;
  lowPrice?: number;
  priceChg?: number;
  priceChgPct?: number;
  volumeOf24h?: number;
  turnoverOf24h?: number;
  openInterest?: string | number;
  fundingFeeRate?: number;
  nextFundingRateDateTime?: number;
}

export interface KucoinTickerMsg {
  symbol: string;
  price?: string | number;
  bestBidPrice?: string | number;
  bestAskPrice?: string | number;
  sequence?: number;
  ts?: number;
}

export interface KucoinDepth {
  symbol?: string;
  sequence?: number;
  timestamp?: number;
  bids?: Array<[number | string, number | string]>;
  asks?: Array<[number | string, number | string]>;
}

export interface KucoinTradeMsg {
  symbol?: string;
  tradeId?: string | number;
  sequence?: number;
  ts?: number;
  size?: number | string;
  price?: string | number;
  side?: string;
}

/** 계약 사양. multiplier 는 수량 변환에 반드시 필요하므로 별도로 들고 다닌다. */
export interface KucoinInstrument {
  /** 내부 심볼 (BTCUSDT) */
  symbol: string;
  /** KuCoin 심볼 (XBTUSDTM) */
  exchangeSymbol: string;
  /** 계약 1개당 기초자산 수량 */
  multiplier: number;
  /**
   * 거래소 기본 수수료율 (소수, 예: 0.0006 = 0.06%).
   *
   * 사용자별 할인(VIP 등급·리베이트)은 반영되지 않은 **기본값**이다.
   * 이 값을 "고객이 실제로 내는 수수료" 로 표시하면 안 된다 — 등급에 따라 다르다.
   */
  takerFeeRate?: number;
  makerFeeRate?: number;
  /** 펀딩비율 (8시간마다 정산). 무기한 선물에만 있다. */
  fundingFeeRate?: number;
  /** 개시증거금률·유지증거금률. 청산가 계산과 레버리지 한도에 쓰인다. */
  initialMarginRate?: number;
  maintenanceMarginRate?: number;
  info: SymbolInfo;
  tradable: boolean;
}

// ---------------------------------------------------------------------------
// 계약 사양
// ---------------------------------------------------------------------------

/** contracts/active 의 한 항목을 정규 SymbolInfo + multiplier 로 변환. */
export function normalizeInstrument(raw: KucoinContract): KucoinInstrument | null {
  const symbol = toInternalSymbol(raw.symbol);
  if (!symbol) return null;

  const multiplier = Number(raw.multiplier);
  if (!Number.isFinite(multiplier) || multiplier <= 0) return null;

  const tickSize = toDecimalString(raw.tickSize ?? 0);
  // stepSize 는 "주문 수량의 최소 증분"이다. KuCoin 은 계약 수로 주문하고
  // lotSize 가 최소 증분이므로, 기초자산 기준으로는 lotSize * multiplier 가 된다.
  const lotSize = Number(raw.lotSize) || 1;
  const stepSize = toDecimalString(lotSize * multiplier);
  if (tickSize === null || stepSize === null) return null;

  /**
   * 수수료·증거금률.
   *
   * 없거나 숫자가 아니면 undefined 로 둔다. 0 으로 채우면 "수수료 무료" 라는
   * 거짓이 되고, 사용자가 비용을 잘못 계산한다.
   */
  const rate = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const candidate = {
    id: symbol,
    base: symbol.slice(0, -4),
    quote: 'USDT',
    contractType: 'perpetual' as const,
    pricePrecision: precisionFromStep(tickSize),
    quantityPrecision: precisionFromStep(stepSize),
    tickSize,
    stepSize,
    minQty: stepSize,
    maxLeverage: Number(raw.maxLeverage) > 0 ? Number(raw.maxLeverage) : 20,
  };

  const parsed = SymbolSchema.safeParse(candidate);
  if (!parsed.success) return null;

  return {
    symbol,
    exchangeSymbol: raw.symbol,
    multiplier,
    // 거래소 기본 수수료율. 사용자별 할인은 반영되지 않는다.
    takerFeeRate: rate(raw.takerFeeRate),
    makerFeeRate: rate(raw.makerFeeRate),
    fundingFeeRate: rate(raw.fundingFeeRate),
    initialMarginRate: rate(raw.initialMargin),
    maintenanceMarginRate: rate(raw.maintainMargin),
    info: parsed.data,
    tradable: raw.status === 'Open',
  };
}

/**
 * contracts/active 항목에서 24시간 통계 티커를 만든다.
 * allTickers 에는 24h 필드가 없어서 이쪽을 쓴다.
 */
export function normalizeTickerFromContract(raw: KucoinContract): Ticker | null {
  const symbol = toInternalSymbol(raw.symbol);
  if (!symbol) return null;

  const last = toDecimalString(raw.lastTradePrice ?? 0);
  if (last === null) return null;

  const candidate: Record<string, unknown> = {
    symbol,
    last,
    // priceChgPct 는 비율(0.0171 = +1.71%). 정규 모델은 퍼센트 숫자를 쓴다.
    changePct: Number(raw.priceChgPct ?? 0) * 100,
  };

  const optional: Array<[string, number | undefined]> = [
    ['markPrice', raw.markPrice],
    ['indexPrice', raw.indexPrice],
    ['high24h', raw.highPrice],
    ['low24h', raw.lowPrice],
    // vol24h 는 USDT 명목가치(turnover)를 쓴다. 화면의 "24H 거래량"이 금액이기 때문.
    ['vol24h', raw.turnoverOf24h],
  ];
  for (const [key, value] of optional) {
    if (value === undefined || value === null) continue;
    const s = toDecimalString(value);
    if (s !== null) candidate[key] = s;
  }

  if (Number.isFinite(Number(raw.fundingFeeRate))) {
    candidate.fundingRate = Number(raw.fundingFeeRate);
  }
  const nextFunding = Number(raw.nextFundingRateDateTime);
  if (Number.isFinite(nextFunding) && nextFunding > 0) {
    candidate.nextFundingAt = Math.round(nextFunding);
  }

  const parsed = TickerSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * 실시간 ticker (REST /api/v1/ticker 또는 WS /contractMarket/ticker).
 * 24h 필드가 없으므로, 호출자가 contracts/active 기반 값과 병합해야 한다.
 * `previous` 를 주면 24h 필드를 보존한다.
 */
export function normalizeLiveTicker(raw: KucoinTickerMsg, previous?: Ticker): Ticker | null {
  const symbol = toInternalSymbol(raw.symbol);
  if (!symbol) return null;

  const last = toDecimalString(raw.price ?? 0);
  if (last === null) return null;

  const candidate: Record<string, unknown> = {
    ...(previous ?? {}),
    symbol,
    last,
    changePct: previous?.changePct ?? 0,
  };

  const parsed = TickerSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// 오더북
// ---------------------------------------------------------------------------

/**
 * 호가를 정규 OrderBook 으로 변환한다.
 *
 * 입력 levels: [[price, sizeContracts], ...]
 * 출력 levels: [[priceDecimalString, baseQtyDecimalString], ...]
 *
 * bids 는 내림차순, asks 는 오름차순으로 정렬한다. KuCoin 이 정렬해 주지만,
 * 정렬을 신뢰하면 최우선호가가 뒤바뀌었을 때 스프레드가 음수가 되고
 * 주문 미리보기가 엉뚱해진다. 그래서 우리가 다시 정렬한다.
 */
export function normalizeOrderBook(
  raw: KucoinDepth,
  instrument: Pick<KucoinInstrument, 'symbol' | 'multiplier'>,
  opts: { isSnapshot?: boolean } = {},
): OrderBook | null {
  const levels = (
    side: Array<[number | string, number | string]> | undefined,
    descending: boolean,
  ): Array<[string, string]> => {
    const rows: Array<{ price: number; size: number }> = [];
    for (const level of side ?? []) {
      const price = Number(level?.[0]);
      const size = Number(level?.[1]);
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!Number.isFinite(size) || size <= 0) continue;
      rows.push({ price, size });
    }
    rows.sort((a, b) => (descending ? b.price - a.price : a.price - b.price));

    const out: Array<[string, string]> = [];
    for (const row of rows) {
      const p = toDecimalString(row.price);
      const q = toDecimalString(row.size * instrument.multiplier);
      if (p === null || q === null) continue;
      out.push([p, q]);
    }
    return out;
  };

  const candidate = {
    symbol: instrument.symbol,
    // sequence 는 증분 갱신 순서 검증에 쓰인다. 없으면 0.
    sequence: Number.isFinite(Number(raw.sequence)) ? Math.max(0, Math.round(Number(raw.sequence))) : 0,
    bids: levels(raw.bids, true),
    asks: levels(raw.asks, false),
    asOf: Number.isFinite(Number(raw.timestamp)) && Number(raw.timestamp) > 0
      ? Math.round(Number(raw.timestamp))
      : Date.now(),
    isSnapshot: opts.isSnapshot ?? false,
  };

  const parsed = OrderBookSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// 체결
// ---------------------------------------------------------------------------

export function normalizeTrade(
  raw: KucoinTradeMsg,
  instrument: Pick<KucoinInstrument, 'multiplier'>,
): Trade | null {
  const price = toDecimalString(raw.price ?? 0);
  const size = toDecimalString(Number(raw.size ?? 0) * instrument.multiplier);
  if (price === null || size === null) return null;

  const id = String(raw.tradeId ?? raw.sequence ?? '');
  if (!id) return null;

  const candidate = {
    id,
    price,
    size,
    // taker 방향이 명시되므로 그대로 쓴다. 알 수 없는 값은 버린다(추측 금지).
    side: raw.side === 'buy' ? 'buy' : raw.side === 'sell' ? 'sell' : null,
    ts: nanosToMs(raw.ts ?? 0) || Date.now(),
  };
  if (candidate.side === null) return null;

  const parsed = TradeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function normalizeTrades(
  rows: KucoinTradeMsg[] | undefined,
  instrument: Pick<KucoinInstrument, 'multiplier'>,
): Trade[] {
  const out: Trade[] = [];
  for (const row of rows ?? []) {
    const t = normalizeTrade(row, instrument);
    if (t) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 캔들 — REST 와 WS 의 파서를 절대 합치지 말 것 (파일 상단 주석 1번 참조)
// ---------------------------------------------------------------------------

export type KucoinRestKlineRow = Array<number | string>;

/**
 * REST /api/v1/kline/query 한 행.
 * 순서: [ timeMs, open, high, low, close, volumeContracts, turnoverUSDT ]
 */
export function normalizeRestCandle(
  row: KucoinRestKlineRow,
  instrument: Pick<KucoinInstrument, 'multiplier'>,
): Candle | null {
  if (!Array.isArray(row) || row.length < 5) return null;

  const time = Math.round(Number(row[0] ?? 0));
  const open = toDecimalString(row[1] ?? 0);
  const high = toDecimalString(row[2] ?? 0);
  const low = toDecimalString(row[3] ?? 0);
  const close = toDecimalString(row[4] ?? 0);
  const volume = toDecimalString(Number(row[5] ?? 0) * instrument.multiplier);

  if (!Number.isFinite(time) || time <= 0) return null;
  if (open === null || high === null || low === null || close === null || volume === null) return null;

  const parsed = CandleSchema.safeParse({ time, open, high, low, close, volume, closed: true });
  return parsed.success ? parsed.data : null;
}

export function normalizeRestCandles(
  rows: KucoinRestKlineRow[] | undefined,
  instrument: Pick<KucoinInstrument, 'multiplier'>,
): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const row of rows ?? []) {
    const c = normalizeRestCandle(row, instrument);
    if (c) byTime.set(c.time, c);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * WS /contractMarket/limitCandle 한 행.
 * 순서: [ timeSec, open, close, high, low, turnoverUSDT, volumeContracts ]
 *
 * REST 와 순서가 다르다. REST 행에 이 함수를 쓰면 안 된다.
 * WS 캔들은 진행 중이므로 closed=false 로 표시한다.
 */
export function normalizeWsCandle(
  row: Array<number | string>,
  instrument: Pick<KucoinInstrument, 'multiplier'>,
): Candle | null {
  if (!Array.isArray(row) || row.length < 5) return null;

  const time = secondsToMs(row[0] ?? 0);
  const openN = Number(row[1]);
  const closeN = Number(row[2]);
  let highN = Number(row[3]);
  let lowN = Number(row[4]);

  if (!Number.isFinite(time) || time <= 0) return null;
  if (!Number.isFinite(openN) || !Number.isFinite(closeN)) return null;

  // 방어: KuCoin 이 순서를 바꾸더라도 OHLC 불변식(high >= max(o,c), low <= min(o,c))은
  // 지킨다. 불변식이 깨진 캔들은 CandleSchema 가 거부해 화면이 비어버린다.
  if (!Number.isFinite(highN)) highN = Math.max(openN, closeN);
  if (!Number.isFinite(lowN) || lowN <= 0) lowN = Math.min(openN, closeN);
  highN = Math.max(highN, openN, closeN);
  lowN = Math.min(lowN, openN, closeN);

  const open = toDecimalString(openN);
  const close = toDecimalString(closeN);
  const high = toDecimalString(highN);
  const low = toDecimalString(lowN);
  const volume = toDecimalString(Number(row[6] ?? 0) * instrument.multiplier);

  if (open === null || close === null || high === null || low === null || volume === null) return null;

  const parsed = CandleSchema.safeParse({ time, open, high, low, close, volume, closed: false });
  return parsed.success ? parsed.data : null;
}
