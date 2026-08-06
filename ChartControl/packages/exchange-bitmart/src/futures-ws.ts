import { TIMEFRAMES, type Timeframe } from '@quantumtrade/config';

/**
 * BitMart USD-M Futures V2 public WebSocket protocol.
 *
 * Pure protocol translation only — no sockets, no state. Everything here was verified against the live
 * endpoint on 2026-08-03, because the published documentation is wrong in three places that each cause a
 * silent failure rather than an error:
 *
 *  1. **The subscribe field is `action`, not `op`.** Our previous gateway sent `{op:'subscribe'}`.
 *  2. **Kline payloads are `{symbol, items:[...]}`**, not the flat `{symbol,o,h,l,c,v,ts}` the docs show.
 *     Reading `o` off the envelope yields `undefined`, which becomes `NaN`, which draws nothing.
 *  3. **The ping reply is not the string `pong`.** The docs say "Expect for a text string 'pong'"; the
 *     server actually sends `{"group":"System","data":"pong+<uuid>"}`. A client comparing `raw === 'pong'`
 *     never sees a reply and will tear down a healthy connection every interval.
 *
 * And one hard constraint the docs state only by omission:
 *
 *  4. **There is no 3-minute kline channel.** `futures/klineBin3m` answers
 *     `Invalid channel: not found`. `3m` is in our internal `TIMEFRAMES`, so it must be reported as
 *     unstreamable rather than quietly mapped to a neighbouring interval.
 */

export const FUTURES_WS_PUBLIC_URL = 'wss://openapi-ws-v2.bitmart.com/api?protocol=1.1';
export const FUTURES_WS_PRIVATE_URL = 'wss://openapi-ws-v2.bitmart.com/user?protocol=1.1';

/**
 * Server-side idle rules, from the docs and consistent with observed behaviour:
 *  - no data for 20s → the server closes the connection, so ping well inside that;
 *  - no subscription within 5s of connecting → the connection is deemed "lifeless" and closed.
 */
export const WS_IDLE_DISCONNECT_MS = 20_000;
export const WS_LIFELESS_MS = 5_000;
export const WS_PING_INTERVAL_MS = 8_000;
/** Max concurrent connections per IP, per the docs. One shared socket keeps us far below it. */
export const WS_MAX_CONNECTIONS_PER_IP = 500;

/**
 * Internal timeframe → WS channel suffix.
 *
 * Note the case change: the WS channel uses `1H`/`1D`/`1W` while our enum and the REST API use lowercase.
 * Verified: `futures/klineBin1h` is rejected with `Invalid channel`, so this is not cosmetic.
 */
const WS_KLINE_SUFFIX: Record<Timeframe, string | null> = {
  '1m': '1m',
  '3m': null, // no such channel — verified against the live server
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '2h': '2H',
  '4h': '4H',
  '1d': '1D',
  '1w': '1W',
};

/** Internal timeframe → REST `step` (minutes), used for history and gap-fill. */
export const REST_KLINE_STEP: Record<Timeframe, number> = {
  '1m': 1,
  '3m': 3,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '2h': 120,
  '4h': 240,
  '1d': 1440,
  '1w': 10080,
};

/** Timeframes that can actually be streamed. `3m` is absent — REST polling is the only option there. */
export const STREAMABLE_TIMEFRAMES: readonly Timeframe[] = TIMEFRAMES.filter(
  (tf) => WS_KLINE_SUFFIX[tf] !== null,
);

export function isStreamableTimeframe(tf: string): tf is Timeframe {
  return (TIMEFRAMES as readonly string[]).includes(tf) && WS_KLINE_SUFFIX[tf as Timeframe] !== null;
}

/**
 * Kline topic for a timeframe, or `null` when the exchange has no such channel.
 *
 * Returning null rather than falling back to a nearby interval is deliberate: a 3m subscriber silently
 * served 1m bars would see a chart that looks right and is wrong.
 */
export function klineTopic(symbol: string, tf: Timeframe): string | null {
  const suffix = WS_KLINE_SUFFIX[tf];
  return suffix === null ? null : `futures/klineBin${suffix}:${symbol}`;
}

export function tickerTopic(symbol: string): string {
  return `futures/ticker:${symbol}`;
}

export function tradeTopic(symbol: string): string {
  return `futures/trade:${symbol}`;
}

/** Depth topic. `level` must be 5/20/50; `speed` is 100ms or 200ms. */
export function depthTopic(symbol: string, level: 5 | 20 | 50 = 20, speed: '100ms' | '200ms' = '200ms'): string {
  return `futures/depth${level}:${symbol}@${speed}`;
}

export function bookTickerTopic(symbol: string): string {
  return `futures/bookticker:${symbol}`;
}

export function subscribeFrame(topics: readonly string[]): string {
  // `action`, not `op`. The previous implementation used `op` and every subscription was ignored.
  return JSON.stringify({ action: 'subscribe', args: [...topics] });
}

export function unsubscribeFrame(topics: readonly string[]): string {
  return JSON.stringify({ action: 'unsubscribe', args: [...topics] });
}

export function pingFrame(): string {
  return JSON.stringify({ action: 'ping' });
}

