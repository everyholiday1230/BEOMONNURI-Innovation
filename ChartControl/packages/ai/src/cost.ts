import type { CostDecision, IAICostController, IAIUsageRepository } from './interfaces';

/**
 * Cost & quota controller (docs PHASE4-07). Enforces per-user rate, daily token, and daily cost
 * limits, a system-wide budget, concurrency cap, and a circuit breaker. Cost is in integer micro-USD
 * (no float money). Model pricing is config-driven (never hardcoded per call-site).
 */
export interface CostConfig {
  requestsPerMinute: number;
  dailyTokenBudget: number;
  dailyCostMicros: number;
  systemDailyCostMicros: number;
  maxConcurrent: number;
  breakerThreshold: number;
  breakerResetMs: number;
  /** micro-USD per 1K tokens, per model. */
  pricing: Record<string, { inputPer1k: number; outputPer1k: number }>;
  defaultPricing: { inputPer1k: number; outputPer1k: number };
}

export const DEFAULT_COST_CONFIG: CostConfig = {
  requestsPerMinute: 20,
  dailyTokenBudget: 2_000_000,
  dailyCostMicros: 5_000_000, // $5.00/user/day
  systemDailyCostMicros: 500_000_000, // $500/day system
  maxConcurrent: 4,
  breakerThreshold: 5,
  breakerResetMs: 30_000,
  pricing: {},
  defaultPricing: { inputPer1k: 5_000, outputPer1k: 15_000 }, // placeholder micro-USD; override via config
};

export class CostController implements IAICostController {
  private windowStart = new Map<string, number>();
  private windowCount = new Map<string, number>();
  private concurrent = 0;
  private systemCostMicros = 0;
  private failures = 0;
  private breakerOpenedAt = 0;

  constructor(
    private readonly cfg: CostConfig,
    private readonly usage: IAIUsageRepository,
    private readonly now: () => number = Date.now,
  ) {}

  estimateCostMicros(model: string, inputTokens: number, outputTokens: number): number {
    const p = this.cfg.pricing[model] ?? this.cfg.defaultPricing;
    return Math.ceil((inputTokens / 1000) * p.inputPer1k + (outputTokens / 1000) * p.outputPer1k);
  }

  async checkAllowed(userId: string): Promise<CostDecision> {
    // rate limit (fixed 60s window per user)
    const t = this.now();
    const ws = this.windowStart.get(userId) ?? 0;
    if (t - ws >= 60_000) {
      this.windowStart.set(userId, t);
      this.windowCount.set(userId, 0);
    }
    const c = (this.windowCount.get(userId) ?? 0) + 1;
    this.windowCount.set(userId, c);
    if (c > this.cfg.requestsPerMinute) return { allowed: false, reason: 'rate-limited', retryAfterMs: 60_000 - (t - (this.windowStart.get(userId) ?? t)) };

    if (this.concurrent >= this.cfg.maxConcurrent) return { allowed: false, reason: 'concurrency-exceeded', retryAfterMs: 1000 };
    if (this.systemCostMicros >= this.cfg.systemDailyCostMicros) return { allowed: false, reason: 'system-budget-exceeded' };

    const [tokens, cost] = await Promise.all([this.usage.dailyTokens(userId), this.usage.dailyCostMicros(userId)]);
    if (tokens >= this.cfg.dailyTokenBudget) return { allowed: false, reason: 'daily-token-exceeded' };
    if (cost >= this.cfg.dailyCostMicros) return { allowed: false, reason: 'daily-cost-exceeded' };
    return { allowed: true };
  }

  acquire(): void {
    this.concurrent += 1;
  }
  release(): void {
    this.concurrent = Math.max(0, this.concurrent - 1);
  }
  addSystemCost(micros: number): void {
    this.systemCostMicros += micros;
  }

  onProviderFailure(): void {
    this.failures += 1;
    if (this.failures >= this.cfg.breakerThreshold) this.breakerOpenedAt = this.now();
  }
  onProviderSuccess(): void {
    this.failures = 0;
    this.breakerOpenedAt = 0;
  }
  breakerOpen(): boolean {
    if (this.breakerOpenedAt === 0) return false;
    if (this.now() - this.breakerOpenedAt >= this.cfg.breakerResetMs) {
      this.breakerOpenedAt = 0; // half-open: allow a trial
      return false;
    }
    return true;
  }
}

/** Full-jitter exponential backoff; honors Retry-After (ms). */
export function aiBackoffMs(attempt: number, opts: { baseMs?: number; maxMs?: number; retryAfterMs?: number; rng?: () => number } = {}): number {
  const { baseMs = 500, maxMs = 20_000, retryAfterMs, rng = Math.random } = opts;
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, maxMs);
  return Math.floor(rng() * Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt)));
}
