import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { AuthService, MailSink } from '@quantumtrade/auth';
import type { RebateRecord } from '@quantumtrade/exchange-bitmart';
import { openDb } from '../db/sqlite';
import {
  SqliteUserRepository,
  SqliteSessionRepository,
  SqliteAuditRepository,
  SqliteTokenRepository,
} from '../db/repos';
import { SqliteAdminRepo } from '../db/admin-repos';
import { SqliteAdminRepoAdapter } from '../db/admin-repo-contract';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { ResourceRepo } from '../db/resource-repo';
import { createAuthRouter } from '../auth-routes';
import { createAdminRouter } from '../admin/admin-routes';
import { createBrokerRebateReader } from '../trading/broker-rebate-source';

/**
 * G10 — `GET /admin/broker/rebates`.
 *
 * Same harness as the other admin API tests: real in-memory database, real AuthService, real routers,
 * cookie jar. The BitMart call is injected, so the RBAC ladder and the response contract are exercised
 * for real without network access.
 *
 * The contract assertions matter as much as the RBAC ones. This endpoint reports COMPANY revenue from a
 * feed that has no user dimension, so the response must make it impossible for a client to read it as
 * per-user payback, and must distinguish "no operator key configured" from "earned nothing".
 */

const ORIGIN = 'http://localhost:5173';

const RECORDS: RebateRecord[] = [
  { date: '2026-08-01', currency: 'BMX', amount: '5.68', source: 'spot' },
  { date: '2026-08-01', currency: 'USDT', amount: '10.238', source: 'spot' },
  { date: '2026-08-02', currency: 'USDT', amount: '21.9895', source: 'spot' },
];

interface BuildOpts {
  /** Omit to simulate a deployment with no operator BitMart credential. */
  rebates?: {
    fetchSpot: (q: { startTime?: number; endTime?: number }) => Promise<RebateRecord[]>;
  };
}

function build(opts: BuildOpts = {}) {
  const db = openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const service = new AuthService(
    new SqliteUserRepository(db),
    new SqliteSessionRepository(db),
    audit,
    {
      emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
      resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
      mail: new MailSink(),
    },
  );
  const repo = new SqliteAdminRepo(db);
  const app = new Hono();
  app.route(
    '/api',
    createAuthRouter({
      service,
      audit,
      resource: new ResourceRepo(db),
      favorites: new SqliteFavoritesRepo(new ResourceRepo(db)),
      preferences: new SqlitePreferencesRepo(new ResourceRepo(db)),
      csrfKey: 'k',
      secureCookies: false,
      corsOrigins: [ORIGIN],
    }),
  );
  app.route(
    '/api',
    createAdminRouter({
      service,
      repo: new SqliteAdminRepoAdapter(repo),
      csrfKey: 'k',
      corsOrigins: [ORIGIN],
      cookieName: 'qt_session',
      health: () => ({ api: 'ok' }),
      ...(opts.rebates
        ? { brokerRebates: { brokerId: 'BEOMONNURI12345', fetchSpot: opts.rebates.fetchSpot } }
        : {}),
    }),
  );
  return { app, db };
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
const cj = (j: Record<string, string>) =>
  Object.entries(j)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

type App = ReturnType<typeof build>['app'];

async function rq(app: App, path: string, jar?: Record<string, string>) {
  const h: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN };
  if (jar) h['cookie'] = cj(jar);
  return app.request(path, { method: 'GET', headers: h });
}

async function mkUser(app: App, db: ReturnType<typeof build>['db'], email: string, role: string) {
  await app.request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password: 'longenough123' }),
  });
  db.prepare('UPDATE users SET role=? WHERE email=?').run(role, email);
  return jarFrom(
    await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password: 'longenough123' }),
    }),
  );
}

/**
 * The parameter is declared even though the stub ignores it: `vi.fn(async () => ...)` infers a
 * zero-length argument tuple, so a test that asserts on `mock.calls[0][0]` would not compile.
 */
const okReader = () => ({
  fetchSpot: vi.fn(async (_q: { startTime?: number; endTime?: number }) => RECORDS),
});

