import { describe, it, expect } from 'vitest';
import { SqliteAdminRepoAdapter } from '../db/admin-repo-contract';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { Hono } from 'hono';
import { AuthService, MailSink } from '@quantumtrade/auth';
import { openDb } from '../db/sqlite';
import { SqliteUserRepository, SqliteSessionRepository, SqliteAuditRepository, SqliteTokenRepository } from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { SqliteAdminRepo } from '../db/admin-repos';
import { createAuthRouter } from '../auth-routes';
import { createAdminRouter } from '../admin/admin-routes';

const ORIGIN = 'http://localhost:5173';

function build(posture?: { mode: string; liveTradingEnabled: boolean; killSwitch: boolean }) {
  const db = openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    mail: new MailSink(),
  });
  const repo = new SqliteAdminRepo(db);
  repo.seedKill('global_live_trading', null, true);
  repo.seedGate({ key: 'controlled-live-order', phase: 'Phase3', description: 'Controlled Live Order', status: 'NOT_EXECUTED', productionRequired: true });
  repo.seedFlag('ai_enabled', false, 'AI');
  const app = new Hono();
  app.route('/api', createAuthRouter({ service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN] }));
  app.route('/api', createAdminRouter({
    service, repo: new SqliteAdminRepoAdapter(repo), csrfKey: 'k', corsOrigins: [ORIGIN],
    cookieName: 'qt_session', health: () => ({ api: 'ok', mfa: 'Not Implemented / Release Gate' }),
    ...(posture ? { posture } : {}),
  }));
  return { app, db, repo };
}

function jarFrom(res: Response) { const out: Record<string, string> = {}; for (const sc of res.headers.getSetCookie?.() ?? []) { const [p] = sc.split(';'); const i = p!.indexOf('='); out[p!.slice(0, i)] = p!.slice(i + 1); } return out; }
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

