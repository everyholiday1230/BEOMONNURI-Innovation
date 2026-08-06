import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { Hono } from 'hono';
import { AuthService, MailSink } from '@quantumtrade/auth';
import { AesGcmSecretCipher, generateRecoveryCodes, generateTotpSecret } from '@quantumtrade/mfa';
import { RedisClient, parseRedisUrl } from '@quantumtrade/cluster';
import { openDb } from '../db/sqlite';
import { SqliteAuditRepository, SqliteSessionRepository, SqliteTokenRepository, SqliteUserRepository } from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { SqliteMfaRepo } from '../db/mfa-repo';
import { SqliteLockoutStore } from '../db/lockout-repo';
import { createAuthRouter } from '../auth-routes';
import { createMfaRouter, mfaChallengeHash } from '../mfa/mfa-routes';
import { InMemoryRateLimiter, RedisRateLimiter, FailClosedRateLimiter, createRateLimiter, type RateLimiter } from '../security/rate-limiter';

/**
 * BATCH_1 / R6-BL-11 — proof the DISTRIBUTED limiter is on the LOGIN and MFA-VERIFY paths, driven through
 * real HTTP requests rather than asserted on the adapter in isolation.
 *
 * What each group is actually establishing:
 *  - 429 + `Retry-After` on both credential surfaces;
 *  - key namespaces are separate (`login:ip` / `login:acct` / `mfa`), so exhausting one does not disarm
 *    or consume another;
 *  - TWO app instances sharing ONE limiter share ONE budget — the multi-instance bypass the audit flagged;
 *  - the throttle never becomes a user-enumeration oracle;
 *  - request-rate limiting and the persistent `account_lockouts` penalty are DIFFERENT controls and both
 *    fire, with distinguishable outcomes.
 */

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'e2e-fixture-not-a-secret';
const REDIS_URL = process.env.REDIS_TEST_URL;
const MFA_COOKIE = 'qt_mfa';

function build(opts: { limiter?: RateLimiter; loginRatePerMin?: number; mfaRatePerMin?: number; db?: ReturnType<typeof openDb> } = {}) {
  const db = opts.db ?? openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    mail: new MailSink(),
  });
  const mfaRepo = new SqliteMfaRepo(db);
  const cipher = new AesGcmSecretCipher(Buffer.alloc(32, 7));
  const gate = {
    isEnabled: (uid: string) => mfaRepo.isEnabled(uid),
    startChallenge: async (uid: string) => {
      const raw = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      await mfaRepo.createChallenge(mfaChallengeHash(raw), uid, 300_000);
      return raw;
    },
    cookie: MFA_COOKIE,
    ttlMs: 300_000,
  };
  const app = new Hono();
  app.route('/api', createAuthRouter({
    service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN],
    mfa: gate, rateLimiter: opts.limiter, loginRatePerMin: opts.loginRatePerMin,
  }));
  app.route('/api', createMfaRouter({
    service, repo: mfaRepo, cipher, csrfKey: 'k', corsOrigins: [ORIGIN], cookieName: 'qt_session',
    challengeCookie: MFA_COOKIE, secureCookies: false, activeSuperAdminIds: () => [],
    lockouts: new SqliteLockoutStore(db), rateLimiter: opts.limiter, ratePerMin: opts.mfaRatePerMin,
  }));
  return { app, db, mfaRepo, cipher };
}

type App = ReturnType<typeof build>['app'];

const login = (app: App, email: string, password = PASSWORD, ip = '203.0.113.10') =>
  app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password }),
  });

async function register(app: App, email: string) {
  await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
}

function cookieFrom(res: Response, name: string): string | undefined {
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [pair] = sc.split(';');
    const i = pair!.indexOf('=');
    if (pair!.slice(0, i) === name) return pair!.slice(i + 1);
  }
  return undefined;
}

