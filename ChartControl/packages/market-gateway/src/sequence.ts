/**
 * Sequence integrity for upstream market messages (Phase 6 §1): duplicate suppression, out-of-order
 * detection, gap detection (with the missing range for REST gap-fill), and stale detection.
 */
export type SeqOutcome =
  | { kind: 'ok'; seq: number }
  | { kind: 'duplicate'; seq: number }
  | { kind: 'out_of_order'; seq: number; expected: number }
  | { kind: 'gap'; from: number; to: number }; // missing (from..to] before this seq

export class SequenceTracker {
  private last = -1;
  private seen = false;
  constructor(private readonly staleMs = 10_000, private readonly now: () => number = Date.now) {}
  private lastTs = 0;

  accept(seq: number, tsMs?: number): SeqOutcome {
    this.lastTs = tsMs ?? this.now();
    this.seen = true;
    if (this.last === -1) { this.last = seq; return { kind: 'ok', seq }; }
    if (seq <= this.last) {
      // strictly not newer → duplicate (==) or out-of-order (<)
      return seq === this.last ? { kind: 'duplicate', seq } : { kind: 'out_of_order', seq, expected: this.last + 1 };
    }
    if (seq > this.last + 1) {
      const gap = { kind: 'gap' as const, from: this.last + 1, to: seq - 1 };
      this.last = seq; // advance; caller triggers REST gap-fill for (from..to)
      return gap;
    }
    this.last = seq;
    return { kind: 'ok', seq };
  }

  /** Feed has gone stale if no accepted message within staleMs. */
  isStale(nowMs?: number): boolean {
    const t = nowMs ?? this.now();
    return this.seen && t - this.lastTs > this.staleMs;
  }

  reset(): void { this.last = -1; this.lastTs = 0; this.seen = false; }
}
