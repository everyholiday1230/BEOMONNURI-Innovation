import { describe, it, expect } from 'vitest';
import { SqliteAdminRepoAdapter } from '../db/admin-repo-contract';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { Hono } from 'hono';
import { AuthService, MailSink } from '@quantumtrade/auth';
import { recordFailure, DEFAULT_LOCKOUT, isLocked } from '@quantumtrade/mfa';
import { openDb } from '../db/sqlite';
import { SqliteUserRepository, SqliteSessionRepository, SqliteAuditRepository, SqliteTokenRepository } from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { SqliteAdminRepo } from '../db/admin-repos';
import { SqliteLockoutStore } from '../db/lockout-repo';
import { createAuthRouter } from '../auth-routes';
import { createAdminRouter } from '../admin/admin-routes';

/**
 * Prompt 5 / B7 — ADM-API-13 (security summary + unlock), ADM-API-12 (reports), ADM-API-15 (backup status).
 *
 * Harness mirrors admin-api.test.ts / portfolio-api.test.ts: a real in-memory database, a real AuthService
 * with the SQLite repositories, the real routers on a fresh Hono app, and a cookie jar. Nothing is stubbed,
 * so a guard that is missing in the router is missing in these tests too.
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
  const repo = new SqliteAdminRepo(db);
  repo.seedGate({ key: 'backup-restore-pitr', phase: 'Phase2', description: 'Managed PG backup/restore + PITR', status: 'NOT_EXECUTED', productionRequired: true });
  const app = new Hono();
  app.route('/api', createAuthRouter({ service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN] }));
  app.route('/api', createAdminRouter({ service, repo: new SqliteAdminRepoAdapter(repo), csrfKey: 'k', corsOrigins: [ORIGIN], cookieName: 'qt_session', health: () => ({ api: 'ok', bitmartWs: 'Not Connected' }) }));
  return { app, db, repo, lockouts: new SqliteLockoutStore(db) };
}

function jarFrom(res: Response) {
  const out: Record<string, string> = {};
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const [p] = sc.split(';');
    const i = p!.indexOf('=');
    out[p!.slice(0, i)] = p!.slice(i + 1);
  }
  return out;
}
const cj = (j: Record<string, string>) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
type App = ReturnType<typeof build>['app'];
async function rq(app: App, method: string, path: string, o: { jar?: Record<string, string>; csrf?: boolean; body?: unknown } = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN };
  if (o.jar) h['cookie'] = cj(o.jar);
  if (o.csrf && o.jar?.['qt_csrf']) h['x-csrf-token'] = o.jar['qt_csrf'];
  const init: RequestInit = { method, headers: h };
  if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(o.body ?? {});
  return app.request(path, init);
}
async function mkUser(app: App, db: ReturnType<typeof build>['db'], email: string, role: string) {
  await rq(app, 'POST', '/api/auth/register', { body: { email, password: 'longenough123' } });
  db.prepare('UPDATE users SET role=? WHERE email=?').run(role, email);
  const jar = jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email, password: 'longenough123' } }));
  const id = (db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string }).id;
  return { jar, id };
}

/** Drive the REAL lockout algorithm until the account is locked, through the REAL persisted store. */
async function lockAccount(store: SqliteLockoutStore, userId: string): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < DEFAULT_LOCKOUT.maxFails; i++) {
    await store.set(userId, recordFailure(await store.get(userId), now, DEFAULT_LOCKOUT));
  }
  expect(isLocked(await store.get(userId), now)).toBe(true);
}

