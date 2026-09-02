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
import {
  MAX_CHART_TEMPLATES,
  type PgChartTemplateRepo,
} from './db/chart-template-repo';
import type { IPreferencesRepo } from './db/preferences-repo';
import type { RateLimiter } from './security/rate-limiter';
import { createHash, randomBytes } from 'node:crypto';

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
  /*
     차트 템플릿 저장소 (선택).

     ★ 선택으로 둔 이유: SQLite 개발 환경에는 이 테이블이 없다. 없으면 라우트를
       등록하지 않고, 화면은 서버 동기화 없이 기기 저장만 쓴다(기존 동작).
       필수로 만들면 개발 환경에서 서버가 뜨지 않는다.
  */
  chartTemplates?: PgChartTemplateRepo;
  preferences: IPreferencesRepo;
  csrfKey: string;
  secureCookies: boolean;
  corsOrigins: string[];
  /**
   * 구글 로그인 설정 (선택).
   *
   * ★ 없으면 구글 라우트를 아예 등록하지 않는다. 등록해 두고 503 을 주면 화면에
   *   버튼이 보이는데 눌러도 안 되는 상태가 된다.
   */
  google?: {
    clientId: string;
    clientSecret: string;
    /** 구글 콘솔에 등록한 것과 **정확히 같은** 값이어야 한다. */
    redirectUri: string;
    /** 로그인 성공 후 돌아갈 앱 주소(해시 라우트 포함). */
    appRedirect: string;
  };
  /**
   * 리퍼럴 귀속 훅 (선택).
   *
   * 회원가입이 성공한 **뒤에** 호출한다. 실패해도 회원가입은 성공으로
   * 처리한다 — 초대 코드 문제로 가입이 막히면 사용자를 잃는다.
   * 귀속은 가입 시점에만 가능하므로(소급 불가) 여기가 유일한 자리다.
   */
  onRegistered?: (userId: string, referralCode: string | null) => Promise<void> | void;
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
    /*
       ★ 화면이 실제로 쓰는 값과 맞춘다. 앱의 밀도 선택은 comfortable/compact/dense 이고
         'dense' 가 빠져 있어 그 값을 저장하려 하면 400 이었다('cozy' 는 예전 값이라 남긴다).
    */
    density: z.enum(['compact', 'cozy', 'comfortable', 'dense']).optional(),
    longshort: z.string().max(32).optional(),
    /*
       ★ 등록된 사전이 en/ja/zh 인데 ko/en 만 허용해서, 일본어·중국어를 고른 이용자는
         설정이 서버에 저장되지 않았다(400). 서비스하는 언어를 모두 받는다.
    */
    locale: z.enum(['ko', 'en', 'ja', 'zh']).optional(),
  })
  .strict();

/** Mirrors `ResourceRepo.MAX_FAVORITES`; re-declared so the route can report it without a repo import. */
const MAX_FAVORITES = 64;

const FavoritesUpdateSchema = z
  .object({
    /*
       Symbol ids, optionally prefixed with the market they belong to.

       Validated here so a bad id never reaches the table, and so the error names the offending
       index rather than failing on a constraint. Trimmed BEFORE the pattern check: surrounding
       whitespace is a client formatting artefact, not a malformed symbol.

       ★★ Why a `spot:` prefix is allowed.

         The same id means two different instruments: `BTCUSDT` on futures is a perpetual contract,
         on spot it is the asset itself. Storing one shared set made a star set on the spot list
         appear on the futures list too, which is simply wrong — they are different products with
         different risk.

         Futures ids stay unprefixed so favourites saved before this change keep working. Silently
         dropping someone's watchlist reads as us having deleted it.

       ★ Only `spot:` is accepted, not an arbitrary prefix. An open-ended `<word>:` pattern would let
         the client invent namespaces we never render, and those rows would sit in the table forever
         with nothing able to show or remove them.
    */
    symbols: z
      .array(z.string().trim().regex(/^(spot:)?[A-Z0-9]{2,20}$/i))
      .max(MAX_FAVORITES),
  })
  .strict();