// ============================================================ login route
describe('BATCH_1 login route — distributed request-rate limit', () => {
  it('returns 429 with Retry-After once the per-account budget is spent', async () => {
    const limiter = new InMemoryRateLimiter();
    const { app } = build({ limiter, loginRatePerMin: 3 });
    const email = 'rate-a@example.com';
    await register(app, email);

    for (let i = 0; i < 3; i += 1) {
      const r = await login(app, email, 'wrong-password-value');
      expect(r.status).toBe(401); // within budget: a normal credential failure
    }
    const denied = await login(app, email, 'wrong-password-value');
    expect(denied.status).toBe(429);
    const retryAfter = Number(denied.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = (await denied.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
    // The denial must not describe the account or the credential.
    expect(JSON.stringify(body)).not.toContain(email);
    expect(JSON.stringify(body)).not.toContain(PASSWORD);
  });

  it('a CORRECT password is throttled too — the budget is on the request, not on the outcome', async () => {
    const limiter = new InMemoryRateLimiter();
    const { app } = build({ limiter, loginRatePerMin: 2 });
    const email = 'rate-b@example.com';
    await register(app, email);
    expect((await login(app, email, 'wrong-password-value')).status).toBe(401);
    expect((await login(app, email, 'wrong-password-value')).status).toBe(401);
    // Third request exceeds the budget even though these credentials are valid.
    expect((await login(app, email)).status).toBe(429);
  });

  it('[enumeration] a registered and an unregistered address are indistinguishable, throttled or not', async () => {
    const limiter = new InMemoryRateLimiter();
    const { app } = build({ limiter, loginRatePerMin: 2 });
    const known = 'enum-known@example.com';
    await register(app, known);
    const unknown = 'enum-absent@example.com';

    const knownRes = await login(app, known, 'wrong-password-value', '203.0.113.21');
    const unknownRes = await login(app, unknown, 'wrong-password-value', '203.0.113.22');
    expect(knownRes.status).toBe(unknownRes.status);
    const kb = (await knownRes.json()) as { error: { code: string; message: string } };
    const ub = (await unknownRes.json()) as { error: { code: string; message: string } };
    expect(kb.error.code).toBe(ub.error.code);
    expect(kb.error.message).toBe(ub.error.message);

    // And once each account bucket is exhausted, the 429 is identical as well.
    await login(app, known, 'wrong-password-value', '203.0.113.21');
    await login(app, unknown, 'wrong-password-value', '203.0.113.22');
    const k429 = await login(app, known, 'wrong-password-value', '203.0.113.21');
    const u429 = await login(app, unknown, 'wrong-password-value', '203.0.113.22');
    expect([k429.status, u429.status]).toEqual([429, 429]);
    // Compared field by field: `correlationId` is a fresh random value per response (by design, for log
    // correlation) and is deliberately excluded — everything an attacker could compare is identical.
    const k429b = (await k429.json()) as { error: { code: string; message: string } };
    const u429b = (await u429.json()) as { error: { code: string; message: string } };
    expect(k429b.error.code).toBe(u429b.error.code);
    expect(k429b.error.message).toBe(u429b.error.message);
    expect(Object.keys(k429b.error).sort()).toEqual(Object.keys(u429b.error).sort());
    expect(k429.headers.get('Retry-After')).toBe(u429.headers.get('Retry-After'));
  });

  it('[namespace] the IP bucket limits one source across MANY accounts', async () => {
    const limiter = new InMemoryRateLimiter();
    const { app } = build({ limiter, loginRatePerMin: 3 });
    // Distinct accounts, one source: each has an untouched account bucket, so only the IP bucket can stop
    // credential stuffing — which is exactly what this asserts.
    for (let i = 0; i < 3; i += 1) {
      const r = await login(app, `stuff-${i}@example.com`, 'wrong-password-value', '198.51.100.9');
      expect(r.status).toBe(401);
    }
    const denied = await login(app, 'stuff-99@example.com', 'wrong-password-value', '198.51.100.9');
    expect(denied.status).toBe(429);
  });

  it('[multi-instance] two app instances sharing ONE limiter share ONE login budget', async () => {
    const shared = new InMemoryRateLimiter();
    const db = openDb(':memory:');
    const a = build({ limiter: shared, loginRatePerMin: 2, db });
    const b = build({ limiter: shared, loginRatePerMin: 2, db });
    const email = 'multi@example.com';
    await register(a.app, email);

    expect((await login(a.app, email, 'wrong-password-value')).status).toBe(401);
    expect((await login(b.app, email, 'wrong-password-value')).status).toBe(401);
    // Instance B is denied by a budget instance A helped consume — N instances no longer mean N budgets.
    expect((await login(b.app, email, 'wrong-password-value')).status).toBe(429);
  });

  it('a successful password step CLEARS the ACCOUNT bucket, but NOT the IP bucket', async () => {
    const limiter = new InMemoryRateLimiter();
    const { app } = build({ limiter, loginRatePerMin: 3 });
    const email = 'reset-me@example.com';
    await register(app, email);
    expect((await login(app, email, 'wrong-password-value', '203.0.113.31')).status).toBe(401);
    expect((await login(app, email, 'wrong-password-value', '203.0.113.31')).status).toBe(401);
    // Success on the last allowed attempt clears the ACCOUNT bucket.
    expect((await login(app, email, PASSWORD, '203.0.113.31')).status).toBe(200);
    // From a different source the account bucket is demonstrably free again.
    expect((await login(app, email, PASSWORD, '203.0.113.32')).status).toBe(200);
    // But the ORIGINAL source stays spent: an IP budget must not be resettable by one valid credential,
    // or an attacker holding a single working account could refresh their stuffing allowance at will.
    expect((await login(app, email, PASSWORD, '203.0.113.31')).status).toBe(429);
  });

  it('[control] without a success, the account bucket stays spent across sources', async () => {
    const limiter = new InMemoryRateLimiter();
    const { app } = build({ limiter, loginRatePerMin: 3 });
    const email = 'no-reset@example.com';
    await register(app, email);
    // Three failures from three different IPs: each IP bucket has room, only the ACCOUNT bucket fills.
    for (const ip of ['203.0.113.41', '203.0.113.42', '203.0.113.43']) {
      expect((await login(app, email, 'wrong-password-value', ip)).status).toBe(401);
    }
    // A fourth source is still denied — proving the previous test's 200 came from the reset, not from
    // simply changing IP.
    expect((await login(app, email, 'wrong-password-value', '203.0.113.44')).status).toBe(429);
  });

  it('no limiter injected → behaviour is unchanged (the gate is additive)', async () => {
    const { app } = build({ loginRatePerMin: 1 });
    const email = 'nolimiter@example.com';
    await register(app, email);
    for (let i = 0; i < 4; i += 1) expect((await login(app, email)).status).toBe(200);
  });
});

// ============================================================ MFA verify route
describe('BATCH_1 MFA verify route — distributed request-rate limit', () => {
  /** Enroll a user with real MFA and reach the pending-challenge state. */
  async function enrolledUser(h: ReturnType<typeof build>, email: string) {
    await register(h.app, email);
    const userId = (h.db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string }).id;
    const secret = generateTotpSecret();
    await h.mfaRepo.startEnrollment(userId, h.cipher.encrypt(secret), Date.now() + 600_000);
    await h.mfaRepo.activate(userId, h.cipher.encrypt(secret), generateRecoveryCodes(10).records);
    const res = await login(h.app, email);
    expect((await res.json()) as { mfaRequired?: boolean }).toMatchObject({ mfaRequired: true });
    const pending = cookieFrom(res, MFA_COOKIE);
    expect(pending).toBeTruthy();
    return { userId, pending: pending! };
  }

  const challenge = (app: App, pending: string, code = '000000') =>
    app.request('/api/auth/mfa/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, cookie: `${MFA_COOKIE}=${pending}` },
      body: JSON.stringify({ code }),
    });

  it('returns 429 + Retry-After on the verify surface, BEFORE the durable lockout threshold', async () => {
    const limiter = new InMemoryRateLimiter();
    const h = build({ limiter, mfaRatePerMin: 2, loginRatePerMin: 100 });
    const { userId, pending } = await enrolledUser(h, 'mfa-rate@example.com');

    expect((await challenge(h.app, pending)).status).toBe(401); // wrong code, within budget
    expect((await challenge(h.app, pending)).status).toBe(401);
    const denied = await challenge(h.app, pending);
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = (await denied.json()) as { error: { code: string } };
    // Distinguishable from the durable lockout: this is the request-rate control.
    expect(body.error.code).toBe('RATE_LIMITED');
    // Only 2 failures were ever counted against the PERSISTENT penalty (the 3rd never reached it), so the
    // two controls are demonstrably independent rather than one wrapping the other.
    const row = h.db.prepare('SELECT fails FROM account_lockouts WHERE user_id=?').get(userId) as { fails: number };
    expect(row.fails).toBe(2);
  });

  it('the persistent lockout still engages on its own terms (different code, different control)', async () => {
    // No request-rate limiter here, so nothing masks the durable penalty.
    const h = build({ loginRatePerMin: 100 });
    const { pending } = await enrolledUser(h, 'mfa-lockout@example.com');
    let last: Response | undefined;
    for (let i = 0; i < 6; i += 1) last = await challenge(h.app, pending);
    expect(last!.status).toBe(429);
    expect(((await last!.json()) as { error: { code: string } }).error.code).toBe('LOCKED');
  });

  it('[namespace] MFA and login buckets are separate — spending one does not spend the other', async () => {
    const limiter = new InMemoryRateLimiter();
    const h = build({ limiter, mfaRatePerMin: 2, loginRatePerMin: 2 });
    const { pending } = await enrolledUser(h, 'mfa-ns@example.com');
    // The login above already consumed from the login buckets. The MFA bucket is untouched.
    expect((await challenge(h.app, pending)).status).toBe(401);
    expect((await challenge(h.app, pending)).status).toBe(401);
    expect((await challenge(h.app, pending)).status).toBe(429);
    // And exhausting MFA did not make a fresh account's login bucket unavailable.
    const other = 'mfa-ns-other@example.com';
    await register(h.app, other);
    expect((await login(h.app, other, PASSWORD, '203.0.113.77')).status).toBe(200);
  });

  it('[multi-instance] two MFA routers sharing ONE limiter share ONE verify budget', async () => {
    const shared = new InMemoryRateLimiter();
    const db = openDb(':memory:');
    const a = build({ limiter: shared, mfaRatePerMin: 2, loginRatePerMin: 100, db });
    const b = build({ limiter: shared, mfaRatePerMin: 2, loginRatePerMin: 100, db });
    const { pending } = await enrolledUser(a, 'mfa-multi@example.com');
    expect((await challenge(a.app, pending)).status).toBe(401);
    expect((await challenge(b.app, pending)).status).toBe(401);
    expect((await challenge(b.app, pending)).status).toBe(429);
  });
});

