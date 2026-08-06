import { describe, it, expect } from 'vitest';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { Hono } from 'hono';
import { AuthService, MailSink, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import type { SymbolInfo } from '@quantumtrade/schemas';
import { openDb, type DB } from '../db/sqlite';
import {
  SqliteUserRepository,
  SqliteSessionRepository,
  SqliteAuditRepository,
  SqliteTokenRepository,
} from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { createAuthRouter } from '../auth-routes';
import { PortfolioRepo } from '../db/portfolio-repo';
import { SqliteOrderDraftRepo } from '../db/order-draft-repo';
import { createOrderRouter } from '../portfolio/order-routes';

/**
 * B4 — order draft and validation.
 *
 * The safety property under test is not "does it validate" but "can anything here submit an order".
 * `executable: false` is asserted on every response shape, including the one produced when every risk
 * gate passes and the kill switch is off.
 */

const ORIGIN = 'http://localhost:5173';
const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

const SYMBOLS: Record<string, SymbolInfo> = {
  BTCUSDT: {
    id: 'BTCUSDT',
    base: 'BTC',
    quote: 'USDT',
    contractType: 'perpetual',
    pricePrecision: 1,
    quantityPrecision: 3,
    tickSize: '0.1',
    stepSize: '0.001',
    minQty: '0.001',
    maxLeverage: 125,
  },
};

interface BuildOpts {
  killSwitch?: boolean;
  liveTradingEnabled?: boolean;
  reference?: { price: string; at: number } | null;
  referenceThrows?: boolean;
  ratePerMin?: number;
}

function build(o: BuildOpts = {}) {
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
  app.route(
    '/api',
    createOrderRouter({
      service,
      audit,
      drafts: new SqliteOrderDraftRepo(db),
      portfolio: new PortfolioRepo(db),
      symbolInfo: SYMBOLS,
      policy: {
        allowedSymbols: ['BTCUSDT'],
        maxOrderNotional: '100000',
        maxLeverage: 20,
        maxOpenPositions: 5,
        dailyOrderLimit: 50,
        dailyLossLimit: '1000',
        priceDeviationLimitPct: 5,
      },
      posture: {
        source: 'MOCK',
        tradingMode: 'MOCK',
        liveTradingEnabled: o.liveTradingEnabled ?? false,
        killSwitchActive: o.killSwitch ?? true,
      },
      referencePrice: async () => {
        if (o.referenceThrows) throw new Error('provider down');
        return o.reference === undefined ? { price: '65000.0', at: NOW } : o.reference;
      },
      minNotional: '5',
      makerFeeRate: '0.0002',
      takerFeeRate: '0.0006',
      csrfKey: 'k',
      corsOrigins: [ORIGIN],
      cookieName: 'qt_session',
      ratePerMin: o.ratePerMin ?? 30,
      now: () => NOW,
      verifyCsrf,
      originAllowed,
    }),
  );
  return { app, db, audit };
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
  o: { jar?: Record<string, string>; csrf?: boolean; body?: unknown; rawBody?: string; idem?: string; noOrigin?: boolean } = {},
) {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (!o.noOrigin) h['origin'] = ORIGIN;
  if (o.jar) h['cookie'] = cj(o.jar);
  if (o.csrf && o.jar?.['qt_csrf']) h['x-csrf-token'] = o.jar['qt_csrf'];
  if (o.idem) h['idempotency-key'] = o.idem;
  const init: RequestInit = { method, headers: h };
  if (method !== 'GET') init.body = o.rawBody ?? JSON.stringify(o.body ?? {});
  return app.request(path, init);
}

async function mkUser(app: App, db: DB, email: string) {
  await rq(app, 'POST', '/api/auth/register', { body: { email, password: 'longenough123' } });
  const jar = jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email, password: 'longenough123' } }));
  const id = (db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string }).id;
  return { jar, id };
}

