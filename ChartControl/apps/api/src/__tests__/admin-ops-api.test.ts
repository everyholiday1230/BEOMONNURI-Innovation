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

/**
 * Prompt 5 / B7 + B8 — ADM-API-07 (gateway metrics), ADM-API-08 (local mock gateway control),
 * ADM-API-09 (incident ack), ADM-API-11 (AI policy write), and the `/admin/ai/errors` redaction contract
 * the B8 client consumes.
 *
 * Same harness as admin-api.test.ts: real in-memory database, real AuthService, real routers, cookie jar.
 */

const ORIGIN = 'http://localhost:5173';

function build(opts: { gatewayControllable?: boolean } = {}) {
  const db = openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    mail: new MailSink(),
  });
  const repo = new SqliteAdminRepo(db);
  const app = new Hono();
  app.route('/api', createAuthRouter({ service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN] }));
  app.route('/api', createAdminRouter({ service, repo: new SqliteAdminRepoAdapter(repo), csrfKey: 'k', corsOrigins: [ORIGIN], cookieName: 'qt_session',
    health: () => ({ api: 'ok', bitmartWs: 'Not Connected' }),
    gatewayControl: { controllable: opts.gatewayControllable ?? true, target: 'LOCAL_MOCK' },
  }));
  return { app, db, repo };
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

// ===========================================================================
// ADM-API-07 — gateway stream metrics
// ===========================================================================
describe('ADM-API-07 GET /admin/gateway/metrics', () => {
  it('[G1] 401 unauthenticated; 403 for a non-admin role', async () => {
    const { app, db } = build();
    expect((await rq(app, 'GET', '/api/admin/gateway/metrics', {})).status).toBe(401);
    const plain = await mkUser(app, db, 'g1-user@ex.com', 'user');
    expect((await rq(app, 'GET', '/api/admin/gateway/metrics', { jar: plain.jar })).status).toBe(403);
  });

  it('[G2] reports LOCAL DB rows only, names its source, and never claims a real gateway host', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'g2-sa@ex.com', 'SUPER_ADMIN');
    const owner = await mkUser(app, db, 'g2-owner@ex.com', 'user');
    const t = Date.now();
    const ins = db.prepare('INSERT INTO exchange_websocket_sessions (id,user_id,status,connected_at,disconnected_at,reconnects) VALUES (?,?,?,?,?,?)');
    ins.run('ws1', owner.id, 'connected', t - 1000, null, 2);
    ins.run('ws2', owner.id, 'disconnected', t - 90_000, t - 5000, 1);

    const res = await rq(app, 'GET', '/api/admin/gateway/metrics', { jar: sa.jar });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const b = (await res.json()) as {
      source: { kind: string; table: string; realGatewayHost: string };
      sessions: { total: number; connected: number; disconnected: number; reconnects: number; byStatus: { status: string; count: number }[] };
      freshness: { ageMs: number; stale: boolean; state: string; staleThresholdMs: number };
      unavailable: string[];
      mockGateway: { status: string; version: number };
      readOnly: boolean;
    };
    expect(b.source.kind).toBe('LOCAL_DB');
    expect(b.source.table).toBe('exchange_websocket_sessions');
    expect(b.source.realGatewayHost).toBe('Not Connected');
    expect(b.sessions.total).toBe(2);
    expect(b.sessions.connected).toBe(1);
    expect(b.sessions.disconnected).toBe(1);
    expect(b.sessions.reconnects).toBe(3);
    expect(b.sessions.byStatus.length).toBe(2);
    // Freshness is computed from the newest recorded timestamp, not assumed.
    expect(b.freshness.state).toBe('FRESH');
    expect(b.freshness.stale).toBe(false);
    expect(b.freshness.ageMs).toBeLessThan(b.freshness.staleThresholdMs);
    // Unproxied gateway metrics are named as unavailable rather than reported as zero.
    expect(b.unavailable).toContain('messageRate');
    expect(b.unavailable).toContain('queueDepth');
    expect(b.readOnly).toBe(true);
  });

  it('[G3] an EMPTY table reports state EMPTY with stale:null — not FRESH and not STALE', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'g3-sa@ex.com', 'SUPER_ADMIN');
    const b = (await (await rq(app, 'GET', '/api/admin/gateway/metrics', { jar: sa.jar })).json()) as {
      sessions: { total: number }; freshness: { state: string; stale: boolean | null; ageMs: number | null };
    };
    expect(b.sessions.total).toBe(0);
    expect(b.freshness.state).toBe('EMPTY');
    // Reporting `false` here would claim fresh data exists; `true` would claim stale data exists.
    expect(b.freshness.stale).toBeNull();
    expect(b.freshness.ageMs).toBeNull();
  });

  it('[G4] stale rows are reported as STALE', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'g4-sa@ex.com', 'SUPER_ADMIN');
    const owner = await mkUser(app, db, 'g4-owner@ex.com', 'user');
    db.prepare('INSERT INTO exchange_websocket_sessions (id,user_id,status,connected_at,disconnected_at,reconnects) VALUES (?,?,?,?,?,?)')
      .run('ws-old', owner.id, 'connected', Date.now() - 10 * 60_000, null, 0);
    const b = (await (await rq(app, 'GET', '/api/admin/gateway/metrics', { jar: sa.jar })).json()) as { freshness: { state: string; stale: boolean } };
    expect(b.freshness.state).toBe('STALE');
    expect(b.freshness.stale).toBe(true);
  });

  it('[G5] an unknown query parameter is a 400', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'g5-sa@ex.com', 'SUPER_ADMIN');
    expect((await rq(app, 'GET', '/api/admin/gateway/metrics?limit=5', { jar: sa.jar })).status).toBe(400);
  });
});

