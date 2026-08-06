/**
 * BitMart rate-limit & fault handling (docs PHASE3-01/§15). Rate-limit VALUES live in ONE central
 * config (never hardcoded across call sites). Provides: per-endpoint token buckets keyed by
 * scope (API key / IP / UID), 429/418 + Retry-After handling, exponential backoff with jitter, and
 * a circuit breaker. Order submission is NEVER blindly retried — the caller reconciles on timeout.
 */

export type RateScope = 'apiKey' | 'ip' | 'uid';

export interface EndpointLimit {
  /** sustained requests per interval */
  capacity: number;
  /** refill interval in ms */
  refillMs: number;
  /** logical priority — higher runs first in a priority queue (order/cancel > reads) */
  priority: number;
}

/**
 * Central rate-limit config. Tune to BitMart's published limits WITHOUT touching call sites.
 * (Placeholder-but-reasonable defaults; real values are environment/config-driven.)
 */
export const BITMART_RATE_LIMITS: Record<string, EndpointLimit> = {
  'system/time': { capacity: 10, refillMs: 1000, priority: 1 },
  'contract/private/assets-detail': { capacity: 12, refillMs: 2000, priority: 2 },
  'contract/private/position': { capacity: 12, refillMs: 2000, priority: 2 },
  'contract/private/get-open-orders': { capacity: 12, refillMs: 2000, priority: 2 },
  'contract/private/order': { capacity: 12, refillMs: 2000, priority: 3 }, // status query (used by reconcile)
  'contract/private/submit-order': { capacity: 20, refillMs: 1000, priority: 10 }, // order — highest priority
  'contract/private/cancel-order': { capacity: 20, refillMs: 1000, priority: 9 },
  'contract/private/modify-limit-order': { capacity: 10, refillMs: 1000, priority: 8 },
  default: { capacity: 10, refillMs: 1000, priority: 1 },
};

export function limitFor(endpoint: string): EndpointLimit {
  return BITMART_RATE_LIMITS[endpoint] ?? BITMART_RATE_LIMITS.default!;
}

/** Classic token bucket. `tryRemove` is non-blocking; returns false when empty (caller queues). */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(
    private readonly limit: EndpointLimit,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = limit.capacity;
    this.lastRefill = now();
  }
  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed <= 0) return;
    const refilled = (elapsed / this.limit.refillMs) * this.limit.capacity;
    if (refilled >= 1) {
      this.tokens = Math.min(this.limit.capacity, this.tokens + Math.floor(refilled));
      this.lastRefill = t;
    }
  }
  get available(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
  tryRemove(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }
}

/** Per-(scope+endpoint) bucket registry so limits are enforced by API key / IP / UID independently. */
export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  constructor(private readonly now: () => number = Date.now) {}
  private key(scope: RateScope, scopeId: string, endpoint: string): string {
    return `${scope}:${scopeId}:${endpoint}`;
  }
  allow(scope: RateScope, scopeId: string, endpoint: string, n = 1): boolean {
    const k = this.key(scope, scopeId, endpoint);
    let b = this.buckets.get(k);
    if (!b) {
      b = new TokenBucket(limitFor(endpoint), this.now);
      this.buckets.set(k, b);
    }
    return b.tryRemove(n);
  }
}

/** Exponential backoff with full jitter. Honors Retry-After (seconds or ms) when provided. */
export function backoffDelayMs(attempt: number, opts: { baseMs?: number; maxMs?: number; retryAfterMs?: number; rng?: () => number } = {}): number {
  const { baseMs = 250, maxMs = 20_000, retryAfterMs, rng = Math.random } = opts;
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, maxMs);
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(rng() * exp); // full jitter in [0, exp)
}

/** Parse a Retry-After header (RFC: delta-seconds or HTTP-date) into ms. */
export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(header);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - now) : undefined;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker: opens after N consecutive failures, blocks calls for `openMs`, then allows a
 * single trial (half-open). A success closes it; a failure re-opens. Prevents hammering BitMart
 * during a 418 IP block or sustained 5xx.
 */
export class CircuitBreaker {
  private failures = 0;
  private state: CircuitState = 'closed';
  private openedAt = 0;
  constructor(
    private readonly threshold = 5,
    private readonly openMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}
  get current(): CircuitState {
    if (this.state === 'open' && this.now() - this.openedAt >= this.openMs) this.state = 'half-open';
    return this.state;
  }
  canRequest(): boolean {
    return this.current !== 'open';
  }
  onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }
  onFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}