function giveBalance(db: DB, userId: string, available: string) {
  db.prepare('INSERT INTO account_balances (id,user_id,asset,available,equity,used,at) VALUES (?,?,?,?,?,?,?)').run(
    `bal-${userId}`,
    userId,
    'USDT',
    available,
    available,
    '0',
    NOW,
  );
}

/** A limit order that satisfies every ORDER-level gate (precision, notional, balance, leverage). */
const goodOrder = {
  symbol: 'BTCUSDT',
  side: 'long' as const,
  type: 'limit' as const,
  quantity: '0.002',
  price: '65000.0',
  leverage: 10,
  marginMode: 'cross' as const,
};

// ---------------------------------------------------------------- guards

describe('B4 guards', () => {
  it('requires a session on both endpoints', async () => {
    const { app } = build();
    for (const p of ['/api/orders/validate', '/api/orders/draft']) {
      expect((await rq(app, 'POST', p, { body: goodOrder })).status, p).toBe(401);
    }
  });

  it('requires CSRF on both endpoints', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'g1@ex.com');
    for (const p of ['/api/orders/validate', '/api/orders/draft']) {
      const res = await rq(app, 'POST', p, { jar: u.jar, body: goodOrder, idem: 'idem-key-1234' });
      expect(res.status, p).toBe(403);
      expect((await jsonOf(res)).error.code).toBe('CSRF_FAILED');
    }
  });

  it('rejects a cross-origin request even with a valid token', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'g2@ex.com');
    const res = await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, noOrigin: true, body: goodOrder });
    expect(res.status).toBe(403);
  });

  it('rate limits per user and reports Retry-After', async () => {
    const { app, db } = build({ ratePerMin: 2 });
    const u = await mkUser(app, db, 'g3@ex.com');
    expect((await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder })).status).toBe(200);
    expect((await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder })).status).toBe(200);
    const third = await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder });
    expect(third.status).toBe(429);
    expect(third.headers.get('retry-after')).toBeTruthy();
  });

  it('does not let one user consume another user\u2019s budget', async () => {
    const { app, db } = build({ ratePerMin: 1 });
    const a = await mkUser(app, db, 'g4a@ex.com');
    const b = await mkUser(app, db, 'g4b@ex.com');
    expect((await rq(app, 'POST', '/api/orders/validate', { jar: a.jar, csrf: true, body: goodOrder })).status).toBe(200);
    expect((await rq(app, 'POST', '/api/orders/validate', { jar: a.jar, csrf: true, body: goodOrder })).status).toBe(429);
    // B is unaffected: the window is keyed by user id.
    expect((await rq(app, 'POST', '/api/orders/validate', { jar: b.jar, csrf: true, body: goodOrder })).status).toBe(200);
  });

  it('rejects an oversized body and invalid json', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'g5@ex.com');
    const big = await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, rawBody: 'x'.repeat(17 * 1024) });
    expect(big.status).toBe(400);
    const bad = await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, rawBody: '{not json' });
    expect(bad.status).toBe(400);
  });

  it('sets no-store', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'g6@ex.com');
    const res = await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

// ---------------------------------------------------------------- schema