// ===========================================================================
// ADM-API-08 — local MOCK gateway control
// ===========================================================================
describe('ADM-API-08 POST /admin/gateway/{resync,reconnect}', () => {
  const body = (version: number, key: string, extra: Record<string, unknown> = {}) => ({
    reason: 'operator requested a local mock resync', reauth: true, version, idempotencyKey: key, ...extra,
  });

  it('[W1] 401 unauthenticated; 403 for a non-admin; 403 for read-only admin roles', async () => {
    const { app, db } = build();
    expect((await rq(app, 'POST', '/api/admin/gateway/resync', { body: body(0, 'key-unauth-1') })).status).toBe(401);
    const plain = await mkUser(app, db, 'w1-user@ex.com', 'user');
    expect((await rq(app, 'POST', '/api/admin/gateway/resync', { jar: plain.jar, csrf: true, body: body(0, 'key-user-1') })).status).toBe(403);
    // SUPPORT and ANALYST hold admin.exchange.READ but not admin.gateway.WRITE: a read permission must
    // never be sufficient for a control action.
    for (const role of ['SUPPORT', 'ANALYST'] as const) {
      const u = await mkUser(app, db, `w1-${role.toLowerCase()}@ex.com`, role);
      expect((await rq(app, 'GET', '/api/admin/gateway/metrics', { jar: u.jar })).status, `${role} read`).toBe(200);
      const res = await rq(app, 'POST', '/api/admin/gateway/reconnect', { jar: u.jar, csrf: true, body: body(0, `key-${role}-1`) });
      expect(res.status, `${role} write`).toBe(403);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain('admin.gateway.write');
    }
  });

  it('[W2] 403 CSRF_FAILED without a token; 403 STEP_UP_REQUIRED without reauth', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'w2-admin@ex.com', 'ADMIN');
    const noCsrf = await rq(app, 'POST', '/api/admin/gateway/resync', { jar: admin.jar, body: body(0, 'key-w2-a') });
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as { error: { code: string } }).error.code).toBe('CSRF_FAILED');

    const noStepUp = await rq(app, 'POST', '/api/admin/gateway/resync', { jar: admin.jar, csrf: true, body: body(0, 'key-w2-b', { reauth: false }) });
    expect(noStepUp.status).toBe(403);
    expect(((await noStepUp.json()) as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');
  });

  it('[W3] 422 on invalid input (missing idempotency key) without echoing the input', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'w3-admin@ex.com', 'ADMIN');
    const marker = 'INJECTED_W3_MARKER';
    const res = await rq(app, 'POST', '/api/admin/gateway/resync', {
      jar: admin.jar, csrf: true, body: { reason: 'no key supplied here', reauth: true, version: 0, extra: marker },
    });
    expect(res.status).toBe(422);
    const raw = await res.text();
    expect(raw).not.toContain(marker);
    // A too-short key is refused rather than accepted as "good enough".
    expect((await rq(app, 'POST', '/api/admin/gateway/resync', { jar: admin.jar, csrf: true, body: body(0, 'short') })).status).toBe(422);
  });

  it('[W4] applies to the LOCAL MOCK only, bumps the version, and is audited', async () => {
    const { app, db, repo } = build();
    const admin = await mkUser(app, db, 'w4-admin@ex.com', 'ADMIN');
    const before = repo.mockGatewayState() as { version: number; resync_count: number };
    const res = await rq(app, 'POST', '/api/admin/gateway/resync', { jar: admin.jar, csrf: true, body: body(before.version, 'key-w4-resync-1') });
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ok: boolean; applied: boolean; result: string; target: string; state: { version: number; resync_count: number; status: string }; note: string };
    expect(b.ok).toBe(true);
    expect(b.applied).toBe(true);
    expect(b.result).toBe('APPLIED_TO_LOCAL_MOCK');
    expect(b.target).toBe('LOCAL_MOCK');
    expect(b.state.resync_count).toBe(before.resync_count + 1);
    expect(b.state.version).toBe(before.version + 1);
    // The response cannot be mistaken for a real reconnect.
    expect(b.note).toContain('LOCAL MOCK');
    const entry = db.prepare("SELECT actor_user_id, action, result FROM admin_actions WHERE action='gateway.resync' ORDER BY at DESC LIMIT 1").get() as { actor_user_id: string; result: string };
    expect(entry.actor_user_id).toBe(admin.id);
    expect(entry.result).toBe('success');

    // reconnect is a distinct counter on the same row.
    const mid = repo.mockGatewayState() as { version: number };
    const rec = await rq(app, 'POST', '/api/admin/gateway/reconnect', { jar: admin.jar, csrf: true, body: body(mid.version, 'key-w4-reconnect-1') });
    expect(rec.status).toBe(200);
    expect(((await rec.json()) as { state: { reconnect_count: number; status: string } }).state.reconnect_count).toBe(1);
  });

  it('[W5] a stale version is a 409, and the same idempotency key replays the first outcome', async () => {
    const { app, db, repo } = build();
    const admin = await mkUser(app, db, 'w5-admin@ex.com', 'ADMIN');
    const v0 = (repo.mockGatewayState() as { version: number }).version;
    const first = await rq(app, 'POST', '/api/admin/gateway/resync', { jar: admin.jar, csrf: true, body: body(v0, 'key-w5-alpha') });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { state: { version: number } };

    // Same key → the STORED outcome, and the counter is NOT incremented again.
    const replay = await rq(app, 'POST', '/api/admin/gateway/resync', { jar: admin.jar, csrf: true, body: body(v0, 'key-w5-alpha') });
    expect(replay.status).toBe(200);
    const r = (await replay.json()) as { idempotentReplay: boolean; state: { version: number; resync_count: number } };
    expect(r.idempotentReplay).toBe(true);
    expect(r.state.version).toBe(firstBody.state.version);
    expect((repo.mockGatewayState() as { resync_count: number }).resync_count).toBe(1);

    // A NEW key with the now-stale version is a genuine conflict.
    const stale = await rq(app, 'POST', '/api/admin/gateway/resync', { jar: admin.jar, csrf: true, body: body(v0, 'key-w5-beta') });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('CONFLICT');
  });

  it('[W6] with no controllable local mock the answer is DISABLED_BY_POLICY, never a fake reconnect', async () => {
    const { app, db, repo } = build({ gatewayControllable: false });
    const admin = await mkUser(app, db, 'w6-admin@ex.com', 'ADMIN');
    const before = repo.mockGatewayState() as { version: number; reconnect_count: number };
    const res = await rq(app, 'POST', '/api/admin/gateway/reconnect', { jar: admin.jar, csrf: true, body: body(before.version, 'key-w6-one') });
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ok: boolean; applied: boolean; result: string; target: string };
    expect(b.ok).toBe(false);
    expect(b.applied).toBe(false);
    expect(b.result).toBe('DISABLED_BY_POLICY');
    expect(b.target).toBe('NOT_CONNECTED');
    // Nothing was mutated.
    expect((repo.mockGatewayState() as { reconnect_count: number; version: number }).reconnect_count).toBe(before.reconnect_count);
    expect((repo.mockGatewayState() as { version: number }).version).toBe(before.version);
    // The refusal is still audited, so an operator's attempt is on the record.
    const n = (db.prepare("SELECT COUNT(*) n FROM admin_actions WHERE action='gateway.reconnect' AND result='failure'").get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it('[W7] no route reaches a REAL exchange or gateway host', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'w7-sa@ex.com', 'SUPER_ADMIN');
    // Control endpoints that would imply a real connection do not exist.
    for (const [method, path] of [
      ['POST', '/api/admin/gateway/connect'],
      ['POST', '/api/admin/gateway/disconnect'],
      ['POST', '/api/admin/gateway/subscribe'],
      ['POST', '/api/admin/exchange/reconnect'],
      ['POST', '/api/admin/ai/execute-order'],
    ] as const) {
      const r = await rq(app, method, path, { jar: sa.jar, csrf: true, body: {} });
      expect([404, 405], `${method} ${path}`).toContain(r.status);
    }
    // And what the mock endpoint returns names its target explicitly.
    const metrics = (await (await rq(app, 'GET', '/api/admin/gateway/metrics', { jar: sa.jar })).json()) as { control: { controllable: boolean; target: string } };
    expect(metrics.control.target).toBe('LOCAL_MOCK');
  });
});

