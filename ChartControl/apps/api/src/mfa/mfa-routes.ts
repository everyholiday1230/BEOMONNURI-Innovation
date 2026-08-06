import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createHash } from 'node:crypto';
import { AuthService, verifyCsrf, csrfTokenFor, originAllowed } from '@quantumtrade/auth';
import {
  generateTotpSecret, otpauthUri, verifyTotp, generateRecoveryCodes, redeemRecoveryCode,
  remainingRecoveryCodes, type SecretCipher, recordFailure, isLocked, resetLockout,
  canDisableMfa, DEFAULT_LOCKOUT,
} from '@quantumtrade/mfa';
import type { IMfaRepo } from '../db/mfa-repo';
import { MemoryLockoutStore, type LockoutStore } from '../db/lockout-repo';
import type { RateLimiter } from '../security/rate-limiter';

const CSRF = 'qt_csrf';
const err = (code: string, message: string) => ({ error: { code, message } });
const hash = (t: string) => createHash('sha256').update(t).digest('hex');

/** Default MFA verification budget per actor per minute. Deliberately small: a human entering a 6-digit
 *  code needs a handful of attempts, an online guessing attack needs thousands. */
export const DEFAULT_MFA_RATE_PER_MIN = 10;

export interface MfaRouterDeps {
  service: AuthService;
  repo: IMfaRepo;
  cipher: SecretCipher;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  challengeCookie: string;
  secureCookies: boolean;
  activeSuperAdminIds?: () => string[];
  /**
   * Where brute-force lockout state lives. Defaults to the previous in-memory behaviour; production wires
   * the PostgreSQL store so a lockout survives a restart and can be counted/cleared by ADM-API-13.
   */
  lockouts?: LockoutStore;
  /**
   * DISTRIBUTED request-rate limiter for the MFA verification surfaces (R6/BL-11). Injected, and in
   * production this is the Redis/Valkey limiter, so the per-actor budget is ONE budget across every
   * instance instead of one per instance.
   *
   * This is a different control from `lockouts` and both are enforced: the limiter caps how FAST codes can
   * be tried (short window, shared, resets with the window), while `account_lockouts` in PostgreSQL is the
   * durable per-account penalty that survives restarts and is cleared only by success or by an admin.
   * Dropping either one would leave a real gap, so neither is treated as a substitute for the other.
   */
  rateLimiter?: RateLimiter;
  /** Verification attempts allowed per actor per minute (distributed). */
  ratePerMin?: number;
}

/** MFA API (Phase 6 §5). Account endpoints require a session; login-step (challenge/recovery) use the
 *  short-lived pending cookie set by /auth/login when MFA is enabled. Secrets encrypted; recovery codes
 *  hashed; TOTP replay-guarded; brute-force locked out. */