describe('B4 intent schema', () => {
  it('rejects unknown fields', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 's1@ex.com');
    const res = await rq(app, 'POST', '/api/orders/validate', {
      jar: u.jar,
      csrf: true,
      // A `submit: true` field must be a hard error, not an ignored extra. Silently dropping it is how a
      // bypass flag gets shipped.
      body: { ...goodOrder, submit: true },
    });
    expect(res.status).toBe(422);
    expect((await jsonOf(res)).issues.map((i: { code: string }) => i.code)).toContain('unrecognized_keys');
  });

  it('rejects a numeric quantity so it cannot be pre-rounded by the JSON parser', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 's2@ex.com');
    const res = await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: { ...goodOrder, quantity: 0.002 } });
    expect(res.status).toBe(422);
  });

  it('requires a price for a limit order and forbids one for a market order', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 's3@ex.com');
    const noPrice = await rq(app, 'POST', '/api/orders/validate', {
      jar: u.jar,
      csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', type: 'limit', quantity: '0.002' },
    });
    expect(noPrice.status).toBe(422);
    const marketWithPrice = await rq(app, 'POST', '/api/orders/validate', {
      jar: u.jar,
      csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.002', price: '65000.0' },
    });
    expect(marketWithPrice.status).toBe(422);
  });

  it('requires a stop price for stop orders', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 's4@ex.com');
    const res = await rq(app, 'POST', '/api/orders/validate', {
      jar: u.jar,
      csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', type: 'stop', quantity: '0.002' },
    });
    expect(res.status).toBe(422);
  });

  it('does not echo rejected input back in the error', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 's5@ex.com');
    const res = await rq(app, 'POST', '/api/orders/validate', {
      jar: u.jar,
      csrf: true,
      body: { ...goodOrder, symbol: '<script>alert(1)</script>' },
    });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await jsonOf(res))).not.toContain('script');
  });
});

// ---------------------------------------------------------------- validation logic

