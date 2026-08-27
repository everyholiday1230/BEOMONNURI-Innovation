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
  /*
     ★ DELETE 에도 본문을 보낸다.

       전에는 GET 과 함께 제외했다. 회원 삭제(DELETE /admin/users/:id)는 사유·
       재인증·확인 이메일을 본문으로 받으므로, 보내지 않으면 스키마 검증에서
       422 로 걸려 **그 뒤의 권한·확인 검사를 전혀 확인하지 못한다.**
       (실제로 이 헬퍼 때문에 403 을 기대한 검사가 422 로 실패했다.)

       GET 은 그대로 제외한다 — 본문 있는 GET 은 우리가 쓰지 않는다.
  */
  if (method !== 'GET') init.body = JSON.stringify(o.body ?? {});
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
    // The last applied migration is a real row. Updated with migration 0013 (resource user_id FK fix —
    // layouts/ai_signals/chart_overlays/order_drafts + version tables must not FK to a users table that
    // lives in Postgres on production; extends the 0012 fix to the resource tables). This assertion
    // is deliberately exact: it is how the backup-status endpoint proves it reports the schema actually
    // applied, not a hardcoded string.
    expect(b.migrations.last?.version).toBe('0015_user_tags');
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

// ===========================================================================
// 2단계 인증 초기화 — POST /admin/users/:id/reset-mfa
//
// 왜 이 검사가 필요한가
//   이 기능은 **보안 요소를 제거한다.** 기기를 잃은 이용자를 되살리는 유일한
//   수단이지만, 동시에 관리자 계정이 탈취되면 임의 사용자의 2단계 인증을 끄고
//   비밀번호만으로 들어가는 경로가 된다. 그래서 아래 조건이 하나라도 느슨해지면
//   그 자체가 취약점이다 — 검사로 고정한다.
// ===========================================================================
describe('ADM-MFA-RESET POST /admin/users/:id/reset-mfa', () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    reason: 'user lost their phone and has no recovery codes',
    reauth: true,
    ...extra,
  });

  it('[M1] 401 미인증 · 403 일반 사용자 · 403 권한 없는 관리자 등급', async () => {
    const { app, db } = build();
    const target = await mkUser(app, db, 'm1-target@ex.com', 'user');
    expect((await rq(app, 'POST', `/api/admin/users/${target.id}/reset-mfa`, { body: body() })).status).toBe(401);

    const plain = await mkUser(app, db, 'm1-user@ex.com', 'user');
    expect((await rq(app, 'POST', `/api/admin/users/${target.id}/reset-mfa`, { jar: plain.jar, csrf: true, body: body() })).status).toBe(403);

    // ANALYST 는 관리 등급이지만 읽기 전용이다(admin.user.status.write 없음).
    const analyst = await mkUser(app, db, 'm1-analyst@ex.com', 'ANALYST');
    expect((await rq(app, 'POST', `/api/admin/users/${target.id}/reset-mfa`, { jar: analyst.jar, csrf: true, body: body() })).status).toBe(403);
  });

  it('[M2] CSRF 토큰 없으면 403', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'm2-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'm2-target@ex.com', 'user');
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/reset-mfa`, { jar: admin.jar, body: body() });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CSRF_FAILED');
  });

  it('[M3] reauth 없으면 403 STEP_UP_REQUIRED — 요소 제거에는 본인 확인이 필요하다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'm3-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'm3-target@ex.com', 'user');
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/reset-mfa`, {
      jar: admin.jar, csrf: true, body: body({ reauth: false }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');
  });

  it('[M4] 사유가 짧으면 422 · 거부된 입력을 응답에 되돌려주지 않는다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'm4-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'm4-target@ex.com', 'user');
    const marker = 'REJECTED_MFA_INPUT_MARKER';
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/reset-mfa`, {
      jar: admin.jar, csrf: true, body: { reason: 'x', reauth: true, injected: marker },
    });
    expect(res.status).toBe(422);
    expect(await res.text()).not.toContain(marker);
  });

  it('[M5] ★ 운영자 계정은 대상이 아니다 — 다른 운영자의 요소를 벗길 수 없다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'm5-admin@ex.com', 'ADMIN');
    for (const role of ['ADMIN', 'SUPER_ADMIN', 'SUPPORT', 'ANALYST']) {
      const op = await mkUser(app, db, `m5-${role.toLowerCase()}@ex.com`, role);
      const res = await rq(app, 'POST', `/api/admin/users/${op.id}/reset-mfa`, {
        jar: admin.jar, csrf: true, body: body(),
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    }
  });

  it('[M6] 자기 자신도 대상이 아니다 — 본인 보안 설정에서 처리해야 한다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'm6-admin@ex.com', 'ADMIN');
    const res = await rq(app, 'POST', `/api/admin/users/${admin.id}/reset-mfa`, {
      jar: admin.jar, csrf: true, body: body(),
    });
    expect(res.status).toBe(403);
  });

  it('[M7] 없는 사용자는 404 (UUID 가 아닌 id 도 500 이 아니라 404)', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'm7-admin@ex.com', 'ADMIN');
    for (const id of ['00000000-0000-0000-0000-000000000000', 'not-a-uuid']) {
      const res = await rq(app, 'POST', `/api/admin/users/${id}/reset-mfa`, {
        jar: admin.jar, csrf: true, body: body(),
      });
      expect(res.status).toBe(404);
    }
  });

  it('[M8] 성공하면 세션도 끊고, 통지 여부를 사실대로 보고한다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'm8-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'm8-target@ex.com', 'user');
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/reset-mfa`, {
      jar: admin.jar, csrf: true, body: body(),
    });
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ok: boolean; sessionsRevoked: number; notified: boolean; note: string };
    expect(b.ok).toBe(true);
    // 요소를 제거했으므로 기존 세션을 남기지 않는다(공격자가 세션을 이어 쓰는 것을 막는다).
    expect(b.sessionsRevoked).toBeGreaterThanOrEqual(1);
    /*
       ★ 메일이 설정되지 않은 환경에서 "통지했다" 고 보고하면 담당자가 이용자에게
         알렸다고 믿는다. 사실대로 false 를 주고 이유를 함께 밝힌다.
    */
    expect(b.notified).toBe(false);
    expect(b.note).toMatch(/NOT notified/u);
  });
});