// ===========================================================================
// ADM-API-09 — incident acknowledgement
// ===========================================================================
describe('ADM-API-09 POST /admin/incidents/:id/ack', () => {
  const mkIncident = async (app: App, jar: Record<string, string>) => {
    const res = await rq(app, 'POST', '/api/admin/incidents', {
      jar, csrf: true, body: { title: 'gateway lag', description: 'latency spike', severity: 'SEV3', service: 'api' },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };

  it('[I1] 401 unauthenticated; 403 for a non-admin; 403 for a role without incident.write', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'i1-admin@ex.com', 'ADMIN');
    const id = await mkIncident(app, admin.jar);
    expect((await rq(app, 'POST', `/api/admin/incidents/${id}/ack`, { body: { version: 0 } })).status).toBe(401);
    const plain = await mkUser(app, db, 'i1-user@ex.com', 'user');
    expect((await rq(app, 'POST', `/api/admin/incidents/${id}/ack`, { jar: plain.jar, csrf: true, body: { version: 0 } })).status).toBe(403);
    for (const role of ['SUPPORT', 'ANALYST'] as const) {
      const u = await mkUser(app, db, `i1-${role.toLowerCase()}@ex.com`, role);
      const res = await rq(app, 'POST', `/api/admin/incidents/${id}/ack`, { jar: u.jar, csrf: true, body: { version: 0 } });
      expect(res.status, role).toBe(403);
    }
  });

  it('[I2] 403 CSRF_FAILED without a token', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'i2-admin@ex.com', 'ADMIN');
    const id = await mkIncident(app, admin.jar);
    const res = await rq(app, 'POST', `/api/admin/incidents/${id}/ack`, { jar: admin.jar, body: { version: 0 } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('CSRF_FAILED');
  });

  it('[I3] 422 without a version; 404 for an unknown incident', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'i3-admin@ex.com', 'ADMIN');
    const id = await mkIncident(app, admin.jar);
    const bad = await rq(app, 'POST', `/api/admin/incidents/${id}/ack`, { jar: admin.jar, csrf: true, body: { note: 'no version' } });
    expect(bad.status).toBe(422);
    expect(await bad.text()).not.toContain('no version');
    expect((await rq(app, 'POST', '/api/admin/incidents/does-not-exist/ack', { jar: admin.jar, csrf: true, body: { version: 0 } })).status).toBe(404);
  });

  it('[I4] records actor + time, bumps the version, writes an event, and is audited', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'i4-admin@ex.com', 'ADMIN');
    const id = await mkIncident(app, admin.jar);
    const res = await rq(app, 'POST', `/api/admin/incidents/${id}/ack`, { jar: admin.jar, csrf: true, body: { version: 0, note: 'on it' } });
    expect(res.status).toBe(200);
    const b = (await res.json()) as { ok: boolean; changed: boolean; acknowledgedAt: number; acknowledgedBy: string; version: number };
    expect(b.changed).toBe(true);
    expect(b.acknowledgedBy).toBe(admin.id);
    expect(b.acknowledgedAt).toBeGreaterThan(0);
    expect(b.version).toBe(1);

    const row = db.prepare('SELECT acknowledged_at, acknowledged_by, status, version FROM incidents WHERE id=?').get(id) as { acknowledged_at: number; acknowledged_by: string; status: string; version: number };
    expect(row.acknowledged_by).toBe(admin.id);
    // Acknowledgement is NOT a state transition: the incident is still OPEN.
    expect(row.status).toBe('OPEN');
    expect(row.version).toBe(1);
    const ev = (db.prepare("SELECT COUNT(*) n FROM incident_events WHERE incident_id=? AND kind='acknowledged'").get(id) as { n: number }).n;
    expect(ev).toBe(1);
    const aud = (db.prepare("SELECT COUNT(*) n FROM admin_actions WHERE action='incident.ack' AND result='success'").get() as { n: number }).n;
    expect(aud).toBe(1);
  });

  it('[I5] a stale version is a 409, checked BEFORE the already-acked branch', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'i5-admin@ex.com', 'ADMIN');
    const id = await mkIncident(app, admin.jar);
    expect((await rq(app, 'POST', `/api/admin/incidents/${id}/ack`, { jar: admin.jar, csrf: true, body: { version: 0 } })).status).toBe(200);
    // Version 0 is now stale (the ack bumped it to 1).
    const stale = await rq(app, 'POST', `/api/admin/incidents/${id}/ack`, { jar: admin.jar, csrf: true, body: { version: 0 } });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('CONFLICT');
  });

  it('[I6] acking twice with the CURRENT version is idempotent and honestly reports changed:false', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'i6-admin@ex.com', 'ADMIN');
    const second = await mkUser(app, db, 'i6-admin2@ex.com', 'ADMIN');
    const id = await mkIncident(app, admin.jar);
    const first = (await (await rq(app, 'POST', `/api/admin/incidents/${id}/ack`, { jar: admin.jar, csrf: true, body: { version: 0 } })).json()) as { acknowledgedAt: number; version: number };

    // A DIFFERENT admin acking an already-acknowledged incident: 200, changed:false, and the FIRST
    // acknowledger/timestamp are preserved rather than overwritten.
    const again = await rq(app, 'POST', `/api/admin/incidents/${id}/ack`, { jar: second.jar, csrf: true, body: { version: first.version } });
    expect(again.status).toBe(200);
    const b = (await again.json()) as { changed: boolean; acknowledgedBy: string; acknowledgedAt: number; version: number };
    expect(b.changed).toBe(false);
    expect(b.acknowledgedBy).toBe(admin.id);
    expect(b.acknowledgedAt).toBe(first.acknowledgedAt);
    // A no-op does NOT bump the version (that would invalidate every other console for nothing)…
    expect(b.version).toBe(first.version);
    // …and does not add a second audit entry or event.
    expect((db.prepare("SELECT COUNT(*) n FROM admin_actions WHERE action='incident.ack'").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT COUNT(*) n FROM incident_events WHERE incident_id=? AND kind='acknowledged'").get(id) as { n: number }).n).toBe(1);
  });
});

