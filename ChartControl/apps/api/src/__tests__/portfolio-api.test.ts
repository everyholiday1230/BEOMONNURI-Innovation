import { describe, it, expect } from 'vitest';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { Hono } from 'hono';
import { AuthService, MailSink, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import { openDb } from '../db/sqlite';
import {
  SqliteUserRepository,
  SqliteSessionRepository,
  SqliteAuditRepository,
  SqliteTokenRepository,
} from '../db/repos';
import { createAuthRouter } from '../auth-routes';
import { ResourceRepo } from '../db/resource-repo';
import { PortfolioRepo } from '../db/portfolio-repo';
import { createPortfolioRouter } from '../portfolio/portfolio-routes';
import type { DB } from '../db/sqlite';

/**
 * B3 / B5 — orders, trades, positions, account read model.
 *
 * These tests write rows DIRECTLY into the tables migration 0003 already defines and then read them
 * back through the HTTP contract. That is deliberate: the point being proven is that the endpoints are
 * backed by the database and scoped to the session user, so the data must not come from a stub inside
 * the route. Fabricated in-route data would pass a mock-based test and fail this one.
 */

const ORIGIN = 'http://localhost:5173';
const NOW = 1_800_000_000_000;

function build(now: () => number = () => NOW, killSwitch = true) {
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
    createPortfolioRouter({
      service,
      repo: new PortfolioRepo(db),
      posture: { source: 'MOCK', tradingMode: 'MOCK', liveTradingEnabled: false, killSwitchActive: killSwitch },
      csrfKey: 'k',
      corsOrigins: [ORIGIN],
      cookieName: 'qt_session',
      now,
      verifyCsrf,
      originAllowed,
    }),
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
  o: { jar?: Record<string, string>; csrf?: boolean; body?: unknown; rawBody?: string; noOrigin?: boolean } = {},
) {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (!o.noOrigin) h['origin'] = ORIGIN;
  if (o.jar) h['cookie'] = cj(o.jar);
  if (o.csrf && o.jar?.['qt_csrf']) h['x-csrf-token'] = o.jar['qt_csrf'];
  const init: RequestInit = { method, headers: h };
  if (method !== 'GET' && method !== 'DELETE') init.body = o.rawBody ?? JSON.stringify(o.body ?? {});
  return app.request(path, init);
}

/** `Response.json()` is `unknown` under TS 5.5; these tests assert on shape, so a local alias keeps
 *  the assertions readable without disabling type checking elsewhere. */
type Json = Record<string, unknown> & { [k: string]: any };
const jsonOf = async (res: Response): Promise<Json> => (await res.json()) as Json;

async function mkUser(app: App, db: DB, email: string) {
  await rq(app, 'POST', '/api/auth/register', { body: { email, password: 'longenough123' } });
  const jar = jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email, password: 'longenough123' } }));
  const id = (db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string }).id;
  return { jar, id };
}

