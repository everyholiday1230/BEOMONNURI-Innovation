import { describe, it, expect } from 'vitest';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { Hono } from 'hono';
import { AuthService, MailSink, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import { openDb, type DB } from '../db/sqlite';
import {
  SqliteUserRepository,
  SqliteSessionRepository,
  SqliteAuditRepository,
  SqliteTokenRepository,
} from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { createAuthRouter } from '../auth-routes';
import { SqliteNotificationRepo } from '../db/notification-repo';
import { createNotificationRouter } from '../notifications/notification-routes';

/**
 * B6 — notifications (NTF-01/02).
 *
 * The interesting cases are ownership (can user B read or mark user A's notification), idempotency (does a
 * second read overwrite the original timestamp), and rendering safety (does a hostile message survive
 * round-tripping as data rather than as markup).
 */

const ORIGIN = 'http://localhost:5173';
const NOW = 1_800_000_000_000;

function build() {
  const db = openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    mail: new MailSink(),
  });
  const repo = new SqliteNotificationRepo(db);
  const app = new Hono();
  app.route(
    '/api',
    createAuthRouter({ service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN] }),
  );
  app.route(
    '/api',
    createNotificationRouter({
      service,
      audit,
      repo,
      posture: { source: 'MOCK', tradingMode: 'MOCK', liveTradingEnabled: false, killSwitchActive: true },
      csrfKey: 'k',
      corsOrigins: [ORIGIN],
      cookieName: 'qt_session',
      now: () => NOW,
      verifyCsrf,
      originAllowed,
    }),
  );
  return { app, db, repo };
}

type App = ReturnType<typeof build>['app'];
type Json = Record<string, unknown> & { [k: string]: any };
const jsonOf = async (res: Response): Promise<Json> => (await res.json()) as Json;

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
  o: { jar?: Record<string, string>; csrf?: boolean; noOrigin?: boolean } = {},
) {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (!o.noOrigin) h['origin'] = ORIGIN;
  if (o.jar) h['cookie'] = cj(o.jar);
  if (o.csrf && o.jar?.['qt_csrf']) h['x-csrf-token'] = o.jar['qt_csrf'];
  const init: RequestInit = { method, headers: h };
  if (method !== 'GET') init.body = '{}';
  return app.request(path, init);
}

async function mkUser(app: App, db: DB, email: string) {
  await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password: 'longenough123' }),
  });
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password: 'longenough123' }),
  });
  const jar = jarFrom(login);
  const id = (db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string }).id;
  return { jar, id };
}

