/**
 * Order book reconciliation (Phase 6 §1): apply a snapshot, then sequenced deltas. A delta whose
 * prevSeq does not match the book's current seq signals a gap → caller must re-snapshot. Zero-size
 * levels are removed.
 */
export interface BookLevel { price: string; size: string; }
export interface OrderBookSnapshot { seq: number; bids: BookLevel[]; asks: BookLevel[]; }
export interface OrderBookDelta { prevSeq: number; seq: number; bids: BookLevel[]; asks: BookLevel[]; }

export type DeltaResult = { kind: 'applied'; seq: number } | { kind: 'duplicate' } | { kind: 'resync_required'; expected: number; got: number };

export class OrderBook {
  private bids = new Map<string, string>();
  private asks = new Map<string, string>();
  private seq = -1;

  applySnapshot(snap: OrderBookSnapshot): void {
    this.bids.clear(); this.asks.clear();
    for (const l of snap.bids) if (Number(l.size) > 0) this.bids.set(l.price, l.size);
    for (const l of snap.asks) if (Number(l.size) > 0) this.asks.set(l.price, l.size);
    this.seq = snap.seq;
  }

  applyDelta(d: OrderBookDelta): DeltaResult {
    if (this.seq === -1) return { kind: 'resync_required', expected: -1, got: d.prevSeq };
    if (d.seq <= this.seq) return { kind: 'duplicate' };
    if (d.prevSeq !== this.seq) return { kind: 'resync_required', expected: this.seq, got: d.prevSeq };
    for (const l of d.bids) { if (Number(l.size) === 0) this.bids.delete(l.price); else this.bids.set(l.price, l.size); }
    for (const l of d.asks) { if (Number(l.size) === 0) this.asks.delete(l.price); else this.asks.set(l.price, l.size); }
    this.seq = d.seq;
    return { kind: 'applied', seq: this.seq };
  }

  get currentSeq(): number { return this.seq; }
  best(): { bid: number | null; ask: number | null } {
    const bid = [...this.bids.keys()].map(Number).sort((a, b) => b - a)[0] ?? null;
    const ask = [...this.asks.keys()].map(Number).sort((a, b) => a - b)[0] ?? null;
    return { bid, ask };
  }
  depth(): { bids: number; asks: number } { return { bids: this.bids.size, asks: this.asks.size }; }
}
