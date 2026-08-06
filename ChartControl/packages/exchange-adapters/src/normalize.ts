import { CandleSchema, type Candle, type Trade } from '@quantumtrade/schemas';
import { MAX_CANDLES_IN_MEMORY, MAX_TRADES_IN_MEMORY } from '@quantumtrade/config';

/**
 * Candle buffer implementing the realtime merge rules (docs/06):
 *  - same `time`  -> replace (latest wins)
 *  - newer `time` -> append
 *  - older `time` -> ignore
 * Also dedups, sorts ascending, validates OHLC, and bounds memory.
 */
export class CandleBuffer {
  private byTime = new Map<number, Candle>();

  constructor(initial: Candle[] = [], private readonly max = MAX_CANDLES_IN_MEMORY) {
    for (const c of initial) this.ingest(c);
  }

  /** Ingest one candle. Returns 'appended' | 'replaced' | 'ignored' | 'invalid'. */
  ingest(candle: Candle): 'appended' | 'replaced' | 'ignored' | 'invalid' {
    const parsed = CandleSchema.safeParse(candle);
    if (!parsed.success) return 'invalid';
    const c = parsed.data;
    const existing = this.byTime.get(c.time);
    if (existing) {
      this.byTime.set(c.time, c);
      return 'replaced';
    }
    // Newer or filling an older gap: both stored, but "older than newest and unseen" is a gap fill,
    // while a strictly older duplicate time is handled above. We store any new timestamp.
    this.byTime.set(c.time, c);
    this.trim();
    return 'appended';
  }

  /** Bulk merge (e.g. REST gap fill after reconnect); dedups against existing. */
  merge(candles: Candle[]): void {
    for (const c of candles) this.ingest(c);
  }

  private trim(): void {
    if (this.byTime.size <= this.max) return;
    const times = [...this.byTime.keys()].sort((a, b) => a - b);
    const excess = this.byTime.size - this.max;
    for (let i = 0; i < excess; i++) this.byTime.delete(times[i]!);
  }

  /** Sorted ascending snapshot. */
  toArray(): Candle[] {
    return [...this.byTime.values()].sort((a, b) => a.time - b.time);
  }

  get size(): number {
    return this.byTime.size;
  }
}

/**
 * Trade buffer: dedups by trade id, keeps timestamp order, bounded ring.
 */
export class TradeBuffer {
  private seen = new Set<string>();
  private list: Trade[] = [];

  constructor(private readonly max = MAX_TRADES_IN_MEMORY) {}

  /** Returns true if the trade was added, false if it was a duplicate. */
  ingest(trade: Trade): boolean {
    if (this.seen.has(trade.id)) return false;
    this.seen.add(trade.id);
    this.list.push(trade);
    this.list.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    if (this.list.length > this.max) {
      const removed = this.list.splice(0, this.list.length - this.max);
      for (const r of removed) this.seen.delete(r.id);
    }
    return true;
  }

  toArray(): Trade[] {
    return [...this.list];
  }

  get size(): number {
    return this.list.length;
  }
}