describe('RBA-01 RBAC', () => {
  it('[1] unauthenticated is 401', async () => {
    const { app } = build({ rebates: okReader() });
    expect((await rq(app, '/api/admin/broker/rebates')).status).toBe(401);
  });

  it('[2] a plain user is 403 and never reaches the upstream', async () => {
    const reader = okReader();
    const { app, db } = build({ rebates: reader });
    const jar = await mkUser(app, db, 'u@x.com', 'USER');
    expect((await rq(app, '/api/admin/broker/rebates', jar)).status).toBe(403);
    expect(reader.fetchSpot.mock.calls.length).toBe(0);
  });

  it('[3] read-only admin roles are refused — revenue is not operational state', async () => {
    // SUPPORT and ANALYST hold the read permissions for users/orders/AI, but company revenue is a
    // separate concern and admin.broker.rebate.read is deliberately not in their sets.
    for (const role of ['SUPPORT', 'ANALYST']) {
      const { app, db } = build({ rebates: okReader() });
      const jar = await mkUser(app, db, `${role.toLowerCase()}@x.com`, role);
      const res = await rq(app, '/api/admin/broker/rebates', jar);
      expect(res.status, `role=${role}`).toBe(403);
      const body = (await res.json()) as { error: { message: string } };
      expect(body.error.message).toContain('admin.broker.rebate.read');
    }
  });

  it('[4] ADMIN and SUPER_ADMIN may read', async () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN']) {
      const { app, db } = build({ rebates: okReader() });
      const jar = await mkUser(app, db, `${role.toLowerCase()}@x.com`, role);
      expect((await rq(app, '/api/admin/broker/rebates', jar)).status, `role=${role}`).toBe(200);
    }
  });
});

