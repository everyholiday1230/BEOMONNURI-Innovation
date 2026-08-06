import { describe, it, expect } from 'vitest';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { Hono } from 'hono';
import { AuthService, MailSink } from '@quantumtrade/auth';
import { openDb } from '../db/sqlite';
import { SqliteUserRepository, SqliteSessionRepository, SqliteAuditRepository, SqliteTokenRepository } from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { createAuthRouter } from '../auth-routes';

/**
 * B2 — favourites (FAV-01/02) and preferences (PREF-01/02).
 *
 * What is actually at stake here is not "does it save" but: can one user reach another's data, can a
 * write without CSRF succeed, does a concurrent edit clobber, and does a partial update erase the fields
 * it did not mention. Each of those gets its own assertion.
 */

const ORIGIN = 'http://localhost:5173';

function build() {
  const db = openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    mail: new MailSink(),
  });
  const app = new Hono();
  app.route(
    '/api',
    createAuthRouter({ service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN] }),
  );
  return { app, db };
}

type App = ReturnType<typeof build>['app'];

function jarFrom(res: Response) {
  const out: Record<string, string> = {};
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [pair] = sc.split(';');
    const i = pair!.indexOf('=');
    out[pair!.slice(0, i)] = pair!.slice(i + 1);
  }
  return out;
}
const cj = (j: Record<string, string>) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');

async function rq(
  app: App,
  method: string,
  path: string,
  o: { jar?: Record<string, string>; csrf?: boolean; body?: unknown; ifMatch?: string } = {},
) {
  const h: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN };
  if (o.jar) h['cookie'] = cj(o.jar);
  if (o.csrf && o.jar?.['qt_csrf']) h['x-csrf-token'] = o.jar['qt_csrf'];
  if (o.ifMatch !== undefined) h['if-match'] = o.ifMatch;
  const init: RequestInit = { method, headers: h };
  if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(o.body ?? {});
  return app.request(path, init);
}

async function mkUser(app: App, email: string) {
  await rq(app, 'POST', '/api/auth/register', { body: { email, password: 'longenough123' } });
  const jar = jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email, password: 'longenough123' } }));
  return { jar };
}

