import { RedisClient, parseRedisUrl, type RespReply } from '@quantumtrade/cluster';

/**
 * R6 / BL — distributed rate limiting.
 *
 * The audit found every API rate limiter (order, admin, login) used an in-process `Map`. Across multiple
 * ECS instances that is trivially bypassed: N instances each allow the per-minute budget, so the real
 * limit is N×budget and it is not consistent. This module provides a backend-abstracted limiter:
 *
 *   - `InMemoryRateLimiter`  — development / single-node / unit tests.
 *   - `RedisRateLimiter`     — production: an ATOMIC fixed-window counter in Redis/Valkey (ElastiCache),
 *                              shared across all instances.
 *   - `createRateLimiter`    — selects by environment. In production it FAILS CLOSED: it requires a Redis
 *                              URL (no silent Map fallback), and when Redis is unreachable at request
 *                              time it DENIES rather than allowing.
 *
 * The key is composed server-side from the authenticated user id or client IP; a client cannot choose or
 * spoof another principal's bucket.
 */

export interface RateDecision {
  ok: boolean;
  /** ms until the current window resets (only meaningful when !ok). */
  retryAfterMs: number;
  /** current count in the window (for observability/tests). */
  count: number;
}

export interface RateLimiter {
  allow(key: string, limit: number, windowMs: number): Promise<RateDecision>;
  /**
   * Clear a key's window. Called after a SUCCESSFUL authentication so a legitimate user who mistyped a
   * password or TOTP code a few times is not left throttled by their own recovered attempt. It is safe
   * because reaching it already required valid credentials.
   *
   * This resets only the short-window REQUEST BUDGET. It has nothing to do with the persistent
   * `account_lockouts` penalty (PostgreSQL), which the MFA routes clear separately via `resetLockout()`:
   * one is a throughput control, the other is an account-state control, and clearing one must never be
   * mistaken for clearing the other.
   *
   * Optional so a limiter that cannot support it stays conformant; callers use `await limiter.reset?.(k)`.
   */
  reset?(key: string): Promise<void>;
}

/** Development / single-node limiter. Async to match the interface; behaviour matches the old Map logic. */
export class InMemoryRateLimiter implements RateLimiter {
  private win = new Map<string, { start: number; count: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async allow(key: string, limit: number, windowMs: number): Promise<RateDecision> {
    const t = this.now();
    const w = this.win.get(key);
    if (!w || t - w.start >= windowMs) {
      this.win.set(key, { start: t, count: 1 });
      return { ok: true, retryAfterMs: 0, count: 1 };
    }
    w.count += 1;
    if (w.count <= limit) return { ok: true, retryAfterMs: 0, count: w.count };
    return { ok: false, retryAfterMs: windowMs - (t - w.start), count: w.count };
  }
  async reset(key: string): Promise<void> {
    this.win.delete(key);
  }
}

/**
 * Production limiter — atomic fixed window in Redis/Valkey.
 *
 * Uses a single EVAL so INCR + first-hit PEXPIRE are atomic (no INCR-then-EXPIRE race that could leave a
 * key without a TTL and pin the bucket forever). The namespace prefix isolates rate-limit keys.
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly ns: string;
  constructor(
    private readonly client: { command(...args: (string | number)[]): Promise<RespReply> },
    ns = 'rl',
  ) {
    this.ns = ns;
  }

  private static readonly SCRIPT =
    "local c = redis.call('INCR', KEYS[1]); " +
    "if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[2]); end; " +
    "local t = redis.call('PTTL', KEYS[1]); " +
    'return {c, t}';

  async allow(key: string, limit: number, windowMs: number): Promise<RateDecision> {
    const bucket = `${this.ns}:${key}`;
    const reply = (await this.client.command('EVAL', RedisRateLimiter.SCRIPT, 1, bucket, limit, windowMs)) as RespReply;
    const arr = Array.isArray(reply) ? reply : [1, windowMs];
    const count = Number(arr[0] ?? 1);
    const pttl = Number(arr[1] ?? windowMs);
    const retryAfterMs = pttl < 0 ? windowMs : pttl;
    return count <= limit ? { ok: true, retryAfterMs: 0, count } : { ok: false, retryAfterMs, count };
  }

  /** DEL the window key. Namespaced identically to `allow`, so it can only clear this limiter's bucket. */
  async reset(key: string): Promise<void> {
    await this.client.command('DEL', `${this.ns}:${key}`);
  }
}

/**
 * A limiter that DENIES when the underlying store throws. Wrapping the Redis limiter with this is what
 * makes production fail closed: a rate limiter that allowed traffic during a Redis outage would be worse
 * than useless.
 */
export class FailClosedRateLimiter implements RateLimiter {
  constructor(private readonly inner: RateLimiter) {}
  async allow(key: string, limit: number, windowMs: number): Promise<RateDecision> {
    try {
      return await this.inner.allow(key, limit, windowMs);
    } catch {
      return { ok: false, retryAfterMs: windowMs, count: limit + 1 };
    }
  }
  /**
   * A failed reset is swallowed on purpose: the only consequence is that a successful user keeps their
   * already-consumed budget until the window expires. Failing the request instead would turn a Redis
   * hiccup into a refused LOGIN that had already passed authentication — strictly worse, and it would not
   * make anything safer (nothing is being granted here, only forgotten).
   */
  async reset(key: string): Promise<void> {
    try {
      await this.inner.reset?.(key);
    } catch {
      /* budget simply expires naturally */
    }
  }
}

export interface RateLimiterEnv {
  isProduction: boolean;
  redisUrl?: string;
  /** Injected for tests so no real socket is opened. */
  redisClientFactory?: (url: string) => { command(...args: (string | number)[]): Promise<RespReply> };
}

/**
 * Select the limiter for the environment. Production: Redis/Valkey URL REQUIRED (fail-closed, no silent
 * in-memory fallback), runtime failures deny. Development/test: in-memory.
 */
export function createRateLimiter(env: RateLimiterEnv): RateLimiter {
  if (env.isProduction) {
    if (!env.redisUrl || env.redisUrl.trim().length === 0) {
      throw new Error(
        'fail-closed startup: REDIS_URL (Redis/Valkey) is required in production for distributed rate ' +
          'limiting — an in-process limiter is bypassable across instances (see R6/BL).',
      );
    }
    const client = env.redisClientFactory
      ? env.redisClientFactory(env.redisUrl)
      : (() => {
          const { host, port, tls } = parseRedisUrl(env.redisUrl!);
          // rediss:// → TLS (ElastiCache in-transit encryption). connectTimeout bounds a hung dial.
          return new RedisClient({ host, port, tls, connectTimeoutMs: 2000 });
        })();
    return new FailClosedRateLimiter(new RedisRateLimiter(client));
  }
  return new InMemoryRateLimiter();
}