describe('B6 notifications — auth, ownership and cache', () => {
  it('requires a session', async () => {
    const { app } = build();
    expect((await rq(app, 'GET', '/api/notifications')).status).toBe(401);
    expect((await rq(app, 'POST', '/api/notifications/x/read')).status).toBe(401);
    expect((await rq(app, 'POST', '/api/notifications/read-all')).status).toBe(401);
  });

  it('never returns or mutates another user\u2019s notifications', async () => {
    const { app, db, repo } = build();
    const a = await mkUser(app, db, 'n-a@ex.com');
    const b = await mkUser(app, db, 'n-b@ex.com');
    const own = await repo.create({ userId: a.id, type: 'system', severity: 'info', message: 'a-only', at: NOW });
    await repo.create({ userId: b.id, type: 'system', severity: 'info', message: 'b-only', at: NOW });

    const seen = await jsonOf(await rq(app, 'GET', '/api/notifications', { jar: b.jar }));
    expect(seen.items.map((i: { message: string }) => i.message)).toEqual(['b-only']);

    // Marking A's notification read as B must be a 404 (a 403 would confirm the id exists) and must not
    // change the row.
    const res = await rq(app, 'POST', `/api/notifications/${own.id}/read`, { jar: b.jar, csrf: true });
    expect(res.status).toBe(404);
    const after = db.prepare('SELECT read FROM notifications WHERE id=?').get(own.id) as { read: number };
    expect(after.read).toBe(0);
  });

  it('requires CSRF and a permitted origin on both mutations', async () => {
    const { app, db, repo } = build();
    const u = await mkUser(app, db, 'n-csrf@ex.com');
    const n = await repo.create({ userId: u.id, type: 'system', severity: 'info', message: 'x', at: NOW });
    expect((await rq(app, 'POST', `/api/notifications/${n.id}/read`, { jar: u.jar })).status).toBe(403);
    expect((await rq(app, 'POST', '/api/notifications/read-all', { jar: u.jar })).status).toBe(403);
    expect(
      (await rq(app, 'POST', `/api/notifications/${n.id}/read`, { jar: u.jar, csrf: true, noOrigin: true })).status,
    ).toBe(403);
  });

  it('sets no-store', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'n-ns@ex.com');
    const res = await rq(app, 'GET', '/api/notifications', { jar: u.jar });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

describe('B6 notifications — list, count and filters', () => {
  it('reports unread count over all rows, not just the current page', async () => {
    const { app, db, repo } = build();
    const u = await mkUser(app, db, 'n-count@ex.com');
    for (let i = 0; i < 5; i += 1) {
      await repo.create({ userId: u.id, type: 'system', severity: 'info', message: `m${i}`, at: NOW - i });
    }
    const body = await jsonOf(await rq(app, 'GET', '/api/notifications?limit=2', { jar: u.jar }));
    expect(body.items).toHaveLength(2);
    // A badge that only counted the visible page would under-report unread alerts.
    expect(body.unreadCount).toBe(5);
    expect(body.page.total).toBe(5);
    expect(body.page.hasMore).toBe(true);
  });

  it('pages without repeating a row when timestamps collide', async () => {
    const { app, db, repo } = build();
    const u = await mkUser(app, db, 'n-page@ex.com');
    const ids = await Promise.all(
      Array.from({ length: 7 }, async () =>
        (await repo.create({ userId: u.id, type: 'system', severity: 'info', message: 'same', at: NOW })).id,
      ),
    );
    const seen: string[] = [];
    for (let offset = 0; offset < 7; offset += 3) {
      const body = await jsonOf(await rq(app, 'GET', `/api/notifications?limit=3&offset=${offset}`, { jar: u.jar }));
      seen.push(...body.items.map((i: { id: string }) => i.id));
    }
    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it('filters unread only, and by type and severity', async () => {
    const { app, db, repo } = build();
    const u = await mkUser(app, db, 'n-filter@ex.com');
    const read = await repo.create({ userId: u.id, type: 'system', severity: 'info', message: 'r', at: NOW });
    await repo.create({ userId: u.id, type: 'risk_alert', severity: 'critical', message: 'u', at: NOW });
    repo.markRead(u.id, read.id, NOW);

    const unread = await jsonOf(await rq(app, 'GET', '/api/notifications?unread=true', { jar: u.jar }));
    expect(unread.items).toHaveLength(1);
    expect(unread.items[0].message).toBe('u');

    const byType = await jsonOf(await rq(app, 'GET', '/api/notifications?type=risk_alert', { jar: u.jar }));
    expect(byType.items).toHaveLength(1);
    const bySeverity = await jsonOf(await rq(app, 'GET', '/api/notifications?severity=critical', { jar: u.jar }));
    expect(bySeverity.items).toHaveLength(1);
  });

  it('rejects an unknown notification type in the filter rather than ignoring it', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'n-badtype@ex.com');
    const res = await rq(app, 'GET', '/api/notifications?type=not_a_kind', { jar: u.jar });
    expect(res.status).toBe(400);
  });

  it('rejects unknown query parameters and an oversized limit', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'n-strict@ex.com');
    expect((await rq(app, 'GET', '/api/notifications?unraed=true', { jar: u.jar })).status).toBe(400);
    expect((await rq(app, 'GET', '/api/notifications?limit=500', { jar: u.jar })).status).toBe(400);
  });

  it('states the delivery contract because there is no push channel', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'n-poll@ex.com');
    const body = await jsonOf(await rq(app, 'GET', '/api/notifications', { jar: u.jar }));
    expect(body.delivery.channel).toBe('POLL');
    expect(body.delivery.pollIntervalMs).toBeGreaterThan(0);
    expect(body.source).toBe('MOCK');
  });
});

