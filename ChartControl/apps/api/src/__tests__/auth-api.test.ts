import { describe, it, expect } from 'vitest';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { AuthService, LoginRateLimiter, MailSink } from '@quantumtrade/auth';
import { openDb } from '../db/sqlite';
import { SqliteUserRepository, SqliteSessionRepository, SqliteAuditRepository, SqliteTokenRepository } from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { createAuthRouter } from '../auth-routes';

const ORIGIN = 'http://localhost:5173';

function build(limiter?: LoginRateLimiter) {
  const db = openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const mail = new MailSink();
  const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    mail,
    ...(limiter ? { limiter } : {}),
  });
  const app = createAuthRouter({ service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'test-key', secureCookies: false, corsOrigins: [ORIGIN] });
  return { app, db, mail, service };
}

function jarFrom(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [pair] = sc.split(';');
    const i = pair!.indexOf('=');
    out[pair!.slice(0, i)] = pair!.slice(i + 1);
  }
  return out;
}
const cookieHeader = (jar: Record<string, string>) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

type App = ReturnType<typeof build>['app'];
async function req(app: App, method: string, path: string, opts: { jar?: Record<string, string>; csrf?: boolean; origin?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.jar) headers['cookie'] = cookieHeader(opts.jar);
  if (opts.csrf && opts.jar?.['qt_csrf']) headers['x-csrf-token'] = opts.jar['qt_csrf'];
  if (opts.origin !== null) headers['origin'] = opts.origin ?? ORIGIN;
  const init: RequestInit = { method, headers };
  if (method !== 'GET') init.body = JSON.stringify(opts.body ?? {});
  return app.request(path, init);
}

async function registerAndLogin(app: App, email: string, password = 'longenough123') {
  await req(app, 'POST', '/auth/register', { body: { email, password } });
  const login = await req(app, 'POST', '/auth/login', { body: { email, password } });
  return jarFrom(login);
}