// ===========================================================================
// ADM-API-11 — AI policy
// ===========================================================================
describe('ADM-API-11 GET/PUT /admin/ai/policy', () => {
  const PROMPT = 'You are QuantumTrade AI. NEVER place orders. INTERNAL_PROMPT_MARKER_7788';
  const body = (version: number, extra: Record<string, unknown> = {}) => ({
    maxOutputTokens: 2048, dailyCostLimitMicros: 5_000_000, allowedTools: ['get_market_snapshot'],
    systemPrompt: PROMPT, promptVersion: 'v2', reason: 'tighten the AI output budget', reauth: true, version, ...extra,
  });

  it('[P1] 401 unauthenticated; 403 for a non-admin; 403 for a role without ai.policy.write', async () => {
    const { app, db } = build();
    expect((await rq(app, 'PUT', '/api/admin/ai/policy', { body: body(0) })).status).toBe(401);
    const plain = await mkUser(app, db, 'p1-user@ex.com', 'user');
    expect((await rq(app, 'PUT', '/api/admin/ai/policy', { jar: plain.jar, csrf: true, body: body(0) })).status).toBe(403);
    for (const role of ['SUPPORT', 'ANALYST'] as const) {
      const u = await mkUser(app, db, `p1-${role.toLowerCase()}@ex.com`, role);
      // The READ is permitted for these roles; the WRITE is not.
      expect((await rq(app, 'GET', '/api/admin/ai/policy', { jar: u.jar })).status, `${role} read`).toBe(200);
      const res = await rq(app, 'PUT', '/api/admin/ai/policy', { jar: u.jar, csrf: true, body: body(0) });
      expect(res.status, `${role} write`).toBe(403);
      expect(((await res.json()) as { error: { message: string } }).error.message).toContain('admin.ai.policy.write');
    }
  });

  it('[P2] 403 CSRF_FAILED without a token; 403 STEP_UP_REQUIRED without reauth', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'p2-admin@ex.com', 'ADMIN');
    const noCsrf = await rq(app, 'PUT', '/api/admin/ai/policy', { jar: admin.jar, body: body(0) });
    expect(noCsrf.status).toBe(403);
    expect(((await noCsrf.json()) as { error: { code: string } }).error.code).toBe('CSRF_FAILED');
    const noStepUp = await rq(app, 'PUT', '/api/admin/ai/policy', { jar: admin.jar, csrf: true, body: body(0, { reauth: false }) });
    expect(noStepUp.status).toBe(403);
    expect(((await noStepUp.json()) as { error: { code: string } }).error.code).toBe('STEP_UP_REQUIRED');
  });

  it('[P3] 422 on invalid input, without echoing it', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'p3-admin@ex.com', 'ADMIN');
    const marker = 'INJECTED_P3_MARKER';
    const res = await rq(app, 'PUT', '/api/admin/ai/policy', { jar: admin.jar, csrf: true, body: { ...body(0), unexpected: marker } });
    expect(res.status).toBe(422);
    expect(await res.text()).not.toContain(marker);
    // Out-of-range budgets are refused rather than clamped silently.
    expect((await rq(app, 'PUT', '/api/admin/ai/policy', { jar: admin.jar, csrf: true, body: body(0, { maxOutputTokens: 0 }) })).status).toBe(422);
    expect((await rq(app, 'PUT', '/api/admin/ai/policy', { jar: admin.jar, csrf: true, body: body(0, { dailyCostLimitMicros: -1 }) })).status).toBe(422);
  });

  it('[P4] writes under an optimistic version; a stale version is a 409 and does not overwrite', async () => {
    const { app, db, repo } = build();
    const admin = await mkUser(app, db, 'p4-admin@ex.com', 'ADMIN');
    const before = repo.getAiPolicy() as { version: number };
    const ok = await rq(app, 'PUT', '/api/admin/ai/policy', { jar: admin.jar, csrf: true, body: body(before.version) });
    expect(ok.status).toBe(200);
    const b = (await ok.json()) as { version: number; maxOutputTokens: number; allowedTools: string[] };
    expect(b.version).toBe(before.version + 1);
    expect(b.maxOutputTokens).toBe(2048);
    expect(b.allowedTools).toEqual(['get_market_snapshot']);

    const stale = await rq(app, 'PUT', '/api/admin/ai/policy', { jar: admin.jar, csrf: true, body: body(before.version, { maxOutputTokens: 999 }) });
    expect(stale.status).toBe(409);
    // The losing write really did not land.
    expect((repo.getAiPolicy() as { max_output_tokens: number }).max_output_tokens).toBe(2048);
  });

  it('[P5] REDACTION: neither the response nor the database nor the audit trail holds the raw prompt', async () => {
    const { app, db } = build();
    const admin = await mkUser(app, db, 'p5-admin@ex.com', 'ADMIN');
    const res = await rq(app, 'PUT', '/api/admin/ai/policy', { jar: admin.jar, csrf: true, body: body(0) });
    expect(res.status).toBe(200);
    const raw = await res.text();
    // The prompt text is absent…
    expect(raw).not.toContain('INTERNAL_PROMPT_MARKER_7788');
    expect(raw).not.toContain(PROMPT);
    // …and a verifiable digest is present instead.
    const b = JSON.parse(raw) as { systemPrompt: { digest: string; algorithm: string; length: number; textReturned: boolean }; providerCredentialReturned: boolean };
    const { createHash } = await import('node:crypto');
    expect(b.systemPrompt.digest).toBe(createHash('sha256').update(PROMPT, 'utf8').digest('hex'));
    expect(b.systemPrompt.algorithm).toBe('sha256');
    expect(b.systemPrompt.length).toBe(PROMPT.length);
    expect(b.systemPrompt.textReturned).toBe(false);
    expect(b.providerCredentialReturned).toBe(false);
    // No provider credential of any kind appears in the payload.
    for (const bad of ['sk-', 'api_key', 'apikey', 'openai_key', 'authorization', 'bearer ']) {
      expect(raw.toLowerCase(), `"${bad}" must not appear in the policy response`).not.toContain(bad);
    }

    // Nothing in the DATABASE holds the prompt either — not the policy row, not its history.
    const rowJson = JSON.stringify(db.prepare('SELECT * FROM ai_policy').all());
    expect(rowJson).not.toContain('INTERNAL_PROMPT_MARKER_7788');
    const histJson = JSON.stringify(db.prepare('SELECT * FROM ai_policy_history').all());
    expect(histJson).not.toContain('INTERNAL_PROMPT_MARKER_7788');
    expect(db.prepare('SELECT COUNT(*) n FROM ai_policy_history').get()).toEqual({ n: 1 });
    // …nor the audit trail.
    const audJson = JSON.stringify(db.prepare("SELECT * FROM admin_actions WHERE action='ai_policy.update'").all());
    expect(audJson).not.toContain('INTERNAL_PROMPT_MARKER_7788');
    expect(audJson).toContain('promptDigest');

    const readBack = await rq(app, 'GET', '/api/admin/ai/policy', { jar: admin.jar });
    expect(await readBack.text()).not.toContain('INTERNAL_PROMPT_MARKER_7788');
  });

  it('[P6] the policy write CANNOT enable live AI execution', async () => {
    const { app, db, repo } = build();
    const admin = await mkUser(app, db, 'p6-admin@ex.com', 'ADMIN');
    // Refused at the parser: `liveExecutionEnabled` is a literal `false` in the schema.
    const attempt = await rq(app, 'PUT', '/api/admin/ai/policy', { jar: admin.jar, csrf: true, body: body(0, { liveExecutionEnabled: true }) });
    expect(attempt.status).toBe(422);
    // Explicitly passing `false` is accepted and still reports live execution as off.
    const ok = await rq(app, 'PUT', '/api/admin/ai/policy', { jar: admin.jar, csrf: true, body: body(0, { liveExecutionEnabled: false }) });
    expect(ok.status).toBe(200);
    const b = (await ok.json()) as { liveExecutionEnabled: boolean; liveExecution: string };
    expect(b.liveExecutionEnabled).toBe(false);
    expect(b.liveExecution).toBe('Not Executed');
    expect((repo.getAiPolicy() as { live_execution_enabled: number }).live_execution_enabled).toBe(0);
    // Second line of defence: the DATABASE refuses the value even if a future code path tried.
    expect(() => db.prepare('UPDATE ai_policy SET live_execution_enabled=1').run()).toThrow();
    // And there is still no AI order-execution endpoint.
    for (const path of ['/api/admin/ai/execute-order', '/api/admin/ai/orders']) {
      const r = await rq(app, 'POST', path, { jar: admin.jar, csrf: true, body: {} });
      expect([404, 405], path).toContain(r.status);
    }
  });

  it('[P7] an unknown query parameter on the read is a 400', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'p7-sa@ex.com', 'SUPER_ADMIN');
    expect((await rq(app, 'GET', '/api/admin/ai/policy?x=1', { jar: sa.jar })).status).toBe(400);
  });
});

