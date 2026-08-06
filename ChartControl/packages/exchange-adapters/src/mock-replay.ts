import {
  CandleSchema,
  type Candle,
  type SymbolInfo,
  type Ticker,
  type Trade,
  type OrderBook,
} from '@quantumtrade/schemas';
import { TIMEFRAME_MS, type Timeframe } from '@quantumtrade/config';
import type {
  CandleQuery,
  IMarketDataProvider,
  IOrderBookAdapter,
  ITradesAdapter,
  Unsubscribe,
} from './interfaces';

/** Deterministic seeded RNG (mulberry32) — reproducible mock data. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MOCK_SYMBOLS: SymbolInfo[] = [
  {
    id: 'BTCUSDT',
    base: 'BTC',
    quote: 'USDT',
    contractType: 'perpetual',
    pricePrecision: 1,
    quantityPrecision: 3,
    tickSize: '0.1',
    stepSize: '0.001',
    minQty: '0.001',
    maxLeverage: 125,
  },
  {
    id: 'ETHUSDT',
    base: 'ETH',
    quote: 'USDT',
    contractType: 'perpetual',
    pricePrecision: 2,
    quantityPrecision: 3,
    tickSize: '0.01',
    stepSize: '0.001',
    minQty: '0.001',
    maxLeverage: 100,
  },
];

const BASE_PRICE: Record<string, number> = { BTCUSDT: 68000, ETHUSDT: 3400 };

/**
 * MOCK_REPLAY provider — deterministic, no external dependency. Lets the whole app be reviewed
 * offline. Implements market-data, order book and trades interfaces.
 */
export class MockReplayProvider implements IMarketDataProvider, IOrderBookAdapter, ITradesAdapter {
  readonly name = 'mock_replay';
  private timers = new Set<ReturnType<typeof setInterval>>();

  constructor(private readonly seed = 1337) {}

  async getSymbols(): Promise<SymbolInfo[]> {
    return MOCK_SYMBOLS;
  }

  private genCandles(symbol: string, tf: Timeframe, limit: number, before?: number): Candle[] {
    const rng = makeRng(this.seed + symbol.length * 7 + TIMEFRAME_MS[tf]);
    const step = TIMEFRAME_MS[tf];
    const end = before ?? Date.now();
    const startBucket = Math.floor((end - limit * step) / step) * step;
    let price = BASE_PRICE[symbol] ?? 1000;
    const candles: Candle[] = [];
    for (let i = 0; i < limit; i++) {
      const time = startBucket + i * step;
      const drift = (rng() - 0.48) * price * 0.01;
      const open = price;
      const close = Math.max(1, open + drift);
      const high = Math.max(open, close) * (1 + rng() * 0.004);
      const low = Math.min(open, close) * (1 - rng() * 0.004);
      const volume = Math.round(rng() * 1000 * 1000) / 1000;
      price = close;
      const c = CandleSchema.parse({
        time,
        open: open.toFixed(2),
        high: high.toFixed(2),
        low: low.toFixed(2),
        close: close.toFixed(2),
        volume: volume.toFixed(3),
        closed: true,
      });
      candles.push(c);
    }
    return candles;
  }

  async getCandles(query: CandleQuery): Promise<Candle[]> {
    return this.genCandles(query.symbol, query.timeframe, query.limit ?? 300, query.before);
  }

  async getTicker(symbol: string): Promise<Ticker> {
    const last = BASE_PRICE[symbol] ?? 1000;
    return {
      symbol,
      last: last.toFixed(2),
      changePct: 2.34,
      markPrice: last.toFixed(2),
      indexPrice: (last * 0.9999).toFixed(2),
      fundingRate: 0.0084,
      nextFundingAt: Date.now() + 54 * 60_000,
      high24h: (last * 1.03).toFixed(2),
      low24h: (last * 0.97).toFixed(2),
      vol24h: '125000000',
    };
  }