export function createMfaRouter(d: MfaRouterDeps): Hono {
  const app = new Hono();
  const base = { path: '/', httpOnly: true as const, secure: d.secureCookies, sameSite: 'Lax' as const };
  // Lockout state. Same algorithm as before (@quantumtrade/mfa); only the STORE is injectable, so the
  // state can be persisted (and therefore observed and cleared by ADM-API-13) instead of dying with the
  // process. `LockoutState | undefined` and the get/set shape are unchanged, so the call sites below are
  // identical to the previous `Map`.
  const lockouts: LockoutStore = d.lockouts ?? new MemoryLockoutStore();
  const rateBudget = d.ratePerMin ?? DEFAULT_MFA_RATE_PER_MIN;

  /**
   * Per-actor MFA verification gate. The key namespace is `mfa:<userId>` — a SERVER-derived principal
   * (session user, or the user the pending challenge cookie resolves to), never anything the client can
   * choose, so one actor cannot spend or evade another's budget. Namespaced separately from the login
   * buckets so password attempts and code attempts cannot cannibalise each other's allowance.
   *
   * Denials reply 429 with `Retry-After` and carry NO information about the account or the code.
   */
  const rateGate = async (c: Context, userId: string): Promise<Response | null> => {
    if (!d.rateLimiter) return null;
    const decision = await d.rateLimiter.allow(`mfa:${userId}`, rateBudget, 60_000);
    if (decision.ok) return null;
    c.header('Retry-After', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
    return c.json(err('RATE_LIMITED', 'too many attempts'), 429);
  };

  /** Clear the request budget after a verified attempt (see RateLimiter.reset — request budget only; the
   *  durable `account_lockouts` penalty is cleared separately by `resetLockout()` below). */
  const rateReset = async (userId: string): Promise<void> => {
    await d.rateLimiter?.reset?.(`mfa:${userId}`);
  };

  app.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'no-store'); });

  const authed = async (c: Context) => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret, raw: raw! } : null;
  };
  const csrfOk = (c: Context, secret: string) =>
    originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF), secret, d.csrfKey);
  const readJson = async (c: Context): Promise<Record<string, unknown>> => c.req.json().catch(() => ({}));
  const ip = (c: Context) => c.req.header('x-forwarded-for') ?? undefined;

  // ---------- status ----------
  app.get('/account/mfa/status', async (c) => {
    const a = await authed(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    const cred = await d.repo.get(a.user.id);
    return c.json({ enabled: cred?.enabled ?? false, pendingSetup: !!cred?.pendingSecretEncrypted, recoveryRemaining: cred ? remainingRecoveryCodes(cred.recoveryCodes) : 0 });
  });

  // ---------- enrollment: setup (password re-auth) ----------
  app.post('/auth/mfa/totp/setup', async (c) => {
    const a = await authed(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    const body = await readJson(c);
    if (typeof body.password !== 'string' || !(await d.service.checkPassword(a.user.id, body.password))) return c.json(err('REAUTH_FAILED', 'password required'), 403);
    if (await d.repo.isEnabled(a.user.id)) return c.json(err('ALREADY_ENABLED', 'MFA already enabled'), 409);
    const secret = generateTotpSecret();
    await d.repo.startEnrollment(a.user.id, d.cipher.encrypt(secret), Date.now() + 10 * 60_000);
    return c.json({ otpauthUri: otpauthUri(secret, a.user.email), secret }); // secret shown ONCE for manual entry
  });

  // ---------- enrollment: verify first code → activate ----------
  app.post('/auth/mfa/totp/verify-enrollment', async (c) => {
    const a = await authed(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    const cred = await d.repo.get(a.user.id);
    if (!cred?.pendingSecretEncrypted) return c.json(err('NO_PENDING', 'no pending setup'), 400);
    if (cred.pendingExpiresAt && cred.pendingExpiresAt < Date.now()) return c.json(err('SETUP_EXPIRED', 'setup expired'), 400);
    const code = String((await readJson(c)).code ?? '');
    const secret = d.cipher.decrypt(cred.pendingSecretEncrypted);
    if (!verifyTotp(secret, code, Date.now()).ok) return c.json(err('INVALID_CODE', 'invalid code'), 400);
    const { codes, records } = generateRecoveryCodes(10);
    await d.repo.activate(a.user.id, d.cipher.encrypt(secret), records);
    return c.json({ enabled: true, recoveryCodes: codes }); // shown ONCE
  });

  // ---------- disable (re-auth + code) ----------
  app.post('/account/mfa/disable', async (c) => {
    const a = await authed(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    const cred = await d.repo.get(a.user.id);
    if (!cred?.enabled || !cred.secretEncrypted) return c.json(err('NOT_ENABLED', ''), 400);
    const body = await readJson(c);
    if (typeof body.password !== 'string' || !(await d.service.checkPassword(a.user.id, body.password))) return c.json(err('REAUTH_FAILED', ''), 403);
    if (!verifyTotp(d.cipher.decrypt(cred.secretEncrypted), String(body.code ?? ''), Date.now()).ok) return c.json(err('INVALID_CODE', ''), 400);
    const guard = canDisableMfa({ role: a.user.role, userId: a.user.id }, d.activeSuperAdminIds?.() ?? []);
    if (!guard.allowed) return c.json(err('FORBIDDEN', guard.reason ?? ''), 403);
    await d.repo.disable(a.user.id);
    return c.json({ ok: true, enabled: false });
  });

  // ---------- regenerate recovery codes ----------
  app.post('/account/mfa/regenerate-recovery', async (c) => {
    const a = await authed(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    const cred = await d.repo.get(a.user.id);
    if (!cred?.enabled || !cred.secretEncrypted) return c.json(err('NOT_ENABLED', ''), 400);
    if (!verifyTotp(d.cipher.decrypt(cred.secretEncrypted), String((await readJson(c)).code ?? ''), Date.now()).ok) return c.json(err('INVALID_CODE', ''), 400);
    const { codes, records } = generateRecoveryCodes(10);
    await d.repo.setRecovery(a.user.id, records);
    return c.json({ recoveryCodes: codes });
  });

  // ---------- login step: TOTP challenge (pending cookie, no session yet) ----------
  app.post('/auth/mfa/challenge', async (c) => {
    if (!originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins)) return c.json(err('ORIGIN', ''), 403);
    const raw = getCookie(c, d.challengeCookie);
    const userId = raw ? await d.repo.peekChallenge(hash(raw)) : null;
    if (!userId) return c.json(err('NO_CHALLENGE', 'no pending MFA challenge'), 401);
    // Request-rate gate BEFORE any decryption/verification work: an attacker must not be able to spend
    // server crypto time faster than the budget, and the budget is shared across instances.
    const limited = await rateGate(c, userId); if (limited) return limited;
    if (isLocked(await lockouts.get(userId), Date.now())) return c.json(err('LOCKED', 'too many attempts'), 429);
    const cred = await d.repo.get(userId);
    if (!cred?.enabled || !cred.secretEncrypted) return c.json(err('NOT_ENABLED', ''), 400);
    const res = verifyTotp(d.cipher.decrypt(cred.secretEncrypted), String((await readJson(c)).code ?? ''), Date.now(), { lastUsedCounter: cred.lastUsedCounter ?? undefined });
    if (!res.ok) { await lockouts.set(userId, recordFailure(await lockouts.get(userId), Date.now(), DEFAULT_LOCKOUT)); return c.json(err('INVALID_CODE', res.reason ?? 'invalid'), 401); }
    await lockouts.set(userId, resetLockout());
    await rateReset(userId);
    if (res.counter !== undefined) await d.repo.setLastCounter(userId, res.counter); // replay guard
    await d.repo.consumeChallenge(hash(raw!));
    return finishLogin(c, userId);
  });

  // ---------- login step: recovery-code login ----------
  app.post('/auth/mfa/recovery', async (c) => {
    if (!originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins)) return c.json(err('ORIGIN', ''), 403);
    const raw = getCookie(c, d.challengeCookie);
    const userId = raw ? await d.repo.peekChallenge(hash(raw)) : null;
    if (!userId) return c.json(err('NO_CHALLENGE', ''), 401);
    const limited = await rateGate(c, userId); if (limited) return limited;
    if (isLocked(await lockouts.get(userId), Date.now())) return c.json(err('LOCKED', ''), 429);
    const cred = await d.repo.get(userId);
    if (!cred?.enabled) return c.json(err('NOT_ENABLED', ''), 400);
    const idx = redeemRecoveryCode(cred.recoveryCodes, String((await readJson(c)).code ?? ''), Date.now());
    if (idx < 0) { await lockouts.set(userId, recordFailure(await lockouts.get(userId), Date.now(), DEFAULT_LOCKOUT)); return c.json(err('INVALID_RECOVERY', 'invalid or used recovery code'), 401); }
    await d.repo.setRecovery(userId, cred.recoveryCodes); // persist one-time consumption
    await lockouts.set(userId, resetLockout());
    await rateReset(userId);
    await d.repo.consumeChallenge(hash(raw!));
    return finishLogin(c, userId, remainingRecoveryCodes(cred.recoveryCodes));
  });

  // ---------- step-up (authenticated; for admin high-risk actions) ----------
  app.post('/auth/mfa/step-up', async (c) => {
    const a = await authed(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    const cred = await d.repo.get(a.user.id);
    if (!cred?.enabled || !cred.secretEncrypted) return c.json(err('NOT_ENABLED', 'MFA not enabled'), 400);
    const limited = await rateGate(c, a.user.id); if (limited) return limited;
    if (isLocked(await lockouts.get(a.user.id), Date.now())) return c.json(err('LOCKED', ''), 429);
    // Step-up verifies a fresh TOTP but is decoupled from the login-challenge replay counter (a user may
    // legitimately step up within the same 30s window they just logged in). Session is already authed.
    const res = verifyTotp(d.cipher.decrypt(cred.secretEncrypted), String((await readJson(c)).code ?? ''), Date.now());
    if (!res.ok) { await lockouts.set(a.user.id, recordFailure(await lockouts.get(a.user.id), Date.now(), DEFAULT_LOCKOUT)); return c.json(err('INVALID_CODE', ''), 401); }
    await lockouts.set(a.user.id, resetLockout());
    await rateReset(a.user.id);
    return c.json({ ok: true, stepUpAt: Date.now(), level: 'stepup' });
  });

  async function finishLogin(c: Context, userId: string, recoveryRemaining?: number) {
    const s = await d.service.createSessionForUser(userId, { ip: ip(c) });
    if (!s.ok) return c.json(err(s.code, s.error), s.code === 'DISABLED' ? 403 : 401);
    deleteCookie(c, d.challengeCookie, { path: '/' });
    setCookie(c, d.cookieName, s.sessionId, base); // session ROTATION: fresh post-MFA session
    setCookie(c, CSRF, csrfTokenFor(s.csrfSecret, d.csrfKey), { ...base, httpOnly: false });
    return c.json({ user: s.user, csrfToken: csrfTokenFor(s.csrfSecret, d.csrfKey), ...(recoveryRemaining !== undefined ? { recoveryRemaining } : {}) });
  }

  return app;
}

/** Shared challenge-token hash (used by the auth login route when starting an MFA challenge). */
export function mfaChallengeHash(raw: string): string { return hash(raw); }
