import { DEFAULT_BITMART_RATE_LIMIT, type RateLimitConfig } from '@quantumtrade/config';

/**
 * Token-bucket rate limiter with exponential backoff + jitter and a circuit breaker.
 * Prevents 429/418 storms (docs section 8). Config-driven — no hardcoded BitMart limits.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(private readonly cfg: RateLimitConfig = DEFAULT_BITMART_RATE_LIMIT) {
    this.tokens = cfg.burst;
  }

  private refill(now = Date.now()): void {
    const elapsed = Math.max(0, (now - this.lastRefill) / 1000);
    this.tokens = Math.min(this.cfg.burst, this.tokens + elapsed * this.cfg.maxRps);
    this.lastRefill = now;
  }

  /** Try to take a token immediately. */
  tryRemove(now = Date.now()): boolean {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** ms until at least one token is available. */
  msUntilAvailable(now = Date.now()): number {
    this.refill(now);
    if (this.tokens >= 1) return 0;
    return Math.ceil(((1 - this.tokens) / this.cfg.maxRps) * 1000);
  }
}

/** Exponential backoff with jitter, capped. attempt starts at 0. */
export function backoffMs(attempt: number, cfg: RateLimitConfig = DEFAULT_BITMART_RATE_LIMIT): number {
  const base = Math.min(cfg.backoffMaxMs, cfg.backoffBaseMs * 2 ** attempt);
  const jitter = base * cfg.jitterRatio * Math.random();
  return Math.round(base - base * cfg.jitterRatio + jitter);
}

/** Honor a server Retry-After (seconds or ms heuristic). */
export function retryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const n = Number(headerValue);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n < 1000 ? n * 1000 : n; // small numbers are seconds
}

type BreakerState = 'closed' | 'open' | 'half-open';

/** Circuit breaker: opens after N consecutive failures, resets after a cooldown. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  state: BreakerState = 'closed';

  constructor(private readonly cfg: RateLimitConfig = DEFAULT_BITMART_RATE_LIMIT) {}

  /** Whether a request may proceed now. */
  canRequest(now = Date.now()): boolean {
    if (this.state === 'open') {
      if (now - this.openedAt >= this.cfg.circuitBreakerResetMs) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  onFailure(now = Date.now()): void {
    this.failures += 1;
    if (this.failures >= this.cfg.circuitBreakerThreshold) {
      this.state = 'open';
      this.openedAt = now;
    }
  }
}
