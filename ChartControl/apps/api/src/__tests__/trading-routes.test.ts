import { describe, it, expect } from 'vitest';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { AuthService, MailSink } from '@quantumtrade/auth';
import type { IExchangeAccountAdapter } from '@quantumtrade/exchange-core';
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

function build(riskState?: Parameters<typeof createTradingRouter>[0]['riskState'], extra?: Partial<Parameters<typeof createTradingRouter>[0]>) {
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
    credRepo: new SqliteCredentialRepo(db), audit, accountAdapter: mockAccount, exchangeId: 'bitmart', policy: POLICY, symbolInfo: SYM,
    csrfKey: 'k', previewSecret: 'test-preview-secret', corsOrigins: [ORIGIN], cookieName: 'qt_session', mode: 'LIVE_READ_ONLY',
    liveTradingEnabled: false, killSwitch: true,
    ...(riskState ? { riskState } : {}),
    ...(extra ?? {}),
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

describe('★★★ 거래소 API 키 행위는 감사기록에 남는다 — 키 값은 남지 않는다', () => {
  /*
     ★★★ 예전에는 등록·검증·삭제가 **어디에도 기록되지 않았다.**

       MFA_KEK 사고(8acefb4) 때 영향 범위를 세야 했는데 자격증명 관련 기록이 하나도
       없어서 **커밋 주석과 DB 행 수로 추정**할 수밖에 없었다. 고객에게 "언제부터
       언제까지 위험했다" 를 말할 근거가 없다는 뜻이다.

     ★★ 그리고 남기는 방식이 더 중요하다. **감사기록에 키가 들어가면 그 기록의
       유출이 곧 키 유출이다.** 그래서 값이 새지 않는지도 함께 확인한다 —
       마스킹된 값조차 넣지 않는다(마스킹 규칙이 바뀌면 과거 기록이 소급해 위험해진다).
  */
  const rows = (db: ReturnType<typeof openDb>) =>
    db.prepare('SELECT action, target, meta FROM audit_logs ORDER BY at').all() as
      { action: string; target: string | null; meta: string | null }[];

  it('등록 → 삭제가 각각 남고, 어떤 기록에도 키 값이 없다', async () => {
    const { app, db } = build();
    const jar = await login(app, 'aud1@ex.com');
    const AK = 'AKIA1234567890';
    const SK = 'SUPERSECRETVALUE';
    const MEMO = 'MEMOPASSPHRASE';

    const created = await (await reqA(app, 'POST', '/api/trading/credentials', {
      jar, csrf: true, body: { accessKey: AK, secretKey: SK, memo: MEMO, label: 'main' },
    })).json() as { id: string };

    let a = rows(db).filter((r) => r.action.startsWith('exchange.credential.'));
    expect(a.map((r) => r.action), '등록이 기록되지 않았다').toContain('exchange.credential.create');
    expect(a.find((r) => r.action === 'exchange.credential.create')?.target).toBe(created.id);

    const del = await reqA(app, 'DELETE', `/api/trading/credentials/${created.id}`, { jar, csrf: true });
    expect(del.status).toBe(200);

    a = rows(db).filter((r) => r.action.startsWith('exchange.credential.'));
    expect(a.map((r) => r.action), '삭제가 기록되지 않았다').toContain('exchange.credential.revoke');

    /*
       ★ 감사기록 전체(action·target·meta)를 한 덩어리로 만들어 키 조각이 있는지 본다.
         meta 만 보면 target 으로 새는 경우를 놓친다.
    */
    const dump = JSON.stringify(rows(db));
    expect(dump, 'accessKey 가 감사기록에 들어갔다').not.toContain(AK);
    expect(dump, 'secretKey 가 감사기록에 들어갔다').not.toContain(SK);
    expect(dump, 'memo(패스프레이즈)가 감사기록에 들어갔다').not.toContain(MEMO);
    /* ★ 마스킹된 형태도 넣지 않는다. */
    expect(dump, '마스킹된 키가 감사기록에 들어갔다').not.toContain('AKIA…');
  });

  it('검증(verify)도 남는다 — 실패한 검증이 반복되면 공격 신호일 수 있다', async () => {
    const { app, db } = build();
    const jar = await login(app, 'aud3@ex.com');
    const created = await (await reqA(app, 'POST', '/api/trading/credentials', {
      jar, csrf: true, body: { accessKey: 'AKIA1234567890', secretKey: 'S', memo: 'M' },
    })).json() as { id: string };
    await reqA(app, 'POST', `/api/trading/credentials/${created.id}/verify`, { jar, csrf: true });
    const acts = rows(db).map((r) => r.action);
    expect(acts, '검증이 기록되지 않았다').toContain('exchange.credential.verify');
  });

  it('없는 id 로 삭제하면(404) 기록을 남기지 않는다 — 노이즈로 덮이면 못 찾는다', async () => {
    const { app, db } = build();
    const jar = await login(app, 'aud2@ex.com');
    const r = await reqA(app, 'DELETE', '/api/trading/credentials/does-not-exist', { jar, csrf: true });
    expect(r.status).toBe(404);
    const a = rows(db).filter((x) => x.action === 'exchange.credential.revoke');
    expect(a, '실패한 삭제까지 기록됐다').toEqual([]);
  });
});

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
    expect(st.mode).toBe('LIVE_READ_ONLY');
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
    expect(Array.isArray(b.gates)).toBe(true);
    expect(b.gates.length).toBeGreaterThan(5);
    expect(b.dryRun).toBe(true);
    expect(Array.isArray(b.unknownInputs)).toBe(true);
  });

  it('[1b] the admin console kill switch blocks the live gate even with env kill OFF', async () => {
    /*
       전에는 이 라우터가 controls 를 받지 못해 관리자 콘솔의 비상정지가 실주문
       경로에 아무 영향이 없었다. env killSwitch 를 끄고 live 를 켠 상태에서도
       콘솔 킬(global_live_trading=active)이면 라이브 게이트가 닫혀야 한다.
    */
    const { app } = build(undefined, {
      liveTradingEnabled: true,
      killSwitch: false,
      controls: { killActive: (scope: string) => scope === 'global_live_trading', controlsUnknown: () => false },
    });
    const jar = await login(app, 'rw-kill@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { liveGate: { allowed: boolean } };
    expect(b.liveGate.allowed).toBe(false);
  });

  /*
     ★★ 'bitmart_live_trading' 킬스위치는 관리자 화면에서 켤 수 있었지만
       **주문 경로가 검사하지 않았다.** 검사 대상을 이름으로 나열했고 그 목록에서
       빠져 있었다. 즉 운영자가 거래를 멈췄다고 믿는 동안 실주문이 계속 나갔다.
       이제 ORDER_BLOCKING_KILL_SCOPES 를 근거로 검사한다.
  */
  it('[1c] ★★ 거래소 킬스위치(exchange_live_trading)가 실주문을 막는다', async () => {
    const { app } = build(undefined, {
      liveTradingEnabled: true,
      killSwitch: false,
      controls: { killActive: (scope: string) => scope === 'exchange_live_trading', controlsUnknown: () => false },
    });
    const jar = await login(app, 'rw-kill-ex@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { liveGate: { allowed: boolean } };
    expect(b.liveGate.allowed).toBe(false);
  });

  it('[1d] ★★ 옛 이름(bitmart_live_trading)도 실주문을 막는다 — 예전에는 무력했다', async () => {
    const { app } = build(undefined, {
      liveTradingEnabled: true,
      killSwitch: false,
      controls: { killActive: (scope: string) => scope === 'bitmart_live_trading', controlsUnknown: () => false },
    });
    const jar = await login(app, 'rw-kill-old@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { liveGate: { allowed: boolean } };
    expect(b.liveGate.allowed).toBe(false);
  });

  it('[1e] 어떤 킬스위치도 꺼져 있으면 라이브 게이트가 열린다', async () => {
    const { app } = build(undefined, {
      liveTradingEnabled: true,
      killSwitch: false,
      controls: { killActive: () => false, controlsUnknown: () => false },
    });
    const jar = await login(app, 'rw-kill-none@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { liveGate: { allowed: boolean }; gates: { id: string; status: string }[] };
    // 킬스위치 때문에 막히지 않아야 한다(다른 게이트로 막히는 것은 이 검사의 대상이 아니다).
    const kill = b.gates.find((g) => g.id.includes('kill') || g.id.includes('emergency'));
    if (kill) expect(kill.status).not.toBe('fail');
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

/*
   SPOT-META — 현물 주문은 현물 규격으로 검증해야 한다.

   ★★ 프로덕션 실측으로 드러난 문제:
     symbolInfo 는 선물 카탈로그로 채워지는데 현물 주문도 그것으로 검증했다.
       · 현물 1006개 중 559개는 선물에 없다 → 'symbol metadata unavailable' 로
         주문이 막혔다. 고객 기록에도 이 사유의 차단이 남아 있다.
       · 겹치는 심볼조차 최소수량이 다르다(ACEUSDT 선물 0.1 / 현물 10).
         선물 수량은 계약 수, 현물은 코인 수라 단위 자체가 다르다.
     그래서 멀쩡한 현물 주문을 막거나, 반대로 거래소가 거부할 주문을 통과시켰다.
*/
describe('SPOT-META 현물 주문은 현물 심볼 규격을 쓴다', () => {
  const SPOT_ONLY: Record<string, SymbolInfo> = {
    // 선물(SYM)에는 없고 현물에만 있는 심볼.
    ACXUSDT: {
      id: 'ACXUSDT', base: 'ACX', quote: 'USDT', contractType: 'spot',
      pricePrecision: 4, quantityPrecision: 2, tickSize: '0.0001', stepSize: '0.01',
      minQty: '0.01', maxLeverage: 1,
    },
  };
  const gatesOf = (b: { gates: { id: string; status: string }[] }, id: string) =>
    b.gates.find((g) => g.id === id);

  it('[1] ★★ 현물에만 있는 심볼도 메타데이터 게이트를 통과한다', async () => {
    const { app } = build(undefined, {
      spotSymbolInfo: SPOT_ONLY,
      policy: { ...POLICY, allowedSymbols: ['ACXUSDT'] },
    });
    const jar = await login(app, 'spotmeta1@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { market: 'spot', symbol: 'ACXUSDT', side: 'long', orderType: 'limit', price: '0.5000', quantity: '10', leverage: 1 },
    })).json() as { gates: { id: string; status: string }[] };
    expect(gatesOf(b, 'metadata')!.status).not.toBe('fail');
  });

  it('[2] 현물 맵이 없으면 막는다 — 선물 규격으로 몰래 통과시키지 않는다', async () => {
    const { app } = build(undefined, { policy: { ...POLICY, allowedSymbols: ['ACXUSDT'] } });
    const jar = await login(app, 'spotmeta2@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { market: 'spot', symbol: 'ACXUSDT', side: 'long', orderType: 'limit', price: '0.5000', quantity: '10', leverage: 1 },
    })).json() as { gates: { id: string; status: string }[] };
    expect(gatesOf(b, 'metadata')!.status).toBe('fail');
  });

  it('[3] 선물 주문은 계속 선물 규격을 쓴다 (현물 맵이 있어도)', async () => {
    const { app } = build(undefined, { spotSymbolInfo: SPOT_ONLY });
    const jar = await login(app, 'spotmeta3@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { market: 'futures', symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as { gates: { id: string; status: string }[] };
    expect(gatesOf(b, 'metadata')!.status).not.toBe('fail');
  });

  it('[4] ★ 최소수량은 현물 기준으로 본다 — 선물 기준이면 판정이 뒤바뀐다', async () => {
    // 현물 minQty 10 / 선물 minQty 0.001 인 심볼을 만들어, 수량 1 이 현물에서는
    // 미달이어야 한다. 선물 규격을 쓰면 통과해버린다(그게 버그였다).
    const spot: Record<string, SymbolInfo> = {
      BTCUSDT: { ...SYM.BTCUSDT!, contractType: 'spot', minQty: '10', stepSize: '1' },
    };
    const { app } = build(undefined, { spotSymbolInfo: spot });
    const jar = await login(app, 'spotmeta4@ex.com');
    const b = await (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { market: 'spot', symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '1', leverage: 1 },
    })).json() as { gates: { id: string; status: string }[] };
    expect(gatesOf(b, 'minQty')!.status).toBe('fail');
  });
});

/*
   DAILY-LOSS — 일일 손실 한도가 **실제 측정값**으로 판정된다.

   ★★ 예전에는 dailyLossSoFar 가 '0' 으로 고정돼 있었다. 그래서 운영자가 한도를
     걸어도 `0 <= 한도` 가 언제나 참이라 게이트가 영원히 통과했다 — 한도를 걸었다고
     믿는 동안 아무 것도 막지 않았다. 이제 riskState.dailyRealizedLoss 로 읽고,
     읽을 수 없으면 통과가 아니라 거부한다.
*/
describe('DAILY-LOSS 일일 손실 한도', () => {
  const gate = (b: { gates: { id: string; status: string; detail: string }[] }) =>
    b.gates.find((g) => g.id === 'policy.dailyLoss')!;
  const validate = async (extra: Partial<Parameters<typeof createTradingRouter>[0]>, email: string) => {
    const { app } = build(undefined, extra);
    const jar = await login(app, email);
    return (await reqA(app, 'POST', '/api/trading/orders/validate', {
      jar, csrf: true,
      body: { symbol: 'BTCUSDT', side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5 },
    })).json() as Promise<{ gates: { id: string; status: string; detail: string }[]; unknownInputs?: string[] }>;
  };
  const riskState = (loss: string | null) => ({
    countOrdersSince: () => 0,
    dailyRealizedLoss: async () => loss,
  });

  it('[L1] 한도가 없으면 손실이 있어도 통과하고 이유를 밝힌다', async () => {
    const b = await validate({ riskState: riskState('500'), policy: { ...POLICY, dailyLossLimit: '' } }, 'dl1@ex.com');
    expect(gate(b).status).toBe('ok');
    expect(gate(b).detail).toContain('no operator cap');
  });

  it('[L2] ★★ **저널 값만으로는 통과하지 않는다** — 자기 신고는 측정이 아니다', async () => {
    /*
       ★★ 예전에는 저널이 돌려준 값을 실측으로 보고 `100 ≤ 1000` 으로 통과시켰다.

         그런데 저널은 **고객이 손으로 적는 것**이다. 아무것도 적지 않으면 0 이 나오고,
         한도를 걸어 뒀는데 아무것도 막지 못한다. 자기 신고 0 건과 "오늘 손실이 0" 은
         전혀 다른 말이다.

       ★ 이제 거래소 실현손익(dailyLossSource='exchange')만 측정으로 인정한다.
         이 하네스에는 거래소 자격증명이 없으므로 저널로 내려가고, 따라서 거부된다 —
         시끄럽지만 정직하다. 한도를 지우면 즉시 풀린다(기본값이 '걸지 않음').
    */
    const b = await validate({ riskState: riskState('100'), policy: { ...POLICY, dailyLossLimit: '1000' } }, 'dl2@ex.com');
    expect(gate(b).status).toBe('fail');
    expect(gate(b).detail).toContain('not measured');
  });

  it('[L3] ★★ 한도를 넘은 손실도 막는다 (저널이든 실측이든 통과시키지 않는다)', async () => {
    const b = await validate({ riskState: riskState('1500'), policy: { ...POLICY, dailyLossLimit: '1000' } }, 'dl3@ex.com');
    expect(gate(b).status).toBe('fail');
  });

  it('[L4] ★★ 측정할 수 없는데 한도가 있으면 거부한다 (통과로 위장하지 않는다)', async () => {
    const b = await validate({ riskState: riskState(null), policy: { ...POLICY, dailyLossLimit: '1000' } }, 'dl4@ex.com');
    expect(gate(b).status).toBe('fail');
    expect(gate(b).detail).toContain('not measured');
    expect(b.unknownInputs ?? []).toContain('dailyLossSoFar');
  });

  it('[L5] 조회 함수가 아예 없으면 측정 불가로 보고한다', async () => {
    const b = await validate({ riskState: { countOrdersSince: () => 0 }, policy: { ...POLICY, dailyLossLimit: '1000' } }, 'dl5@ex.com');
    expect(gate(b).status).toBe('fail');
    expect(b.unknownInputs ?? []).toContain('dailyLossSoFar');
  });

  it('[L6] 조회가 예외를 던져도 게이트는 거부로 끝난다(요청이 깨지지 않는다)', async () => {
    const b = await validate({
      riskState: { countOrdersSince: () => 0, dailyRealizedLoss: async () => { throw new Error('db down'); } },
      policy: { ...POLICY, dailyLossLimit: '1000' },
    }, 'dl6@ex.com');
    expect(gate(b).status).toBe('fail');
  });
});