// ===========================================================================
// B8 — /admin/ai/errors (the endpoint the Admin AI Ops screen consumes)
// ===========================================================================
describe('B8 GET /admin/ai/errors', () => {
  const seedRuns = (db: ReturnType<typeof build>['db'], userId: string) => {
    const secret = 'USER_PROMPT_TEXT_MUST_NOT_LEAK_4242';
    const answer = 'ASSISTANT_RESPONSE_TEXT_MUST_NOT_LEAK_4243';
    db.prepare('INSERT INTO ai_conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)').run('c-err', userId, 't', 1000, 1000);
    const msg = db.prepare('INSERT INTO ai_messages (id,conversation_id,user_id,role,content,created_at) VALUES (?,?,?,?,?,?)');
    msg.run('m-1', 'c-err', userId, 'user', secret, 1000);
    msg.run('m-2', 'c-err', userId, 'assistant', answer, 1001);
    const run = db.prepare(
      `INSERT INTO ai_runs (id,conversation_id,user_id,provider,model,prompt_version,fallback_used,status,correlation_id,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    );
    run.run('run-ok', 'c-err', userId, 'mock', 'mock-1', 'v1', 0, 'ok', 'trace-ok', 5000);
    run.run('run-e1', 'c-err', userId, 'mock', 'mock-1', 'v1', 0, 'error', 'trace-e1', 6000);
    run.run('run-e2', 'c-err', userId, 'openai', 'gpt-x', 'v1', 1, 'timeout', 'trace-e2', 7000);
    run.run('run-e3', 'c-err', userId, 'mock', 'mock-2', 'v1', 0, 'failed', 'trace-e3', 8000);
    return { secret, answer };
  };

  it('[E1] 401 unauthenticated; 403 for a non-admin role', async () => {
    const { app, db } = build();
    expect((await rq(app, 'GET', '/api/admin/ai/errors', {})).status).toBe(401);
    const plain = await mkUser(app, db, 'e1-user@ex.com', 'user');
    expect((await rq(app, 'GET', '/api/admin/ai/errors', { jar: plain.jar })).status).toBe(403);
  });

  it('[E2] returns ONLY error-family runs, with a total, and paginates', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'e2-sa@ex.com', 'SUPER_ADMIN');
    const owner = await mkUser(app, db, 'e2-owner@ex.com', 'user');
    seedRuns(db, owner.id);

    const res = await rq(app, 'GET', '/api/admin/ai/errors', { jar: sa.jar });
    expect(res.status).toBe(200);
    const b = (await res.json()) as { errors: Record<string, unknown>[]; total: number; errorStatuses: string[]; readOnly: boolean; promptRedacted: boolean };
    expect(b.total).toBe(3); // the `ok` run is excluded
    expect(b.errors.map((e) => e.id)).not.toContain('run-ok');
    expect(b.errorStatuses).toContain('error');
    expect(b.readOnly).toBe(true);
    expect(b.promptRedacted).toBe(true);
    // Safe identifiers are explicit, so a screen does not have to guess which field is safe to show.
    expect(b.errors[0]!.traceId).toBe('trace-e3');
    expect(b.errors[0]!.errorClass).toBe('failed');
    // No provider error code is recorded in this deployment; reported as absent rather than back-filled.
    expect(b.errors[0]!.errorCode).toBeNull();

    // Real pagination: the total is of the whole match, not of the page.
    const page = (await (await rq(app, 'GET', '/api/admin/ai/errors?limit=2&offset=2', { jar: sa.jar })).json()) as { errors: unknown[]; total: number; limit: number; offset: number };
    expect(page.total).toBe(3);
    expect(page.errors).toHaveLength(1);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(2);
  });

  it('[E3] filtering works, and the status filter cannot be widened out of the error family', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'e3-sa@ex.com', 'SUPER_ADMIN');
    const owner = await mkUser(app, db, 'e3-owner@ex.com', 'user');
    seedRuns(db, owner.id);

    const byProvider = (await (await rq(app, 'GET', '/api/admin/ai/errors?provider=openai', { jar: sa.jar })).json()) as { total: number; errors: Record<string, unknown>[] };
    expect(byProvider.total).toBe(1);
    expect(byProvider.errors[0]!.id).toBe('run-e2');

    const byStatus = (await (await rq(app, 'GET', '/api/admin/ai/errors?status=timeout', { jar: sa.jar })).json()) as { total: number };
    expect(byStatus.total).toBe(1);

    const bySearch = (await (await rq(app, 'GET', '/api/admin/ai/errors?q=trace-e1', { jar: sa.jar })).json()) as { total: number };
    expect(bySearch.total).toBe(1);

    // `status=ok` would turn the errors endpoint into an unfiltered run list — refused, and the rejected
    // value is not echoed back.
    const widened = await rq(app, 'GET', '/api/admin/ai/errors?status=ok', { jar: sa.jar });
    expect(widened.status).toBe(422);
    const raw = await widened.text();
    expect(raw).not.toContain('run-ok');
    // An unknown parameter is a 400 rather than a silently unfiltered response.
    expect((await rq(app, 'GET', '/api/admin/ai/errors?bogus=1', { jar: sa.jar })).status).toBe(400);
  });

  it('[E4] REDACTION: no prompt or response body reaches the payload', async () => {
    const { app, db } = build();
    const sa = await mkUser(app, db, 'e4-sa@ex.com', 'SUPER_ADMIN');
    const owner = await mkUser(app, db, 'e4-owner@ex.com', 'user');
    const { secret, answer } = seedRuns(db, owner.id);

    const raw = await (await rq(app, 'GET', '/api/admin/ai/errors', { jar: sa.jar })).text();
    expect(raw).not.toContain(secret);
    expect(raw).not.toContain(answer);
    expect(raw.toLowerCase()).not.toContain('content');
    expect(raw.toLowerCase()).not.toContain('message_text');
    // Positive control: the conversation really is in the database, so the absence above is the endpoint's
    // projection and not an empty table.
    expect((db.prepare('SELECT COUNT(*) n FROM ai_messages').get() as { n: number }).n).toBe(2);
  });

  it('[E5] RBAC: every admin role with admin.ai.read may read it; there is no write route', async () => {
    const { app, db } = build();
    for (const [i, role] of ['SUPPORT', 'ANALYST', 'ADMIN', 'SUPER_ADMIN'].entries()) {
      const u = await mkUser(app, db, `e5-${i}@ex.com`, role);
      expect((await rq(app, 'GET', '/api/admin/ai/errors', { jar: u.jar })).status, role).toBe(200);
    }
    const sa = await mkUser(app, db, 'e5-sa2@ex.com', 'SUPER_ADMIN');
    for (const [method, path] of [
      ['POST', '/api/admin/ai/errors'],
      ['DELETE', '/api/admin/ai/errors'],
      ['POST', '/api/admin/ai/errors/run-e1/retry'],
    ] as const) {
      const r = await rq(app, method, path, { jar: sa.jar, csrf: true, body: {} });
      expect([404, 405], `${method} ${path}`).toContain(r.status);
    }
  });
});