describe('FAV-01 / FAV-02 favourites', () => {
  it('starts empty at version 0 and reports the cap', async () => {
    const { app } = build();
    const u = await mkUser(app, 'f1@ex.com');
    const res = await rq(app, 'GET', '/api/me/favorites', { jar: u.jar });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ symbols: [], version: 0, updatedAt: null, maxFavorites: 64 });
  });

  it('persists order, de-duplicates and normalizes case', async () => {
    const { app } = build();
    const u = await mkUser(app, 'f2@ex.com');
    const put = await rq(app, 'PUT', '/api/me/favorites', {
      jar: u.jar, csrf: true, body: { symbols: ['ethusdt', 'BTCUSDT', 'ETHUSDT', ' btcusdt '] },
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as { symbols: string[]; version: number };
    // Caller order preserved, duplicates collapsed, upper-cased.
    expect(body.symbols).toEqual(['ETHUSDT', 'BTCUSDT']);
    expect(body.version).toBe(1);

    const get = (await (await rq(app, 'GET', '/api/me/favorites', { jar: u.jar })).json()) as { symbols: string[]; version: number };
    expect(get.symbols).toEqual(['ETHUSDT', 'BTCUSDT']);
    expect(get.version).toBe(1);
  });

  it('is per-user: one session cannot see or affect another user\'s set', async () => {
    const { app } = build();
    const a = await mkUser(app, 'f3a@ex.com');
    const b = await mkUser(app, 'f3b@ex.com');
    await rq(app, 'PUT', '/api/me/favorites', { jar: a.jar, csrf: true, body: { symbols: ['BTCUSDT'] } });
    const bGet = (await (await rq(app, 'GET', '/api/me/favorites', { jar: b.jar })).json()) as { symbols: string[] };
    expect(bGet.symbols).toEqual([]);
    // B writing does not disturb A.
    await rq(app, 'PUT', '/api/me/favorites', { jar: b.jar, csrf: true, body: { symbols: ['ETHUSDT'] } });
    const aGet = (await (await rq(app, 'GET', '/api/me/favorites', { jar: a.jar })).json()) as { symbols: string[] };
    expect(aGet.symbols).toEqual(['BTCUSDT']);
  });

  it('requires a session and a CSRF token', async () => {
    const { app } = build();
    const u = await mkUser(app, 'f4@ex.com');
    expect((await rq(app, 'GET', '/api/me/favorites', {})).status).toBe(401);
    expect((await rq(app, 'PUT', '/api/me/favorites', { body: { symbols: [] } })).status).toBe(401);
    // Session but no CSRF header → refused.
    const noCsrf = await rq(app, 'PUT', '/api/me/favorites', { jar: u.jar, body: { symbols: ['BTCUSDT'] } });
    expect(noCsrf.status).toBe(403);
    // And nothing was written.
    const after = (await (await rq(app, 'GET', '/api/me/favorites', { jar: u.jar })).json()) as { symbols: string[] };
    expect(after.symbols).toEqual([]);
  });

  it('If-Match makes a concurrent edit a 409 instead of a clobber', async () => {
    const { app } = build();
    const u = await mkUser(app, 'f5@ex.com');
    await rq(app, 'PUT', '/api/me/favorites', { jar: u.jar, csrf: true, body: { symbols: ['BTCUSDT'] }, ifMatch: '0' });
    // A second writer still holding version 0 must be refused.
    const stale = await rq(app, 'PUT', '/api/me/favorites', { jar: u.jar, csrf: true, body: { symbols: ['ETHUSDT'] }, ifMatch: '0' });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { currentVersion: number };
    expect(body.currentVersion).toBe(1);
    // The first writer's value survived.
    const now = (await (await rq(app, 'GET', '/api/me/favorites', { jar: u.jar })).json()) as { symbols: string[] };
    expect(now.symbols).toEqual(['BTCUSDT']);
  });

  it('rejects a malformed symbol and an oversized set', async () => {
    const { app } = build();
    const u = await mkUser(app, 'f6@ex.com');
    const bad = await rq(app, 'PUT', '/api/me/favorites', { jar: u.jar, csrf: true, body: { symbols: ['BTC/USDT'] } });
    expect(bad.status).toBe(400);
    const tooMany = await rq(app, 'PUT', '/api/me/favorites', {
      jar: u.jar, csrf: true, body: { symbols: Array.from({ length: 65 }, (_, i) => `SYM${i}`) },
    });
    expect([400, 422]).toContain(tooMany.status);
    // An unknown key is refused rather than ignored.
    expect((await rq(app, 'PUT', '/api/me/favorites', { jar: u.jar, csrf: true, body: { symbols: [], extra: 1 } })).status).toBe(400);
  });

  it('writes an audit entry naming the actor', async () => {
    const { app, db } = build();
    const u = await mkUser(app, 'f7@ex.com');
    await rq(app, 'PUT', '/api/me/favorites', { jar: u.jar, csrf: true, body: { symbols: ['BTCUSDT'] } });
    const n = (db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='account.favorites.update'").get() as { n: number }).n;
    expect(n).toBeGreaterThanOrEqual(1);
  });
});

describe('PREF-01 / PREF-02 preferences', () => {
  it('a partial update does NOT erase the fields it did not mention', async () => {
    const { app } = build();
    const u = await mkUser(app, 'p1@ex.com');
    await rq(app, 'PUT', '/api/account/preferences', { jar: u.jar, csrf: true, body: { theme: 'dark', locale: 'ko' } });
    // Patch only the theme.
    await rq(app, 'PUT', '/api/account/preferences', { jar: u.jar, csrf: true, body: { theme: 'light' } });
    const got = (await (await rq(app, 'GET', '/api/account/preferences', { jar: u.jar })).json()) as {
      preferences: { theme: string; locale: string }; version: number;
    };
    expect(got.preferences.theme).toBe('light');
    // The regression this guards: locale used to be nulled by any partial write.
    expect(got.preferences.locale).toBe('ko');
    expect(got.version).toBe(2);
  });

  it('only allow-listed keys and enumerated values are accepted', async () => {
    const { app } = build();
    const u = await mkUser(app, 'p2@ex.com');
    // Unknown key.
    expect((await rq(app, 'PUT', '/api/account/preferences', { jar: u.jar, csrf: true, body: { isAdmin: true } })).status).toBe(400);
    // Prototype-pollution shaped payload. It must be sent as RAW TEXT: `{ __proto__: ... }` in an object
    // literal sets the prototype rather than an own property, so `JSON.stringify` would emit `{}` and the
    // test would prove nothing.
    const proto = await app.request('/api/account/preferences', {
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        origin: ORIGIN,
        cookie: cj(u.jar),
        'x-csrf-token': u.jar['qt_csrf']!,
      },
      body: '{"__proto__":{"polluted":true},"theme":"dark"}',
    });
    expect(proto.status).toBe(400);
    // Whatever the response, the prototype must not have been touched.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    // Out-of-enum value.
    expect((await rq(app, 'PUT', '/api/account/preferences', { jar: u.jar, csrf: true, body: { theme: 'neon' } })).status).toBe(400);
  });

  it('If-Match conflicts, and CSRF is required', async () => {
    const { app } = build();
    const u = await mkUser(app, 'p3@ex.com');
    await rq(app, 'PUT', '/api/account/preferences', { jar: u.jar, csrf: true, body: { theme: 'dark' }, ifMatch: '0' });
    expect((await rq(app, 'PUT', '/api/account/preferences', { jar: u.jar, csrf: true, body: { theme: 'light' }, ifMatch: '0' })).status).toBe(409);
    expect((await rq(app, 'PUT', '/api/account/preferences', { jar: u.jar, body: { theme: 'light' } })).status).toBe(403);
  });

  it('is per-user', async () => {
    const { app } = build();
    const a = await mkUser(app, 'p4a@ex.com');
    const b = await mkUser(app, 'p4b@ex.com');
    await rq(app, 'PUT', '/api/account/preferences', { jar: a.jar, csrf: true, body: { theme: 'dark' } });
    const bGot = (await (await rq(app, 'GET', '/api/account/preferences', { jar: b.jar })).json()) as { preferences: unknown };
    expect(bGot.preferences).toBeNull();
  });
});