describe('RBA-02 response contract', () => {
  async function adminGet(path: string, opts: BuildOpts = { rebates: okReader() }) {
    const { app, db } = build(opts);
    const jar = await mkUser(app, db, 'a@x.com', 'ADMIN');
    return rq(app, path, jar);
  }

  it('[1] returns records plus an exact per-currency summary', async () => {
    const res = await adminGet('/api/admin/broker/rebates');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      records: RebateRecord[];
      summary: { byCurrency: Record<string, string>; bySource: Record<string, unknown> };
      brokerId: string;
      configured: boolean;
    };
    expect(body.configured).toBe(true);
    expect(body.brokerId).toBe('BEOMONNURI12345');
    expect(body.records).toHaveLength(3);
    // 10.238 + 21.9895 — a float sum would give 32.227499999999996 here.
    expect(body.summary.byCurrency).toEqual({ USDT: '32.2275', BMX: '5.68' });
  });

  it('[2] states that the data is operator-scoped with no per-user attribution', async () => {
    const body = (await (await adminGet('/api/admin/broker/rebates')).json()) as {
      scope: string;
      perUserAttributionAvailable: boolean;
      note: string;
    };
    // BitMart returns daily totals per currency only. A client must not present this as user payback.
    expect(body.scope).toBe('operator');
    expect(body.perUserAttributionAvailable).toBe(false);
    expect(body.note).toContain('not per-user payback');
  });

  it('[3] declares that futures are excluded, and why', async () => {
    const body = (await (await adminGet('/api/admin/broker/rebates')).json()) as {
      futures: { included: boolean; reason: string };
    };
    expect(body.futures.included).toBe(false);
    expect(body.futures.reason).toContain('unconfirmed');
  });

  it('[4] reports whether the window was explicit or BitMart’s 180-day default', async () => {
    const a = (await (await adminGet('/api/admin/broker/rebates')).json()) as { defaultWindow: string };
    expect(a.defaultWindow).toBe('last-180-days');

    const b = (await (
      await adminGet('/api/admin/broker/rebates?from=1683365678&to=1683367993')
    ).json()) as { defaultWindow: string };
    expect(b.defaultWindow).toBe('explicit');
  });

  it('[5] passes the bounds through as seconds', async () => {
    const reader = okReader();
    const { app, db } = build({ rebates: reader });
    const jar = await mkUser(app, db, 'a@x.com', 'ADMIN');
    await rq(app, '/api/admin/broker/rebates?from=1683365678&to=1683367993', jar);
    expect(reader.fetchSpot.mock.calls[0]?.[0]).toEqual({
      startTime: 1683365678,
      endTime: 1683367993,
    });
  });

  it('[6] admin responses stay uncacheable', async () => {
    const res = await adminGet('/api/admin/broker/rebates');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('RBA-03 failure modes', () => {
  async function adminGet(path: string, opts: BuildOpts) {
    const { app, db } = build(opts);
    const jar = await mkUser(app, db, 'a@x.com', 'ADMIN');
    return rq(app, path, jar);
  }

  it('[1] no operator credential is NOT_CONFIGURED, not an empty statement', async () => {
    const res = await adminGet('/api/admin/broker/rebates', {});
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string }; configured: boolean };
    expect(body.error.code).toBe('NOT_CONFIGURED');
    expect(body.configured).toBe(false);
    // The distinction that matters: an operator must not read this as "we earned nothing".
    expect('records' in body).toBe(false);
  });

  it('[2] an upstream BitMart error is a 502 that names the cause', async () => {
    const res = await adminGet('/api/admin/broker/rebates', {
      rebates: {
        fetchSpot: async () => {
          throw new Error('rebate error 53005: this API key has no broker-interface permission');
        },
      },
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UPSTREAM_ERROR');
    // 53005 is fixed on BitMart's side, so the operator needs to see which failure it was.
    expect(body.error.message).toContain('53005');
  });

  it('[3] an unknown query parameter is a 400, not a silent full-history read', async () => {
    const res = await adminGet('/api/admin/broker/rebates?form=123', { rebates: okReader() });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('[4] a reversed range is rejected rather than silently returning nothing', async () => {
    const res = await adminGet('/api/admin/broker/rebates?from=200&to=100', { rebates: okReader() });
    expect(res.status).toBe(400);
  });

  it('[5] an empty statement is reported as configured with zero records', async () => {
    const res = await adminGet('/api/admin/broker/rebates', {
      rebates: { fetchSpot: async () => [] },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      configured: boolean;
      records: unknown[];
      summary: { byCurrency: Record<string, string>; recordCount: number };
    };
    expect(body.configured).toBe(true);
    expect(body.records).toEqual([]);
    expect(body.summary.byCurrency).toEqual({});
    expect(body.summary.recordCount).toBe(0);
  });
});

describe('RBA-04 reader construction', () => {
  it('[1] a dev deployment with no operator key yields no reader', () => {
    expect(
      createBrokerRebateReader({ brokerId: 'B', isProduction: false, env: {} }),
    ).toBeUndefined();
  });

  it('[2] a blank operator key is treated as unconfigured', () => {
    expect(
      createBrokerRebateReader({ brokerId: 'B', isProduction: false, env: { BITMART_API_KEY: '  ' } }),
    ).toBeUndefined();
  });

  it('[3] a dev key produces a reader', () => {
    const r = createBrokerRebateReader({
      brokerId: 'B',
      isProduction: false,
      env: { BITMART_ACCESS_KEY: 'ak', BITMART_SECRET_KEY: 'sk', BITMART_MEMO: 'm' },
    });
    expect(r?.brokerId).toBe('B');
  });

  it('[4] production without a Secrets Manager id yields no reader instead of throwing', () => {
    // resolveCredentialProvider is fail-closed and throws; a missing broker key must degrade one
    // endpoint, not prevent the API from starting.
    expect(() =>
      createBrokerRebateReader({ brokerId: 'B', isProduction: true, env: {} }),
    ).not.toThrow();
    expect(createBrokerRebateReader({ brokerId: 'B', isProduction: true, env: {} })).toBeUndefined();
  });

  it('[5] production refuses the dev env credential path', () => {
    expect(
      createBrokerRebateReader({
        brokerId: 'B',
        isProduction: true,
        env: { BITMART_ACCESS_KEY: 'ak', BITMART_SECRET_KEY: 'sk', BITMART_MEMO: 'm' },
      }),
    ).toBeUndefined();
  });

  it('[6] the reader sends the operator key and broker id to BitMart', async () => {
    const fetchImpl = vi.fn(async () =>
      ({
        status: 200,
        ok: true,
        json: async () => ({
          code: 1000,
          data: { rebates: { '2026-08-01': [{ currency: 'USDT', rebate_amount: '1.5' }] } },
        }),
      }) as unknown as Response,
    ) as unknown as typeof fetch;

    const r = createBrokerRebateReader({
      brokerId: 'BEOMONNURI12345',
      isProduction: false,
      env: { BITMART_ACCESS_KEY: 'operator-ak', BITMART_SECRET_KEY: 'sk', BITMART_MEMO: 'm' },
      fetchImpl,
      restBase: 'http://127.0.0.1:1',
    });

    const recs = await r!.fetchSpot({});
    expect(recs).toEqual([
      { date: '2026-08-01', currency: 'USDT', amount: '1.5', source: 'spot' },
    ]);

    const headers = (
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit
    ).headers as Record<string, string>;
    expect(headers['X-BM-KEY']).toBe('operator-ak');
    expect(headers['X-BM-BROKER-ID']).toBe('BEOMONNURI12345');
  });
});
