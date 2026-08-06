import {
  CandleSchema,
  SymbolSchema,
  TickerSchema,
  validate,
  type Candle,
  type SymbolInfo,
  type Ticker,
} from '@quantumtrade/schemas';
import { DEFAULT_BITMART_RATE_LIMIT, type RateLimitConfig, type Timeframe } from '@quantumtrade/config';
import type { CandleQuery, IMarketDataProvider, Unsubscribe } from './interfaces';
import { TokenBucket, CircuitBreaker } from './rate-limiter';

/**
 * BitMart PUBLIC market-data provider. Uses only public endpoints (no credentials).
 * ALL BitMart-specific parsing is isolated in the `normalize*` functions below — the single
 * point of API drift (ADR-0002 / risks-assumptions #1). Everything is Zod-validated before use.
 *
 * NOTE: field mappings target BitMart's public v2 surface but cannot be asserted offline in this
 * handoff; the REST paths are marked 🟡 in the mock/real matrix. The normalize functions are
 * unit-tested with representative fixtures so a real shape change is a one-function fix.
 */

export interface BitMartConfig {
  restBase: string;
  wsPublic?: string;
  rateLimit?: RateLimitConfig;
  /** injectable fetch (for tests / non-browser). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** map our timeframe -> BitMart "step" (minutes). */
}

/** BitMart contract kline step in minutes. */
const STEP_MIN: Record<Timeframe, number> = {
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

// ---------- pure normalization (unit-tested) ----------

/** BitMart kline rows may arrive as arrays [t,o,h,l,c,v] or objects. Normalize to Candle[]. */
export function normalizeBitmartKline(raw: unknown): Candle[] {
  const rows = extractRows(raw);
  const out: Candle[] = [];
  for (const row of rows) {
    const c = rowToCandle(row);
    if (!c) continue;
    const parsed = CandleSchema.safeParse(c);
    if (parsed.success) out.push(parsed.data);
  }
  // dedup by time + ascending sort
  const byTime = new Map<number, Candle>();
  for (const c of out) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function extractRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const data = (raw as { data?: unknown }).data;
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const d = data as { klines?: unknown; symbols?: unknown };
      if (Array.isArray(d.klines)) return d.klines;
      // BitMart /contract/public/details returns { data: { symbols: [...] } }.
      if (Array.isArray(d.symbols)) return d.symbols;
    }
  }
  return [];
}

function rowToCandle(row: unknown): Record<string, unknown> | null {
  // Array form: [timestamp, open, high, low, close, volume]
  if (Array.isArray(row) && row.length >= 6) {
    return {
      time: toMs(row[0]),
      open: String(row[1]),
      high: String(row[2]),
      low: String(row[3]),
      close: String(row[4]),
      volume: String(row[5]),
      closed: true,
    };
  }
  // Object form.
  if (row && typeof row === 'object') {
    const r = row as Record<string, unknown>;
    const t = r['timestamp'] ?? r['t'] ?? r['time'];
    if (t === undefined) return null;
    return {
      time: toMs(t),
      open: String(r['open'] ?? r['open_price'] ?? r['o']),
      high: String(r['high'] ?? r['high_price'] ?? r['h']),
      low: String(r['low'] ?? r['low_price'] ?? r['l']),
      close: String(r['close'] ?? r['close_price'] ?? r['c']),
      volume: String(r['volume'] ?? r['v'] ?? '0'),
      closed: true,
    };
  }
  return null;
}