// ===========================================================================
// ADM-API-13 — security summary
// ===========================================================================
describe('ADM-API-13 GET /admin/security/summary', () => {
  it('[S1] 401 unauthenticated, 403 for a non-admin role', async () => {
    const { app, db } = build();
    expect((await rq(app, 'GET', '/api/admin/security/summary', {})).status).toBe(401);
    const plain = await mkUser(app, db, 's1-user@ex.com', 'user');
    expect((await rq(app, 'GET', '/api/admin/security/summary', { jar: plain.jar })).status).toBe(403);
    const pro = await mkUser(app, db, 's1-pro@ex.com', 'PRO_USER');
    expect((await rq(app, 'GET', '/api/admin/security/summary', { jar: pro.jar })).status).toBe(403);
  });

  it('[S2] returns REAL aggregate counts and no-store headers', async () => {
    const { app, db, lockouts } = build();
    const sa = await mkUser(app, db, 's2-sa@ex.com', 'SUPER_ADMIN');
    const victim = await mkUser(app, db, 's2-victim@ex.com', 'user');
    const disabled = await mkUser(app, db, 's2-disabled@ex.com', 'user');
    db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(disabled.id);
    db.prepare('UPDATE users SET mfa_enabled=1 WHERE id=?').run(victim.id);
    db.prepare('INSERT INTO mfa_credentials (user_id,enabled,secret_encrypted,recovery_codes_json,updated_at) VALUES (?,?,?,?,?)')
      .run(victim.id, 1, 'ENCRYPTED_TOTP_SECRET_BLOB', '[{"hash":"RECOVERY_CODE_HASH"}]', Date.now());
    await lockAccount(lockouts, victim.id);

    const res = await rq(app, 'GET', '/api/admin/security/summary', { jar: sa.jar });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const b = (await res.json()) as Record<string, Record<string, number | null>>;
    // Counts are computed from the tables, not invented.
    expect(b.users!.total).toBe(3);
    expect(b.users!.disabled).toBe(1);
    expect(b.mfa!.credentialsEnabled).toBe(1);
    expect(b.mfa!.usersFlagged).toBe(1);
    expect(b.lockouts!.activeNow).toBe(1);
    expect(b.sessions!.active).toBeGreaterThanOrEqual(1);
    // A real login failure is counted from the audit log rather than assumed to be zero.
    await rq(app, 'POST', '/api/auth/login', { body: { email: 's2-victim@ex.com', password: 'wrongpassword1' } });
    const again = (await (await rq(app, 'GET', '/api/admin/security/summary', { jar: sa.jar })).json()) as Record<string, Record<string, number>>;
    expect(again.logins24h!.failed).toBeGreaterThanOrEqual(1);
  });

  it('[S3] REDACTION: no MFA secret, seed, otpauth URI, QR payload, recovery code or password hash', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 's3-sa@ex.com', 'SUPER_ADMIN');
    const victim = await mkUser(app, db, 's3-victim@ex.com', 'user');
    const secret = 'JBSWY3DPEHPK3PXP_TOTP_SEED';
    const recovery = 'RECOVERY_CODE_HASH_ABCDEF';
    db.prepare('INSERT INTO mfa_credentials (user_id,enabled,secret_encrypted,pending_secret_encrypted,recovery_codes_json,updated_at) VALUES (?,?,?,?,?,?)')
      .run(victim.id, 1, secret, `${secret}_PENDING`, `[{"hash":"${recovery}"}]`, Date.now());

    const raw = await (await rq(app, 'GET', '/api/admin/security/summary', { jar: sa.jar })).text();
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain(recovery);
    for (const bad of ['otpauth', 'password_hash', 'passwordhash', 'qrcode', 'recovery_codes', 'secret_encrypted', '$2a$', '$2b$']) {
      expect(raw.toLowerCase(), `"${bad}" must not appear in the security summary`).not.toContain(bad);
    }
    // Positive control: the fixture really is in the database, so the absence above is redaction and not
    // an empty table.
    const stored = db.prepare('SELECT secret_encrypted s FROM mfa_credentials WHERE user_id=?').get(victim.id) as { s: string };
    expect(stored.s).toBe(secret);
  });

  it('[S4] an unknown query parameter is a 400 (not silently ignored)', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 's4-sa@ex.com', 'SUPER_ADMIN');
    expect((await rq(app, 'GET', '/api/admin/security/summary?bogus=1', { jar: sa.jar })).status).toBe(400);
    expect((await rq(app, 'GET', '/api/admin/security/lockouts?state=nope', { jar: sa.jar })).status).toBe(400);
  });

  it('[S5] RBAC across the four admin roles: all read roles may read the summary', async () => {
    const { app, db } = build();
    for (const [i, role] of ['SUPPORT', 'ANALYST', 'ADMIN', 'SUPER_ADMIN'].entries()) {
      const u = await mkUser(app, db, `s5-${i}@ex.com`, role);
      expect((await rq(app, 'GET', '/api/admin/security/summary', { jar: u.jar })).status, role).toBe(200);
      expect((await rq(app, 'GET', '/api/admin/security/lockouts', { jar: u.jar })).status, role).toBe(200);
    }
  });
});

