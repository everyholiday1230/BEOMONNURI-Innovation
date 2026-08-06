import type { OrderBook } from '@quantumtrade/schemas';
import { MAX_ORDERBOOK_DEPTH } from '@quantumtrade/config';

type Level = [string, string]; // [price, size] as decimal strings

export type ApplyResult =
  | { status: 'applied'; book: OrderBookState }
  | { status: 'snapshot'; book: OrderBookState }
  | { status: 'gap'; expected: number; got: number } // caller must re-fetch snapshot
  | { status: 'stale'; lastSeq: number; got: number }; // out-of-order/old update ignored

/**
 * Maintains an order book from a snapshot + incremental updates with sequence/gap detection.
 * - snapshot resets state.
 * - incremental applies iff sequence == lastSeq + 1.
 * - a forward gap (sequence > lastSeq + 1) => 'gap' (caller resubscribes/re-snapshots).
 * - an old/duplicate sequence (<= lastSeq) => 'stale' (ignored).
 * Also removes zero-quantity levels, drops invalid sizes, sorts bids desc / asks asc,
 * and bounds depth.
 */
export class OrderBookState {
  private bids = new Map<string, string>();
  private asks = new Map<string, string>();
  lastSeq = -1;
  symbol = '';

  constructor(private readonly maxDepth = MAX_ORDERBOOK_DEPTH) {}

  applySnapshot(book: OrderBook): ApplyResult {
    this.symbol = book.symbol;
    this.bids.clear();
    this.asks.clear();
    for (const [p, s] of book.bids) this.setLevel(this.bids, p, s);
    for (const [p, s] of book.asks) this.setLevel(this.asks, p, s);
    this.lastSeq = book.sequence;
    return { status: 'snapshot', book: this };
  }

  applyIncremental(book: OrderBook): ApplyResult {
    if (book.isSnapshot) return this.applySnapshot(book);
    if (book.sequence <= this.lastSeq) {
      return { status: 'stale', lastSeq: this.lastSeq, got: book.sequence };
    }
    if (this.lastSeq >= 0 && book.sequence !== this.lastSeq + 1) {
      return { status: 'gap', expected: this.lastSeq + 1, got: book.sequence };
    }
    for (const [p, s] of book.bids) this.setLevel(this.bids, p, s);
    for (const [p, s] of book.asks) this.setLevel(this.asks, p, s);
    this.lastSeq = book.sequence;
    return { status: 'applied', book: this };
  }

  private setLevel(side: Map<string, string>, price: string, size: string): void {
    const n = Number(size);
    if (!Number.isFinite(n) || n < 0) return; // drop invalid
    if (n === 0) side.delete(price); // zero qty removes the level
    else side.set(price, size);
  }

  private sortedSide(side: Map<string, string>, dir: 'desc' | 'asc'): Level[] {
    const arr: Level[] = [...side.entries()];
    arr.sort((a, b) =>
      dir === 'desc' ? Number(b[0]) - Number(a[0]) : Number(a[0]) - Number(b[0]),
    );
    return arr.slice(0, this.maxDepth);
  }

  snapshot(): { symbol: string; sequence: number; bids: Level[]; asks: Level[] } {
    return {
      symbol: this.symbol,
      sequence: this.lastSeq,
      bids: this.sortedSide(this.bids, 'desc'),
      asks: this.sortedSide(this.asks, 'asc'),
    };
  }

  /** best bid / best ask (top of book), or undefined if empty. */
  bestBid(): string | undefined {
    return this.sortedSide(this.bids, 'desc')[0]?.[0];
  }
  bestAsk(): string | undefined {
    return this.sortedSide(this.asks, 'asc')[0]?.[0];
  }
}
