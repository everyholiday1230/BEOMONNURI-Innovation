import { describe, it, expect } from 'vitest';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { AuthService, MailSink } from '@quantumtrade/auth';
import type { IExchangeAccountAdapter } from '@quantumtrade/exchange-bitmart';
import { openDb } from '../db/sqlite';
import { SqliteUserRepository, SqliteSessionRepository, SqliteAuditRepository, SqliteTokenRepository } from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { SqliteCredentialRepo } from '../db/trading-repos';
import { createAuthRouter } from '../auth-routes';
import { createTradingRouter } from '../trading-routes';
import { CredentialVault, LocalKekProvider } from '../trading/credential-vault';
import type { TradingPolicy } from '../trading/risk-engine';
import type { SymbolInfo } from '@quantumtrade/schemas';

const ORIGIN = 'http://localhost:5173';
const SYM: Record<string, SymbolInfo> = { BTCUSDT: { id: 'BTCUSDT', base: 'BTC', quote: 'USDT', contractType: 'perpetual', pricePrecision: 1, quantityPrecision: 3, tickSize: '0.1', stepSize: '0.001', minQty: '0.001', maxLeverage: 125 } };
const POLICY: TradingPolicy = { allowedSymbols: ['BTCUSDT'], maxOrderNotional: '100000', maxLeverage: 20, maxOpenPositions: 5, dailyOrderLimit: 50, dailyLossLimit: '1000', priceDeviationLimitPct: 5 };

const mockAccount: IExchangeAccountAdapter = {
  async getServerTime() { return Date.now(); },
  async getBalances() { return [{ asset: 'USDT', available: '1000', equity: '1200', used: '200' }]; },
  async getPositions() { return []; },
  async getOpenOrders() { return []; },
  async getOrderByClientId() { return null; },
};

function build(riskState?: Parameters<typeof createTradingRouter>[0]['riskState']) {
  const db = openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    mail: new MailSink(),
  });
  const app = new Hono();
  app.route('/api', createAuthRouter({ service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN] }));
  app.route('/api', createTradingRouter({
    service, vault: new CredentialVault(new LocalKekProvider(randomBytes(32).toString('base64'))),
    credRepo: new SqliteCredentialRepo(db), accountAdapter: mockAccount, exchangeId: 'bitmart', policy: POLICY, symbolInfo: SYM,
    csrfKey: 'k', corsOrigins: [ORIGIN], cookieName: 'qt_session', mode: 'BITMART_LIVE_READ_ONLY',
    liveTradingEnabled: false, killSwitch: true,
    ...(riskState ? { riskState } : {}),
  }));
  return { app, db };
}

function jarFrom(res: Response) {
  const out: Record<string, string> = {};
  for (const sc of res.headers.getSetCookie?.() ?? []) { const [p] = sc.split(';'); const i = p!.indexOf('='); out[p!.slice(0, i)] = p!.slice(i + 1); }
  return out;
}
const cj = (j: Record<string, string>) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
type App = ReturnType<typeof build>['app'];
async function reqA(app: App, method: string, path: string, o: { jar?: Record<string, string>; csrf?: boolean; body?: unknown; headers?: Record<string, string> } = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN, ...(o.headers ?? {}) };
  if (o.jar) h['cookie'] = cj(o.jar);
  if (o.csrf && o.jar?.['qt_csrf']) h['x-csrf-token'] = o.jar['qt_csrf'];
  const init: RequestInit = { method, headers: h };
  if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(o.body ?? {});
  return app.request(path, init);
}
async function login(app: App, email: string) {
  await reqA(app, 'POST', '/api/auth/register', { body: { email, password: 'longenough123' } });
  return jarFrom(await reqA(app, 'POST', '/api/auth/login', { body: { email, password: 'longenough123' } }));
}

