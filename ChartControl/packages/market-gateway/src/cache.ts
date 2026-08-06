/** REST request coalescing (Phase 6 §1): a single in-flight request per key; concurrent callers share
 * the same promise. Prevents a thundering herd of identical REST calls to BitMart (gap-fill, candles). */
export class RequestCoalescer<T> {
  private inflight = new Map<string, Promise<T>>();
  private coalesced = 0;
  do(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) { this.coalesced += 1; return existing; }
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
  get coalescedCount(): number { return this.coalesced; }
}

/** Candle cache (Phase 6 §1): bounded per (symbol,timeframe) ring of closed candles + REST gap-fill. */
export interface Candle {
  openTime: number;
  open: number; high: number; low: number; close: number; volume: number;
}

export class CandleCache {
  private store = new Map<string, Candle[]>();
  constructor(private readonly maxPerSeries = 1000) {}
  private key(symbol: string, tf: string): string { return `${symbol}:${tf}`; }

  upsert(symbol: string, tf: string, candle: Candle): void {
    const k = this.key(symbol, tf);
    const arr = this.store.get(k) ?? [];
    const idx = arr.findIndex((c) => c.openTime === candle.openTime);
    if (idx >= 0) arr[idx] = candle;
    else {
      // keep sorted by openTime; typical append
      if (arr.length === 0 || candle.openTime > arr[arr.length - 1]!.openTime) arr.push(candle);
      else { arr.push(candle); arr.sort((a, b) => a.openTime - b.openTime); }
    }
    if (arr.length > this.maxPerSeries) arr.splice(0, arr.length - this.maxPerSeries);
    this.store.set(k, arr);
  }

  get(symbol: string, tf: string, limit = 500): Candle[] {
    const arr = this.store.get(this.key(symbol, tf)) ?? [];
    return arr.slice(-limit);
  }

  /** Detect missing openTime slots given the timeframe step (ms) → ranges for REST gap-fill. */
  missingRanges(symbol: string, tf: string, stepMs: number): Array<{ from: number; to: number }> {
    const arr = this.store.get(this.key(symbol, tf)) ?? [];
    const gaps: Array<{ from: number; to: number }> = [];
    for (let i = 1; i < arr.length; i++) {
      const expected = arr[i - 1]!.openTime + stepMs;
      if (arr[i]!.openTime > expected) gaps.push({ from: expected, to: arr[i]!.openTime - stepMs });
    }
    return gaps;
  }
  size(symbol: string, tf: string): number { return this.store.get(this.key(symbol, tf))?.length ?? 0; }
}