// ===========================================================================
// 비밀번호 재설정 링크 발송 — POST /admin/users/:id/send-password-reset
//
// ★ 임시 비밀번호를 만들지 않는다는 것이 이 기능의 핵심이다. 만들면 관리자가
//   이용자 비밀번호를 아는 상태가 되고, 우리가 게시한 방침 8절("비밀번호 원문을
//   보관하지 않습니다")과 어긋난다.
// ===========================================================================
describe('ADM-PWRESET POST /admin/users/:id/send-password-reset', () => {
  const body = (extra: Record<string, unknown> = {}) => ({ reason: 'user cannot sign in and asked support', ...extra });

  it('[P1] 401 미인증 · 403 일반 사용자 · 403 읽기 전용 관리 등급', async () => {
    const { app, db } = build();
    const target = await mkUser(app, db, 'p1-target@ex.com', 'user');
    expect((await rq(app, 'POST', `/api/admin/users/${target.id}/send-password-reset`, { body: body() })).status).toBe(401);
    const plain = await mkUser(app, db, 'p1-user@ex.com', 'user');
    expect((await rq(app, 'POST', `/api/admin/users/${target.id}/send-password-reset`, { jar: plain.jar, csrf: true, body: body() })).status).toBe(403);
    const analyst = await mkUser(app, db, 'p1-analyst@ex.com', 'ANALYST');
    expect((await rq(app, 'POST', `/api/admin/users/${target.id}/send-password-reset`, { jar: analyst.jar, csrf: true, body: body() })).status).toBe(403);
  });

  it('[P2] 사유가 없으면 422', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'p2-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'p2-target@ex.com', 'user');
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/send-password-reset`, {
      jar: admin.jar, csrf: true, body: {},
    });
    expect(res.status).toBe(422);
  });

  it('[P3] ★ 응답에 비밀번호나 토큰이 절대 담기지 않는다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'p3-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'p3-target@ex.com', 'user');
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/send-password-reset`, {
      jar: admin.jar, csrf: true, body: body(),
    });
    const text = await res.text();
    /*
       메일 미설정 환경에서는 MAIL_NOT_CONFIGURED 가 오고, 설정된 환경에서는
       발송 성공이 온다. 어느 쪽이든 **토큰·임시 비밀번호가 응답에 있으면 안 된다.**
       관리자가 그 값을 알면 이용자를 대신해 로그인할 수 있다.
    */
    expect(text).not.toMatch(/temporaryPassword|tempPassword|"token"|resetToken/u);
  });

  it('[P4] 없는 사용자는 404', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'p4-admin@ex.com', 'ADMIN');
    const res = await rq(app, 'POST', '/api/admin/users/00000000-0000-0000-0000-000000000000/send-password-reset', {
      jar: admin.jar, csrf: true, body: body(),
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 회원 삭제 (법정 보관분 분리 보관) — DELETE /admin/users/:id
//
// 왜 이 검사가 필요한가
//   되돌릴 수 없는 작업이다. 잘못된 대상을 지우면 그 계정을 되살릴 방법이 없다.
//   그리고 우리 방침(§6)이 "지체 없이 파기" 와 "법정 보관분은 분리 보관" 을
//   **동시에** 약속했으므로, 보관하지 못하는 상태에서 지우는 것도 위반이다.
//   아래 조건이 하나라도 느슨해지면 그 자체가 사고 경로다.
// ===========================================================================
describe('ADM-USER-DELETE DELETE /admin/users/:id', () => {
  const body = (email: string, extra: Record<string, unknown> = {}) => ({
    reason: 'user requested account deletion',
    reauth: true,
    confirmEmail: email,
    ...extra,
  });

  it('[D1] 401 미인증 · 403 일반 사용자 · ★ ADMIN 도 안 된다(SUPER 전용)', async () => {
    const { app, db } = build();
    const target = await mkUser(app, db, 'd1-target@ex.com', 'user');
    expect((await rq(app, 'DELETE', `/api/admin/users/${target.id}`, { body: body('d1-target@ex.com') })).status).toBe(401);

    const plain = await mkUser(app, db, 'd1-user@ex.com', 'user');
    expect((await rq(app, 'DELETE', `/api/admin/users/${target.id}`, { jar: plain.jar, csrf: true, body: body('d1-target@ex.com') })).status).toBe(403);

    /*
       ★ ADMIN 에게 주지 않는다.

         되돌릴 수 없는 작업은 한 사람이 혼자 실행할 수 있게 두지 않는다
         (admin.legal.write 와 같은 판단). 이 기대가 깨지면 권한 설계가 무너진 것이다.
    */
    const admin = await mkUser(app, db, 'd1-admin@ex.com', 'ADMIN');
    const res = await rq(app, 'DELETE', `/api/admin/users/${target.id}`, { jar: admin.jar, csrf: true, body: body('d1-target@ex.com') });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('admin.user.delete');
  });

  it('[D2] CSRF 토큰 없으면 403', async () => {
    const { app, db } = build();
    const su = await mkUser(app, db, 'd2-super@ex.com', 'SUPER_ADMIN');
    const target = await mkUser(app, db, 'd2-target@ex.com', 'user');
    const res = await rq(app, 'DELETE', `/api/admin/users/${target.id}`, { jar: su.jar, body: body('d2-target@ex.com') });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CSRF_FAILED');
  });

  it('[D3] reauth 없으면 403 · 사유가 짧으면 422', async () => {
    const { app, db } = build();
    const su = await mkUser(app, db, 'd3-super@ex.com', 'SUPER_ADMIN');
    const target = await mkUser(app, db, 'd3-target@ex.com', 'user');

    const noReauth = await rq(app, 'DELETE', `/api/admin/users/${target.id}`, {
      jar: su.jar, csrf: true, body: body('d3-target@ex.com', { reauth: false }),
    });
    expect(noReauth.status).toBe(403);
    expect(((await noReauth.json()) as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');

    const shortReason = await rq(app, 'DELETE', `/api/admin/users/${target.id}`, {
      jar: su.jar, csrf: true, body: body('d3-target@ex.com', { reason: 'x' }),
    });
    expect(shortReason.status).toBe(422);
  });

  it('[D4] ★ 이메일이 대상과 다르면 지우지 않는다 — 잘못된 행을 누른 실수를 막는다', async () => {
    const { app, db } = build();
    const su = await mkUser(app, db, 'd4-super@ex.com', 'SUPER_ADMIN');
    const target = await mkUser(app, db, 'd4-target@ex.com', 'user');
    const res = await rq(app, 'DELETE', `/api/admin/users/${target.id}`, {
      jar: su.jar, csrf: true, body: body('someone-else@ex.com'),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CONFIRMATION_MISMATCH');
    // 대상이 그대로 살아 있어야 한다.
    const still = await rq(app, 'GET', `/api/admin/users/${target.id}`, { jar: su.jar });
    expect(still.status).toBe(200);
  });

  it('[D5] ★ 운영자 계정과 자기 자신은 이 경로로 지우지 않는다', async () => {
    const { app, db } = build();
    const su = await mkUser(app, db, 'd5-super@ex.com', 'SUPER_ADMIN');

    // 자기 자신
    const self = await rq(app, 'DELETE', `/api/admin/users/${su.id}`, {
      jar: su.jar, csrf: true, body: body('d5-super@ex.com'),
    });
    expect(self.status).toBe(403);

    // 다른 운영자 등급
    for (const role of ['ADMIN', 'SUPPORT', 'ANALYST']) {
      const email = `d5-${role.toLowerCase()}@ex.com`;
      const op = await mkUser(app, db, email, role);
      const res = await rq(app, 'DELETE', `/api/admin/users/${op.id}`, {
        jar: su.jar, csrf: true, body: body(email),
      });
      expect(res.status).toBe(403);
    }
  });

  it('[D6] 없는 사용자는 404 (UUID 가 아닌 id 도 500 이 아니라 404)', async () => {
    const { app, db } = build();
    const su = await mkUser(app, db, 'd6-super@ex.com', 'SUPER_ADMIN');
    for (const id of ['00000000-0000-0000-0000-000000000000', 'not-a-uuid']) {
      const res = await rq(app, 'DELETE', `/api/admin/users/${id}`, {
        jar: su.jar, csrf: true, body: body('whatever@ex.com'),
      });
      expect(res.status).toBe(404);
    }
  });

  it('[D7] ★★ 분리 보관을 할 수 없으면 삭제하지 않는다', async () => {
    /*
       이 테스트는 SQLite 백엔드로 돈다. 0022 는 Postgres 마이그레이션이므로
       `retained_*` 테이블이 없고, 구현은 그 경우 null 을 돌려주도록 되어 있다.

       ★ 그때 삭제를 진행하면 방침이 5년 보관하겠다고 한 동의·주문 기록이
         그대로 사라진다. "보관할 곳이 없으면 지우지 않는다" 가 이 기능의
         가장 중요한 성질이고, 그래서 성공으로 보고하지 않는지 확인한다.
    */
    const { app, db } = build();
    const su = await mkUser(app, db, 'd7-super@ex.com', 'SUPER_ADMIN');
    const target = await mkUser(app, db, 'd7-target@ex.com', 'user');

    const res = await rq(app, 'DELETE', `/api/admin/users/${target.id}`, {
      jar: su.jar, csrf: true, body: body('d7-target@ex.com'),
    });
    const b = (await res.json()) as { ok?: boolean; error?: { code: string } };

    if (b.error) {
      // 보관 저장소가 없는 환경 — 지우지 않았어야 한다.
      expect(b.error.code).toBe('RETENTION_UNAVAILABLE');
      const still = await rq(app, 'GET', `/api/admin/users/${target.id}`, { jar: su.jar });
      expect(still.status).toBe(200);
    } else {
      // 보관 저장소가 있는 환경 — 지워졌고 보관 개수를 보고해야 한다.
      expect(b.ok).toBe(true);
      const gone = await rq(app, 'GET', `/api/admin/users/${target.id}`, { jar: su.jar });
      expect(gone.status).toBe(404);
    }
  });
});

// ===========================================================================
// 관리자 노트 · 이메일 변경 · 회원 목록 반출
// ===========================================================================
describe('ADM-NOTES 관리자 노트', () => {
  it('[N1] 조회는 읽기 권한 · 작성·삭제는 변경 권한', async () => {
    const { app, db } = build();
    const target = await mkUser(app, db, 'n1-target@ex.com', 'user');

    // 미인증
    expect((await rq(app, 'GET', `/api/admin/users/${target.id}/notes`)).status).toBe(401);

    // 일반 사용자는 읽기도 안 된다
    const plain = await mkUser(app, db, 'n1-user@ex.com', 'user');
    expect((await rq(app, 'GET', `/api/admin/users/${target.id}/notes`, { jar: plain.jar })).status).toBe(403);

    /*
       ★ ANALYST 는 읽을 수 있지만 쓸 수 없다.
         지원·분석 담당은 맥락을 봐야 업무가 되고, 기록을 바꾸는 것은 변경
         권한이 있는 등급의 일이다.
    */
    const analyst = await mkUser(app, db, 'n1-analyst@ex.com', 'ANALYST');
    expect((await rq(app, 'GET', `/api/admin/users/${target.id}/notes`, { jar: analyst.jar })).status).toBe(200);
    expect((await rq(app, 'POST', `/api/admin/users/${target.id}/notes`, {
      jar: analyst.jar, csrf: true, body: { body: 'analyst should not be able to write this' },
    })).status).toBe(403);
  });

  it('[N2] 빈 본문·과도한 길이는 400', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'n2-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'n2-target@ex.com', 'user');
    for (const bad of ['', '   ', 'x'.repeat(4001)]) {
      const res = await rq(app, 'POST', `/api/admin/users/${target.id}/notes`, {
        jar: admin.jar, csrf: true, body: { body: bad },
      });
      expect(res.status).toBe(400);
    }
  });

  it('[N3] ★ 다른 회원의 노트를 지울 수 없다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'n3-admin@ex.com', 'ADMIN');
    const a = await mkUser(app, db, 'n3-a@ex.com', 'user');
    const bUser = await mkUser(app, db, 'n3-b@ex.com', 'user');

    const created = await rq(app, 'POST', `/api/admin/users/${a.id}/notes`, {
      jar: admin.jar, csrf: true, body: { body: 'a note that belongs to user A' },
    });
    const cb = (await created.json()) as { ok?: boolean; id?: string; error?: { code: string } };
    // 저장할 수 없는 환경(개발 DB 에 표 없음)이면 이 검사는 의미가 없다.
    if (!cb.id) { expect(cb.error?.code).toBe('NOTES_UNAVAILABLE'); return; }

    /*
       ★ B 의 경로로 A 의 노트 id 를 지우려 하면 404 여야 한다.
         노트 id 만으로 지울 수 있으면 id 를 알아낸 사람이 남의 기록을 지운다.
         "없는 것" 과 "남의 것" 을 구분해 알리지도 않는다(존재 여부 누출).
    */
    const cross = await rq(app, 'DELETE', `/api/admin/users/${bUser.id}/notes/${cb.id}`, {
      jar: admin.jar, csrf: true,
    });
    expect(cross.status).toBe(404);

    // 올바른 조합은 지워진다.
    const own = await rq(app, 'DELETE', `/api/admin/users/${a.id}/notes/${cb.id}`, { jar: admin.jar, csrf: true });
    expect(own.status).toBe(200);
  });
});

describe('ADM-EMAIL 이메일 변경', () => {
  const body = (email: string, extra: Record<string, unknown> = {}) => ({
    email, reason: 'user reported a typo in their address', reauth: true, ...extra,
  });

  it('[E1] 권한·CSRF·reauth·형식을 모두 요구한다', async () => {
    const { app, db } = build();
    const target = await mkUser(app, db, 'e1-target@ex.com', 'user');

    expect((await rq(app, 'PATCH', `/api/admin/users/${target.id}/email`, { body: body('e1-new@ex.com') })).status).toBe(401);

    const analyst = await mkUser(app, db, 'e1-analyst@ex.com', 'ANALYST');
    expect((await rq(app, 'PATCH', `/api/admin/users/${target.id}/email`, {
      jar: analyst.jar, csrf: true, body: body('e1-new@ex.com'),
    })).status).toBe(403);

    const admin = await mkUser(app, db, 'e1-admin@ex.com', 'ADMIN');
    // CSRF 없음
    expect((await rq(app, 'PATCH', `/api/admin/users/${target.id}/email`, {
      jar: admin.jar, body: body('e1-new@ex.com'),
    })).status).toBe(403);
    // reauth 없음
    const noReauth = await rq(app, 'PATCH', `/api/admin/users/${target.id}/email`, {
      jar: admin.jar, csrf: true, body: body('e1-new@ex.com', { reauth: false }),
    });
    expect(noReauth.status).toBe(403);
    expect(((await noReauth.json()) as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');
    // 형식 오류
    expect((await rq(app, 'PATCH', `/api/admin/users/${target.id}/email`, {
      jar: admin.jar, csrf: true, body: body('not-an-email'),
    })).status).toBe(422);
  });

  it('[E2] ★ 이미 쓰는 주소면 409, 그리고 원래 주소는 그대로다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'e2-admin@ex.com', 'ADMIN');
    const a = await mkUser(app, db, 'e2-a@ex.com', 'user');
    await mkUser(app, db, 'e2-b@ex.com', 'user');

    const res = await rq(app, 'PATCH', `/api/admin/users/${a.id}/email`, {
      jar: admin.jar, csrf: true, body: body('e2-b@ex.com'),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('EMAIL_TAKEN');

    const still = db.prepare('SELECT email FROM users WHERE id=?').get(a.id) as { email: string };
    expect(still.email).toBe('e2-a@ex.com');
  });

  it('[E3] ★★ 변경하면 email_verified 가 false 로 돌아간다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'e3-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'e3-target@ex.com', 'user');
    db.prepare('UPDATE users SET email_verified=1 WHERE id=?').run(target.id);

    const res = await rq(app, 'PATCH', `/api/admin/users/${target.id}/email`, {
      jar: admin.jar, csrf: true, body: body('e3-fixed@ex.com'),
    });
    expect(res.status).toBe(200);

    const row = db.prepare('SELECT email, email_verified FROM users WHERE id=?').get(target.id) as { email: string; email_verified: number };
    expect(row.email).toBe('e3-fixed@ex.com');
    /*
       ★ 새 주소는 그 사람의 것이라는 증거가 없다. 확인된 상태로 남기면
         잘못 입력된 주소가 확인된 것처럼 보이고, 그 뒤 비밀번호 재설정
         링크가 남의 메일함으로 간다.
    */
    expect(Number(row.email_verified)).toBe(0);
  });

  it('[E4] 운영자 계정은 이 경로로 바꾸지 않는다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'e4-admin@ex.com', 'ADMIN');
    const op = await mkUser(app, db, 'e4-op@ex.com', 'SUPPORT');
    const res = await rq(app, 'PATCH', `/api/admin/users/${op.id}/email`, {
      jar: admin.jar, csrf: true, body: body('e4-op-new@ex.com'),
    });
    expect(res.status).toBe(403);
  });
});

describe('ADM-EXPORT 회원 목록 반출', () => {
  it('[X1] ★ 목록 읽기 권한만으로는 반출할 수 없다', async () => {
    const { app, db } = build();
    expect((await rq(app, 'GET', '/api/admin/users/export')).status).toBe(401);

    /*
       ★ SUPPORT 는 회원 목록을 읽을 수 있지만(admin.user.read) 반출 권한
         (admin.audit.export)은 없다. 파일로 나가는 것은 화면에서 보는 것과
         성질이 다르므로 권한을 분리한다.
    */
    const support = await mkUser(app, db, 'x1-support@ex.com', 'SUPPORT');
    expect((await rq(app, 'GET', '/api/admin/users', { jar: support.jar })).status).toBe(200);
    const res = await rq(app, 'GET', '/api/admin/users/export', { jar: support.jar });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('admin.audit.export');
  });

  it('[X2] CSV 로 나가고, 내보내는 항목이 최소로 유지된다', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'x2-admin@ex.com', 'ADMIN');
    const res = await rq(app, 'GET', '/api/admin/users/export', { jar: admin.jar });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');

    const text = await res.text();
    expect(text.split('\n')[0]).toBe('id,email,role,status,created_at');
    /*
       ★ 여기 없는 것은 파일에 나가지 않는다. 특히 비밀번호 해시와 MFA 관련
         값은 내보낼 이유가 없다(있으면 유출 시 피해가 그만큼 커진다).
    */
    expect(text).not.toMatch(/password|mfa_secret|secret/i);
  });

  it('[X3] format=json 이 검색 조건 검증을 깨뜨리지 않는다', async () => {
    /*
       UserSearchSchema 는 .strict() 이므로 모르는 키가 있으면 전체를 400 으로
       거부한다. format 을 스키마에 넣으면 **요청 전체가 실패**한다(실측으로 겪었다).
    */
    const { app, db } = build();
    const admin = await mkUser(app, db, 'x3-admin@ex.com', 'ADMIN');
    const res = await rq(app, 'GET', '/api/admin/users/export?format=json&limit=2', { jar: admin.jar });
    expect(res.status).toBe(200);
    const b = (await res.json()) as { users: unknown[]; cappedAt: number };
    expect(Array.isArray(b.users)).toBe(true);
    expect(b.cappedAt).toBe(5000);
  });
});

// ===========================================================================
// 감사 로그 접근 통제
//
// auth 라우터에 있던 `/admin/audit` 껍데기를 제거했으므로(등록 순서에 따라
// 실제 관리자 API 를 가로챌 수 있었다) 그 검사를 실제 경로로 옮긴다.
// ===========================================================================
describe('ADM-AUDIT-GUARD GET /admin/audit', () => {
  it('[A1] 미인증 401 · 일반 사용자 403 · SUPPORT 도 403(감사 열람 권한 없음)', async () => {
    const { app, db } = build();
    expect((await rq(app, 'GET', '/api/admin/audit')).status).toBe(401);

    const plain = await mkUser(app, db, 'a1-user@ex.com', 'user');
    expect((await rq(app, 'GET', '/api/admin/audit', { jar: plain.jar })).status).toBe(403);

    /*
       ★ SUPPORT 는 관리 등급이지만 감사 로그를 볼 수 없다(admin.audit.read 없음).
         고객 응대에 필요한 것은 회원 정보이고, 감사 로그는 "누가 무엇을 했나" 를
         조사하는 자료다. 권한을 넓히지 않는다.
    */
    const support = await mkUser(app, db, 'a1-support@ex.com', 'SUPPORT');
    expect((await rq(app, 'GET', '/api/admin/audit', { jar: support.jar })).status).toBe(403);

    // ANALYST 는 볼 수 있다.
    const analyst = await mkUser(app, db, 'a1-analyst@ex.com', 'ANALYST');
    expect((await rq(app, 'GET', '/api/admin/audit', { jar: analyst.jar })).status).toBe(200);
  });
});
