import { z } from 'zod';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  AuthService,
  verifyCsrf,
  csrfTokenFor,
  originAllowed,
  hasPermission,
  type IAuditRepository,
  type PermissionV2,
  type PublicUser,
} from '@quantumtrade/auth';
import type { ResourceRepo } from './db/resource-repo';
import type { IFavoritesRepo } from './db/favorites-repo';
import type { IPreferencesRepo } from './db/preferences-repo';
import type { RateLimiter } from './security/rate-limiter';
import { createHash } from 'node:crypto';

const SESSION = 'qt_session';
const CSRF = 'qt_csrf';
const MAX_BODY = 64 * 1024; // oversized-input guard
/** Default distributed login budget per minute, applied to BOTH the IP and the account bucket. */
export const DEFAULT_LOGIN_RATE_PER_MIN = 10;
const corr = () => Math.random().toString(36).slice(2, 10);
const err = (code: string, message: string) => ({ error: { code, message, correlationId: corr() } });

interface RouterDeps {
  service: AuthService;
  audit: IAuditRepository;
  resource: ResourceRepo;
  /** BATCH_2 — favourites & preferences move to the async repository contract (PostgreSQL in production,
   *  SQLite in dev/test), selected by the server. The legacy `resource` endpoints (layouts/signals/etc.)
   *  are unchanged; only these two required domains are cut over. */
  favorites: IFavoritesRepo;
  preferences: IPreferencesRepo;
  csrfKey: string;
  secureCookies: boolean;
  corsOrigins: string[];
  cookieName?: string;
  cookieDomain?: string;
  /** Optional MFA gate (Phase 6). When a user has MFA enabled, login returns a pending challenge
   *  instead of a full session (the pre-MFA session is discarded). ASYNC since Batch 1: the MFA
   *  credential/challenge store is PostgreSQL in production, so neither call can be synchronous and
   *  neither may be left un-awaited (an un-awaited `startChallenge` would set a cookie for a challenge
   *  row that might never exist). */
  mfa?: {
    isEnabled: (userId: string) => Promise<boolean>;
    startChallenge: (userId: string) => Promise<string>; // returns raw pending token (stores its hash)
    cookie: string;
    ttlMs: number;
  };
  /**
   * DISTRIBUTED login request-rate limiter (R6/BL-11). In production this is the Redis/Valkey limiter, so
   * the login budget is ONE budget across every instance rather than one per instance (the multi-instance
   * bypass the audit flagged). Injected by the server; dev/test use the in-memory limiter.
   *
   * Complements — never replaces — the persistent `account_lockouts` penalty in PostgreSQL: this bounds
   * request RATE in a short window, that bounds ACCOUNT state durably.
   */
  rateLimiter?: RateLimiter;
  /** Login attempts allowed per minute, per IP and per account bucket (distributed). */
  loginRatePerMin?: number;
}

function ipOf(c: Context): string | undefined {
  const xff = c.req.header('x-forwarded-for');
  return xff ? xff.split(',')[0]!.trim() : undefined;
}

/** Read + parse JSON with a hard size cap (oversized-input protection). */
async function readJson(c: Context): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const text = await c.req.text();
  if (text.length > MAX_BODY) return { ok: false };
  try {
    return { ok: true, body: text ? JSON.parse(text) : {} };
  } catch {
    return { ok: false };
  }
}

/**
 * B2 — preference and favourite write contracts.
 *
 * Both are `.strict()` allow-lists rather than free-form objects. A preferences endpoint that accepts
 * arbitrary JSON is a prototype-pollution and unbounded-payload surface, and it also lets a client
 * persist keys the server never reads — which then look like features that exist.
 */
const PreferencesUpdateSchema = z
  .object({
    theme: z.enum(['dark', 'light']).optional(),
    brand: z.string().max(32).optional(),
    density: z.enum(['compact', 'cozy', 'comfortable']).optional(),
    longshort: z.string().max(32).optional(),
    locale: z.enum(['ko', 'en']).optional(),
  })
  .strict();

/** Mirrors `ResourceRepo.MAX_FAVORITES`; re-declared so the route can report it without a repo import. */
const MAX_FAVORITES = 64;