  /**
   * Tickers for the whole mock catalogue.
   *
   * Values are DETERMINISTIC per symbol (seeded from the symbol id), not random: a markets screen whose
   * numbers changed on every poll would make it impossible to tell a real update from noise, and a
   * screenshot could not be reproduced. Every symbol also gets a DIFFERENT change/volume, because a
   * table where all 21 rows read +2.34% cannot exercise sorting, gainer/loser filters or the heatmap.
   */
  async getTickers(): Promise<Ticker[]> {
    return MOCK_SYMBOLS.map((s) => {
      const rng = makeRng(this.seed + s.id.length * 13 + s.id.charCodeAt(0));
      const base = BASE_PRICE[s.id] ?? 100 + (s.id.charCodeAt(0) % 40) * 25;
      // -8%..+8%, stable for a given symbol.
      const changePct = Number(((rng() - 0.5) * 16).toFixed(2));
      const last = base * (1 + changePct / 100);
      const dp = s.pricePrecision;
      return {
        symbol: s.id,
        last: last.toFixed(dp),
        changePct,
        markPrice: last.toFixed(dp),
        indexPrice: (last * 0.9999).toFixed(dp),
        fundingRate: Number(((rng() - 0.5) * 0.02).toFixed(6)),
        nextFundingAt: Date.now() + 54 * 60_000,
        high24h: (last * (1 + rng() * 0.04)).toFixed(dp),
        low24h: (last * (1 - rng() * 0.04)).toFixed(dp),
        vol24h: Math.floor(1_000_000 + rng() * 500_000_000).toString(),
      };
    });
  }

  subscribeCandles(
    symbol: string,
    timeframe: Timeframe,
    onCandle: (candle: Candle) => void,
  ): Unsubscribe {
    const rng = makeRng(this.seed + 99);
    const step = TIMEFRAME_MS[timeframe];
    let bucket = Math.floor(Date.now() / step) * step;
    let price = BASE_PRICE[symbol] ?? 1000;
    let open = price;
    const timer = setInterval(() => {
      const now = Date.now();
      if (now >= bucket + step) {
        bucket = Math.floor(now / step) * step;
        open = price;
      }
      price = Math.max(1, price + (rng() - 0.48) * price * 0.002);
      onCandle(
        CandleSchema.parse({
          time: bucket,
          open: open.toFixed(2),
          high: Math.max(open, price).toFixed(2),
          low: Math.min(open, price).toFixed(2),
          close: price.toFixed(2),
          volume: (rng() * 500).toFixed(3),
          closed: false,
        }),
      );
    }, 1000);
    this.timers.add(timer);
    return () => {
      clearInterval(timer);
      this.timers.delete(timer);
    };
  }

  async getSnapshot(symbol: string, depth = 20): Promise<OrderBook> {
    const rng = makeRng(this.seed + 5);
    const mid = BASE_PRICE[symbol] ?? 1000;
    const bids: [string, string][] = [];
    const asks: [string, string][] = [];
    for (let i = 0; i < depth; i++) {
      bids.push([(mid - i - 1).toFixed(1), (rng() * 5).toFixed(3)]);
      asks.push([(mid + i + 1).toFixed(1), (rng() * 5).toFixed(3)]);
    }
    return { symbol, sequence: 1, bids, asks, asOf: Date.now(), isSnapshot: true };
  }

  subscribeBook(symbol: string, onUpdate: (book: OrderBook) => void): Unsubscribe {
    let seq = 2;
    const rng = makeRng(this.seed + 6);
    const mid = BASE_PRICE[symbol] ?? 1000;
    const timer = setInterval(() => {
      onUpdate({
        symbol,
        sequence: seq++,
        bids: [[(mid - 1 - Math.floor(rng() * 5)).toFixed(1), (rng() * 5).toFixed(3)]],
        asks: [[(mid + 1 + Math.floor(rng() * 5)).toFixed(1), (rng() * 5).toFixed(3)]],
        asOf: Date.now(),
        isSnapshot: false,
      });
    }, 500);
    this.timers.add(timer);
    return () => {
      clearInterval(timer);
      this.timers.delete(timer);
    };
  }

  async getRecent(symbol: string, limit = 30): Promise<Trade[]> {
    const rng = makeRng(this.seed + 8);
    const mid = BASE_PRICE[symbol] ?? 1000;
    const out: Trade[] = [];
    for (let i = 0; i < limit; i++) {
      out.push({
        id: `mock-${i}`,
        price: (mid + (rng() - 0.5) * 10).toFixed(2),
        size: (rng() * 2).toFixed(3),
        side: rng() > 0.5 ? 'buy' : 'sell',
        ts: Date.now() - (limit - i) * 1000,
      });
    }
    return out;
  }

  subscribeTrades(symbol: string, onTrade: (trade: Trade) => void): Unsubscribe {
    let n = 1000;
    const rng = makeRng(this.seed + 9);
    const mid = BASE_PRICE[symbol] ?? 1000;
    const timer = setInterval(() => {
      onTrade({
        id: `mock-${n++}`,
        price: (mid + (rng() - 0.5) * 10).toFixed(2),
        size: (rng() * 2).toFixed(3),
        side: rng() > 0.5 ? 'buy' : 'sell',
        ts: Date.now(),
      });
    }, 700);
    this.timers.add(timer);
    return () => {
      clearInterval(timer);
      this.timers.delete(timer);
    };
  }

  disposeAll(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.clear();
  }
}