describe('B4 validation', () => {
  it('blocks on deployment gates even when the order itself is fine', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v1@ex.com');
    giveBalance(db, u.id, '10000');
    const b = await jsonOf(await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder }));
    // `valid` describes the order; `allowed` adds the deployment gates. Keeping them apart is what lets
    // the UI avoid blaming the user's input for a policy block.
    expect(b.valid).toBe(true);
    expect(b.allowed).toBe(false);
    expect(b.executable).toBe(false);
    const codes = b.blockingReasons.map((r: { code: string }) => r.code);
    expect(codes).toContain('LIVE_TRADING_DISABLED');
    expect(codes).toContain('KILL_SWITCH_ACTIVE');
  });

  it('keeps executable=false even with the kill switch off and live trading on', async () => {
    // The most dangerous possible configuration must still not produce an executable verdict.
    const { app, db } = build({ killSwitch: false, liveTradingEnabled: true });
    const u = await mkUser(app, db, 'v2@ex.com');
    giveBalance(db, u.id, '10000');
    const b = await jsonOf(await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder }));
    expect(b.valid).toBe(true);
    expect(b.allowed).toBe(true);
    expect(b.executable).toBe(false);
  });

  it('blocks a precision violation with a specific code', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v3@ex.com');
    giveBalance(db, u.id, '10000');
    // stepSize is 0.001, so 0.0025 is not representable.
    const b = await jsonOf(
      await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: { ...goodOrder, quantity: '0.0025' } }),
    );
    expect(b.valid).toBe(false);
    expect(b.blockingReasons.map((r: { code: string }) => r.code)).toContain('PRECISION_VIOLATION');
  });

  it('blocks below the minimum notional', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v4@ex.com');
    giveBalance(db, u.id, '10000');
    // 0.001 * 65000 = 65 which is above 5; use a low price to drop under the minimum instead.
    const b = await jsonOf(
      await rq(app, 'POST', '/api/orders/validate', {
        jar: u.jar,
        csrf: true,
        body: { ...goodOrder, quantity: '0.001', price: '1000.0' },
      }),
    );
    // 0.001 * 1000 = 1 < 5
    expect(b.blockingReasons.map((r: { code: string }) => r.code)).toContain('BELOW_MIN_NOTIONAL');
  });

  it('treats an unknown balance as insufficient rather than assuming funds exist', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v5@ex.com');
    // No balance row at all.
    const b = await jsonOf(await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder }));
    expect(b.valid).toBe(false);
    expect(b.blockingReasons.map((r: { code: string }) => r.code)).toContain('BALANCE_UNKNOWN');
  });

  it('blocks insufficient margin using decimal arithmetic', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v6@ex.com');
    // notional 130, leverage 10 → required margin 13. Give 12.99 so the comparison must be exact.
    giveBalance(db, u.id, '12.99');
    const b = await jsonOf(await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder }));
    expect(b.blockingReasons.map((r: { code: string }) => r.code)).toContain('INSUFFICIENT_BALANCE');
    const ok = build({ killSwitch: false, liveTradingEnabled: true });
    const u2 = await mkUser(ok.app, ok.db, 'v6b@ex.com');
    giveBalance(ok.db, u2.id, '13');
    const b2 = await jsonOf(await rq(ok.app, 'POST', '/api/orders/validate', { jar: u2.jar, csrf: true, body: goodOrder }));
    expect(b2.blockingReasons.map((r: { code: string }) => r.code)).not.toContain('INSUFFICIENT_BALANCE');
  });

  it('blocks a stop loss on the wrong side of entry', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v7@ex.com');
    giveBalance(db, u.id, '10000');
    const b = await jsonOf(
      await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: { ...goodOrder, stopLoss: '66000.0' } }),
    );
    expect(b.blockingReasons.map((r: { code: string }) => r.code)).toContain('STOP_LOSS_WRONG_SIDE');
  });

  it('blocks a symbol outside the policy allowlist', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v8@ex.com');
    giveBalance(db, u.id, '10000');
    const b = await jsonOf(
      await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: { ...goodOrder, symbol: 'XRPUSDT' } }),
    );
    const codes = b.blockingReasons.map((r: { code: string }) => r.code);
    expect(codes).toContain('SYMBOL_NOT_PERMITTED');
    expect(codes).toContain('UNKNOWN_SYMBOL');
  });

  it('blocks leverage above the policy limit', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v9@ex.com');
    giveBalance(db, u.id, '10000');
    const b = await jsonOf(
      await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: { ...goodOrder, leverage: 50 } }),
    );
    expect(b.blockingReasons.map((r: { code: string }) => r.code)).toContain('LEVERAGE_ABOVE_LIMIT');
  });

  it('blocks a market order when the reference price is unavailable or stale', async () => {
    const none = build({ reference: null });
    const u1 = await mkUser(none.app, none.db, 'v10@ex.com');
    giveBalance(none.db, u1.id, '10000');
    const b1 = await jsonOf(
      await rq(none.app, 'POST', '/api/orders/validate', {
        jar: u1.jar,
        csrf: true,
        body: { symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.002', leverage: 10 },
      }),
    );
    expect(b1.blockingReasons.map((r: { code: string }) => r.code)).toContain('NO_REFERENCE_PRICE');

    const stale = build({ reference: { price: '65000.0', at: NOW - 120_000 } });
    const u2 = await mkUser(stale.app, stale.db, 'v11@ex.com');
    giveBalance(stale.db, u2.id, '10000');
    const b2 = await jsonOf(
      await rq(stale.app, 'POST', '/api/orders/validate', {
        jar: u2.jar,
        csrf: true,
        body: { symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.002', leverage: 10 },
      }),
    );
    expect(b2.blockingReasons.map((r: { code: string }) => r.code)).toContain('STALE_REFERENCE_PRICE');
  });

  it('fails closed when the price provider throws', async () => {
    const { app, db } = build({ referenceThrows: true });
    const u = await mkUser(app, db, 'v12@ex.com');
    giveBalance(db, u.id, '10000');
    const b = await jsonOf(
      await rq(app, 'POST', '/api/orders/validate', {
        jar: u.jar,
        csrf: true,
        body: { symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.002', leverage: 10 },
      }),
    );
    // A provider outage must not produce a permissive verdict.
    expect(b.valid).toBe(false);
    expect(b.blockingReasons.map((r: { code: string }) => r.code)).toContain('NO_REFERENCE_PRICE');
  });

  it('blocks a limit price that deviates too far from the reference', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v13@ex.com');
    giveBalance(db, u.id, '1000000');
    const b = await jsonOf(
      await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: { ...goodOrder, price: '90000.0' } }),
    );
    expect(b.blockingReasons.map((r: { code: string }) => r.code)).toContain('PRICE_DEVIATION_TOO_LARGE');
  });

  it('computes fees with decimal arithmetic and reports both sides', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v14@ex.com');
    giveBalance(db, u.id, '10000');
    const b = await jsonOf(await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder }));
    // notional 130; maker 0.0002 → 0.026, taker 0.0006 → 0.078
    expect(b.normalizedOrder.notional).toBe('130');
    expect(b.estimatedFees.maker).toBe('0.026');
    expect(b.estimatedFees.taker).toBe('0.078');
    expect(b.estimatedFees.assumed).toBe('maker');
  });

  it('marks an AI-originated intent as advisory', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v15@ex.com');
    giveBalance(db, u.id, '10000');
    const b = await jsonOf(
      await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: { ...goodOrder, origin: 'ai_suggestion' } }),
    );
    expect(b.warnings.map((w: { code: string }) => w.code)).toContain('AI_ORIGINATED_ADVISORY');
  });

  it('returns risk checks and provenance', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v16@ex.com');
    giveBalance(db, u.id, '10000');
    const b = await jsonOf(await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder }));
    expect(Array.isArray(b.riskChecks)).toBe(true);
    expect(b.riskChecks.length).toBeGreaterThan(5);
    expect(b.tradingMode).toBe('MOCK');
    expect(b.source).toBe('MOCK');
  });

  it('writes nothing to order_drafts on validate', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'v17@ex.com');
    giveBalance(db, u.id, '10000');
    await rq(app, 'POST', '/api/orders/validate', { jar: u.jar, csrf: true, body: goodOrder });
    const n = db.prepare('SELECT COUNT(*) AS n FROM order_drafts').get() as { n: number };
    // Validation is not a mutation. A row here would make retries and audits misleading.
    expect(n.n).toBe(0);
  });
});

