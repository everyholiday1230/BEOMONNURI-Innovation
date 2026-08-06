/** Exponential backoff with full jitter (Phase 6 §1). Deterministic via injected rng for tests. */
export interface BackoffConfig {
  baseMs: number;
  maxMs: number;
  factor: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 500, maxMs: 30_000, factor: 2 };

export function backoffDelay(attempt: number, cfg: BackoffConfig = DEFAULT_BACKOFF, rng: () => number = Math.random): number {
  const capped = Math.min(cfg.maxMs, cfg.baseMs * cfg.factor ** Math.max(0, attempt));
  // full jitter: uniform in [0, capped]
  return Math.floor(rng() * capped);
}

/**
 * Circuit breaker (Phase 6 §1). CLOSED → OPEN after N consecutive failures; OPEN rejects until the
 * cooldown elapses, then HALF_OPEN allows a trial; success → CLOSED, failure → OPEN again.
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitConfig {
  failureThreshold: number;
  cooldownMs: number;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  constructor(private readonly cfg: CircuitConfig, private readonly now: () => number = Date.now) {}

  get current(): CircuitState { return this.state; }

  canRequest(): boolean {
    if (this.state === 'open') {
      if (this.now() - this.openedAt >= this.cfg.cooldownMs) { this.state = 'half_open'; return true; }
      return false;
    }
    return true; // closed or half_open (single trial)
  }

  onSuccess(): void { this.state = 'closed'; this.consecutiveFailures = 0; }

  onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.state === 'half_open' || this.consecutiveFailures >= this.cfg.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.now();
    }
  }
}