describe('Phase 3 trading routes', () => {
  it('create credential returns masked only (no secret/memo)', async () => {
    const { app } = build();
    const jar = await login(app, 'c1@ex.com');
    const res = await reqA(app, 'POST', '/api/trading/credentials', { jar, csrf: true, body: { accessKey: 'AKIA1234567890', secretKey: 'SECRET', memo: 'MEMO', label: 'main' } });
    expect(res.status).toBe(201);
    const body = JSON.stringify(await res.json());
    expect(body).toContain('AKIA…7890');
    expect(body).not.toContain('SECRET');
    expect(body).not.toContain('MEMO');
  });

  it('verify sets VERIFIED via read-only probe (mock)', async () => {
    const { app } = build();
    const jar = await login(app, 'c2@ex.com');
    const created = await (await reqA(app, 'POST', '/api/trading/credentials', { jar, csrf: true, body: { accessKey: 'ak', secretKey: 's', memo: 'm' } })).json() as { id: string };
    const v = await (await reqA(app, 'POST', `/api/trading/credentials/${created.id}/verify`, { jar, csrf: true })).json() as { connectionStatus: string };
    expect(v.connectionStatus).toBe('VERIFIED');
  });

  it('cross-user cannot verify or see another user credential (404 / isolation)', async () => {
    const { app } = build();
    const jarA = await login(app, 'A3@ex.com');
    const jarB = await login(app, 'B3@ex.com');
    const created = await (await reqA(app, 'POST', '/api/trading/credentials', { jar: jarA, csrf: true, body: { accessKey: 'ak', secretKey: 's', memo: 'm' } })).json() as { id: string };
    expect((await reqA(app, 'POST', `/api/trading/credentials/${created.id}/verify`, { jar: jarB, csrf: true })).status).toBe(404);
    const statusB = await (await reqA(app, 'GET', '/api/trading/connection-status', { jar: jarB })).json() as { credentials: unknown[] };
    expect(statusB.credentials.length).toBe(0);
  });

  it('connection-status reports live disabled + kill switch on by default', async () => {
    const { app } = build();
    const jar = await login(app, 'c4@ex.com');
    const st = await (await reqA(app, 'GET', '/api/trading/connection-status', { jar })).json() as { liveTradingEnabled: boolean; emergencyKillSwitch: boolean; mode: string };
    expect(st.liveTradingEnabled).toBe(false);
    expect(st.emergencyKillSwitch).toBe(true);
    expect(st.mode).toBe('BITMART_LIVE_READ_ONLY');
  });

  it('order submit is SHADOW/blocked — never transmitted; idempotent', async () => {
    const { app } = build();
    const jar = await login(app, 'c5@ex.com');
    const body = { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000.0', quantity: '0.01', leverage: 5, stopLoss: '67000.0', takeProfit: '70000.0', riskReward: '2', maxEstLoss: '10', positionValue: '680', referencePrice: '68010.0', confirmationToken: 'x' };
    const r1 = await (await reqA(app, 'POST', '/api/trading/orders/submit', { jar, csrf: true, headers: { 'idempotency-key': 'idem-A' }, body })).json() as { transmitted: boolean; liveGateAllowed: boolean };
    expect(r1.transmitted).toBe(false);
    expect(r1.liveGateAllowed).toBe(false); // read-only mode + kill switch
    // idempotent replay → same result
    const r2 = await (await reqA(app, 'POST', '/api/trading/orders/submit', { jar, csrf: true, headers: { 'idempotency-key': 'idem-A' }, body })).json();
    expect(r2).toEqual(r1);
    // missing idempotency key → 400
    expect((await reqA(app, 'POST', '/api/trading/orders/submit', { jar, csrf: true, body })).status).toBe(400);
  });

  it('unauthenticated + missing CSRF are rejected', async () => {
    const { app } = build();
    expect((await reqA(app, 'GET', '/api/trading/connection-status', {})).status).toBe(401);
    const jar = await login(app, 'c6@ex.com');
    expect((await reqA(app, 'POST', '/api/trading/credentials', { jar, body: { accessKey: 'a', secretKey: 's', memo: 'm' } })).status).toBe(403);
  });
});

/**
 * Added 2026-08-03.
 *
 * Eight risk-engine inputs were hardcoded literals in the submit handler:
 * `credentialStatus:'VERIFIED'`, `futureTradePermissionVerified:true`, `dailyOrderCount:0`,
 * `dailyLossSoFar:'0'`, `openPositions:0`, `marketDataStatus:'LIVE'`,
 * `exchangeConnectivityHealthy:true`, `idempotencyKeyValid:true`.
 *
 * Every gate that depends on them therefore ALWAYS passed — a user with no exchange key satisfied the
 * credential gate, and the daily-order and open-position limits could never trigger because their inputs
 * were constants. `countOrdersSince()` already existed for this ("used by the daily-order-count risk gate")
 * and was never called.
 */
describe('RISK-WIRE — the risk engine reads real state', () => {
  it('[1] validate returns the FULL gate list, which submit alone never did', async () => {
    const { app } = build();
    const jar = await login(app, 'rw1@ex.com');
    const res = await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    });
    expect(res.status).toBe(200);
    const b = await res.json() as { gates: { id: string; status: string }[]; dryRun: boolean; unknownInputs: string[] };
    // Without this endpoint a user learned which gate blocked them only AFTER pressing submit.
    expect(Array.isArray(b.gates)).toBe(true);
    expect(b.gates.length).toBeGreaterThan(5);
    expect(b.dryRun).toBe(true);
    expect(Array.isArray(b.unknownInputs)).toBe(true);
  });

  it('[2] a user with NO exchange key does not pass the credential gate', async () => {
    const { app } = build();
    const jar = await login(app, 'rw2@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { state: { credentialStatus: string; futureTradePermissionVerified: boolean } };
    // Was 'VERIFIED' as a literal, regardless of whether any key existed.
    expect(b.state.credentialStatus).toBe('NONE');
    expect(b.state.futureTradePermissionVerified).toBe(false);
  });

  it('[3] the daily order count comes from the store, not a constant 0', async () => {
    let asked: { userId: string; since: number } | null = null;
    const { app } = build({
      countOrdersSince: (userId, since) => { asked = { userId, since }; return 41; },
    });
    const jar = await login(app, 'rw3@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { state: { dailyOrderCount: number }; gates: { id: string; status: string }[] };
    expect(b.state.dailyOrderCount).toBe(41);
    expect(asked).not.toBeNull();
    // A 24h window.
    expect(Date.now() - asked!.since).toBeGreaterThan(86_000_000);
    // POLICY.dailyOrderLimit is 50 in this harness, so 41 still passes — the point is that the real value
    // reached the gate.
    const g = b.gates.find((x) => x.id === 'policy.dailyOrders');
    expect(g).toBeTruthy();
  });

  it('[4] exceeding the daily order limit now FAILS the gate', async () => {
    const { app } = build({ countOrdersSince: () => 9999 });
    const jar = await login(app, 'rw4@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { pass: boolean; gates: { id: string; status: string; detail: string }[] };
    const g = b.gates.find((x) => x.id === 'policy.dailyOrders')!;
    // With the input hardcoded to 0 this gate could never fail.
    expect(g.status).toBe('fail');
    expect(g.detail).toContain('9999');
    expect(b.pass).toBe(false);
  });

  it('[5] an undeterminable input is REPORTED, not treated as a pass', async () => {
    const { app } = build();
    const jar = await login(app, 'rw5@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { unknownInputs: string[]; state: { marketDataStatus: string } };
    // No riskState injected → the count and freshness cannot be determined and must say so.
    expect(b.unknownInputs).toContain('dailyOrderCount');
    expect(b.unknownInputs).toContain('marketDataStatus');
    expect(b.state.marketDataStatus).toBe('UNAVAILABLE');
  });

  it('[6] mock market data is STALE, not LIVE', async () => {
    const { app } = build({ countOrdersSince: () => 0, marketDataStatus: () => 'STALE' });
    const jar = await login(app, 'rw6@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { state: { marketDataStatus: string }; pass: boolean };
    // Deterministic fixture data must not satisfy a freshness gate; `marketDataStatus:'LIVE'` was a literal.
    expect(b.state.marketDataStatus).toBe('STALE');
  });

  it('[7] validate transmits and stores nothing', async () => {
    const { app, db } = build({ countOrdersSince: () => 0 });
    const jar = await login(app, 'rw7@ex.com');
    const before = (db.prepare('SELECT COUNT(*) n FROM orders').get() as { n: number }).n;
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { note: string };
    expect(b.note).toContain('nothing transmitted');
    expect((db.prepare('SELECT COUNT(*) n FROM orders').get() as { n: number }).n).toBe(before);
  });

  it('[8] validate requires auth and CSRF', async () => {
    const { app } = build();
    expect((await reqA(app, 'POST', '/api/trading/orders/validate', { body: {} })).status).toBe(401);
    const jar = await login(app, 'rw8@ex.com');
    // No CSRF header.
    expect((await reqA(app, 'POST', '/api/trading/orders/validate', { jar, body: {} })).status).toBe(403);
  });

  it('[9] submit also returns the gate list so a rejection is explainable', async () => {
    const { app } = build({ countOrdersSince: () => 0 });
    const jar = await login(app, 'rw9@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/submit', {
      jar, csrf: true, headers: { 'idempotency-key': 'k-rw9' },
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { transmitted: boolean; gates?: unknown[]; unknownInputs?: string[] };
    expect(b.transmitted).toBe(false);
    expect(Array.isArray(b.gates)).toBe(true);
    expect(Array.isArray(b.unknownInputs)).toBe(true);
  });
});