describe('Phase 5 Admin API security', () => {
  it('[1] normal USER is denied all admin access (403), no-store header set', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'u1@ex.com', 'user');
    const res = await rq(app, 'GET', '/api/admin/overview', { jar: u.jar });
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // unauthenticated → 401
    expect((await rq(app, 'GET', '/api/admin/overview', {})).status).toBe(401);
  });

  it('[2] SUPPORT cannot change roles (missing permission)', async () => {
    const { app, db } = build();
    const support = await mkUser(app, db, 'sup@ex.com', 'SUPPORT');
    const target = await mkUser(app, db, 't1@ex.com', 'user');
    const res = await rq(app, 'PATCH', `/api/admin/users/${target.id}/role`, { jar: support.jar, csrf: true, body: { newRole: 'ANALYST', reason: 'promote please' } });
    expect(res.status).toBe(403);
  });

  it('[3] ADMIN cannot create SUPER_ADMIN (privilege escalation blocked)', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'adm@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 't2@ex.com', 'user');
    const res = await rq(app, 'PATCH', `/api/admin/users/${target.id}/role`, { jar: admin.jar, csrf: true, body: { newRole: 'SUPER_ADMIN', reason: 'escalate attempt' } });
    expect(res.status).toBe(403);
  });

  it('[4] self role change denied', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'adm2@ex.com', 'ADMIN');
    const res = await rq(app, 'PATCH', `/api/admin/users/${admin.id}/role`, { jar: admin.jar, csrf: true, body: { newRole: 'ANALYST', reason: 'self change' } });
    expect(res.status).toBe(403);
  });

  it('[5] cannot disable the last SUPER_ADMIN', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'sa@ex.com', 'SUPER_ADMIN');
    const res = await rq(app, 'POST', `/api/admin/users/${sa.id}/disable`, { jar: sa.jar, csrf: true, body: { reason: 'disable last super admin' } });
    expect(res.status).toBe(403);
  });

  it('[6] CSRF failure on mutation', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'adm3@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 't3@ex.com', 'user');
    const res = await rq(app, 'POST', `/api/admin/users/${target.id}/disable`, { jar: admin.jar, body: { reason: 'no csrf token here' } });
    expect(res.status).toBe(403);
  });

  it('[7/11] user detail is redacted (no password hash / secret / token)', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'adm4@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 't4@ex.com', 'user');
    const body = await (await rq(app, 'GET', `/api/admin/users/${target.id}`, { jar: admin.jar })).text();
    expect(body).not.toMatch(/password_hash|passwordHash/);
    expect(body).not.toMatch(/csrf_secret|sessionToken/);
  });

  it('[8] disabled admin session is immediately invalid', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'sa2@ex.com', 'SUPER_ADMIN');
    const admin = await mkUser(app, db, 'adm5@ex.com', 'ADMIN');
    // super admin disables the ADMIN
    expect((await rq(app, 'POST', `/api/admin/users/${admin.id}/disable`, { jar: sa.jar, csrf: true, body: { reason: 'disable admin now' } })).status).toBe(200);
    // the disabled admin's session no longer validates
    expect((await rq(app, 'GET', '/api/admin/overview', { jar: admin.jar })).status).toBe(401);
  });

  it('[12] kill switch requires step-up reauth + optimistic-lock conflict on concurrent edit', async () => {
    const { app, db, repo } = build();
    const admin = await mkUser(app, db, 'adm6@ex.com', 'ADMIN');
    const ks = (repo.listKill() as { id: string; version: number }[])[0]!;
    // without reauth → 403 step-up
    expect((await rq(app, 'PATCH', `/api/admin/kill-switches/${ks.id}`, { jar: admin.jar, csrf: true, body: { scope: 'global_live_trading', active: false, target: null, reason: 'maintenance window', reauth: false, version: ks.version } })).status).toBe(403);
    // with reauth → ok
    expect((await rq(app, 'PATCH', `/api/admin/kill-switches/${ks.id}`, { jar: admin.jar, csrf: true, body: { scope: 'global_live_trading', active: false, target: null, reason: 'maintenance window', reauth: true, version: ks.version } })).status).toBe(200);
    // stale version → 409 conflict
    expect((await rq(app, 'PATCH', `/api/admin/kill-switches/${ks.id}`, { jar: admin.jar, csrf: true, body: { scope: 'global_live_trading', active: true, target: null, reason: 'concurrent edit', reauth: true, version: ks.version } })).status).toBe(409);
  });

  it('[16] release gate cannot be marked PASSED without evidence (no fake pass); ADMIN cannot WAIVE', async () => {
    const { app, db, repo } = build();
    const admin = await mkUser(app, db, 'adm7@ex.com', 'ADMIN');
    const gate = (repo.listGates() as { id: string; version: number }[])[0]!;
    expect((await rq(app, 'PATCH', `/api/admin/release-gates/${gate.id}`, { jar: admin.jar, csrf: true, body: { status: 'PASSED', version: gate.version } })).status).toBe(403);
    expect((await rq(app, 'PATCH', `/api/admin/release-gates/${gate.id}`, { jar: admin.jar, csrf: true, body: { status: 'WAIVED', reason: 'temporary waiver please', expiresAt: Date.now() + 86_400_000, version: gate.version } })).status).toBe(403);
  });

  it('[10] audit export requires the export permission (SUPPORT lacks it)', async () => {
    const { app, db } = build();
    const support = await mkUser(app, db, 'sup2@ex.com', 'SUPPORT');
    expect((await rq(app, 'GET', '/api/admin/audit/export?format=json', { jar: support.jar })).status).toBe(403);
    const analyst = await mkUser(app, db, 'ana@ex.com', 'ANALYST');
    expect((await rq(app, 'GET', '/api/admin/audit/export?format=json', { jar: analyst.jar })).status).toBe(200);
  });

  it('[19] SQL-injection-style search is parameterized (no error, no dump)', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'adm8@ex.com', 'ADMIN');
    const res = await rq(app, 'GET', `/api/admin/users?q=${encodeURIComponent("' OR 1=1; DROP TABLE users;--")}`, { jar: admin.jar });
    expect(res.status).toBe(200);
    // users table still intact
    expect(() => db.prepare('SELECT COUNT(*) FROM users').get()).not.toThrow();
  });

  it('[21] admin API rate limit returns 429 after the per-actor window is exceeded', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'rl@ex.com', 'ADMIN');
    let got429 = false;
    for (let i = 0; i < 130; i++) {
      const res = await rq(app, 'GET', '/api/admin/overview', { jar: admin.jar });
      if (res.status === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });

  it('successful admin action is recorded in append-only admin_actions', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'sa3@ex.com', 'SUPER_ADMIN');
    const target = await mkUser(app, db, 't9@ex.com', 'user');
    await rq(app, 'POST', `/api/admin/users/${target.id}/disable`, { jar: sa.jar, csrf: true, body: { reason: 'policy violation cleanup' } });
    const n = (db.prepare("SELECT COUNT(*) n FROM admin_actions WHERE action='user.disable' AND result='success'").get() as { n: number }).n;
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('[31] /admin/me reports the SERVER view of role + effective permissions, never a secret', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'me-sa@ex.com', 'SUPER_ADMIN');
    const res = await rq(app, 'GET', '/api/admin/me', { jar: sa.jar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string; permissions: string[]; email: string };
    expect(body.role).toBe('SUPER_ADMIN');
    expect(body.permissions).toContain('admin.release_gate.write');
    expect(body.permissions).toContain('admin.audit.read');
    // No credential material may ride along on the identity payload.
    const raw = JSON.stringify(body);
    for (const leak of ['password', 'password_hash', 'csrf', 'secret', 'token', 'qt_session']) {
      expect(raw.toLowerCase()).not.toContain(leak);
    }
  });

  it('[32] /admin/me permission sets actually differ per role (UI cannot be role-blind)', async () => {
    const { app, db } = build();
    const perms = async (email: string, role: string) => {
      const u = await mkUser(app, db, email, role);
      const r = await rq(app, 'GET', '/api/admin/me', { jar: u.jar });
      expect(r.status).toBe(200);
      return new Set(((await r.json()) as { permissions: string[] }).permissions);
    };
    const support = await perms('me-sup@ex.com', 'SUPPORT');
    const analyst = await perms('me-ana@ex.com', 'ANALYST');
    const admin = await perms('me-adm@ex.com', 'ADMIN');
    const superAdmin = await perms('me-sa2@ex.com', 'SUPER_ADMIN');

    expect(support.has('admin.role.write')).toBe(false);
    expect(support.has('admin.audit.read')).toBe(false);
    expect(analyst.has('admin.user.status.write')).toBe(false);
    expect(analyst.has('admin.audit.read')).toBe(true); // export implies read
    expect(admin.has('admin.kill_switch.write')).toBe(true);
    expect(admin.has('admin.ai.policy.write')).toBe(true);

    // The lattice that actually exists: SUPPORT and ANALYST are strict, DIFFERENT subsets of ADMIN,
    // and ADMIN is a subset of SUPER_ADMIN.
    const subset = (a: Set<string>, b: Set<string>) => [...a].every((p) => b.has(p));
    expect(subset(support, admin)).toBe(true);
    expect(subset(analyst, admin)).toBe(true);
    expect(subset(admin, superAdmin)).toBe(true);
    expect(support.size).toBeLessThan(admin.size);
    expect(analyst.size).toBeLessThan(admin.size);
    // SUPPORT and ANALYST differ from each other, so navigation cannot be role-blind.
    expect(subset(support, analyst) && subset(analyst, support)).toBe(false);

    // NOTE: ADMIN and SUPER_ADMIN hold the SAME admin permission set. Their separation is enforced by
    // the invariant layer (canAssignRole blocks ADMIN from granting ADMIN/SUPER_ADMIN), NOT by
    // permissions — so a UI that gates only on permissions cannot distinguish them. Asserted here so
    // the fact is visible rather than assumed.
    expect(admin.size).toBe(superAdmin.size);
  });

  it('[33] a non-admin role gets 403 from /admin/me (default deny)', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'me-user@ex.com', 'user');
    expect((await rq(app, 'GET', '/api/admin/me', { jar: u.jar })).status).toBe(403);
    expect((await rq(app, 'GET', '/api/admin/me', {})).status).toBe(401);
  });

  it('[34] /admin/orders is a real read-only query with filters, paging and a total', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'ord-sa@ex.com', 'SUPER_ADMIN');
    const owner = await mkUser(app, db, 'ord-owner@ex.com', 'user');
    const ins = db.prepare(
      `INSERT INTO orders (internal_order_id,user_id,client_order_id,symbol,side,type,price,quantity,
                           filled_quantity,status,mode,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    ins.run('o1', owner.id, 'c1', 'BTCUSDT', 'buy', 'limit', '68000', '0.01', '0', 'NEW', 'MOCK', 1000, 1000);
    ins.run('o2', owner.id, 'c2', 'ETHUSDT', 'sell', 'market', null, '1', '1', 'FILLED', 'MOCK', 2000, 2000);

    const all = await rq(app, 'GET', '/api/admin/orders', { jar: sa.jar });
    expect(all.status).toBe(200);
    const body = (await all.json()) as { orders: Record<string, unknown>[]; total: number; readOnly: boolean };
    expect(body.total).toBe(2);
    expect(body.readOnly).toBe(true);
    // Most recent first, and the user's email is joined in.
    expect(body.orders[0]!.internal_order_id).toBe('o2');
    expect(body.orders[0]!.user_email).toBe('ord-owner@ex.com');
    // Credential material is not part of the payload.
    expect(Object.keys(body.orders[0]!)).not.toContain('credential_id');

    const filtered = await rq(app, 'GET', '/api/admin/orders?symbol=BTCUSDT', { jar: sa.jar });
    const f = (await filtered.json()) as { orders: unknown[]; total: number };
    expect(f.total).toBe(1);
    expect(f.orders).toHaveLength(1);

    const paged = await rq(app, 'GET', '/api/admin/orders?limit=1&offset=1', { jar: sa.jar });
    const p = (await paged.json()) as { orders: Record<string, unknown>[]; total: number };
    expect(p.total).toBe(2); // total is of the whole match, not the page
    expect(p.orders).toHaveLength(1);
    expect(p.orders[0]!.internal_order_id).toBe('o1');
  });

  it('[35] /admin/positions is a real read-only query; unknown query params are rejected', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'pos-sa@ex.com', 'SUPER_ADMIN');
    const owner = await mkUser(app, db, 'pos-owner@ex.com', 'user');
    db.prepare(
      `INSERT INTO positions (id,user_id,symbol,side,size,entry_price,mark_price,liquidation_price,
                              leverage,margin_mode,unrealized_pnl,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('p1', owner.id, 'BTCUSDT', 'long', '0.5', '67000', '68000', '60000', 10, 'cross', '500', 5000);

    const res = await rq(app, 'GET', '/api/admin/positions', { jar: sa.jar });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { positions: Record<string, unknown>[]; total: number; readOnly: boolean };
    expect(body.total).toBe(1);
    expect(body.readOnly).toBe(true);
    expect(body.positions[0]!.user_email).toBe('pos-owner@ex.com');

    // `.strict()` schema: an unexpected parameter is a 400, not silently ignored.
    expect((await rq(app, 'GET', '/api/admin/positions?bogus=1', { jar: sa.jar })).status).toBe(400);
  });

  it('[36] there is NO admin write path to orders or positions (policy, not permission)', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'nowrite-sa@ex.com', 'SUPER_ADMIN');
    // Even a fully-permitted SUPER_ADMIN with a valid CSRF token cannot reach a mutation route,
    // because none is mounted.
    for (const [method, path] of [
      ['POST', '/api/admin/orders'],
      ['DELETE', '/api/admin/orders/o1'],
      ['PATCH', '/api/admin/orders/o1'],
      ['POST', '/api/admin/orders/o1/cancel'],
      ['POST', '/api/admin/positions/p1/close'],
      ['PATCH', '/api/admin/positions/p1/leverage'],
      ['POST', '/api/admin/withdraw'],
    ] as const) {
      const res = await rq(app, method, path, { jar: sa.jar, csrf: true, body: {} });
      expect([404, 405], `${method} ${path} must not be a working mutation`).toContain(res.status);
    }
  });

  it('[37] order read requires the order permission (ANALYST has it, a plain USER does not)', async () => {
    const { app, db } = build();
    const analyst = await mkUser(app, db, 'ord-analyst@ex.com', 'ANALYST');
    const plain = await mkUser(app, db, 'ord-user@ex.com', 'user');
    expect((await rq(app, 'GET', '/api/admin/orders', { jar: analyst.jar })).status).toBe(200);
    expect((await rq(app, 'GET', '/api/admin/orders', { jar: plain.jar })).status).toBe(403);
    expect((await rq(app, 'GET', '/api/admin/positions', { jar: plain.jar })).status).toBe(403);
  });

  it('[38] /admin/ai/usage returns real run history and NEVER prompt or response text', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'ai-sa@ex.com', 'SUPER_ADMIN');
    const owner = await mkUser(app, db, 'ai-owner@ex.com', 'user');
    const secret = 'THIS_IS_THE_USER_PROMPT_TEXT';
    db.prepare('INSERT INTO ai_conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run('conv1', owner.id, 'c', 1000, 1000);
    db.prepare(
      `INSERT INTO ai_messages (id,conversation_id,user_id,role,content,created_at) VALUES (?,?,?,?,?,?)`,
    ).run('m1', 'conv1', owner.id, 'user', secret, 1000);
    db.prepare(
      `INSERT INTO ai_runs (id,conversation_id,user_id,provider,model,prompt_version,fallback_used,status,correlation_id,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run('run1', 'conv1', owner.id, 'mock', 'mock-1', 'v1', 1, 'ok', 'corr1', 2000);
    db.prepare(
      `INSERT INTO ai_usage_records (id,user_id,conversation_id,correlation_id,model,fallback_used,input_tokens,output_tokens,estimated_cost_micros,at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run('u1', owner.id, 'conv1', 'corr1', 'mock-1', 1, 100, 50, 1234, 2000);
    db.prepare('INSERT INTO ai_tool_calls (id,run_id,user_id,tool_name,args_json,at) VALUES (?,?,?,?,?,?)')
      .run('tc1', 'run1', owner.id, 'get_market_snapshot', '{}', 2000);

    const res = await rq(app, 'GET', '/api/admin/ai/usage', { jar: sa.jar });
    expect(res.status).toBe(200);
    const raw = await res.text();
    // The operational signal is present…
    const body = JSON.parse(raw) as {
      runs: Record<string, unknown>[]; total: number; readOnly: boolean; promptRedacted: boolean;
      summary: Record<string, number | null>;
    };
    expect(body.total).toBe(1);
    expect(body.readOnly).toBe(true);
    expect(body.promptRedacted).toBe(true);
    expect(body.runs[0]!.model).toBe('mock-1');
    expect(body.runs[0]!.user_email).toBe('ai-owner@ex.com');
    expect(body.runs[0]!.tool_calls).toBe(1);
    expect(body.runs[0]!.input_tokens).toBe(100);
    expect(body.runs[0]!.estimated_cost_micros).toBe(1234);
    expect(body.summary.records).toBe(1);
    // …and the conversation text is NOT, anywhere in the response.
    expect(raw).not.toContain(secret);
    expect(raw.toLowerCase()).not.toContain('content');
  });

  it('[39] /admin/exchange-connections masks the credential and never joins the secret table', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'gw-sa@ex.com', 'SUPER_ADMIN');
    const owner = await mkUser(app, db, 'gw-owner@ex.com', 'user');
    const secretBlob = 'ENCRYPTED_SECRET_MATERIAL_DO_NOT_LEAK';
    const cols = (db.prepare('PRAGMA table_info(exchange_credentials)').all() as { name: string }[]).map((c) => c.name);
    // Insert a credential using whatever the schema actually names its columns, then a connection.
    const values: Record<string, unknown> = {
      id: 'cred-abcd1234', user_id: owner.id, exchange: 'bitmart', label: 'l',
      access_key_masked: '****1234', created_at: 1000, updated_at: 1000, status: 'active',
    };
    for (const c of cols) if (!(c in values)) values[c] = secretBlob;
    const names = cols.filter((c) => c in values);
    db.prepare(`INSERT INTO exchange_credentials (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`)
      .run(...names.map((n) => values[n]));
    db.prepare(
      'INSERT INTO exchange_connections (id,user_id,credential_id,mode,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ).run('conn1', owner.id, 'cred-abcd1234', 'BITMART_LIVE_READ_ONLY', 'connected', 1000, 2000);

    const res = await rq(app, 'GET', '/api/admin/exchange-connections', { jar: sa.jar });
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { connections: Record<string, unknown>[]; total: number; readOnly: boolean };
    expect(body.total).toBe(1);
    expect(body.readOnly).toBe(true);
    // Only a masked tail, never the full credential id and never the secret material.
    expect(body.connections[0]!.credential_ref).toBe('…1234');
    expect(raw).not.toContain(secretBlob);
    expect(raw).not.toContain('cred-abcd1234');
  });

  it('[40] AI/gateway reads are permission-gated; AI order execution still has no route', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'gw2-sa@ex.com', 'SUPER_ADMIN');
    const plain = await mkUser(app, db, 'gw2-user@ex.com', 'user');
    expect((await rq(app, 'GET', '/api/admin/ai/usage', { jar: plain.jar })).status).toBe(403);
    expect((await rq(app, 'GET', '/api/admin/exchange-connections', { jar: plain.jar })).status).toBe(403);
    expect((await rq(app, 'GET', '/api/admin/ai/usage?bogus=1', { jar: sa.jar })).status).toBe(400);

    // ASSERTION CHANGED (Prompt 5 / B7 — ADM-API-08). `/admin/gateway/resync` and `/admin/gateway/reconnect`
    // previously did not exist, and this test pinned their absence. They now exist as guarded controls over
    // the LOCAL MOCK gateway state only, so "must be 404" is no longer the accurate statement of the
    // contract — it would now be asserting the absence of a feature that deliberately exists.
    //
    // What is asserted instead is the property that actually matters and that a 404 was only a proxy for:
    // an EMPTY body cannot mutate anything. A fully-permitted SUPER_ADMIN with a valid CSRF token still
    // gets 422 (no reason / no reauth / no version / no idempotency key), which is a stronger statement
    // than "the route is missing" because it also survives the route existing. The full contract
    // (permission, CSRF, step-up, version, idempotency, DISABLED_BY_POLICY) is covered in
    // admin-ops-api.test.ts [W1]–[W7].
    for (const path of ['/api/admin/gateway/resync', '/api/admin/gateway/reconnect'] as const) {
      const r = await rq(app, 'POST', path, { jar: sa.jar, csrf: true, body: {} });
      expect(r.status, `POST ${path} must refuse an empty body`).toBe(422);
    }
    // A read-only admin role cannot reach the control at all.
    const analyst = await mkUser(app, db, 'gw2-analyst@ex.com', 'ANALYST');
    expect((await rq(app, 'POST', '/api/admin/gateway/resync', { jar: analyst.jar, csrf: true, body: {} })).status).toBe(403);

    // AI order execution remains absent: no endpoint, for any role.
    for (const [method, path] of [
      ['POST', '/api/admin/ai/execute-order'],
      ['POST', '/api/admin/ai/orders'],
    ] as const) {
      const r = await rq(app, method, path, { jar: sa.jar, csrf: true, body: {} });
      expect([404, 405], `${method} ${path}`).toContain(r.status);
    }
  });

  it('[41] /admin/me reports capabilities that DO separate ADMIN from SUPER_ADMIN', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'cap-admin@ex.com', 'ADMIN');
    const sa = await mkUser(app, db, 'cap-sa@ex.com', 'SUPER_ADMIN');
    const caps = async (jar: Record<string, string>) => {
      const r = await rq(app, 'GET', '/api/admin/me', { jar });
      expect(r.status).toBe(200);
      const b = (await r.json()) as { permissions: string[]; capabilities: string[] };
      return b;
    };
    const a = await caps(admin.jar);
    const s = await caps(sa.jar);

    // The documented SUPER_ADMIN-only operations (docs/PHASE5-02) are reported as capabilities.
    expect(s.capabilities).toContain('admin.roles.assignPrivileged');
    expect(s.capabilities).toContain('admin.release.waive');
    expect(a.capabilities).not.toContain('admin.roles.assignPrivileged');
    expect(a.capabilities).not.toContain('admin.release.waive');

    // …while the permission sets remain identical, which is exactly why capabilities are needed.
    expect(new Set(a.permissions)).toEqual(new Set(s.permissions));
  });

  it('[42] the capabilities match what the server actually enforces, not just what it advertises', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'cap2-admin@ex.com', 'ADMIN');
    const target = await mkUser(app, db, 'cap2-target@ex.com', 'user');
    // ADMIN advertises no `assignPrivileged` capability — and the mutation is genuinely refused.
    const res = await rq(app, 'PATCH', `/api/admin/users/${target.id}/role`, {
      jar: admin.jar, csrf: true, body: { newRole: 'SUPER_ADMIN', reason: 'escalation attempt' },
    });
    expect(res.status).toBe(403);
  });
});