describe('B6 notifications — idempotent read mutations', () => {
  it('marking read twice is a 200 that does not move readAt', async () => {
    const { app, db, repo } = build();
    const u = await mkUser(app, db, 'n-idem@ex.com');
    const n = await repo.create({ userId: u.id, type: 'system', severity: 'info', message: 'x', at: NOW });

    const first = await jsonOf(await rq(app, 'POST', `/api/notifications/${n.id}/read`, { jar: u.jar, csrf: true }));
    expect(first.changed).toBe(true);
    expect(first.unreadCount).toBe(0);
    const readAt = (db.prepare('SELECT read_at FROM notifications WHERE id=?').get(n.id) as { read_at: number }).read_at;

    const second = await rq(app, 'POST', `/api/notifications/${n.id}/read`, { jar: u.jar, csrf: true });
    expect(second.status).toBe(200);
    // The replay is reported honestly rather than pretending it did work...
    expect((await jsonOf(second)).changed).toBe(false);
    // ...and `readAt` still records when it was FIRST read.
    const readAt2 = (db.prepare('SELECT read_at FROM notifications WHERE id=?').get(n.id) as { read_at: number }).read_at;
    expect(readAt2).toBe(readAt);
  });

  it('read-all reports how many rows it changed and is a no-op the second time', async () => {
    const { app, db, repo } = build();
    const u = await mkUser(app, db, 'n-all@ex.com');
    for (let i = 0; i < 3; i += 1) await repo.create({ userId: u.id, type: 'system', severity: 'info', message: `m${i}`, at: NOW });
    const first = await jsonOf(await rq(app, 'POST', '/api/notifications/read-all', { jar: u.jar, csrf: true }));
    expect(first.changed).toBe(3);
    const second = await jsonOf(await rq(app, 'POST', '/api/notifications/read-all', { jar: u.jar, csrf: true }));
    expect(second.changed).toBe(0);
  });

  it('read-all does not touch another user\u2019s notifications', async () => {
    const { app, db, repo } = build();
    const a = await mkUser(app, db, 'n-all-a@ex.com');
    const b = await mkUser(app, db, 'n-all-b@ex.com');
    await repo.create({ userId: a.id, type: 'system', severity: 'info', message: 'a', at: NOW });
    await repo.create({ userId: b.id, type: 'system', severity: 'info', message: 'b', at: NOW });
    await rq(app, 'POST', '/api/notifications/read-all', { jar: a.jar, csrf: true });
    const bUnread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read=0').get(b.id) as { n: number };
    expect(bUnread.n).toBe(1);
  });

  it('records an audit event only when something actually changed', async () => {
    const { app, db, repo } = build();
    const u = await mkUser(app, db, 'n-audit@ex.com');
    const n = await repo.create({ userId: u.id, type: 'system', severity: 'info', message: 'x', at: NOW });
    await rq(app, 'POST', `/api/notifications/${n.id}/read`, { jar: u.jar, csrf: true });
    await rq(app, 'POST', `/api/notifications/${n.id}/read`, { jar: u.jar, csrf: true });
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE actor_user_id=? AND action='notification.read'")
      .get(u.id) as { n: number };
    // Two requests, one real change: an audit trail full of no-ops is an audit trail nobody reads.
    expect(rows.n).toBe(1);
  });
});

describe('B6 notifications — content safety', () => {
  it('stores and returns a hostile message as data, unchanged and unescaped', async () => {
    const { app, db, repo } = build();
    const u = await mkUser(app, db, 'n-xss@ex.com');
    const hostile = '<img src=x onerror="alert(1)">';
    await repo.create({ userId: u.id, type: 'system', severity: 'info', message: hostile, at: NOW });
    const body = await jsonOf(await rq(app, 'GET', '/api/notifications', { jar: u.jar }));
    // The server does not HTML-escape: escaping at the storage layer double-escapes for every non-HTML
    // consumer. Safety comes from the client rendering it as a text node, which the E2E test asserts.
    expect(body.items[0].message).toBe(hostile);
  });

  it('rejects an unsupported type or severity at the data layer', async () => {
    const { db, repo } = build();
    db.prepare(
      "INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES ('ux','ux@ex.com','x','USER','active',1,1)",
    ).run();
    await expect(
      repo.create({ userId: 'ux', type: 'not_a_type' as 'system', severity: 'info', message: 'x', at: NOW }),
    ).rejects.toThrow();
    await expect(
      repo.create({ userId: 'ux', type: 'system', severity: 'nuclear' as 'info', message: 'x', at: NOW }),
    ).rejects.toThrow();
  });

  it('truncates an over-long message instead of dropping the notification', async () => {
    const { db, repo } = build();
    db.prepare(
      "INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES ('uy','uy@ex.com','x','USER','active',1,1)",
    ).run();
    const n = await repo.create({ userId: 'uy', type: 'system', severity: 'info', message: 'x'.repeat(2000), at: NOW });
    // Losing the signal entirely would be worse than losing the tail of a badly formatted message.
    expect(n.message).toHaveLength(500);
  });
});