export function createAuthRouter(deps: RouterDeps): Hono {
  const { service, audit, resource, favorites, preferences, chartTemplates, csrfKey, secureCookies, corsOrigins } = deps;
  const app = new Hono();
  const sessionCookie = deps.cookieName ?? SESSION;
  const base = { secure: secureCookies, sameSite: 'Lax' as const, path: '/', ...(deps.cookieDomain ? { domain: deps.cookieDomain } : {}) };

  /*
     요청 문맥. locale 은 메일 언어에 쓴다.

     ★ 화면이 보내는 x-qt-lang 을 먼저 믿는다(사용자가 고른 언어다). 없으면
       브라우저의 accept-language 를 쓴다. 둘 다 없으면 메일은 영어로 나간다.
  */
  const langOf = (c: Context) => c.req.header('x-qt-lang') ?? c.req.header('accept-language') ?? undefined;
  const ctxOf = (c: Context) => ({ ip: ipOf(c), userAgent: c.req.header('user-agent'), locale: langOf(c), traceId: c.req.header('x-trace-id') ?? corr() });

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
    // 분산 레이트리밋(IP): 자동 대량 가입 방지.
    if (deps.rateLimiter) {
      const budget = deps.loginRatePerMin ?? DEFAULT_LOGIN_RATE_PER_MIN;
      const ipKey = `register:ip:${ipOf(c) ?? 'unknown'}`;
      const dec = await deps.rateLimiter.allow(ipKey, budget, 60_000);
      if (!dec.ok) {
        c.header('Retry-After', String(Math.max(1, Math.ceil(dec.retryAfterMs / 1000))));
        return c.json(err('RATE_LIMITED', 'too many attempts'), 429);
      }
    }
    const r = await service.register(parsed.body, ctxOf(c));
    if (!r.ok) return c.json(err(r.code, r.error), r.code === 'EMAIL_TAKEN' ? 409 : 400);

    /*
       초대 코드 귀속.

       ★ 가입 시점에만 가능하다. 나중에 "이 사람은 내가 초대했다" 고 주장해도
         검증할 근거가 없으므로 소급 귀속을 허용하지 않는다.

       ★ 실패를 삼킨다. 코드가 잘못됐거나 저장소가 죽었어도 가입은 성공이다.
         리퍼럴은 부가 기능이고, 이것 때문에 가입이 막히면 사용자를 잃는다.
         (귀속되지 않았다는 사실은 사용자에게 알릴 방법이 없다 — 초대자가
          자기 화면에서 인원이 안 늘어난 것으로 알게 된다.)

       코드는 body 에서 읽는다. 스키마가 strict 라면 register 가 이미 거부했을
       것이므로, 여기서는 파싱된 원본에서 꺼낸다.
    */
    if (deps.onRegistered) {
      const raw = parsed.body as Record<string, unknown> | undefined;
      const code = raw && typeof raw.referralCode === 'string' ? raw.referralCode : null;
      try {
        await deps.onRegistered(r.user.id, code);
      } catch (e) {
        console.warn('[auth] 리퍼럴 귀속 실패 — 가입은 유지한다:', (e as Error).message);
      }
    }

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

  /* ============================================================
     구글 로그인 (OAuth 2.0 Authorization Code, 기밀 클라이언트)
     ------------------------------------------------------------
     흐름
       1) GET /auth/google/start     → 구글 동의 화면으로 리다이렉트
       2) 구글이 code 와 state 를 붙여 /auth/google/callback 으로 돌려보낸다
       3) 서버가 code 를 토큰으로 교환(서버↔구글, client_secret 사용)
       4) id_token 에서 이메일을 읽어 세션을 만든다

     ★★ state 로 CSRF 를 막는다
       state 를 만들어 **HttpOnly 쿠키**에 넣고, 콜백에서 쿼리의 state 와 대조한다.
       이게 없으면 공격자가 자기 code 로 콜백을 호출해 피해자 브라우저를 자기
       계정에 로그인시킬 수 있다(로그인 CSRF).

     ★★ 서명 검증을 왜 따로 하지 않는가
       id_token 을 **우리가 직접** 구글 토큰 엔드포인트에 client_secret 으로
       인증해서 받는다(TLS). 즉 출처가 구글임이 전송 채널로 보장된다. 그래도
       aud(우리 client_id)·iss(구글)·exp·email_verified 는 반드시 확인한다 —
       다른 앱용 토큰이나 만료 토큰, 소유 미확인 주소를 받지 않기 위해서다.

     ★ 설정이 없으면 이 라우트는 등록되지 않는다(위 deps.google).
     ============================================================ */
  if (deps.google) {
    const g = deps.google;
    const STATE_COOKIE = 'qt_oauth_state';

    app.get('/auth/google/start', async (c) => {
      const state = randomBytes(24).toString('base64url');
      /*
         ★ state 는 HttpOnly 쿠키에 둔다. 화면 스크립트가 읽을 필요가 없고,
           읽히면 CSRF 방어가 무의미해진다. 10분이면 충분하다.
      */
      setCookie(c, STATE_COOKIE, state, { ...base, httpOnly: true, maxAge: 600 });

      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', g.clientId);
      url.searchParams.set('redirect_uri', g.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email');
      url.searchParams.set('state', state);
      // 이미 동의한 사용자는 화면을 다시 보지 않는다.
      url.searchParams.set('prompt', 'select_account');
      return c.redirect(url.toString(), 302);
    });

    app.get('/auth/google/callback', async (c) => {
      /** 실패는 앱의 로그인 화면으로 돌려보낸다 — 흰 화면에 JSON 을 남기지 않는다. */
      const fail = (reason: string) => {
        deleteCookie(c, STATE_COOKIE, { path: '/' });
        const u = new URL(g.appRedirect);
        u.hash = `/login?oauth_error=${encodeURIComponent(reason)}`;
        return c.redirect(u.toString(), 302);
      };

      const code = c.req.query('code');
      const state = c.req.query('state');
      const expected = getCookie(c, STATE_COOKIE);
      if (c.req.query('error')) return fail(String(c.req.query('error')).slice(0, 40));
      if (!code || !state || !expected || state !== expected) return fail('state_mismatch');
      // 한 번 쓴 state 는 즉시 버린다(재사용 방지).
      deleteCookie(c, STATE_COOKIE, { path: '/' });

      let payload: { aud?: string; iss?: string; exp?: number; email?: string; email_verified?: boolean | string };
      try {
        const res = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: g.clientId,
            client_secret: g.clientSecret,
            redirect_uri: g.redirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        if (!res.ok) return fail('token_exchange_failed');
        const tok = (await res.json()) as { id_token?: string };
        if (!tok.id_token) return fail('no_id_token');
        const part = tok.id_token.split('.')[1];
        if (!part) return fail('malformed_id_token');
        payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
      } catch {
        return fail('token_exchange_error');
      }

      // 이 토큰이 **우리 앱** 것인지. 다른 앱의 토큰을 받아주면 안 된다.
      if (payload.aud !== g.clientId) return fail('aud_mismatch');
      const iss = String(payload.iss ?? '');
      if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') return fail('iss_mismatch');
      if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return fail('token_expired');

      /*
         ★★ 소유가 확인된 주소만 받는다. email_verified 가 아니면 남의 주소로
           기존 계정을 가로챌 수 있다(같은 이메일의 계정에 붙기 때문이다).
      */
      const verified = payload.email_verified === true || payload.email_verified === 'true';
      if (!payload.email || !verified) return fail('email_not_verified');

      const r = await service.loginWithVerifiedEmail(payload.email, 'google', ctxOf(c));
      if (!r.ok) return fail(r.code === 'DISABLED' ? 'account_disabled' : 'login_failed');

      /*
         ★ MFA 가 켜진 계정은 비밀번호 경로와 같은 규칙을 적용한다 — 구글로
           들어오면 2단계를 건너뛸 수 있으면 안 된다.
      */
      if (deps.mfa && (await deps.mfa.isEnabled(r.user.id))) {
        await service.logout(r.sessionId, ctxOf(c));
        const pending = await deps.mfa.startChallenge(r.user.id);
        setCookie(c, deps.mfa.cookie, pending, { ...base, httpOnly: true, maxAge: Math.floor(deps.mfa.ttlMs / 1000) });
        const u = new URL(g.appRedirect);
        u.hash = '/login?mfa=1';
        return c.redirect(u.toString(), 302);
      }

      setCookie(c, sessionCookie, r.sessionId, { ...base, httpOnly: true });
      setCookie(c, CSRF, csrfTokenFor(r.csrfSecret, csrfKey), { ...base, httpOnly: false });
      const u = new URL(g.appRedirect);
      u.hash = '/trade';
      return c.redirect(u.toString(), 302);
    });
  }

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
    /*
       ★★ 필드 이름이 어긋나 **비밀번호 변경이 전혀 동작하지 않았다.**

         서버는 oldPassword 를 읽는데 화면(api-client)은 currentPassword 를 보냈다.
         그래서 현재 비밀번호가 항상 빈 문자열로 들어가 무엇을 입력해도
         'invalid credentials' 였다. 고객에게는 "현재 비밀번호가 맞는데 왜 틀렸다고
         하나" 로 보인다.

       ★ 양쪽 이름을 모두 받는다. 화면만 고치면 예전 화면이 캐시된 브라우저에서
         계속 실패하고, 서버만 고치면 다른 호출자가 깨진다.
    */
    const b = parsed.body as { oldPassword?: string; currentPassword?: string; newPassword?: string };
    const current = b.oldPassword ?? b.currentPassword ?? '';
    const r = await service.changePassword(a.user.id, current, b.newPassword ?? '', ctxOf(c));
    /*
       ★ 실패 사유를 구분해서 돌려준다. 전에는 전부 INVALID 였고, 새 비밀번호가
         짧아서 실패했는데도 화면이 '현재 비밀번호가 틀렸다' 로 안내했다.
    */
    if (r.ok) return c.json({ ok: true });
    const reason = String(r.error ?? 'failed');
    const code = reason.startsWith('PASSWORD_TOO_SHORT') ? 'PASSWORD_TOO_SHORT' : 'INVALID';
    return c.json(err(code, reason), 400);
  });

  // email verification
  app.post('/auth/verify-email/request', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf'), 403);
    /*
       ★★ 재발송에도 한도를 둔다.

         전에는 인증 세션만 있으면 무제한으로 부를 수 있었다. 그러면 자기
         주소로 메일을 계속 보내 **발송 비용**을 태우고(제공자 과금), 발송
         도메인의 평판을 떨어뜨려 다른 이용자의 인증 메일까지 스팸으로 분류되게
         만들 수 있다. 계정당 한도라서 정상 이용자(한두 번 다시 보내기)는
         걸리지 않는다.

       ★ 레이트리미터가 없는 배포에서는 통과시킨다 — 한도 장치가 없다고
         인증 메일 재발송 자체를 막으면 가입이 완결되지 않는다.
    */
    if (deps.rateLimiter) {
      const dec = await deps.rateLimiter.allow(`verify-email:user:${a.user.id}`, 5, 600_000);
      if (!dec.ok) {
        c.header('Retry-After', String(Math.max(1, Math.ceil(dec.retryAfterMs / 1000))));
        return c.json(err('RATE_LIMITED', 'too many verification emails requested'), 429);
      }
    }
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
    // 분산 레이트리밋(IP + 이메일 해시): 재설정 메일 폭탄/DoS 방지.
    if (deps.rateLimiter) {
      const budget = deps.loginRatePerMin ?? DEFAULT_LOGIN_RATE_PER_MIN;
      const emailForKey = String((parsed.body as { email?: unknown } | null)?.email ?? '').trim().toLowerCase();
      const ipKey = `forgot:ip:${ipOf(c) ?? 'unknown'}`;
      const acctKey = `forgot:acct:${createHash('sha256').update(emailForKey).digest('hex')}`;
      const [byIp, byAcct] = await Promise.all([
        deps.rateLimiter.allow(ipKey, budget, 60_000),
        deps.rateLimiter.allow(acctKey, budget, 60_000),
      ]);
      // 한도 초과 시 조용히 성공 응답(열거 방지) — 메일만 보내지 않는다.
      if (!byIp.ok || !byAcct.ok) return c.json({ ok: true });
    }
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

  /*
     ---- 내 데이터 내보내기 (개인정보처리방침 7절 · 이전권) ----

     ★★ 방침 7절이 "개인정보를 구조화된 형식으로 받기(이전 요구)" 를 이용자
       권리로 약속했는데 그 수단이 없었다. 권리를 적어 놓고 행사할 방법을
       주지 않으면 약속을 지키지 않는 것이다(GDPR 20조 이전권도 같은 취지).

     ★ 이 라우터가 접근할 수 있는 것만 담는다.

       계정 정보 · 화면 설정 · 즐겨찾기 · 차트 템플릿. 주문·체결 기록과 약관
       동의 기록은 이 라우터의 저장소로 읽을 수 없어서 담지 못한다. **담지 못한
       것을 담은 척하지 않고, 무엇이 빠졌는지 응답에 적는다** — 이용자가 그것을
       보고 별도로 요청할 수 있어야 한다.

     ★ 비밀번호 해시와 거래소 API 키는 담지 않는다.
       해시는 이용자에게 쓸모가 없고(원문을 복원할 수 없다), 키는 우리도
       복호화해 보여주지 않는다는 것이 방침이다. 내보내기 파일이 유출되면
       그 자체가 사고가 되므로 넣을 이유가 없는 것은 넣지 않는다.

     ★ 감사 기록을 남긴다. 본인 요청이지만 개인정보가 파일로 나가는 사건이다.
  */
  app.get('/me/export', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);

    const [prefs, favs] = await Promise.all([
      preferences.get(a.user.id).catch(() => null),
      favorites.list(a.user.id).catch(() => null),
    ]);

    let templates: unknown[] = [];
    if (chartTemplates) {
      templates = await chartTemplates.list(a.user.id).catch(() => []);
    }

    await audit.record({
      id: corr(),
      actorUserId: a.user.id,
      action: 'account.data.export',
      target: a.user.id,
      ip: ipOf(c) ?? null,
      at: Date.now(),
      // ★ AuditEntry 에는 result 필드가 없다. 부가 정보는 meta 로 넣는다.
      meta: { what: 'account · preferences · favorites · chart templates', format: 'json' },
    }).catch((e: unknown) => {
      // 기록 실패가 이용자의 권리 행사를 막지 않는다. 다만 조용히 넘기지 않는다.
      console.warn('[account] 데이터 내보내기 감사 기록 실패', e);
    });

    return c.json({
      /*
         무엇을 담았고 무엇을 담지 못했는지 밝힌다.
         "전부 받았다" 고 오해하면 빠진 자료를 따로 요청하지 못한다.
      */
      exportedAt: new Date().toISOString(),
      format: 'json',
      account: {
        id: a.user.id,
        email: a.user.email,
        role: a.user.role,
        status: a.user.status,
        mfaEnabled: a.user.mfaEnabled ?? null,
        emailVerified: a.user.emailVerified ?? null,
        createdAt: a.user.createdAt ?? null,
      },
      preferences: prefs ?? null,
      favorites: favs ? favs.symbols : null,
      chartTemplates: templates,
      excluded: [
        {
          what: 'password hash',
          why: 'stored one-way only; it cannot be turned back into your password and is of no use to you',
        },
        {
          what: 'exchange API keys',
          why: 'kept encrypted and never shown to anyone, including us — see the privacy policy',
        },
        {
          what: 'orders, fills and consent records',
          why: 'not reachable from this endpoint yet. Contact support to receive them; they are retained per the privacy policy (5 years)',
        },
      ],
      note: 'This file contains your personal data. Store it somewhere safe — anyone who reads it sees your account details.',
    });
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

  /*
     차트 템플릿 (기기 간 동기화).

     ★★ 원래 `localStorage` 에만 저장했다. 집 PC 에서 만든 지표 조합이 사무실
       PC·휴대폰에서는 없었다 — 같은 계정으로 로그인했으면 따라오는 것이 사용자
       기대다. 즐겨찾기는 이미 서버에 저장하는데 템플릿만 빠져 있었다.

     ★ 소유권은 **세션의 userId** 로만 정한다. 본문이나 쿼리로 받은 사용자 id 를
       믿으면 남의 템플릿을 읽고 지울 수 있다.
  */
  if (chartTemplates) {
    app.get('/me/chart-templates', async (c) => {
      const a = await needAuth(c);
      if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
      const items = await chartTemplates.list(a.user.id);
      return c.json({ items, max: MAX_CHART_TEMPLATES });
    });

    app.put('/me/chart-templates', async (c) => {
      const a = await needAuth(c);
      if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
      if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf'), 403);
      if (!requirePerm(a.user, 'account.update.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
      const parsed = await readJson(c);
      if (!parsed.ok) return c.json(err('BAD_REQUEST', 'invalid body'), 400);
      const body = (parsed.body ?? {}) as {
        name?: unknown; symbol?: unknown; timeframe?: unknown; payload?: unknown; schemaVersion?: unknown;
      };
      if (typeof body.name !== 'string') return c.json(err('BAD_REQUEST', 'name required'), 400);
      if (body.payload === undefined) return c.json(err('BAD_REQUEST', 'payload required'), 400);

      const out = await chartTemplates.save(a.user.id, {
        name: body.name,
        symbol: typeof body.symbol === 'string' ? body.symbol : null,
        timeframe: typeof body.timeframe === 'string' ? body.timeframe : null,
        payload: body.payload,
        schemaVersion: typeof body.schemaVersion === 'number' ? body.schemaVersion : 1,
      });
      if (!out.ok) {
        /* ★ 왜 거부됐는지 구분해서 알린다. "저장 실패" 만 보내면 사용자가
             이름을 고쳐야 할지 정리를 해야 할지 알 수 없다. */
        if (out.reason === 'tooMany') {
          return c.json({ ...err('UNPROCESSABLE', `at most ${out.max} templates`), max: out.max }, 422);
        }
        if (out.reason === 'tooLarge') {
          return c.json({ ...err('UNPROCESSABLE', 'template too large'), maxChars: out.maxChars }, 422);
        }
        return c.json(err('BAD_REQUEST', 'invalid template name'), 400);
      }
      return c.json({ ok: true, template: out.template });
    });

    app.delete('/me/chart-templates/:id', async (c) => {
      const a = await needAuth(c);
      if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
      if (!(await csrfGuard(c, a.csrfSecret))) return c.json(err('CSRF_FAILED', 'csrf'), 403);
      const removed = await chartTemplates.remove(a.user.id, c.req.param('id'));
      /* ★ 없는 것과 남의 것을 구분해 알리지 않는다 — 구분하면 어떤 id 가
           존재하는지 알아낼 수 있다. 둘 다 404 로 답한다. */
      if (!removed) return c.json(err('NOT_FOUND', 'template not found'), 404);
      return c.json({ ok: true });
    });
  }

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

  /*
     ---------------- admin / support ----------------

     ★★ 여기에 있던 `/admin/audit` 와 `/admin/users/:id` 두 라우트를 제거했다.

       둘 다 `{ ok: true }` 만 돌려주는 껍데기였는데, 이 라우터가 관리자
       라우터보다 먼저 등록되면 **실제 관리자 API 를 가로챈다.**

       실제로 그런 일이 있었다. 검증 테스트에서 auth 라우터를 먼저 등록하자
       `/admin/users/export` 가 여기의 `/admin/users/:id` 에 잡혀
       `{ ok: true }` 를 반환했다(CSV 대신 JSON, 권한 검사도 다른 것이 걸렸다).
       운영에서는 등록 순서가 반대라 드러나지 않았을 뿐이고, 순서를 바꾸는
       변경 한 번으로 관리자 기능 전체가 껍데기로 대체될 수 있었다.

       관리자 기능은 admin/admin-routes.ts 한 곳에만 둔다. 같은 경로를 두 곳에
       두면 어느 쪽이 실행되는지가 등록 순서에 달리고, 그것은 코드를 읽어서는
       알 수 없다.

     ★ 권한 정의(support.user.read · audit.read)는 packages/auth 에 그대로 있고
       관리자 라우터가 자기 권한 체계로 검사한다.
  */

  return app;
}