/** A candle in our canonical shape: decimal strings, epoch **milliseconds**. */
export interface WsCandle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  /** Streamed bars are the in-progress bar for their interval, so they are not closed. */
  closed: boolean;
}

export interface WsTicker {
  symbol: string;
  last: string;
  markPrice: string | null;
  indexPrice: string | null;
  /** Signed PERCENT, converted from the exchange's ratio (`range`). */
  changePct: number | null;
  vol24h: string | null;
  bid: string | null;
  ask: string | null;
}

export interface WsBookTicker {
  symbol: string;
  bid: string;
  bidVol: string;
  ask: string;
  askVol: string;
  ts: number;
}

export interface WsTrade {
  tradeId: string;
  symbol: string;
  price: string;
  volume: string;
  /** True when the BUYER is the maker. */
  buyerIsMaker: boolean;
  ts: number;
}

/** One side of a depth push. BitMart sends bids and asks as SEPARATE messages (`way` 1 vs 2). */
export interface WsDepthSide {
  symbol: string;
  side: 'bid' | 'ask';
  levels: { price: string; volume: string }[];
  ts: number;
}

export type WsFrame =
  | { kind: 'ack'; action: string; group: string | null; success: boolean; error: string | null }
  | { kind: 'pong' }
  | { kind: 'kline'; topic: string; symbol: string; timeframe: Timeframe; candles: WsCandle[] }
  | { kind: 'ticker'; topic: string; ticker: WsTicker }
  | { kind: 'bookticker'; topic: string; book: WsBookTicker }
  | { kind: 'trade'; topic: string; trades: WsTrade[] }
  | { kind: 'depth'; topic: string; depth: WsDepthSide }
  | { kind: 'unknown'; raw: string };

/** Reverse map from a WS suffix back to our timeframe, so a frame can be attributed to a subscription. */
const SUFFIX_TO_TIMEFRAME = new Map<string, Timeframe>(
  (Object.entries(WS_KLINE_SUFFIX) as [Timeframe, string | null][])
    .filter((e): e is [Timeframe, string] => e[1] !== null)
    .map(([tf, suffix]) => [suffix, tf]),
);

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Ratio → percent, 4dp.
 *
 * The futures feed reports change as a signed RATIO in both `change_24h` (REST) and `range` (WS). Taking
 * it as a percent understates every move by 100×.
 */
export function ratioToPercent(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100 * 10_000) / 10_000;
}

/** Seconds → milliseconds. Kline `ts` is in seconds; depth/bookticker `ms_t` is already ms. */
function secToMs(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000);
}