function toMs(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // BitMart contract timestamps are seconds; convert if it looks like seconds.
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

// ---------- provider ----------

/**
 * BitMart reports `change_24h` as a signed RATIO, not a percentage. Multiply by 100.
 *
 * The reference documents the field only as "24h Change" with no unit, so this was VERIFIED against
 * live data (2026-08-03) rather than assumed:
 *
 *  - across all 1,215 listed contracts every value was |x| < 0.03. Read as percentages that would mean
 *    no contract moved more than 0.03% in 24 hours, which this market does not do;
 *  - comparing `last_price` against the hourly close exactly 24h earlier for BTC/ETH/SOL/XRP/DOGE/ADA
 *    gave 6/6 sign agreement with matching magnitudes (ADA: measured +6.70%, `change_24h × 100` =
 *    +7.79%; the residual is because BitMart's rolling 24h window does not start on an hourly
 *    boundary).
 *
 * Left unconverted, every 24h change on the markets screen reads ~100× too small — a wrong number that
 * looks plausible. `Ticker.changePct` in our schema means percent.
 */
export function bitmartChangeRatioToPercent(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return 0;
  // Round to 4dp: the raw ratio carries 16 significant digits of float noise (0.0056745209241998),
  // and a percentage displayed to 2dp does not need more.
  return Math.round(n * 100 * 10_000) / 10_000;
}

export class BitMartPublicMarketDataProvider implements IMarketDataProvider {
  readonly name = 'bitmart_public';
  private readonly bucket: TokenBucket;
  private readonly breaker: CircuitBreaker;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: BitMartConfig) {
    const rl = cfg.rateLimit ?? DEFAULT_BITMART_RATE_LIMIT;
    this.bucket = new TokenBucket(rl);
    this.breaker = new CircuitBreaker(rl);
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  }

  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    if (!this.breaker.canRequest()) throw new Error('circuit_open');
    if (!this.bucket.tryRemove()) {
      await sleep(this.bucket.msUntilAvailable(), signal);
    }
    try {
      const res = await this.fetchImpl(`${this.cfg.restBase}${path}`, { signal });
      if (res.status === 429 || res.status === 418) {
        this.breaker.onFailure();
        throw new Error(`rate_limited_${res.status}`);
      }
      if (!res.ok) {
        this.breaker.onFailure();
        throw new Error(`upstream_${res.status}`);
      }
      this.breaker.onSuccess();
      return await res.json();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.breaker.onFailure();
      throw e;
    }
  }

  async getSymbols(signal?: AbortSignal): Promise<SymbolInfo[]> {
    const raw = await this.get('/contract/public/details', signal);
    const rows = extractRows(raw);
    const out: SymbolInfo[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      // BitMart /contract/public/details reports price_precision / vol_precision as the
      // tick/step SIZE STRINGS (e.g. "0.1", "1"), NOT integer digit counts. Derive precision.
      const priceTick = String(r['price_precision'] ?? '0.01');
      const volStep = String(r['vol_precision'] ?? '0.001');
      const candidate = {
        id: String(r['symbol'] ?? ''),
        base: String(r['base_currency'] ?? r['base'] ?? ''),
        quote: String(r['quote_currency'] ?? r['quote'] ?? 'USDT'),
        contractType: 'perpetual' as const,
        pricePrecision: decimalsOf(priceTick),
        quantityPrecision: decimalsOf(volStep),
        tickSize: priceTick,
        stepSize: volStep,
        minQty: String(r['min_volume'] ?? '0.001'),
        maxLeverage: Number(r['max_leverage'] ?? 20),
      };
      const parsed = SymbolSchema.safeParse(candidate);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  async getCandles(query: CandleQuery): Promise<Candle[]> {
    const step = STEP_MIN[query.timeframe];
    const limit = query.limit ?? 500;
    // BitMart contract kline REQUIRES start_time/end_time in SECONDS; without them it returns
    // {code:40039 "Invalid Timestamp"}. Derive the window from limit × step (minutes).
    // `before` (pagination cursor) may arrive in ms or s — normalize to seconds.
    const endSec = query.before
      ? Math.floor(query.before < 1e12 ? query.before : query.before / 1000)
      : Math.floor(Date.now() / 1000);
    const startSec = endSec - limit * step * 60;
    const path =
      `/contract/public/kline?symbol=${encodeURIComponent(query.symbol)}` +
      `&step=${step}&start_time=${startSec}&end_time=${endSec}`;
    const raw = await this.get(path, query.signal);
    return normalizeBitmartKline(raw);
  }

  async getTicker(symbol: string, signal?: AbortSignal): Promise<Ticker> {
    const raw = await this.get(`/contract/public/details?symbol=${encodeURIComponent(symbol)}`, signal);
    const rows = extractRows(raw);
    const r = (rows[0] ?? {}) as Record<string, unknown>;
    const candidate = {
      symbol,
      last: String(r['last_price'] ?? r['close'] ?? '0'),
      changePct: bitmartChangeRatioToPercent(r['change_24h']),
      markPrice: r['mark_price'] !== undefined ? String(r['mark_price']) : undefined,
      indexPrice: r['index_price'] !== undefined ? String(r['index_price']) : undefined,
      fundingRate: r['funding_rate'] !== undefined ? Number(r['funding_rate']) : undefined,
      high24h: r['high_24h'] !== undefined ? String(r['high_24h']) : undefined,
      low24h: r['low_24h'] !== undefined ? String(r['low_24h']) : undefined,
      vol24h: r['volume_24h'] !== undefined ? String(r['volume_24h']) : undefined,
    };
    const v = validate(TickerSchema, candidate);
    if (!v.ok) throw new Error(`ticker validation failed: ${v.error}`);
    return v.data;
  }

  /**
   * All tickers in one request. `/contract/public/details` with no `symbol` returns every contract, so
   * the batch costs the same upstream as a single symbol.
   *
   * Rows that fail schema validation are DROPPED, not thrown: one contract with a malformed price must
   * not blank the entire markets screen. A dropped row shows up as a missing pair, which is visible;
   * substituting zeros would not be.
   */
  async getTickers(signal?: AbortSignal): Promise<Ticker[]> {
    const raw = await this.get('/contract/public/details', signal);
    const rows = extractRows(raw);
    const out: Ticker[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const symbol = r['symbol'];
      if (typeof symbol !== 'string' || symbol === '') continue;
      const candidate = {
        symbol,
        last: String(r['last_price'] ?? r['close'] ?? '0'),
        changePct: bitmartChangeRatioToPercent(r['change_24h']),
        markPrice: r['mark_price'] !== undefined ? String(r['mark_price']) : undefined,
        indexPrice: r['index_price'] !== undefined ? String(r['index_price']) : undefined,
        fundingRate: r['funding_rate'] !== undefined ? Number(r['funding_rate']) : undefined,
        high24h: r['high_24h'] !== undefined ? String(r['high_24h']) : undefined,
        low24h: r['low_24h'] !== undefined ? String(r['low_24h']) : undefined,
        vol24h: r['volume_24h'] !== undefined ? String(r['volume_24h']) : undefined,
      };
      const v = validate(TickerSchema, candidate);
      if (v.ok) out.push(v.data);
    }
    return out;
  }

  /**
   * Realtime candle subscription over BitMart public WebSocket. Manages a single socket and
   * removes the listener + closes the socket on unsubscribe (prevents leaks on symbol/tf change).
   * Marked 🟡 — requires a live environment to verify end-to-end.
   */
  subscribeCandles(
    symbol: string,
    timeframe: Timeframe,
    onCandle: (candle: Candle) => void,
  ): Unsubscribe {
    const WS = (globalThis as { WebSocket?: MinimalWebSocketCtor }).WebSocket;
    if (!WS || !this.cfg.wsPublic) {
      return () => {};
    }
    const ws = new WS(this.cfg.wsPublic);
    const channel = `futures/klineBin${STEP_MIN[timeframe]}m:${symbol}`;
    const onOpen = () => ws.send(JSON.stringify({ action: 'subscribe', args: [channel] }));
    const onMsg = (ev: { data: unknown }) => {
      try {
        const parsed = normalizeBitmartKline(JSON.parse(String(ev.data)));
        for (const c of parsed) onCandle(c);
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('message', onMsg);
    return () => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('message', onMsg);
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
  }
}

/** Minimal WebSocket surface — avoids requiring the DOM lib in this shared package. */
interface MinimalWebSocket {
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: { data: unknown }) => void): void;
  removeEventListener(type: string, listener: (ev: { data: unknown }) => void): void;
}
type MinimalWebSocketCtor = new (url: string) => MinimalWebSocket;

function tickFromPrecision(p: number): string {
  if (p <= 0) return '1';
  return `0.${'0'.repeat(p - 1)}1`;
}

/** Decimal places implied by a tick/step size string, e.g. "0.1"→1, "0.01"→2, "1"→0. */
function decimalsOf(size: string): number {
  const s = size.trim();
  const dot = s.indexOf('.');
  if (dot < 0) return 0;
  return s.replace(/0+$/, '').length - dot - 1;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });
}

export const _internal = { rowToCandle, toMs, extractRows, tickFromPrecision, decimalsOf };
