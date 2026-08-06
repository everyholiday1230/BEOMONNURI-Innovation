/**
 * Backpressure + slow-consumer isolation (Phase 6 §1). Each consumer has its OWN bounded queue; a slow
 * consumer only drops ITS OWN messages (oldest-dropped policy) and is isolated from others. Dropped
 * messages are counted per consumer for metrics. A per-user token-bucket rate limiter is included.
 */
export class BoundedQueue<T> {
  private q: T[] = [];
  private dropped = 0;
  constructor(private readonly maxDepth: number) {}
  push(item: T): boolean {
    if (this.q.length >= this.maxDepth) { this.q.shift(); this.dropped += 1; this.q.push(item); return false; }
    this.q.push(item);
    return true;
  }
  drain(max = Infinity): T[] { return this.q.splice(0, Math.min(max, this.q.length)); }
  get depth(): number { return this.q.length; }
  get droppedCount(): number { return this.dropped; }
}

export interface FanoutStats { consumers: number; delivered: number; dropped: number; }

export class Fanout<T> {
  private consumers = new Map<string, BoundedQueue<T>>();
  constructor(private readonly maxDepthPerConsumer = 1000) {}
  add(consumerId: string): void { if (!this.consumers.has(consumerId)) this.consumers.set(consumerId, new BoundedQueue<T>(this.maxDepthPerConsumer)); }
  remove(consumerId: string): void { this.consumers.delete(consumerId); }
  /** Publish to all consumers; slow ones drop their own oldest without affecting others. */
  publish(item: T): FanoutStats {
    let delivered = 0, dropped = 0;
    for (const q of this.consumers.values()) { if (q.push(item)) delivered += 1; else dropped += 1; }
    return { consumers: this.consumers.size, delivered, dropped };
  }
  queueFor(consumerId: string): BoundedQueue<T> | undefined { return this.consumers.get(consumerId); }
  totalDropped(): number { let n = 0; for (const q of this.consumers.values()) n += q.droppedCount; return n; }
  size(): number { return this.consumers.size; }
}

/** Per-user token bucket (Phase 6 §1 per-user rate limit; §3 rate-limit-bypass defense). */
export class TokenBucket {
  private tokens: number;
  private lastRefillMs: number;
  constructor(private readonly capacity: number, private readonly refillPerSec: number, private readonly now: () => number = Date.now) {
    this.tokens = capacity;
    this.lastRefillMs = now();
  }
  tryRemove(n = 1): boolean {
    const t = this.now();
    const elapsed = (t - this.lastRefillMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefillMs = t;
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
  get available(): number { return this.tokens; }
}

export class PerUserRateLimiter {
  private buckets = new Map<string, TokenBucket>();
  constructor(private readonly capacity: number, private readonly refillPerSec: number, private readonly now: () => number = Date.now) {}
  allow(userId: string, n = 1): boolean {
    let b = this.buckets.get(userId);
    if (!b) { b = new TokenBucket(this.capacity, this.refillPerSec, this.now); this.buckets.set(userId, b); }
    return b.tryRemove(n);
  }
}