function msOf(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

interface RawEnvelope {
  action?: unknown;
  group?: unknown;
  success?: unknown;
  error?: unknown;
  data?: unknown;
}

/**
 * Parses one server frame.
 *
 * Never throws: a malformed or unrecognised frame becomes `{kind:'unknown'}` so the caller can count it
 * instead of losing the connection. Rows that fail validation are dropped rather than coerced — a candle
 * with `NaN` prices would render as a gap at zero.
 */
export function parseFrame(raw: string): WsFrame {
  // Some deployments/proxies still deliver a bare "pong"; the live server sends a System frame. Accept both.
  if (raw === 'pong' || raw === '"pong"') return { kind: 'pong' };

  let env: RawEnvelope;
  try {
    env = JSON.parse(raw) as RawEnvelope;
  } catch {
    return { kind: 'unknown', raw };
  }
  if (env === null || typeof env !== 'object') return { kind: 'unknown', raw };

  const group = typeof env.group === 'string' ? env.group : null;

  // Ping reply. Verified live: {"group":"System","data":"pong+<uuid>"} — NOT the documented bare string.
  if (group === 'System' && typeof env.data === 'string' && env.data.startsWith('pong')) {
    return { kind: 'pong' };
  }

  if (typeof env.action === 'string' && typeof env.success === 'boolean') {
    return {
      kind: 'ack',
      action: env.action,
      group,
      success: env.success,
      error: typeof env.error === 'string' ? env.error : null,
    };
  }

  if (group === null || env.data === undefined || env.data === null) return { kind: 'unknown', raw };

  // ---- kline
  const klineMatch = /^futures\/klineBin([0-9]+[mHDW]):(.+)$/u.exec(group);
  if (klineMatch) {
    const tf = SUFFIX_TO_TIMEFRAME.get(klineMatch[1]!);
    if (tf === undefined) return { kind: 'unknown', raw };
    const d = env.data as { symbol?: unknown; items?: unknown };
    const symbol = str(d.symbol) ?? klineMatch[2]!;
    // `items` is the real shape. The docs' flat form is also tolerated in case it ever appears.
    const rows: unknown[] = Array.isArray(d.items) ? d.items : [env.data];
    const candles: WsCandle[] = [];
    for (const r of rows) {
      if (r === null || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const time = secToMs(o.ts);
      const open = str(o.o);
      const high = str(o.h);
      const low = str(o.l);
      const close = str(o.c);
      if (time === null || open === null || high === null || low === null || close === null) continue;
      candles.push({ time, open, high, low, close, volume: str(o.v) ?? '0', closed: false });
    }
    if (candles.length === 0) return { kind: 'unknown', raw };
    return { kind: 'kline', topic: group, symbol, timeframe: tf, candles };
  }

  // ---- ticker
  if (group.startsWith('futures/ticker:')) {
    const d = env.data as Record<string, unknown>;
    const symbol = str(d.symbol);
    const last = str(d.last_price);
    if (symbol === null || last === null) return { kind: 'unknown', raw };
    return {
      kind: 'ticker',
      topic: group,
      ticker: {
        symbol,
        last,
        markPrice: str(d.mark_price),
        indexPrice: str(d.index_price),
        changePct: ratioToPercent(d.range),
        vol24h: str(d.volume_24),
        bid: str(d.bid_price),
        ask: str(d.ask_price),
      },
    };
  }

  // ---- book ticker (BBO)
  if (group.startsWith('futures/bookticker:')) {
    const d = env.data as Record<string, unknown>;
    const symbol = str(d.symbol);
    const bid = str(d.best_bid_price);
    const ask = str(d.best_ask_price);
    const ts = msOf(d.ms_t);
    if (symbol === null || bid === null || ask === null || ts === null) return { kind: 'unknown', raw };
    return {
      kind: 'bookticker',
      topic: group,
      book: { symbol, bid, bidVol: str(d.best_bid_vol) ?? '0', ask, askVol: str(d.best_ask_vol) ?? '0', ts },
    };
  }

  // ---- trades (data is an ARRAY here, unlike every other channel)
  if (group.startsWith('futures/trade:')) {
    if (!Array.isArray(env.data)) return { kind: 'unknown', raw };
    const trades: WsTrade[] = [];
    for (const r of env.data) {
      if (r === null || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const price = str(o.deal_price);
      const symbol = str(o.symbol);
      const id = str(o.trade_id);
      if (price === null || symbol === null || id === null) continue;
      // `created_at` is an RFC3339 string with nanosecond precision, not an epoch.
      const ts = typeof o.created_at === 'string' ? Date.parse(o.created_at) : NaN;
      trades.push({
        tradeId: id,
        symbol,
        price,
        volume: str(o.deal_vol) ?? '0',
        buyerIsMaker: o.m === true,
        ts: Number.isFinite(ts) ? ts : Date.now(),
      });
    }
    if (trades.length === 0) return { kind: 'unknown', raw };
    return { kind: 'trade', topic: group, trades };
  }

  // ---- depth (one SIDE per message: way 1 = bid, way 2 = ask)
  if (/^futures\/depth(All|Increase)?\d+:/u.test(group)) {
    const d = env.data as Record<string, unknown>;
    const symbol = str(d.symbol);
    const ts = msOf(d.ms_t) ?? Date.now();
    if (symbol === null) return { kind: 'unknown', raw };
    if (Array.isArray(d.depths)) {
      const side = d.way === 2 ? 'ask' : 'bid';
      return { kind: 'depth', topic: group, depth: { symbol, side, levels: depthLevels(d.depths), ts } };
    }
    // depthAll/depthIncrease carry both sides; emit the bid side and let callers request both explicitly.
    if (Array.isArray(d.bids) || Array.isArray(d.asks)) {
      const bids = Array.isArray(d.bids) ? d.bids : [];
      return { kind: 'depth', topic: group, depth: { symbol, side: 'bid', levels: depthLevels(bids), ts } };
    }
    return { kind: 'unknown', raw };
  }

  return { kind: 'unknown', raw };
}

function depthLevels(rows: readonly unknown[]): { price: string; volume: string }[] {
  const out: { price: string; volume: string }[] = [];
  for (const r of rows) {
    if (r === null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const price = str(o.price);
    if (price === null) continue;
    out.push({ price, volume: str(o.vol) ?? '0' });
  }
  return out;
}

/**
 * REST kline URL for history and gap-fill.
 *
 * `start_time`/`end_time` are in SECONDS and both are required; a single request returns at most 500 bars.
 */
export function restKlineUrl(
  base: string,
  symbol: string,
  tf: Timeframe,
  fromSec: number,
  toSec: number,
): string {
  const p = new URLSearchParams({
    symbol,
    step: String(REST_KLINE_STEP[tf]),
    start_time: String(Math.floor(fromSec)),
    end_time: String(Math.floor(toSec)),
  });
  return `${base.replace(/\/+$/u, '')}/contract/public/kline?${p.toString()}`;
}

/** REST kline rows → canonical candles. REST uses `*_price` names and second timestamps. */
export function parseRestKlines(body: unknown): WsCandle[] {
  const rows = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: WsCandle[] = [];
  for (const r of rows) {
    if (r === null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const time = secToMs(o.timestamp);
    const open = str(o.open_price);
    const high = str(o.high_price);
    const low = str(o.low_price);
    const close = str(o.close_price);
    if (time === null || open === null || high === null || low === null || close === null) continue;
    // Historical bars from REST are complete.
    out.push({ time, open, high, low, close, volume: str(o.volume) ?? '0', closed: true });
  }
  return out;
}