/**
 * Added 2026-08-03.
 *
 * `/admin/overview` reported `liveMode:'BITMART_LIVE_READ_ONLY'`, `liveTradingEnabled:false` and
 * `killSwitch:true` as **hardcoded literals**. An operator opening the dashboard to check whether the kill
 * switch was engaged would have been told "yes" regardless of the deployment's actual configuration. And
 * the endpoint returned no user counts at all, so a dashboard could only have invented them.
 */
describe('ADM-POSTURE — the dashboard reports the real deployment posture', () => {
  it('[1] a live-trading deployment is reported as live', async () => {
    const { app, db } = build({ mode: 'BITMART_LIVE', liveTradingEnabled: true, killSwitch: false });
    const { jar } = await mkUser(app, db, 'p1@ex.com', 'SUPER_ADMIN');
    const r = await rq(app, 'GET', '/api/admin/overview', { jar });
    const b = await r.json() as { exchange: { liveMode: string }; trading: { liveTradingEnabled: unknown; killSwitch: unknown; postureSource: string } };
    // Would have been false/true/READ_ONLY before the fix, no matter what was configured.
    expect(b.exchange.liveMode).toBe('BITMART_LIVE');
    expect(b.trading.liveTradingEnabled).toBe(true);
    expect(b.trading.killSwitch).toBe(false);
    expect(b.trading.postureSource).toBe('deployment');
  });

  it('[2] a read-only deployment is reported as read-only', async () => {
    const { app, db } = build({ mode: 'BITMART_LIVE_READ_ONLY', liveTradingEnabled: false, killSwitch: true });
    const { jar } = await mkUser(app, db, 'p2@ex.com', 'SUPER_ADMIN');
    const b = await (await rq(app, 'GET', '/api/admin/overview', { jar })).json() as { trading: { killSwitch: unknown } };
    expect(b.trading.killSwitch).toBe(true);
  });

  it('[3] with no posture injected it reports Unavailable, never a default of false', async () => {
    const { app, db } = build();
    const { jar } = await mkUser(app, db, 'p3@ex.com', 'SUPER_ADMIN');
    const b = await (await rq(app, 'GET', '/api/admin/overview', { jar })).json() as { trading: { liveTradingEnabled: unknown; killSwitch: unknown; postureSource: string } };
    // `false` would read as "live trading is off", which is a claim we cannot make without the value.
    expect(b.trading.liveTradingEnabled).toBe('Unavailable');
    expect(b.trading.killSwitch).toBe('Unavailable');
    expect(b.trading.postureSource).toBe('unavailable');
  });
});