// ===========================================================================
// ADM-API-13 — account unlock
// ===========================================================================
describe('ADM-API-13 POST /admin/users/:id/unlock', () => {
  const body = (extra: Record<string, unknown> = {}) => ({ reason: 'user called support to be unlocked', reauth: true, ...extra });

  it('[U1] 401 unauthenticated; 403 for a non-admin; 403 for an admin lacking the permission', async () => {
    const { app, db } = build();
    const target = await mkUser(app, db, 'u1-target@ex.com', 'user');
    expect((await rq(app, 'POST', `/api/admin/users/${target.id}/unlock`, { body: body() })).status).toBe(401);
    const plain = await mkUser(app, db, 'u1-user@ex.com', 'user');
    expect((await rq(app, 'POST', `/api/admin/users/${target.id}/unlock`, { jar: plain.jar, csrf: true, body: body() })).status).toBe(403);
    // ANALYST is an admin role but is read-only: it does not hold admin.user.status.write.
    const analyst = await mkUser(app, db, 'u1-analyst@ex.com', 'ANALYST');
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/unlock`, { jar: analyst.jar, csrf: true, body: body() });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('admin.user.status.write');
  });

  it('[U2] 403 CSRF_FAILED without a token', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'u2-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'u2-target@ex.com', 'user');
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/unlock`, { jar: admin.jar, body: body() });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CSRF_FAILED');
  });

  it('[U3] 403 STEP_UP_REQUIRED without the reauth acknowledgement', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'u3-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'u3-target@ex.com', 'user');
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/unlock`, { jar: admin.jar, csrf: true, body: body({ reauth: false }) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');
  });

  it('[U4] 422 on invalid input, and the rejected input is NOT echoed back', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'u4-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'u4-target@ex.com', 'user');
    const marker = 'REJECTED_INPUT_MARKER_XYZ';
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/unlock`, {
      jar: admin.jar, csrf: true, body: { reason: 'x', reauth: true, injected: marker },
    });
    expect(res.status).toBe(422);
    const raw = await res.text();
    expect(raw).not.toContain(marker);
    expect(raw).not.toContain('injected');
  });

  it('[U5] 404 for a target that does not exist', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'u5-admin@ex.com', 'ADMIN');
    const res = await rq(app, 'POST', '/api/admin/users/00000000-0000-0000-0000-000000000000/unlock', { jar: admin.jar, csrf: true, body: body() });
    expect(res.status).toBe(404);
  });

  it('[U6] clears a REAL persisted lockout, separates actor from target, and is audited', async () => {
    const { app, db, repo, lockouts } = build();
    const admin = await mkUser(app, db, 'u6-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'u6-target@ex.com', 'user');
    await lockAccount(lockouts, target.id);

    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/unlock`, { jar: admin.jar, csrf: true, body: body() });
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ok: boolean; changed: boolean; userId: string; lockout: { locked: boolean } };
    expect(b.changed).toBe(true);
    expect(b.userId).toBe(target.id);
    expect(b.lockout.locked).toBe(false);
    // The lockout the MFA routes consult is genuinely gone.
    expect(isLocked(await lockouts.get(target.id), Date.now())).toBe(false);

    const entry = db
      .prepare("SELECT actor_user_id, target_user_id, result, risk_level, reason FROM admin_actions WHERE action='user.unlock' ORDER BY at DESC LIMIT 1")
      .get() as { actor_user_id: string; target_user_id: string; result: string; risk_level: string; reason: string };
    expect(entry.actor_user_id).toBe(admin.id);
    expect(entry.target_user_id).toBe(target.id);
    expect(entry.actor_user_id).not.toBe(entry.target_user_id);
    expect(entry.result).toBe('success');
    expect(entry.risk_level).toBe('high');
    // The clearing is also evidenced on the lockout row itself.
    const row = db.prepare('SELECT cleared_by, cleared_at, fails, locked_until FROM account_lockouts WHERE user_id=?').get(target.id) as { cleared_by: string; cleared_at: number; fails: number; locked_until: number };
    expect(row.cleared_by).toBe(admin.id);
    expect(row.fails).toBe(0);
    expect(row.locked_until).toBe(0);
    expect(repo.countLockouts('active')).toBe(0);
  });

  it('[U7] unlocking an account that was not locked reports changed:false honestly', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'u7-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'u7-target@ex.com', 'user');
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/unlock`, { jar: admin.jar, csrf: true, body: body() });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { changed: boolean }).changed).toBe(false);
  });

  it('[U8] DECISION: an admin may not unlock their OWN account (403 SELF_ACTION_FORBIDDEN)', async () => {
    const { app, db, lockouts } = build();
    const admin = await mkUser(app, db, 'u8-admin@ex.com', 'ADMIN');
    await lockAccount(lockouts, admin.id);
    const res = await rq(app, 'POST', `/api/admin/users/${admin.id}/unlock`, { jar: admin.jar, csrf: true, body: body() });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('SELF_ACTION_FORBIDDEN');
    // The lockout survives: a containment control cannot be cleared by the party it contains.
    expect(isLocked(await lockouts.get(admin.id), Date.now())).toBe(true);
    // The refusal is audited as a failure, so the attempt is visible.
    const n = (db.prepare("SELECT COUNT(*) n FROM admin_actions WHERE action='user.unlock' AND result='failure'").get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it('[U9] the unlock response carries no MFA material of any kind', async () => {
    const { app, db, lockouts } = build();
    const admin = await mkUser(app, db, 'u9-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'u9-target@ex.com', 'user');
    const secret = 'TOTPSEED_MUST_NOT_LEAK_9999';
    db.prepare('INSERT INTO mfa_credentials (user_id,enabled,secret_encrypted,recovery_codes_json,updated_at) VALUES (?,?,?,?,?)')
      .run(target.id, 1, secret, '[{"hash":"CODEHASH9"}]', Date.now());
    await lockAccount(lockouts, target.id);
    const raw = await (await rq(app, 'POST', `/api/admin/users/${target.id}/unlock`, { jar: admin.jar, csrf: true, body: body() })).text();
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain('CODEHASH9');
    for (const bad of ['otpauth', 'secret', 'recovery', 'qrcode', 'password']) {
      expect(raw.toLowerCase(), `"${bad}" must not appear in the unlock response`).not.toContain(bad);
    }
  });
});

// ===========================================================================
// ADM-API-12 — reports
// ===========================================================================
describe('ADM-API-12 reports', () => {
  it('[R1] 401 unauthenticated; 403 for a non-admin; 403 for SUPPORT (no audit permission)', async () => {
    const { app, db } = build();
    expect((await rq(app, 'GET', '/api/admin/reports', {})).status).toBe(401);
    const plain = await mkUser(app, db, 'r1-user@ex.com', 'user');
    expect((await rq(app, 'GET', '/api/admin/reports', { jar: plain.jar })).status).toBe(403);
    const support = await mkUser(app, db, 'r1-support@ex.com', 'SUPPORT');
    expect((await rq(app, 'GET', '/api/admin/reports', { jar: support.jar })).status).toBe(403);
    expect((await rq(app, 'POST', '/api/admin/reports', { jar: support.jar, csrf: true, body: { type: 'daily_operations' } })).status).toBe(403);
  });

  it('[R2] 403 CSRF_FAILED on generate without a token', async () => {
    const { app, db } = build();
    const analyst = await mkUser(app, db, 'r2-analyst@ex.com', 'ANALYST');
    const res = await rq(app, 'POST', '/api/admin/reports', { jar: analyst.jar, body: { type: 'daily_operations' } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CSRF_FAILED');
  });

  it('[R3] an unknown type is a 422 and NEVER a generic report; the input is not echoed', async () => {
    const { app, db } = build();
    const analyst = await mkUser(app, db, 'r3-analyst@ex.com', 'ANALYST');
    const marker = 'super_secret_report_type_marker';
    const res = await rq(app, 'POST', '/api/admin/reports', { jar: analyst.jar, csrf: true, body: { type: marker } });
    expect(res.status).toBe(422);
    const raw = await res.text();
    expect(raw).not.toContain(marker);
    // Nothing was stored, so an unknown type cannot become an empty "successful" report.
    expect((db.prepare('SELECT COUNT(*) n FROM admin_reports').get() as { n: number }).n).toBe(0);
    // An extra key is also a 422 (the schema is strict), not a silently-ignored field.
    expect((await rq(app, 'POST', '/api/admin/reports', { jar: analyst.jar, csrf: true, body: { type: 'ai_cost', sneaky: 1 } })).status).toBe(422);
    // An inverted window is refused rather than producing an empty report.
    expect((await rq(app, 'POST', '/api/admin/reports', { jar: analyst.jar, csrf: true, body: { type: 'ai_cost', from: 2000, to: 1000 } })).status).toBe(422);
  });

  it('[R4] every allowlisted type generates a report whose figures come from real tables', async () => {
    const { app, db } = build();
    const analyst = await mkUser(app, db, 'r4-analyst@ex.com', 'ANALYST');
    const owner = await mkUser(app, db, 'r4-owner@ex.com', 'user');
    const now = Date.now();
    db.prepare(
      `INSERT INTO orders (internal_order_id,user_id,client_order_id,symbol,side,type,price,quantity,filled_quantity,status,mode,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('r4-o1', owner.id, 'r4-c1', 'BTCUSDT', 'buy', 'limit', '68000', '0.01', '0', 'NEW', 'MOCK', now, now);

    const types = ['daily_operations', 'trading_activity', 'ai_cost', 'security_posture', 'compliance_audit'] as const;
    for (const type of types) {
      const gen = await rq(app, 'POST', '/api/admin/reports', { jar: analyst.jar, csrf: true, body: { type } });
      expect(gen.status, type).toBe(201);
      const g = (await gen.json()) as { id: string; type: string; generatedAt: number; source: { tables: string[]; kind: string; window: { from: number; to: number } } };
      expect(g.type).toBe(type);
      // Provenance: which tables, which window, and when.
      expect(g.source.kind).toBe('LOCAL_DB_AGGREGATE');
      expect(g.source.tables.length).toBeGreaterThan(0);
      expect(g.source.window.from).toBeLessThanOrEqual(g.source.window.to);
      expect(g.generatedAt).toBeGreaterThan(0);

      const one = await rq(app, 'GET', `/api/admin/reports/${g.id}`, { jar: analyst.jar });
      expect(one.status).toBe(200);
      const o = (await one.json()) as { type: string; data: Record<string, unknown>; source: { tables: string[] }; generatedBy: string; immutable: boolean };
      expect(o.type).toBe(type);
      expect(o.immutable).toBe(true);
      expect(o.generatedBy).toBe(analyst.id);
      expect(Object.keys(o.data).length).toBeGreaterThan(0);
    }

    // The order that really exists is counted; nothing was invented.
    const trading = (db.prepare("SELECT data_json d FROM admin_reports WHERE report_type='trading_activity'").get() as { d: string }).d;
    expect((JSON.parse(trading) as { ordersInWindow: number }).ordersInWindow).toBe(1);

    const list = await rq(app, 'GET', '/api/admin/reports', { jar: analyst.jar });
    const l = (await list.json()) as { types: string[]; reports: Record<string, unknown>[]; total: number };
    expect(l.total).toBe(types.length);
    // The allowlist is served by the SERVER so the UI cannot offer a type the server would reject.
    expect(new Set(l.types)).toEqual(new Set(types));
    expect(l.reports[0]!.source).toBeTruthy();

    const filtered = (await (await rq(app, 'GET', '/api/admin/reports?type=ai_cost', { jar: analyst.jar })).json()) as { total: number };
    expect(filtered.total).toBe(1);
    expect((await rq(app, 'GET', '/api/admin/reports?type=not_a_type', { jar: analyst.jar })).status).toBe(400);
  });

  it('[R5] 404 for a report id that does not exist; generation is audited', async () => {
    const { app, db } = build();
    const analyst = await mkUser(app, db, 'r5-analyst@ex.com', 'ANALYST');
    expect((await rq(app, 'GET', '/api/admin/reports/nope-nope', { jar: analyst.jar })).status).toBe(404);
    await rq(app, 'POST', '/api/admin/reports', { jar: analyst.jar, csrf: true, body: { type: 'compliance_audit' } });
    const n = (db.prepare("SELECT COUNT(*) n FROM admin_actions WHERE action='report.generate' AND result='success'").get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it('[R6] reports are immutable: there is no update or delete route', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'r6-sa@ex.com', 'SUPER_ADMIN');
    const gen = await rq(app, 'POST', '/api/admin/reports', { jar: sa.jar, csrf: true, body: { type: 'daily_operations' } });
    const { id } = (await gen.json()) as { id: string };
    for (const [method, path] of [
      ['PATCH', `/api/admin/reports/${id}`],
      ['PUT', `/api/admin/reports/${id}`],
      ['DELETE', `/api/admin/reports/${id}`],
    ] as const) {
      const r = await rq(app, method, path, { jar: sa.jar, csrf: true, body: {} });
      expect([404, 405], `${method} ${path}`).toContain(r.status);
    }
  });
});

// ===========================================================================
// ADM-API-15 — backup status (READ-ONLY)
// ===========================================================================
describe('ADM-API-15 GET /admin/backup/status', () => {
  it('[B1] 401 unauthenticated, 403 for a non-admin role', async () => {
    const { app, db } = build();
    expect((await rq(app, 'GET', '/api/admin/backup/status', {})).status).toBe(401);
    const plain = await mkUser(app, db, 'b1-user@ex.com', 'user');
    expect((await rq(app, 'GET', '/api/admin/backup/status', { jar: plain.jar })).status).toBe(403);
  });

  it('[B2] states honestly that the store is SQLite and reports what is actually knowable', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'b2-sa@ex.com', 'SUPER_ADMIN');
    const res = await rq(app, 'GET', '/api/admin/backup/status', { jar: sa.jar });
    expect(res.status).toBe(200);
    const b = (await res.json()) as {
      engine: string; managedPostgres: string;
      file: { name: string; inMemory: boolean; present: boolean; sizeBytes: number | null; modifiedAt: number | null };
      pragmas: { journalMode: string | null; walEnabled: boolean | null; pageSize: unknown; foreignKeys: unknown };
      migrations: { last: { version: string } | null; appliedCount: number | null };
      backup: Record<string, unknown>;
      unavailable: string[];
      restore: { supported: boolean; reason: string };
      releaseGate: { key: string; status: string } | null;
    };
    expect(b.engine).toBe('sqlite');
    expect(b.managedPostgres).toBe('Not Connected');
    // This harness uses an in-memory database, so "is there a file to back up?" is honestly `false` —
    // not a missing-file error and not a fabricated present file.
    expect(b.file.inMemory).toBe(true);
    expect(b.file.present).toBe(false);
    expect(b.file.sizeBytes).toBeNull();
    // Knowable pragmas are real values.
    expect(b.pragmas.journalMode).toBeTruthy();
    expect(typeof b.pragmas.walEnabled).toBe('boolean');
    expect(Number(b.pragmas.pageSize)).toBeGreaterThan(0);
    // The last applied migration is a real row, and 0009 is part of this schema.
    // Updated with migration 0010 (Phase 8 trade journal). This assertion is deliberately exact: it is
    // how the backup-status endpoint proves it reports the schema actually applied, not a hardcoded string.
    expect(b.migrations.last?.version).toBe('0011_phase8_strategies');
    expect(b.migrations.appliedCount).toBeGreaterThanOrEqual(9);
    // NOTHING unknowable is reported as a success: every backup field is null and named as unavailable.
    for (const [k, v] of Object.entries(b.backup)) {
      expect(v, `backup.${k} must not be fabricated`).toBeNull();
    }
    expect(b.unavailable).toContain('pitr');
    expect(b.unavailable).toContain('managedPostgresBackup');
    // The release gate is NOT marked passed.
    expect(b.releaseGate?.key).toBe('backup-restore-pitr');
    expect(b.releaseGate?.status).toBe('NOT_EXECUTED');
    expect(b.restore.supported).toBe(false);
    expect(b.restore.reason).toBe('DISABLED_BY_POLICY');
  });

  it('[B3] a real database FILE reports presence/size/mtime and WAL, and only the basename', async () => {
    // A second harness on a temp file, because the in-memory case cannot prove the file probe works.
    const { mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'qt-backup-status-'));
    const path = join(dir, 'probe.db');
    const fileDb = openDb(path);
    const repo = new SqliteAdminRepo(fileDb);
    const status = repo.backupStatus() as {
      file: { name: string; inMemory: boolean; present: boolean; sizeBytes: number; modifiedAt: number };
      pragmas: { journalMode: string; walEnabled: boolean };
    };
    expect(status.file.inMemory).toBe(false);
    expect(status.file.present).toBe(true);
    expect(status.file.sizeBytes).toBeGreaterThan(0);
    expect(status.file.modifiedAt).toBeGreaterThan(0);
    // Basename only — the host's directory layout is not exposed to the console.
    expect(status.file.name).toBe('probe.db');
    expect(JSON.stringify(status)).not.toContain(dir);
    expect(status.pragmas.journalMode.toLowerCase()).toBe('wal');
    expect(status.pragmas.walEnabled).toBe(true);
    fileDb.close();
  });

  it('[B4] there is NO restore route (not a disabled one — none is mounted)', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'b4-sa@ex.com', 'SUPER_ADMIN');
    for (const [method, path] of [
      ['POST', '/api/admin/backup/restore'],
      ['POST', '/api/admin/backup'],
      ['POST', '/api/admin/backup/run'],
      ['DELETE', '/api/admin/backup'],
    ] as const) {
      const r = await rq(app, method, path, { jar: sa.jar, csrf: true, body: {} });
      expect([404, 405], `${method} ${path} must not exist`).toContain(r.status);
    }
    expect((await rq(app, 'GET', '/api/admin/backup/status?bogus=1', { jar: sa.jar })).status).toBe(400);
  });

  it('[B5] 429 once the per-actor admin budget is exhausted', async () => {
    // Rate limiting is a property of the shared guard, asserted here on a B7 route so a future route that
    // bypassed `guard()` would be caught.
    const db = openDb(':memory:');
    const audit = new SqliteAuditRepository(db);
    const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
      emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
      resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
      mail: new MailSink(),
    });
    const app = new Hono();
    app.route('/api', createAuthRouter({ service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN] }));
    app.route('/api', createAdminRouter({ service, repo: new SqliteAdminRepoAdapter(new SqliteAdminRepo(db)), csrfKey: 'k', corsOrigins: [ORIGIN], cookieName: 'qt_session', health: () => ({}), ratePerMin: 5 }));
    const sa = await mkUser(app, db, 'b5-sa@ex.com', 'SUPER_ADMIN');
    let got429 = false;
    for (let i = 0; i < 20; i++) {
      if ((await rq(app, 'GET', '/api/admin/backup/status', { jar: sa.jar })).status === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });
});