// ---------------------------------------------------------------- draft

describe('B4 draft persistence', () => {
  it('requires an idempotency key', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'd1@ex.com');
    const res = await rq(app, 'POST', '/api/orders/draft', { jar: u.jar, csrf: true, body: goodOrder });
    expect(res.status).toBe(400);
    const short = await rq(app, 'POST', '/api/orders/draft', { jar: u.jar, csrf: true, body: goodOrder, idem: 'abc' });
    expect(short.status).toBe(400);
  });

  it('persists the intent, the verdict and executable=false', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'd2@ex.com');
    giveBalance(db, u.id, '10000');
    const res = await rq(app, 'POST', '/api/orders/draft', { jar: u.jar, csrf: true, body: goodOrder, idem: 'draft-key-0001' });
    expect(res.status).toBe(201);
    const b = await jsonOf(res);
    expect(b.draftId).toBeTruthy();
    expect(b.version).toBe(1);
    expect(b.executable).toBe(false);

    const row = db.prepare('SELECT * FROM order_drafts WHERE id=?').get(b.draftId) as Record<string, unknown>;
    expect(row.user_id).toBe(u.id);
    expect(row.executable).toBe(0);
    expect(row.source).toBe('MOCK');
    // The verdict is stored, so an audit of the row alone shows what the server decided at the time.
    expect(row.valid).toBe(1);
    expect(row.allowed).toBe(0);
    expect(row.idempotency_key).toBe('draft-key-0001');
  });

  it('replays the stored verdict for a repeated idempotency key', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'd3@ex.com');
    giveBalance(db, u.id, '10000');
    const first = await jsonOf(
      await rq(app, 'POST', '/api/orders/draft', { jar: u.jar, csrf: true, body: goodOrder, idem: 'replay-key-001' }),
    );
    // Second call with a DIFFERENT body under the same key must return the original stored result, not a
    // new verdict — otherwise the key guarantees nothing.
    const second = await rq(app, 'POST', '/api/orders/draft', {
      jar: u.jar,
      csrf: true,
      body: { ...goodOrder, quantity: '0.005' },
      idem: 'replay-key-001',
    });
    expect(second.status).toBe(200);
    const b2 = await jsonOf(second);
    expect(b2.replayed).toBe(true);
    expect(b2.draftId).toBe(first.draftId);
    expect(b2.normalizedOrder.quantity).toBe('0.002');
    const n = db.prepare('SELECT COUNT(*) AS n FROM order_drafts').get() as { n: number };
    expect(n.n).toBe(1);
  });

  it('lets two users use the same idempotency key independently', async () => {
    const { app, db } = build();
    const a = await mkUser(app, db, 'd4a@ex.com');
    const b = await mkUser(app, db, 'd4b@ex.com');
    giveBalance(db, a.id, '10000');
    giveBalance(db, b.id, '10000');
    const ra = await rq(app, 'POST', '/api/orders/draft', { jar: a.jar, csrf: true, body: goodOrder, idem: 'shared-key-01' });
    const rb = await rq(app, 'POST', '/api/orders/draft', { jar: b.jar, csrf: true, body: goodOrder, idem: 'shared-key-01' });
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    expect((await jsonOf(ra)).draftId).not.toBe((await jsonOf(rb)).draftId);
  });

  it('stores a draft even when the order is invalid, with the reasons', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'd5@ex.com');
    const res = await rq(app, 'POST', '/api/orders/draft', {
      jar: u.jar,
      csrf: true,
      body: { ...goodOrder, quantity: '0.0025' },
      idem: 'invalid-key-01',
    });
    // A rejected draft is still a record of what the user tried; discarding it would lose the audit trail.
    expect(res.status).toBe(201);
    const b = await jsonOf(res);
    expect(b.valid).toBe(false);
    const row = db.prepare('SELECT valid, allowed FROM order_drafts WHERE id=?').get(b.draftId) as { valid: number; allowed: number };
    expect(row.valid).toBe(0);
    expect(row.allowed).toBe(0);
  });

  it('records an audit event with reason codes but not the order values', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'd6@ex.com');
    giveBalance(db, u.id, '10000');
    await rq(app, 'POST', '/api/orders/draft', { jar: u.jar, csrf: true, body: goodOrder, idem: 'audit-key-001' });
    const rows = db
      .prepare("SELECT action, meta FROM audit_logs WHERE actor_user_id=? AND action='order.draft.create'")
      .all(u.id) as { action: string; meta: string }[];
    expect(rows).toHaveLength(1);
    const meta = JSON.parse(rows[0]!.meta) as { blockingCodes: string[] };
    expect(meta.blockingCodes).toContain('LIVE_TRADING_DISABLED');
    // The user's price and size are their data; they do not belong in the audit trail.
    expect(rows[0]!.meta).not.toContain('65000');
  });

  it('lists only the caller\u2019s drafts', async () => {
    const { app, db } = build();
    const a = await mkUser(app, db, 'd7a@ex.com');
    const b = await mkUser(app, db, 'd7b@ex.com');
    giveBalance(db, a.id, '10000');
    await rq(app, 'POST', '/api/orders/draft', { jar: a.jar, csrf: true, body: goodOrder, idem: 'list-key-0001' });
    const mine = await jsonOf(await rq(app, 'GET', '/api/orders/drafts', { jar: a.jar }));
    expect(mine.page.total).toBe(1);
    const theirs = await jsonOf(await rq(app, 'GET', '/api/orders/drafts', { jar: b.jar }));
    expect(theirs.page.total).toBe(0);
  });

  it('has no submit route', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'd8@ex.com');
    // Asserted rather than assumed: a submit path must not appear on this router at any point.
    for (const p of ['/api/orders/submit', '/api/orders/draft/submit', '/api/orders']) {
      const res = await rq(app, 'POST', p, { jar: u.jar, csrf: true, body: goodOrder, idem: 'no-submit-001' });
      expect([404, 405], `${p} responded ${res.status}`).toContain(res.status);
    }
  });
});