let seq = 0;
function insertOrder(
  db: DB,
  userId: string,
  o: Partial<{ symbol: string; side: string; type: string; price: string; quantity: string; filled: string; status: string; at: number }> = {},
) {
  const id = `ord-${++seq}`;
  const at = o.at ?? NOW - 1000;
  db.prepare(
    `INSERT INTO orders (internal_order_id,user_id,client_order_id,symbol,side,type,price,quantity,filled_quantity,status,mode,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    userId,
    `cli-${id}`,
    o.symbol ?? 'BTCUSDT',
    o.side ?? 'long',
    o.type ?? 'limit',
    o.price ?? '65000.10',
    o.quantity ?? '0.001',
    o.filled ?? '0',
    o.status ?? 'ACCEPTED',
    'MOCK',
    at,
    at,
  );
  return id;
}

function insertExecution(db: DB, userId: string, orderId: string, e: Partial<{ price: string; quantity: string; fee: string; at: number }> = {}) {
  const id = `exe-${++seq}`;
  db.prepare(
    `INSERT INTO executions (id,internal_order_id,user_id,exec_id,price,quantity,fee,liquidity,at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(id, orderId, userId, `x-${id}`, e.price ?? '65000.10', e.quantity ?? '0.001', e.fee ?? '0.0325', 'taker', e.at ?? NOW - 500);
  return id;
}

function insertPosition(
  db: DB,
  userId: string,
  p: Partial<{ symbol: string; side: string; size: string; entry: string; mark: string; pnl: string; lev: number; at: number }> = {},
) {
  const id = `pos-${++seq}`;
  db.prepare(
    `INSERT INTO positions (id,user_id,symbol,side,size,entry_price,mark_price,liquidation_price,leverage,margin_mode,unrealized_pnl,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    userId,
    p.symbol ?? 'BTCUSDT',
    p.side ?? 'long',
    p.size ?? '0.001',
    p.entry ?? '64000.00',
    p.mark ?? '65000.00',
    '32000.00',
    p.lev ?? 10,
    'cross',
    p.pnl ?? '1.00',
    p.at ?? NOW - 1000,
  );
  return id;
}

function insertBalance(db: DB, userId: string, b: Partial<{ asset: string; available: string; equity: string; used: string; at: number }> = {}) {
  const id = `bal-${++seq}`;
  db.prepare('INSERT INTO account_balances (id,user_id,asset,available,equity,used,at) VALUES (?,?,?,?,?,?,?)').run(
    id,
    userId,
    b.asset ?? 'USDT',
    b.available ?? '1000.10',
    b.equity ?? '1200.20',
    b.used ?? '200.10',
    b.at ?? NOW - 1000,
  );
  return id;
}

// ---------------------------------------------------------------- auth / isolation

describe('B3 read model — authentication and ownership', () => {
  it('rejects every read model endpoint when unauthenticated', async () => {
    const { app } = build();
    for (const p of ['/api/orders/open', '/api/orders/history', '/api/trades', '/api/positions', '/api/account/summary', '/api/account/assets']) {
      const res = await rq(app, 'GET', p);
      expect(res.status, p).toBe(401);
    }
  });

  it('never returns another user\u2019s orders, trades, positions or balances', async () => {
    const { app, db } = build();
    const a = await mkUser(app, db, 'iso-a@ex.com');
    const b = await mkUser(app, db, 'iso-b@ex.com');
    const oa = insertOrder(db, a.id, { symbol: 'BTCUSDT' });
    insertExecution(db, a.id, oa);
    insertPosition(db, a.id);
    insertBalance(db, a.id);

    // B has an identically shaped row set of its own, so an accidental unscoped query would still
    // return "plausible" data — the assertion is on the ids, not on emptiness alone.
    const ob = insertOrder(db, b.id, { symbol: 'ETHUSDT' });
    insertExecution(db, b.id, ob);

    const orders = await jsonOf(await rq(app, 'GET', '/api/orders/open', { jar: b.jar }));
    expect(orders.items.map((r: { id: string }) => r.id)).toEqual([ob]);
    const trades = await jsonOf(await rq(app, 'GET', '/api/trades', { jar: b.jar }));
    expect(trades.items.every((t: { symbol: string }) => t.symbol === 'ETHUSDT')).toBe(true);
    const positions = await jsonOf(await rq(app, 'GET', '/api/positions', { jar: b.jar }));
    expect(positions.items).toEqual([]);
    const assets = await jsonOf(await rq(app, 'GET', '/api/account/assets', { jar: b.jar }));
    expect(assets.items).toEqual([]);
  });

  it('sets no-store on account-scoped responses', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'ns@ex.com');
    const res = await rq(app, 'GET', '/api/positions', { jar: u.jar });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

// ---------------------------------------------------------------- provenance

describe('B3 provenance', () => {
  it('reports MOCK source, trading mode and kill-switch state on every read', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'prov@ex.com');
    insertOrder(db, u.id);
    const body = await jsonOf(await rq(app, 'GET', '/api/orders/open', { jar: u.jar }));
    expect(body.source).toBe('MOCK');
    expect(body.tradingMode).toBe('MOCK');
    expect(body.liveTradingEnabled).toBe(false);
    expect(body.killSwitchActive).toBe(true);
    expect(body.servedAt).toBe(NOW);
  });

  it('distinguishes an empty result set from stale data', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'empty@ex.com');
    const empty = await jsonOf(await rq(app, 'GET', '/api/positions', { jar: u.jar }));
    // "You have no positions" must not be reported the same way as "we cannot see your positions".
    expect(empty.freshness).toBe('EMPTY');
    expect(empty.stale).toBe(false);
    expect(empty.asOf).toBeNull();
  });

  it('marks positions stale when the mark price is older than the freshness window', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'stale@ex.com');
    insertPosition(db, u.id, { at: NOW - 60_000 });
    const body = await jsonOf(await rq(app, 'GET', '/api/positions', { jar: u.jar }));
    expect(body.stale).toBe(true);
    expect(body.freshness).toBe('STALE');
    expect(body.asOf).toBe(NOW - 60_000);
  });

  it('does not report settled order records as stale', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'notstale@ex.com');
    insertOrder(db, u.id, { status: 'FILLED', at: NOW - 30 * 86_400_000 });
    const body = await jsonOf(await rq(app, 'GET', '/api/orders/history', { jar: u.jar }));
    // A month-old fill is old, not stale. Conflating the two teaches the UI to ignore the flag.
    expect(body.stale).toBe(false);
    expect(body.freshness).toBe('NOT_APPLICABLE');
  });
});

// ---------------------------------------------------------------- filters / states

describe('B3 filters, states and validation', () => {
  it('separates open from terminal orders', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'states@ex.com');
    const open = insertOrder(db, u.id, { status: 'PARTIALLY_FILLED' });
    const done = insertOrder(db, u.id, { status: 'FILLED' });
    const o = await jsonOf(await rq(app, 'GET', '/api/orders/open', { jar: u.jar }));
    const h = await jsonOf(await rq(app, 'GET', '/api/orders/history', { jar: u.jar }));
    expect(o.items.map((r: { id: string }) => r.id)).toEqual([open]);
    expect(h.items.map((r: { id: string }) => r.id)).toEqual([done]);
  });

  it('rejects a status that is not legal for the endpoint instead of ignoring it', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'badstatus@ex.com');
    // FILLED is terminal, so it is not a valid filter on /orders/open. Silently ignoring it would make
    // the client believe it filtered when it did not.
    const res = await rq(app, 'GET', '/api/orders/open?status=FILLED', { jar: u.jar });
    expect(res.status).toBe(400);
    expect((await jsonOf(res)).issues).toEqual([{ path: 'status', code: 'not_open_state' }]);
  });

  it('rejects unknown query parameters', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'strict@ex.com');
    const res = await rq(app, 'GET', '/api/orders/open?sybmol=BTCUSDT', { jar: u.jar });
    expect(res.status).toBe(400);
  });

  it('rejects an inverted time range', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'range@ex.com');
    const res = await rq(app, 'GET', `/api/trades?from=${NOW}&to=${NOW - 1000}`, { jar: u.jar });
    expect(res.status).toBe(400);
  });

  it('does not echo the rejected input back in the error', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'noecho@ex.com');
    const res = await rq(app, 'GET', '/api/orders/open?symbol=%3Cscript%3Ealert(1)%3C%2Fscript%3E', { jar: u.jar });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await jsonOf(res))).not.toContain('script');
  });

  it('filters by symbol and side', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'filter@ex.com');
    insertOrder(db, u.id, { symbol: 'BTCUSDT', side: 'long' });
    insertOrder(db, u.id, { symbol: 'ETHUSDT', side: 'short' });
    const btc = await jsonOf(await rq(app, 'GET', '/api/orders/open?symbol=btcusdt', { jar: u.jar }));
    expect(btc.items).toHaveLength(1);
    expect(btc.items[0].symbol).toBe('BTCUSDT');
    const shorts = await jsonOf(await rq(app, 'GET', '/api/orders/open?side=short', { jar: u.jar }));
    expect(shorts.items).toHaveLength(1);
    expect(shorts.items[0].symbol).toBe('ETHUSDT');
  });

  it('applies an exclusive upper time bound so adjacent ranges cannot double-count', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'bound@ex.com');
    const o = insertOrder(db, u.id);
    insertExecution(db, u.id, o, { at: 1000 });
    insertExecution(db, u.id, o, { at: 2000 });
    const lower = await jsonOf(await rq(app, 'GET', '/api/trades?from=1000&to=2000', { jar: u.jar }));
    const upper = await jsonOf(await rq(app, 'GET', '/api/trades?from=2000&to=3000', { jar: u.jar }));
    expect(lower.page.total).toBe(1);
    expect(upper.page.total).toBe(1);
  });
});

// ---------------------------------------------------------------- pagination

describe('B3 pagination and stable ordering', () => {
  it('pages without duplicating or dropping rows when timestamps collide', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'page@ex.com');
    // Identical timestamps: only the primary-key tie-break makes the ordering total, and without a
    // total order LIMIT/OFFSET paging repeats and skips rows.
    const ids = Array.from({ length: 7 }, () => insertOrder(db, u.id, { at: NOW - 5000 }));
    const seen: string[] = [];
    for (let offset = 0; offset < 7; offset += 3) {
      const body = await jsonOf(await rq(app, 'GET', `/api/orders/open?limit=3&offset=${offset}`, { jar: u.jar }));
      expect(body.page.total).toBe(7);
      seen.push(...body.items.map((r: { id: string }) => r.id));
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it('reports hasMore honestly', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'more@ex.com');
    insertOrder(db, u.id);
    insertOrder(db, u.id);
    const first = await jsonOf(await rq(app, 'GET', '/api/orders/open?limit=1', { jar: u.jar }));
    expect(first.page.hasMore).toBe(true);
    const last = await jsonOf(await rq(app, 'GET', '/api/orders/open?limit=1&offset=1', { jar: u.jar }));
    expect(last.page.hasMore).toBe(false);
  });

  it('caps the page size', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'cap@ex.com');
    expect((await rq(app, 'GET', '/api/orders/open?limit=201', { jar: u.jar })).status).toBe(400);
  });

  it('honours the sort allowlist and rejects anything outside it', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'sort@ex.com');
    insertOrder(db, u.id, { symbol: 'AAAUSDT' });
    insertOrder(db, u.id, { symbol: 'ZZZUSDT' });
    const asc = await jsonOf(await rq(app, 'GET', '/api/orders/open?sort=symbol&dir=asc', { jar: u.jar }));
    expect(asc.items.map((r: { symbol: string }) => r.symbol)).toEqual(['AAAUSDT', 'ZZZUSDT']);
    // An arbitrary sort column must not reach SQL.
    expect((await rq(app, 'GET', '/api/orders/open?sort=user_id', { jar: u.jar })).status).toBe(400);
  });
});

// ---------------------------------------------------------------- decimals

describe('B3/B5 decimal fidelity', () => {
  it('returns order and fill decimals as unmodified strings', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'dec@ex.com');
    // A quantity that a float round-trip would visibly corrupt.
    const o = insertOrder(db, u.id, { price: '65000.123456789012345', quantity: '0.000000000000001' });
    insertExecution(db, u.id, o, { price: '65000.123456789012345', quantity: '0.000000000000001' });
    const orders = await jsonOf(await rq(app, 'GET', '/api/orders/open', { jar: u.jar }));
    expect(orders.items[0].price).toBe('65000.123456789012345');
    expect(orders.items[0].quantity).toBe('0.000000000000001');
    const trades = await jsonOf(await rq(app, 'GET', '/api/trades', { jar: u.jar }));
    expect(trades.items[0].price).toBe('65000.123456789012345');
  });

  it('sums balances with decimal arithmetic, not floating point', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'sum@ex.com');
    // 0.1 + 0.2 is the canonical float failure; the summary must report 0.3.
    insertBalance(db, u.id, { asset: 'USDT', available: '0.1', equity: '0.1', used: '0' });
    insertBalance(db, u.id, { asset: 'BTC', available: '0.2', equity: '0.2', used: '0' });
    const body = await jsonOf(await rq(app, 'GET', '/api/account/summary', { jar: u.jar }));
    expect(body.available).toBe('0.3');
    expect(body.equity).toBe('0.3');
  });
});

// ---------------------------------------------------------------- account summary

describe('B5 account summary', () => {
  it('reports missing figures as null with an unavailable list, never as zero', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'noacct@ex.com');
    const body = await jsonOf(await rq(app, 'GET', '/api/account/summary', { jar: u.jar }));
    // Zero available balance is a number the position sizer would act on. Absence must not look like it.
    expect(body.available).toBeNull();
    expect(body.equity).toBeNull();
    expect(body.marginRatio).toBeNull();
    expect(body.unavailable).toContain('available');
    expect(body.unavailable).toContain('marginRatio');
  });

  it('computes exposure from mark price and counts unpriced positions separately', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'expo@ex.com');
    insertPosition(db, u.id, { symbol: 'BTCUSDT', size: '2', mark: '100.5', entry: '100' });
    db.prepare(
      `INSERT INTO positions (id,user_id,symbol,side,size,entry_price,mark_price,liquidation_price,leverage,margin_mode,unrealized_pnl,updated_at)
       VALUES ('pos-unpriced',?,'XRPUSDT','long','5',NULL,NULL,NULL,NULL,NULL,NULL,?)`,
    ).run(u.id, NOW - 1000);
    const body = await jsonOf(await rq(app, 'GET', '/api/account/summary', { jar: u.jar }));
    expect(body.exposure.positionCount).toBe(2);
    expect(body.exposure.pricedPositionCount).toBe(1);
    expect(body.exposure.notional).toBe('201');
  });

  it('returns only the latest snapshot per asset', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'latest@ex.com');
    insertBalance(db, u.id, { asset: 'USDT', available: '1', at: NOW - 5000 });
    insertBalance(db, u.id, { asset: 'USDT', available: '2', at: NOW - 1000 });
    const body = await jsonOf(await rq(app, 'GET', '/api/account/assets', { jar: u.jar }));
    expect(body.items).toHaveLength(1);
    expect(body.items[0].available).toBe('2');
  });
});

// ---------------------------------------------------------------- validation-only mutations

describe('B5 position close-draft and margin validation are non-executable', () => {
  it('requires CSRF', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'csrf@ex.com');
    const id = insertPosition(db, u.id);
    const res = await rq(app, 'POST', `/api/positions/${id}/close-draft`, { jar: u.jar });
    expect(res.status).toBe(403);
    expect((await jsonOf(res)).error.code).toBe('CSRF_FAILED');
  });

  it('rejects a cross-origin request even with a valid token', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'origin@ex.com');
    const id = insertPosition(db, u.id);
    const res = await rq(app, 'POST', `/api/positions/${id}/close-draft`, { jar: u.jar, csrf: true, noOrigin: true });
    expect(res.status).toBe(403);
  });

  it('returns executable=false with an explicit blocking reason and writes nothing', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'close@ex.com');
    const id = insertPosition(db, u.id, { side: 'long', size: '0.5', mark: '100' });
    const res = await rq(app, 'POST', `/api/positions/${id}/close-draft`, { jar: u.jar, csrf: true });
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.executable).toBe(false);
    expect(body.allowed).toBe(false);
    expect(body.normalizedClose).toMatchObject({ side: 'short', quantity: '0.5', reduceOnly: true });
    expect(body.estimatedNotional).toBe('50');
    expect(body.blockingReasons.map((r: { code: string }) => r.code)).toContain('LIVE_TRADING_DISABLED');
    expect(body.blockingReasons.map((r: { code: string }) => r.code)).toContain('KILL_SWITCH_ACTIVE');
    // The position row is untouched: this endpoint is a calculation, not an action.
    const after = db.prepare('SELECT size, updated_at FROM positions WHERE id=?').get(id) as { size: string };
    expect(after.size).toBe('0.5');
  });

  it('404s for a position owned by someone else rather than confirming it exists', async () => {
    const { app, db } = build();
    const a = await mkUser(app, db, 'own-a@ex.com');
    const b = await mkUser(app, db, 'own-b@ex.com');
    const id = insertPosition(db, a.id);
    const res = await rq(app, 'POST', `/api/positions/${id}/close-draft`, { jar: b.jar, csrf: true });
    expect(res.status).toBe(404);
  });

  it('requires a decimal string amount for margin validation', async () => {
    const { app, db } = build();
    const u = await mkUser(app, db, 'margin@ex.com');
    const id = insertPosition(db, u.id);
    // A JS number would be rounded by the JSON parser before validation could see the real value.
    const bad = await rq(app, 'POST', `/api/positions/${id}/margin-adjustment/validate`, { jar: u.jar, csrf: true, body: { amount: 10.5 } });
    expect(bad.status).toBe(400);
    const ok = await rq(app, 'POST', `/api/positions/${id}/margin-adjustment/validate`, { jar: u.jar, csrf: true, body: { amount: '10.5' } });
    expect(ok.status).toBe(200);
    const body = await jsonOf(ok);
    expect(body.executable).toBe(false);
    expect(body.blockingReasons.map((r: { code: string }) => r.code)).toContain('MARGIN_ADJUST_DISABLED_BY_POLICY');
  });

  it('keeps executable=false even when the kill switch is inactive', async () => {
    // The kill switch is one gate among several. Turning it off must not make anything executable.
    const { app, db } = build(() => NOW, false);
    const u = await mkUser(app, db, 'nokill@ex.com');
    const id = insertPosition(db, u.id);
    const body = await jsonOf(await rq(app, 'POST', `/api/positions/${id}/close-draft`, { jar: u.jar, csrf: true }));
    expect(body.executable).toBe(false);
    expect(body.blockingReasons.map((r: { code: string }) => r.code)).toContain('LIVE_TRADING_DISABLED');
  });
});