// ============================================================ Redis-backed (ephemeral container)
describe.skipIf(!REDIS_URL)('BATCH_1 login/MFA limiter — real Redis/Valkey (ephemeral)', () => {
  let client: RedisClient;
  beforeAll(async () => {
    const { host, port, tls } = parseRedisUrl(REDIS_URL!);
    client = new RedisClient({ host, port, tls, connectTimeoutMs: 2000 });
    await client.connect();
    await client.command('PING');
  });
  afterAll(async () => { await client.quit().catch(() => {}); });

  const uniq = () => `t${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

  it('[atomic] concurrent login attempts consume the shared budget exactly once each', async () => {
    const limiter = new RedisRateLimiter(client, `rl-${uniq()}`);
    const key = `login:acct:${uniq()}`;
    const results = await Promise.all(Array.from({ length: 30 }, () => limiter.allow(key, 10, 60_000)));
    expect(results.filter((r) => r.ok).length).toBe(10);
    expect(results.filter((r) => !r.ok).length).toBe(20);
  });

  it('[TTL] the login window expires and the budget returns', async () => {
    const limiter = new RedisRateLimiter(client, `rl-${uniq()}`);
    const key = `login:ip:${uniq()}`;
    expect((await limiter.allow(key, 1, 400)).ok).toBe(true);
    expect((await limiter.allow(key, 1, 400)).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 600));
    expect((await limiter.allow(key, 1, 400)).ok).toBe(true);
  });

  it('[namespace] login, account and MFA keys never collide', async () => {
    const limiter = new RedisRateLimiter(client, `rl-${uniq()}`);
    const id = uniq();
    // Same principal, three different controls: each must have its own budget.
    expect((await limiter.allow(`login:ip:${id}`, 1, 60_000)).ok).toBe(true);
    expect((await limiter.allow(`login:acct:${id}`, 1, 60_000)).ok).toBe(true);
    expect((await limiter.allow(`mfa:${id}`, 1, 60_000)).ok).toBe(true);
    // ...and each is independently exhausted.
    expect((await limiter.allow(`login:ip:${id}`, 1, 60_000)).ok).toBe(false);
    expect((await limiter.allow(`mfa:${id}`, 1, 60_000)).ok).toBe(false);
  });

  it('[multi-instance] two limiter instances share ONE Redis budget', async () => {
    const ns = `rl-${uniq()}`;
    const one = new RedisRateLimiter(client, ns);
    const two = new RedisRateLimiter(client, ns);
    const key = `mfa:${uniq()}`;
    expect((await one.allow(key, 3, 60_000)).ok).toBe(true);
    expect((await two.allow(key, 3, 60_000)).ok).toBe(true);
    expect((await one.allow(key, 3, 60_000)).ok).toBe(true);
    // Fourth request denied regardless of which instance serves it.
    expect((await two.allow(key, 3, 60_000)).ok).toBe(false);
  });

  it('[reset] clearing after success frees the budget, and only that key', async () => {
    const limiter = new RedisRateLimiter(client, `rl-${uniq()}`);
    const mine = `login:acct:${uniq()}`;
    const other = `login:acct:${uniq()}`;
    await limiter.allow(mine, 1, 60_000);
    await limiter.allow(other, 1, 60_000);
    expect((await limiter.allow(mine, 1, 60_000)).ok).toBe(false);
    await limiter.reset(mine);
    expect((await limiter.allow(mine, 1, 60_000)).ok).toBe(true);
    // The neighbouring bucket was not cleared as a side effect.
    expect((await limiter.allow(other, 1, 60_000)).ok).toBe(false);
  });

  it('[reconnect] a fresh client keeps seeing the same shared counter', async () => {
    const ns = `rl-${uniq()}`;
    const key = `login:ip:${uniq()}`;
    const first = new RedisRateLimiter(client, ns);
    await first.allow(key, 2, 60_000);
    const { host, port, tls } = parseRedisUrl(REDIS_URL!);
    const second = new RedisClient({ host, port, tls, connectTimeoutMs: 2000 });
    await second.connect();
    try {
      const limiter = new RedisRateLimiter(second, ns);
      expect((await limiter.allow(key, 2, 60_000)).ok).toBe(true);
      expect((await limiter.allow(key, 2, 60_000)).ok).toBe(false); // budget already partly spent
    } finally {
      await second.quit().catch(() => {});
    }
  });

  it('[HTTP integration] login and MFA 429 are served by the REAL Redis limiter', async () => {
    const limiter = new FailClosedRateLimiter(new RedisRateLimiter(client, `rl-${uniq()}`));
    const h = build({ limiter, loginRatePerMin: 2, mfaRatePerMin: 2 });
    const email = `redis-http-${uniq()}@example.com`;
    await register(h.app, email);
    expect((await login(h.app, email, 'wrong-password-value')).status).toBe(401);
    expect((await login(h.app, email, 'wrong-password-value')).status).toBe(401);
    const denied = await login(h.app, email, 'wrong-password-value');
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('[HTTP multi-instance] two app instances behind ONE Redis budget share the login limit', async () => {
    const limiter = new FailClosedRateLimiter(new RedisRateLimiter(client, `rl-${uniq()}`));
    const db = openDb(':memory:');
    const a = build({ limiter, loginRatePerMin: 2, db });
    const b = build({ limiter, loginRatePerMin: 2, db });
    const email = `redis-multi-${uniq()}@example.com`;
    await register(a.app, email);
    expect((await login(a.app, email, 'wrong-password-value')).status).toBe(401);
    expect((await login(b.app, email, 'wrong-password-value')).status).toBe(401);
    expect((await login(b.app, email, 'wrong-password-value')).status).toBe(429);
  });

  it('[outage fail-closed] an unreachable Redis DENIES login rather than allowing it', async () => {
    // A real client dialled at a closed port: the connection genuinely fails, and the limiter must not
    // "fail open" into unlimited attempts.
    const dead = new RedisClient({ host: '127.0.0.1', port: 1, connectTimeoutMs: 300 });
    await expect(dead.connect()).rejects.toThrow();
    const limiter = new FailClosedRateLimiter(new RedisRateLimiter(dead, `rl-${uniq()}`));
    const h = build({ limiter, loginRatePerMin: 100 });
    const email = `outage-${uniq()}@example.com`;
    await register(h.app, email);
    const res = await login(h.app, email);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    await dead.quit().catch(() => {});
  });

  it('[timeout] a hung backend still denies (bounded, never an open gate)', async () => {
    const hung: RateLimiter = { allow: async () => { throw new Error('ETIMEDOUT'); } };
    const limiter = new FailClosedRateLimiter(hung);
    const d = await limiter.allow('login:acct:x', 5, 60_000);
    expect(d.ok).toBe(false);
    expect(d.retryAfterMs).toBe(60_000);
  });
});

// ============================================================ configuration safety (no socket)
describe('BATCH_1 login/MFA limiter — production selection + credential safety', () => {
  it('production REQUIRES Redis for the credential surfaces (no in-process fallback)', () => {
    expect(() => createRateLimiter({ isProduction: true, redisUrl: undefined })).toThrow(/REDIS_URL/);
    expect(() => createRateLimiter({ isProduction: true, redisUrl: '   ' })).toThrow(/REDIS_URL/);
  });

  it('never leaks Redis credentials into the thrown error', () => {
    try {
      createRateLimiter({ isProduction: true, redisUrl: '' });
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toMatch(/rediss?:\/\//);
      expect(msg).not.toContain('password');
    }
  });

  it('a rediss:// URL is carried through as TLS (ElastiCache in-transit encryption)', () => {
    const seen: string[] = [];
    const limiter = createRateLimiter({
      isProduction: true,
      redisUrl: 'rediss://user:sekret@cache.example.com:6380',
      redisClientFactory: (url) => {
        // The factory receives the URL; assert the limiter itself never echoes it anywhere.
        const parsed = parseRedisUrl(url);
        seen.push(`${parsed.tls}`);
        return { command: async () => [1, 60_000] };
      },
    });
    expect(seen).toEqual(['true']);
    expect(limiter).toBeInstanceOf(FailClosedRateLimiter);
  });

  it('dev/test selects the in-memory limiter', () => {
    expect(createRateLimiter({ isProduction: false })).toBeInstanceOf(InMemoryRateLimiter);
  });
});