describe('ADM-COUNTS — real user counts', () => {
  it('[1] overview carries a total and consistent breakdowns', async () => {
    const { app, db } = build();
    const { jar } = await mkUser(app, db, 'p4@ex.com', 'SUPER_ADMIN');
    const b = await (await rq(app, 'GET', '/api/admin/overview', { jar })).json() as {
      users: { total: number; byStatus: Record<string, number>; byRole: Record<string, number> };
    };
    expect(b.users.total).toBeGreaterThan(0);
    // The breakdowns come from one grouped scan, so they must add up to the total exactly.
    const sumStatus = Object.values(b.users.byStatus).reduce((a, n) => a + n, 0);
    const sumRole = Object.values(b.users.byRole).reduce((a, n) => a + n, 0);
    expect(sumStatus).toBe(b.users.total);
    expect(sumRole).toBe(b.users.total);
  });

  it('[2] /admin/users total is the filtered count, not the page size', async () => {
    const { app, db } = build();
    const { jar } = await mkUser(app, db, 'p5@ex.com', 'SUPER_ADMIN');
    for (let i = 0; i < 3; i += 1) await mkUser(app, db, `bulk${i}@ex.com`, 'user');

    const b = await (await rq(app, 'GET', '/api/admin/users?limit=1', { jar })).json() as {
      users: unknown[]; total: number; page: { limit: number; offset: number; hasMore: boolean };
    };
    expect(b.users).toHaveLength(1);
    // Counting the page would report 1 as the total and break every pager.
    expect(b.total).toBeGreaterThan(1);
    expect(b.page.hasMore).toBe(true);
  });

  it('[3] a role filter narrows the total as well as the rows', async () => {
    const { app, db } = build();
    const { jar } = await mkUser(app, db, 'p6@ex.com', 'SUPER_ADMIN');
    await mkUser(app, db, 'plain@ex.com', 'user');
    const b = await (await rq(app, 'GET', '/api/admin/users?limit=50&role=SUPER_ADMIN', { jar })).json() as {
      users: unknown[]; total: number;
    };
    expect(b.total).toBe(b.users.length);
    expect(b.total).toBeGreaterThanOrEqual(1);
  });

  it('[4] the last page reports hasMore false', async () => {
    const { app, db } = build();
    const { jar } = await mkUser(app, db, 'p7@ex.com', 'SUPER_ADMIN');
    // 200 is the schema maximum; 500 is rejected, which is the correct behaviour and not what this checks.
    const b = await (await rq(app, 'GET', '/api/admin/users?limit=200', { jar })).json() as {
      users: unknown[]; total: number; page: { hasMore: boolean };
    };
    expect(b.page.hasMore).toBe(false);
    expect(b.users.length).toBe(b.total);
  });

  it('[5] a limit above the schema maximum is rejected, not silently clamped', async () => {
    const { app, db } = build();
    const { jar } = await mkUser(app, db, 'p8@ex.com', 'SUPER_ADMIN');
    // Silently clamping would make a caller believe it received everything.
    expect((await rq(app, 'GET', '/api/admin/users?limit=500', { jar })).status).toBe(400);
    expect((await rq(app, 'GET', '/api/admin/users?bogus=1', { jar })).status).toBe(400);
  });
});
