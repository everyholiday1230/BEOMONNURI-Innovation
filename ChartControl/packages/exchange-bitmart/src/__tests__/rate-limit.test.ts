import { describe, it, expect } from 'vitest';
import {
  BITMART_RATE_LIMITS,
  limitFor,
  TokenBucket,
  RateLimiter,
  backoffDelayMs,
  parseRetryAfterMs,
  CircuitBreaker,
} from '../rate-limit';

describe('BitMart rate-limit config (§15 — central, not hardcoded per call site)', () => {
  it('order/cancel have higher priority than reads', () => {
    expect(limitFor('contract/private/submit-order').priority).toBeGreaterThan(limitFor('contract/private/position').priority);
    expect(limitFor('contract/private/cancel-order').priority).toBeGreaterThan(limitFor('contract/private/get-open-orders').priority);
  });
  it('unknown endpoint falls back to default', () => {
    expect(limitFor('nope/does-not-exist')).toEqual(BITMART_RATE_LIMITS.default);
  });
});

describe('TokenBucket', () => {
  it('drains capacity then blocks, then refills over time', () => {
    let t = 1000;
    const b = new TokenBucket({ capacity: 3, refillMs: 1000, priority: 1 }, () => t);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(true);
    expect(b.tryRemove()).toBe(false); // empty
    t += 1000; // full interval → refill to capacity
    expect(b.available).toBe(3);
    expect(b.tryRemove()).toBe(true);
  });
});

describe('RateLimiter (per scope+endpoint isolation)', () => {
  it('separate API keys have independent buckets', () => {
    const rl = new RateLimiter(() => 0);
    const ep = 'contract/private/submit-order'; // capacity 20
    for (let i = 0; i < 20; i++) expect(rl.allow('apiKey', 'keyA', ep)).toBe(true);
    expect(rl.allow('apiKey', 'keyA', ep)).toBe(false); // A exhausted
    expect(rl.allow('apiKey', 'keyB', ep)).toBe(true); // B independent
  });
  it('IP and UID scopes are independent from API key scope', () => {
    const rl = new RateLimiter(() => 0);
    expect(rl.allow('ip', '1.2.3.4', 'system/time')).toBe(true);
    expect(rl.allow('uid', 'u1', 'system/time')).toBe(true);
  });
});

describe('backoff + jitter, Retry-After', () => {
  it('backoff grows exponentially and stays within [0, exp)', () => {
    const rng = () => 0.999999;
    const d0 = backoffDelayMs(0, { baseMs: 250, rng });
    const d3 = backoffDelayMs(3, { baseMs: 250, rng });
    expect(d0).toBeLessThan(250);
    expect(d3).toBeLessThan(250 * 2 ** 3);
    expect(d3).toBeGreaterThan(d0);
  });
  it('honors Retry-After (capped at maxMs) over computed backoff', () => {
    expect(backoffDelayMs(5, { retryAfterMs: 3000, maxMs: 20000 })).toBe(3000);
    expect(backoffDelayMs(5, { retryAfterMs: 999999, maxMs: 20000 })).toBe(20000);
  });
  it('parses Retry-After seconds and HTTP-date', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:05 GMT', now)).toBe(5000);
  });
});

describe('CircuitBreaker (418 IP block / sustained 5xx)', () => {
  it('opens after threshold failures, half-opens after openMs, closes on success', () => {
    let t = 0;
    const cb = new CircuitBreaker(3, 5000, () => t);
    expect(cb.canRequest()).toBe(true);
    cb.onFailure();
    cb.onFailure();
    expect(cb.canRequest()).toBe(true); // 2 < 3
    cb.onFailure(); // 3 → open
    expect(cb.current).toBe('open');
    expect(cb.canRequest()).toBe(false);
    t += 5000; // openMs elapsed → half-open (single trial)
    expect(cb.current).toBe('half-open');
    expect(cb.canRequest()).toBe(true);
    cb.onSuccess(); // trial ok → closed
    expect(cb.current).toBe('closed');
  });
  it('a failure in half-open re-opens', () => {
    let t = 0;
    const cb = new CircuitBreaker(1, 1000, () => t);
    cb.onFailure(); // open
    t += 1000; // half-open
    expect(cb.current).toBe('half-open');
    cb.onFailure(); // re-open
    expect(cb.current).toBe('open');
  });
});