describe('Phase 2 closure — auth security & isolation (sqlite :memory:)', () => {
  it('migrations create all closure tables', () => {
    const { db } = build();
    const t = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    for (const x of ['users', 'sessions', 'permissions', 'role_permissions', 'user_roles', 'email_verification_tokens', 'password_reset_tokens', 'ai_signals', 'signal_versions', 'layout_versions', 'order_drafts', 'chart_overlays', 'ai_conversations', 'ai_messages', 'simulation_orders', 'simulation_order_events', 'alerts', 'notifications', 'usage_records'])
      expect(t).toContain(x);
  });

  it('register → login → me → logout(csrf+origin) → me 401', async () => {
    const { app } = build();
    const jar = await registerAndLogin(app, 'a@ex.com');
    expect(jar['qt_session']).toBeTruthy();
    const me = await req(app, 'GET', '/auth/me', { jar });
    expect(me.status).toBe(200);
    const out = await req(app, 'POST', '/auth/logout', { jar, csrf: true });
    expect(out.status).toBe(200);
    expect((await req(app, 'GET', '/auth/me', { jar })).status).toBe(401);
  });

  it('duplicate email → 409', async () => {
    const { app } = build();
    await req(app, 'POST', '/auth/register', { body: { email: 'dup@ex.com', password: 'longenough123' } });
    expect((await req(app, 'POST', '/auth/register', { body: { email: 'dup@ex.com', password: 'longenough123' } })).status).toBe(409);
  });

  it('generic login error for wrong password and unknown email (no enumeration)', async () => {
    const { app } = build();
    await req(app, 'POST', '/auth/register', { body: { email: 'g@ex.com', password: 'longenough123' } });
    const wrong = await req(app, 'POST', '/auth/login', { body: { email: 'g@ex.com', password: 'nope' } });
    const unknown = await req(app, 'POST', '/auth/login', { body: { email: 'ghost@ex.com', password: 'whatever123' } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(JSON.stringify(await wrong.json())).toContain('invalid credentials');
  });

  it('brute-force rate limit → 429 + Retry-After', async () => {
    const { app } = build(new LoginRateLimiter(3, 60_000));
    await req(app, 'POST', '/auth/register', { body: { email: 'bf@ex.com', password: 'longenough123' } });
    for (let i = 0; i < 3; i++) await req(app, 'POST', '/auth/login', { body: { email: 'bf@ex.com', password: 'bad' } });
    const res = await req(app, 'POST', '/auth/login', { body: { email: 'bf@ex.com', password: 'longenough123' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });

  it('CSRF: logout rejected when token missing (403)', async () => {
    const { app } = build();
    const jar = await registerAndLogin(app, 'csrf1@ex.com');
    expect((await req(app, 'POST', '/auth/logout', { jar, csrf: false })).status).toBe(403);
  });
  it('CSRF: logout rejected on token mismatch (403)', async () => {
    const { app } = build();
    const jar = await registerAndLogin(app, 'csrf2@ex.com');
    const bad = { ...jar, qt_csrf: 'tampered-token' };
    const res = await req(app, 'POST', '/auth/logout', { jar: bad, csrf: true });
    expect(res.status).toBe(403);
  });
  it('CSRF: cross-origin request rejected even with valid token (403)', async () => {
    const { app } = build();
    const jar = await registerAndLogin(app, 'csrf3@ex.com');
    const res = await req(app, 'POST', '/auth/logout', { jar, csrf: true, origin: 'http://evil.example' });
    expect(res.status).toBe(403);
  });

  it('vertical privilege escalation: the auth router exposes no admin surface at all', async () => {
    /*
       ★★ 전에는 이 라우터에 `/admin/audit` 껍데기가 있어서 403 을 확인했다.

         그 껍데기는 `{ ok: true }` 만 돌려주면서, 등록 순서에 따라 **실제 관리자
         API 를 가로챌 수 있었다**(실측으로 /admin/users/export 가 그것에 잡혔다).
         그래서 제거했다 — 관리자 기능은 admin/admin-routes.ts 한 곳에만 둔다.

       ★ 이제 이 라우터에는 관리자 경로가 없으므로 404 가 맞다. 그리고 그것이
         더 나은 상태다: 관리자 표면이 여기 없다는 사실 자체가 방어다.

       ★ "일반 사용자는 관리자 감사 로그를 볼 수 없다" 는 실제 경로에서 확인한다
         (admin-security-api.test.ts 의 ADM-AUDIT-GUARD).
    */
    const { app } = build();
    const jar = await registerAndLogin(app, 'v@ex.com');
    const res = await req(app, 'GET', '/admin/audit', { jar });
    expect(res.status).toBe(404);
  });

  it('horizontal privilege escalation: user A cannot read B layout/signal/order-draft (404)', async () => {
    const { app } = build();
    const jarA = await registerAndLogin(app, 'A@ex.com');
    const jarB = await registerAndLogin(app, 'B@ex.com');
    // A creates resources
    const lay = await (await req(app, 'POST', '/me/layouts', { jar: jarA, csrf: true, body: { name: 'A', layout: { x: 1 } } })).json() as { id: string };
    const sig = await (await req(app, 'POST', '/me/signals', { jar: jarA, csrf: true, body: { symbol: 'BTCUSDT', data: { a: 1 } } })).json() as { id: string };
    const od = await (await req(app, 'POST', '/me/order-drafts', { jar: jarA, csrf: true, body: { symbol: 'BTCUSDT', side: 'long', data: {} } })).json() as { id: string };
    // B attempts to read A's by id → 404 (ownership scoping)
    expect((await req(app, 'GET', `/me/layouts/${lay.id}`, { jar: jarB })).status).toBe(404);
    expect((await req(app, 'GET', `/me/signals/${sig.id}`, { jar: jarB })).status).toBe(404);
    expect((await req(app, 'GET', `/me/order-drafts/${od.id}`, { jar: jarB })).status).toBe(404);
    // B attempts to update A's layout → 404
    expect((await req(app, 'PUT', `/me/layouts/${lay.id}`, { jar: jarB, csrf: true, body: { layout: { x: 9 } } })).status).toBe(404);
    // A can read its own
    expect((await req(app, 'GET', `/me/layouts/${lay.id}`, { jar: jarA })).status).toBe(200);
    // B's list does not include A's items
    const bList = await (await req(app, 'GET', '/me/layouts', { jar: jarB })).json() as { items: unknown[] };
    expect(bList.items.length).toBe(0);
  });

  it('unauthenticated cannot access user resources (401)', async () => {
    const { app } = build();
    expect((await req(app, 'GET', '/me/layouts', {})).status).toBe(401);
  });

  it('SQL injection in login email is neutralized (401, tables intact)', async () => {
    const { app, db } = build();
    const res = await req(app, 'POST', '/auth/login', { body: { email: "x'; DROP TABLE users; --", password: 'whatever123' } });
    expect([400, 401]).toContain(res.status);
    const users = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
    expect(users).toBeTruthy();
  });

  it('malformed JSON → 400', async () => {
    const { app } = build();
    const res = await app.request('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{not json' });
    expect(res.status).toBe(400);
  });

  it('oversized input → 400', async () => {
    const { app } = build();
    const big = 'x'.repeat(70 * 1024);
    const res = await req(app, 'POST', '/auth/register', { body: { email: 'o@ex.com', password: 'longenough123', junk: big } });
    expect(res.status).toBe(400);
  });

  it('password change invalidates existing sessions', async () => {
    const { app } = build();
    const jar = await registerAndLogin(app, 'pc@ex.com');
    const chg = await req(app, 'POST', '/auth/change-password', { jar, csrf: true, body: { oldPassword: 'longenough123', newPassword: 'newlongenough123' } });
    expect(chg.status).toBe(200);
    // old session no longer valid
    expect((await req(app, 'GET', '/auth/me', { jar })).status).toBe(401);
  });

  it('email verification via MailSink token (single-use)', async () => {
    const { app, mail } = build();
    const jar = await registerAndLogin(app, 'ev@ex.com');
    await req(app, 'POST', '/auth/verify-email/request', { jar, csrf: true });
    const token = mail.last()?.meta?.token as string;
    expect(token).toBeTruthy();
    expect((await req(app, 'POST', '/auth/verify-email', { body: { token } })).status).toBe(200);
    // reused token now fails
    const again = await (await req(app, 'POST', '/auth/verify-email', { body: { token } })).json() as { ok: boolean };
    expect(again.ok).toBe(false);
  });

  it('forgot-password is generic (200) for unknown email; reset works for real token', async () => {
    const { app, mail } = build();
    await req(app, 'POST', '/auth/register', { body: { email: 'rp@ex.com', password: 'longenough123' } });
    // unknown email → still 200 generic, no mail
    mail.clear();
    const unknown = await req(app, 'POST', '/auth/forgot-password', { body: { email: 'nobody@ex.com' } });
    expect(unknown.status).toBe(200);
    expect(mail.last()).toBeUndefined();
    // known email → 200 + mail with token
    const known = await req(app, 'POST', '/auth/forgot-password', { body: { email: 'rp@ex.com' } });
    expect(known.status).toBe(200);
    const token = mail.last()?.meta?.token as string;
    expect(token).toBeTruthy();
    const reset = await req(app, 'POST', '/auth/reset-password', { body: { token, newPassword: 'resetlongenough123' } });
    expect(reset.status).toBe(200);
    // login with new password works
    const login = await req(app, 'POST', '/auth/login', { body: { email: 'rp@ex.com', password: 'resetlongenough123' } });
    expect(login.status).toBe(200);
  });

  it('session device list + revoke-others keeps only current', async () => {
    const { app } = build();
    const email = 'sess@ex.com';
    await req(app, 'POST', '/auth/register', { body: { email, password: 'longenough123' } });
    const jar1 = jarFrom(await req(app, 'POST', '/auth/login', { body: { email, password: 'longenough123' } }));
    await req(app, 'POST', '/auth/login', { body: { email, password: 'longenough123' } }); // second device
    const list = await (await req(app, 'GET', '/auth/sessions', { jar: jar1 })).json() as { sessions: unknown[] };
    expect(list.sessions.length).toBe(2);
    await req(app, 'POST', '/auth/sessions/revoke-others', { jar: jar1, csrf: true });
    const after = await (await req(app, 'GET', '/auth/sessions', { jar: jar1 })).json() as { sessions: { current: boolean }[] };
    expect(after.sessions.length).toBe(1);
    expect(after.sessions[0]!.current).toBe(true);
  });

  it('audit log redaction: no password/token/csrf recorded', async () => {
    const { app, service } = build();
    await registerAndLogin(app, 'aud@ex.com');
    // access admin audit requires admin; read directly from repo via a SUPER path is not available,
    // so assert via the service audit repo through a fresh admin — instead check serialized audit.
    const entries = await (service as unknown as { audit: { list: (n: number) => Promise<unknown[]> } }).audit.list(100);
    const blob = JSON.stringify(entries);
    expect(blob).toContain('auth.register');
    expect(blob).toContain('auth.login');
    expect(blob).not.toContain('longenough123');
    expect(blob).not.toMatch(/qt_csrf|password_hash/);
  });
});

/*
   PW-CHANGE — 비밀번호 변경 계약.

   ★★ 이 경로는 **전혀 동작하지 않았다.** 서버는 oldPassword 를 읽는데 화면은
     currentPassword 를 보냈다. 현재 비밀번호가 항상 빈 문자열로 들어가 무엇을
     입력해도 'invalid credentials' 였다 — 고객에게는 "맞는 비밀번호인데 왜
     틀렸다고 하나" 로 보인다. 필드 이름 하나가 기능 하나를 죽인 경우다.

   ★★ 그리고 실패 사유가 구분되지 않았다. 새 비밀번호가 짧아서 실패했는데도
     화면은 '현재 비밀번호가 틀렸다' 로 안내했고, 고객은 엉뚱한 곳을 고쳤다.
*/
describe('PW-CHANGE 비밀번호 변경', () => {
  const PW = 'TenChars10';
  const setup = async () => {
    const { app } = build();
    const email = `pwc${Math.random().toString(36).slice(2, 8)}@ex.com`;
    const jar = await registerAndLogin(app, email, PW);
    return { app, jar, email };
  };
  const change = (app: App, jar: Record<string, string>, body: Record<string, unknown>) =>
    req(app, 'POST', '/auth/change-password', { jar, csrf: true, body });

  it('[P1] ★★ oldPassword 로 실제 변경된다', async () => {
    const { app, jar } = await setup();
    expect((await change(app, jar, { oldPassword: PW, newPassword: 'BrandNewPw11' })).status).toBe(200);
  });

  it('[P2] ★ currentPassword 라는 이름으로도 받는다 — 캐시된 예전 화면이 계속 실패하면 안 된다', async () => {
    const { app, jar } = await setup();
    expect((await change(app, jar, { currentPassword: PW, newPassword: 'BrandNewPw11' })).status).toBe(200);
  });

  it('[P3] ★★ 짧은 새 비밀번호는 PASSWORD_TOO_SHORT 로 구분된다 (현재 비번 오류와 섞이지 않는다)', async () => {
    const { app, jar } = await setup();
    const r = await change(app, jar, { oldPassword: PW, newPassword: 'short' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('PASSWORD_TOO_SHORT');
  });

  it('[P4] 현재 비밀번호가 틀리면 INVALID 다', async () => {
    const { app, jar } = await setup();
    const r = await change(app, jar, { oldPassword: 'WrongPassword1', newPassword: 'BrandNewPw11' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('INVALID');
  });

  it('[P5] 변경 후 새 비밀번호로만 로그인된다 — 실제로 바뀌었는지 확인한다', async () => {
    const { app, jar, email } = await setup();
    expect((await change(app, jar, { oldPassword: PW, newPassword: 'BrandNewPw11' })).status).toBe(200);
    expect((await req(app, 'POST', '/auth/login', { body: { email, password: 'BrandNewPw11' } })).status).toBe(200);
    expect((await req(app, 'POST', '/auth/login', { body: { email, password: PW } })).status).not.toBe(200);
  });
});