const FavoritesUpdateSchema = z
  .object({
    // Symbol ids only: uppercase alphanumerics. Validated here so a bad id never reaches the table, and
    // so the error names the offending index rather than failing on a constraint.
    // Trimmed BEFORE the pattern check: surrounding whitespace is a client formatting artefact, not a
    // malformed symbol. The pattern itself stays strict (alphanumeric ids only).
    symbols: z.array(z.string().trim().regex(/^[A-Z0-9]{2,20}$/i)).max(MAX_FAVORITES),
  })
  .strict();

export function createAuthRouter(deps: RouterDeps): Hono {
  const { service, audit, resource, favorites, preferences, csrfKey, secureCookies, corsOrigins } = deps;
  const app = new Hono();
  const sessionCookie = deps.cookieName ?? SESSION;
  const base = { secure: secureCookies, sameSite: 'Lax' as const, path: '/', ...(deps.cookieDomain ? { domain: deps.cookieDomain } : {}) };

  const ctxOf = (c: Context) => ({ ip: ipOf(c), userAgent: c.req.header('user-agent'), traceId: c.req.header('x-trace-id') ?? corr() });

  async function authed(c: Context): Promise<{ user: PublicUser; raw: string; csrfSecret: string } | null> {
    const raw = getCookie(c, sessionCookie);
    if (!raw) return null;
    const v = await service.validateSession(raw);
    return v ? { user: v.user, raw, csrfSecret: v.session.csrfSecret } : null;
  }

  /** Unsafe-method guard: Origin/Referer allowlist (defense in depth) + signed session-bound CSRF. */
  async function csrfGuard(c: Context, csrfSecret: string): Promise<boolean> {
    if (!originAllowed(c.req.header('origin'), c.req.header('referer'), corsOrigins)) return false;
    return verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF), csrfSecret, csrfKey);
  }

  function requirePerm(user: PublicUser, perm: PermissionV2): boolean {
    return hasPermission(user.role, perm);
  }

  // ---------------- auth ----------------
  app.get('/auth/csrf', async (c) => {
    const a = await authed(c);
    if (!a) return c.json({ csrfToken: null });
    const token = csrfTokenFor(a.csrfSecret, csrfKey);
    setCookie(c, CSRF, token, { ...base, httpOnly: false });
    return c.json({ csrfToken: token });
  });

  app.post('/auth/register', async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json(err('BAD_REQUEST', 'invalid or oversized body'), 400);
    const r = await service.register(parsed.body, ctxOf(c));
    if (!r.ok) return c.json(err(r.code, r.error), r.code === 'EMAIL_TAKEN' ? 409 : 400);
    return c.json({ user: r.user }, 201);
  });

  app.post('/auth/login', async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json(err('BAD_REQUEST', 'invalid or oversized body'), 400);
    // ---- distributed request-rate gate (R6/BL-11), BEFORE any credential work ----
    // Two buckets, both server-derived and namespaced apart from the MFA buckets:
    //   login:ip:<ip>        — caps one source hammering many accounts (credential stuffing);
    //   login:acct:<sha256>  — caps many sources hammering one account (targeted guessing).
    // The account bucket keys on a HASH of the normalized address, never the address itself: the bucket
    // must not put user e-mail into Redis, and a key must not become an oracle for whether an account
    // exists. The gate runs before `service.login`, so a denial cannot depend on account existence, and
    // the 429 body is identical for a registered and an unregistered address.
    if (deps.rateLimiter) {
      const budget = deps.loginRatePerMin ?? DEFAULT_LOGIN_RATE_PER_MIN;
      const emailForKey = String((parsed.body as { email?: unknown } | null)?.email ?? '').trim().toLowerCase();
      const acctKey = `login:acct:${createHash('sha256').update(emailForKey).digest('hex')}`;
      const ipKey = `login:ip:${ipOf(c) ?? 'unknown'}`;
      const [byIp, byAcct] = await Promise.all([
        deps.rateLimiter.allow(ipKey, budget, 60_000),
        deps.rateLimiter.allow(acctKey, budget, 60_000),
      ]);
      if (!byIp.ok || !byAcct.ok) {
        const retryAfterMs = Math.max(byIp.ok ? 0 : byIp.retryAfterMs, byAcct.ok ? 0 : byAcct.retryAfterMs);
        c.header('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
        return c.json(err('RATE_LIMITED', 'too many attempts'), 429);
      }
    }
    const r = await service.login(parsed.body, ctxOf(c));
    if (!r.ok) {
      if (r.code === 'RATE_LIMITED' && r.retryAfterMs) c.header('Retry-After', String(Math.ceil(r.retryAfterMs / 1000)));
      return c.json(err(r.code, r.error), r.code === 'RATE_LIMITED' ? 429 : r.code === 'DISABLED' ? 403 : 401);
    }
    // Password step passed: forget the consumed request budget for this ACCOUNT (request budget ONLY —
    // the durable `account_lockouts` penalty is a separate control cleared by the MFA routes).
    //
    // The IP bucket is deliberately NOT reset. It exists to cap one source probing many accounts, so
    // letting a single valid credential clear it would hand an attacker who controls one working account a
    // way to refresh their credential-stuffing allowance on demand. The account bucket is safe to clear
    // because clearing it required that account's own correct password.
    if (deps.rateLimiter) {
      const emailForKey = r.user.email.trim().toLowerCase();
      await deps.rateLimiter.reset?.(`login:acct:${createHash('sha256').update(emailForKey).digest('hex')}`);
    }
    // MFA gate: if enabled, discard the pre-MFA session and require a challenge (password step passed).
    if (deps.mfa && (await deps.mfa.isEnabled(r.user.id))) {
      await service.logout(r.sessionId, ctxOf(c));
      const pending = await deps.mfa.startChallenge(r.user.id);
      setCookie(c, deps.mfa.cookie, pending, { ...base, httpOnly: true, maxAge: Math.floor(deps.mfa.ttlMs / 1000) });
      return c.json({ mfaRequired: true, email: r.user.email });
    }
    setCookie(c, sessionCookie, r.sessionId, { ...base, httpOnly: true }); // raw token; only hash stored server-side
    setCookie(c, CSRF, csrfTokenFor(r.csrfSecret, csrfKey), { ...base, httpOnly: false });
    return c.json({ user: r.user, csrfToken: csrfTokenFor(r.csrfSecret, csrfKey) });
  });

  app.post('/auth/logout', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf validation failed'), 403);
    await service.logout(a.raw, ctxOf(c));
    deleteCookie(c, sessionCookie, { path: '/' });
    deleteCookie(c, CSRF, { path: '/' });
    return c.json({ ok: true });
  });

  app.get('/auth/me', async (c) => {
    const a = await authed(c);
    return a ? c.json({ user: a.user }) : c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
  });

  /**
   * 세션 조회 — 비로그인도 정상 응답(200)이다.
   *
   * `/auth/me` 는 비로그인에 401 을 준다. 그건 "이 자원에 접근 권한이 없다"는
   * 의미로는 옳지만, 화면이 시작할 때마다 "누가 로그인했나?" 를 묻는 용도로는
   * 부적절하다. 브라우저가 401 을 콘솔 에러로 기록해서, 정상 상태인 비로그인이
   * 매번 오류처럼 보인다.
   *
   * 그래서 조회 전용 엔드포인트를 따로 둔다. "아무도 로그인하지 않았다" 는
   * 오류가 아니라 유효한 답이다.
   *
   * ★ 이걸 권한 검사에 쓰면 안 된다. 항상 200 이므로 게이트로 쓸 수 없다.
   *   실제 차단은 각 엔드포인트가 401/403 으로 한다.
   */
  app.get('/auth/session', async (c) => {
    const a = await authed(c);
    // 캐시하면 로그아웃 후에도 이전 사용자가 보인다.
    c.header('Cache-Control', 'no-store');
    return c.json({ authenticated: Boolean(a), user: a ? a.user : null });
  });

  app.post('/auth/change-password', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf'), 403);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json(err('BAD_REQUEST', 'invalid body'), 400);
    const b = parsed.body as { oldPassword?: string; newPassword?: string };
    const r = await service.changePassword(a.user.id, b.oldPassword ?? '', b.newPassword ?? '', ctxOf(c));
    return r.ok ? c.json({ ok: true }) : c.json(err('INVALID', r.error ?? 'failed'), 400);
  });

  // email verification
  app.post('/auth/verify-email/request', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf'), 403);
    await service.requestEmailVerification(a.user.id, ctxOf(c));
    return c.json({ ok: true }); // generic
  });
  app.post('/auth/verify-email', async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json(err('BAD_REQUEST', 'invalid body'), 400);
    const r = await service.verifyEmail(String((parsed.body as { token?: string }).token ?? ''), ctxOf(c));
    return c.json({ ok: r.ok }); // generic result
  });

  // password reset (public; generic responses; Origin checked for unsafe method)
  app.post('/auth/forgot-password', async (c) => {
    if (!originAllowed(c.req.header('origin'), c.req.header('referer'), corsOrigins)) return c.json(err('FORBIDDEN', 'origin'), 403);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json(err('BAD_REQUEST', 'invalid body'), 400);
    await service.requestPasswordReset(String((parsed.body as { email?: string }).email ?? ''), ctxOf(c));
    return c.json({ ok: true }); // ALWAYS generic (no user enumeration)
  });
  app.post('/auth/reset-password', async (c) => {
    if (!originAllowed(c.req.header('origin'), c.req.header('referer'), corsOrigins)) return c.json(err('FORBIDDEN', 'origin'), 403);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json(err('BAD_REQUEST', 'invalid body'), 400);
    const b = parsed.body as { token?: string; newPassword?: string };
    const r = await service.resetPassword(String(b.token ?? ''), String(b.newPassword ?? ''), ctxOf(c));
    return r.ok ? c.json({ ok: true }) : c.json(err('INVALID', r.error ?? 'failed'), 400);
  });

  // ---------------- sessions / devices ----------------
  app.get('/auth/sessions', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    return c.json({ sessions: await service.listSessions(a.user.id, a.raw) });
  });
  app.post('/auth/sessions/revoke', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf'), 403);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json(err('BAD_REQUEST', 'invalid body'), 400);
    const ok = await service.revokeSession(a.user.id, String((parsed.body as { sessionId?: string }).sessionId ?? ''), ctxOf(c));
    return ok ? c.json({ ok: true }) : c.json(err('NOT_FOUND', 'session not found'), 404);
  });
  app.post('/auth/sessions/revoke-others', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf'), 403);
    await service.revokeOtherSessions(a.user.id, a.raw, ctxOf(c));
    return c.json({ ok: true });
  });

  // ---------------- account ----------------
  app.get('/account/me', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!requirePerm(a.user, 'account.read.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    return c.json({ user: a.user });
  });
  app.get('/account/preferences', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    const prefs = await preferences.get(a.user.id);
    // `version` is surfaced so the client can send If-Match on the next write.
    return c.json({ preferences: prefs, version: prefs?.version ?? 0 });
  });
  app.put('/account/preferences', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf'), 403);
    if (!requirePerm(a.user, 'account.update.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json(err('BAD_REQUEST', 'invalid body'), 400);
    const body = PreferencesUpdateSchema.safeParse(parsed.body ?? {});
    if (!body.success) {
      // Allow-listed keys and enumerated values only: an arbitrary JSON blob is never persisted, so a
      // crafted payload cannot smuggle unexpected keys (or `__proto__`) into the row.
      return c.json(
        { ...err('BAD_REQUEST', 'invalid preferences'), issues: body.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })) },
        400,
      );
    }
    // If-Match is optional; when present it must match, so a concurrent edit is a 409 not a clobber.
    const ifMatch = c.req.header('if-match');
    const expectedVersion = ifMatch === undefined ? undefined : Number(ifMatch.replace(/"/g, ''));
    if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) {
      return c.json(err('BAD_REQUEST', 'invalid If-Match'), 400);
    }
    const out = await preferences.upsert(a.user.id, body.data as Record<string, string | undefined>, expectedVersion);
    if (!out.ok) {
      return c.json({ ...err('CONFLICT', 'preferences changed since it was read'), currentVersion: out.currentVersion }, 409);
    }
    await audit.record({ id: corr(), actorUserId: a.user.id, action: 'account.preferences.update', target: a.user.id, ip: ipOf(c) ?? null, at: Date.now(), meta: { result: 'success', version: out.version } });
    return c.json({ ok: true, version: out.version });
  });

  // ---- favourites (FAV-01 / FAV-02) ----
  // Previously localStorage only. Ownership comes from the session, never from the body, so one user
  // can never read or write another's set.
  app.get('/me/favorites', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    const out = await favorites.list(a.user.id);
    return c.json({ symbols: out.symbols, version: out.version, updatedAt: out.updatedAt, maxFavorites: MAX_FAVORITES });
  });
  app.put('/me/favorites', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf'), 403);
    if (!requirePerm(a.user, 'account.update.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json(err('BAD_REQUEST', 'invalid body'), 400);
    const body = FavoritesUpdateSchema.safeParse(parsed.body ?? {});
    if (!body.success) {
      return c.json(
        { ...err('BAD_REQUEST', 'invalid favorites'), issues: body.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })) },
        400,
      );
    }
    const ifMatch = c.req.header('if-match');
    const expectedVersion = ifMatch === undefined ? undefined : Number(ifMatch.replace(/"/g, ''));
    if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) {
      return c.json(err('BAD_REQUEST', 'invalid If-Match'), 400);
    }
    const out = await favorites.replace(a.user.id, body.data.symbols, expectedVersion);
    if (!out.ok) {
      if (out.reason === 'tooMany') {
        return c.json({ ...err('UNPROCESSABLE', `at most ${MAX_FAVORITES} favorites`), maxFavorites: MAX_FAVORITES }, 422);
      }
      return c.json({ ...err('CONFLICT', 'favorites changed since they were read'), currentVersion: out.currentVersion }, 409);
    }
    await audit.record({ id: corr(), actorUserId: a.user.id, action: 'account.favorites.update', target: a.user.id, ip: ipOf(c) ?? null, at: Date.now(), meta: { result: 'success', count: out.symbols.length, version: out.version } });
    return c.json({ ok: true, symbols: out.symbols, version: out.version });
  });
  app.post('/account/disable', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf'), 403);
    await service.disableAccount(a.user.id, ctxOf(c));
    deleteCookie(c, sessionCookie, { path: '/' });
    return c.json({ ok: true });
  });

  // ---------------- user-owned resources (ownership enforced by session userId) ----------------
  const needAuth = async (c: Context) => authed(c);

  // layouts
  app.get('/me/layouts', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!requirePerm(a.user, 'layout.read.self')) return c.json(err('FORBIDDEN', ''), 403); return c.json({ items: resource.listLayouts(a.user.id) }); });
  app.post('/me/layouts', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', ''), 403); if (!requirePerm(a.user, 'layout.write.self')) return c.json(err('FORBIDDEN', ''), 403); const p = await readJson(c); if (!p.ok) return c.json(err('BAD_REQUEST', ''), 400); const b = p.body as { name?: string; layout?: unknown }; const r = resource.createLayout(a.user.id, b.name ?? 'Layout', b.layout ?? {}); await audit.record({ id: corr(), actorUserId: a.user.id, action: 'layout.save', target: r.id, ip: ipOf(c) ?? null, at: Date.now(), meta: { result: 'success', version: r.version } }); return c.json(r, 201); });
  app.get('/me/layouts/:id', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); const row = resource.getLayout(a.user.id, c.req.param('id')); return row ? c.json(row) : c.json(err('NOT_FOUND', 'not found'), 404); });
  app.put('/me/layouts/:id', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', ''), 403); const p = await readJson(c); if (!p.ok) return c.json(err('BAD_REQUEST', ''), 400); const r = resource.updateLayout(a.user.id, c.req.param('id'), (p.body as { layout?: unknown }).layout ?? {}); return r ? c.json(r) : c.json(err('NOT_FOUND', 'not found'), 404); });
  app.get('/me/layouts/:id/versions', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); return c.json({ versions: resource.listLayoutVersions(a.user.id, c.req.param('id')) }); });

  // signals
  app.get('/me/signals', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!requirePerm(a.user, 'signal.read.self')) return c.json(err('FORBIDDEN', ''), 403); return c.json({ items: resource.listSignals(a.user.id) }); });
  app.post('/me/signals', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', ''), 403); if (!requirePerm(a.user, 'signal.write.self')) return c.json(err('FORBIDDEN', ''), 403); const p = await readJson(c); if (!p.ok) return c.json(err('BAD_REQUEST', ''), 400); const b = p.body as { symbol?: string; timeframe?: string; direction?: string; data?: unknown }; const r = resource.createSignal(a.user.id, { symbol: b.symbol ?? 'BTCUSDT', timeframe: b.timeframe, direction: b.direction, data: b.data ?? {} }); await audit.record({ id: corr(), actorUserId: a.user.id, action: 'signal.create', target: r.id, ip: ipOf(c) ?? null, at: Date.now(), meta: { result: 'success' } }); return c.json(r, 201); });
  app.get('/me/signals/:id', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); const row = resource.getSignal(a.user.id, c.req.param('id')); return row ? c.json(row) : c.json(err('NOT_FOUND', 'not found'), 404); });

  // order drafts
  app.get('/me/order-drafts', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!requirePerm(a.user, 'order-draft.read.self')) return c.json(err('FORBIDDEN', ''), 403); return c.json({ items: resource.listOrderDrafts(a.user.id) }); });
  app.post('/me/order-drafts', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', ''), 403); if (!requirePerm(a.user, 'order-draft.write.self')) return c.json(err('FORBIDDEN', ''), 403); const p = await readJson(c); if (!p.ok) return c.json(err('BAD_REQUEST', ''), 400); const b = p.body as { symbol?: string; side?: string; data?: unknown }; const r = resource.createOrderDraft(a.user.id, { symbol: b.symbol ?? 'BTCUSDT', side: b.side ?? 'long', data: b.data ?? {} }); await audit.record({ id: corr(), actorUserId: a.user.id, action: 'order-draft.create', target: r.id, ip: ipOf(c) ?? null, at: Date.now(), meta: { result: 'success' } }); return c.json(r, 201); });
  app.get('/me/order-drafts/:id', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); const row = resource.getOrderDraft(a.user.id, c.req.param('id')); return row ? c.json(row) : c.json(err('NOT_FOUND', 'not found'), 404); });

  // overlays / conversations / sim-orders
  app.get('/me/overlays', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); return c.json({ items: resource.listOverlays(a.user.id) }); });
  app.post('/me/overlays', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', ''), 403); const p = await readJson(c); if (!p.ok) return c.json(err('BAD_REQUEST', ''), 400); const b = p.body as { symbol?: string; kind?: string; data?: unknown }; return c.json(resource.createOverlay(a.user.id, { symbol: b.symbol ?? 'BTCUSDT', kind: b.kind ?? 'trendLine', data: b.data ?? {} }), 201); });
  app.get('/me/conversations', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); return c.json({ items: resource.listConversations(a.user.id) }); });
  app.post('/me/conversations', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', ''), 403); const p = await readJson(c); if (!p.ok) return c.json(err('BAD_REQUEST', ''), 400); return c.json(resource.createConversation(a.user.id, String((p.body as { title?: string }).title ?? 'Conversation')), 201); });
  app.post('/me/conversations/:id/messages', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', ''), 403); const p = await readJson(c); if (!p.ok) return c.json(err('BAD_REQUEST', ''), 400); const b = p.body as { role?: string; content?: string }; const r = resource.addMessage(a.user.id, c.req.param('id'), b.role ?? 'user', String(b.content ?? '')); return r ? c.json(r, 201) : c.json(err('NOT_FOUND', 'not found'), 404); });
  app.get('/me/conversations/:id/messages', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); const rows = resource.listMessages(a.user.id, c.req.param('id')); return rows ? c.json({ items: rows }) : c.json(err('NOT_FOUND', 'not found'), 404); });
  app.get('/me/sim-orders', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); return c.json({ items: resource.listSimOrders(a.user.id) }); });

  // ---------------- admin / support ----------------
  app.get('/admin/audit', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!requirePerm(a.user, 'audit.read')) return c.json(err('FORBIDDEN', 'audit.read'), 403); await audit.record({ id: corr(), actorUserId: a.user.id, action: 'admin.audit.access', target: null, ip: ipOf(c) ?? null, at: Date.now(), meta: { result: 'success' } }); return c.json({ entries: await audit.list(50) }); });
  app.get('/admin/users/:id', async (c) => { const a = await needAuth(c); if (!a) return c.json(err('UNAUTHENTICATED', ''), 401); if (!requirePerm(a.user, 'support.user.read')) return c.json(err('FORBIDDEN', 'support.user.read'), 403); return c.json({ ok: true }); });

  return app;
}
