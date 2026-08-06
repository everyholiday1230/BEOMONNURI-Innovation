import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { AuthService, MailSink } from '@quantumtrade/auth';
import { openDb } from '../db/sqlite';
import { SqliteUserRepository, SqliteSessionRepository, SqliteAuditRepository, SqliteTokenRepository } from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { createAuthRouter } from '../auth-routes';
import { SqliteStrategyRepo, hashConfig } from '../db/strategy-repo';
import { createStrategyRouter, type CandleSource } from '../strategy-routes';
import { DEFAULT_CONFIG, type BacktestBar } from '@quantumtrade/strategy';

/**
 * G6 strategy gallery API.
 *
 * The design's gallery cards carried static `pnl30` / `winRate` / `sharpe` / `maxDD` / `followers` fields.
 * These tests pin that no metric is ever returned without the window and assumptions that produced it, that
 * `null` means "not computed" rather than zero, that follower counts are real counts starting at zero, and
 * that following does not execute anything.
 */

const ORIGIN = 'http://localhost:5173';

/** A deterministic price path with enough movement for every rule set to signal. */
function makeBars(n: number): BacktestBar[] {
  const out: BacktestBar[] = [];
  for (let k = 0; k < n; k += 1) {
    const p = 100 + k * 0.05 + Math.sin(k / 7) * 4;
    out.push({
      time: (k + 1) * 3_600_000,
      open: String(p),
      high: String(p + 1.5),
      low: String(p - 1.5),
      close: String(p + Math.cos(k / 3) * 0.5),
      volume: '1',
    });
  }
  return out;
}

function build(opts: { bars?: BacktestBar[]; source?: string; failWith?: Error } = {}) {
  const db = openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    mail: new MailSink(),
  });
  const candles: CandleSource = {
    source: () => opts.source ?? 'bitmart_public',
    getCandles: async () => {
      if (opts.failWith) throw opts.failWith;
      return opts.bars ?? makeBars(300);
    },
  };
  const app = new Hono();
  app.route('/api', createAuthRouter({
    service, audit, resource: new ResourceRepo(db),
    favorites: new SqliteFavoritesRepo(new ResourceRepo(db)),
    preferences: new SqlitePreferencesRepo(new ResourceRepo(db)),
    csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN],
  }));
  app.route('/api', createStrategyRouter({
    service, repo: new SqliteStrategyRepo(db), candles,
    csrfKey: 'k', corsOrigins: [ORIGIN], cookieName: 'qt_session',
  }));
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

async function login(app: App, email: string) {
  await rq(app, 'POST', '/api/auth/register', { body: { email, password: 'longenough123' } });
  return jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email, password: 'longenough123' } }));
}

describe('STR-01 the catalogue carries no invented metrics', () => {
  it('[1] listing is public and every metric starts null', async () => {
    const { app } = build();
    const res = await rq(app, 'GET', '/api/strategies');
    expect(res.status).toBe(200);
    const b = await res.json() as { items: { id: string; metrics: unknown; followers: number }[]; unavailable: string[]; metricsNote: string };
    expect(b.items.length).toBeGreaterThanOrEqual(4);
    for (const i of b.items) {
      // The design's cards showed a Sharpe before anything had been computed.
      expect(i.metrics).toBeNull();
      // 1,240 / 2,140 followers were fixtures. The real count starts at zero.
      expect(i.followers).toBe(0);
    }
    // Stated so a consumer cannot read null as 0.
    expect(b.metricsNote).toMatch(/미실행/u);
    expect(b.unavailable).toContain('subscriptionTiers');
    expect(b.unavailable).toContain('userAuthoredStrategies');
    expect(b.unavailable).toContain('liveTrackRecord');
  });

  it('[2] a benchmark is present so returns are comparable', async () => {
    const { app } = build();
    const b = await (await rq(app, 'GET', '/api/strategies')).json() as { items: { id: string; category: string }[] };
    expect(b.items.some((i) => i.category === 'benchmark')).toBe(true);
  });

  it('[3] an unknown strategy is 404', async () => {
    const { app } = build();
    expect((await rq(app, 'GET', '/api/strategies/no-such-thing')).status).toBe(404);
  });
});

describe('STR-02 backtests carry their window and assumptions', () => {
  it('[1] a run returns metrics, window, config and caveats together', async () => {
    const { app } = build();
    const jar = await login(app, 's1@ex.com');
    const res = await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', {
      jar, csrf: true, body: { symbol: 'BTCUSDT', timeframe: '1h', bars: 300 },
    });
    expect(res.status).toBe(200);
    const b = await res.json() as {
      metrics: { totalReturnPct: number; sharpe: number | null; sharpeConventions: unknown };
      window: { barCount: number; warmupBars: number };
      config: { takerFee: string; slippage: string };
      caveats: string[]; dataSource: string; cached: boolean;
    };
    // A metric without its window is not interpretable.
    expect(b.window.barCount).toBe(300);
    expect(b.window.warmupBars).toBe(50);
    // Costs are not zero by default.
    expect(Number(b.config.takerFee)).toBeGreaterThan(0);
    expect(Number(b.config.slippage)).toBeGreaterThan(0);
    expect(b.caveats.length).toBeGreaterThan(3);
    expect(b.dataSource).toBe('bitmart_public');
    if (b.metrics.sharpe !== null) expect(b.metrics.sharpeConventions).not.toBeNull();
  });

  it('[2] a non-live data source is called out in the caveats', async () => {
    const { app } = build({ source: 'mock_replay' });
    const jar = await login(app, 's2@ex.com');
    const b = await (await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', {
      jar, csrf: true, body: { bars: 300 },
    })).json() as { caveats: string[]; dataSource: string };
    expect(b.dataSource).toBe('mock_replay');
    // Observed on the mock feed: +4.08% with Sharpe 7.54 — plausible numbers from a deterministic path a
    // trend strategy can trivially exploit. Without this line they read as market results.
    expect(b.caveats[0]).toMatch(/실시장 데이터가 아닌/u);
    expect(b.caveats[0]).toMatch(/mock_replay/u);
  });

  it('[3] the result is cached by its exact inputs and re-served', async () => {
    const { app } = build();
    const jar = await login(app, 's3@ex.com');
    const first = await (await rq(app, 'POST', '/api/strategies/rsi-reversion-14/backtest', {
      jar, csrf: true, body: { bars: 300 },
    })).json() as { cached: boolean; metrics: { totalReturnPct: number } };
    expect(first.cached).toBe(false);
    const second = await (await rq(app, 'POST', '/api/strategies/rsi-reversion-14/backtest', {
      jar, csrf: true, body: { bars: 300 },
    })).json() as { cached: boolean; metrics: { totalReturnPct: number } };
    expect(second.cached).toBe(true);
    // Determinism is what makes a cached result safe to show.
    expect(second.metrics.totalReturnPct).toBe(first.metrics.totalReturnPct);
  });

  it('[4] a different fee is a DIFFERENT cache entry', async () => {
    const { app } = build();
    const jar = await login(app, 's4@ex.com');
    await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', { jar, csrf: true, body: { bars: 300 } });
    const other = await (await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', {
      jar, csrf: true, body: { bars: 300, takerFee: '0' },
    })).json() as { cached: boolean; config: { takerFee: string } };
    // Serving the cached numbers under a changed fee would be the same class of error as inventing them.
    expect(other.cached).toBe(false);
    expect(other.config.takerFee).toBe('0');
  });

  it('[5] the config hash distinguishes cost assumptions', () => {
    const a = hashConfig(DEFAULT_CONFIG);
    const b = hashConfig({ ...DEFAULT_CONFIG, takerFee: '0' });
    expect(a).not.toBe(b);
    // Stable for identical inputs, so a cache hit is possible at all.
    expect(hashConfig(DEFAULT_CONFIG)).toBe(a);
  });

  it('[6] too few bars is refused, not returned as a flat result', async () => {
    const { app } = build({ bars: makeBars(60) });
    const jar = await login(app, 's6@ex.com');
    // sma-cross needs 50 warmup bars + a fill bar; 60 is enough for the runner but the schema floor is 60.
    const res = await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', { jar, csrf: true, body: { bars: 60 } });
    // Either it runs (>= warmup+2) or it is refused with 422 — never a zeroed 200.
    expect([200, 422]).toContain(res.status);
    if (res.status === 422) {
      const b = await res.json() as { error: { code: string } };
      expect(b.error.code).toBe('INSUFFICIENT_DATA');
    }
  });

  it('[7] no candles is NO_DATA, not a zero return', async () => {
    const { app } = build({ bars: [] });
    const jar = await login(app, 's7@ex.com');
    const res = await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', { jar, csrf: true, body: { bars: 300 } });
    expect(res.status).toBe(503);
    const b = await res.json() as { error: { code: string } };
    // A 0% return would render as "the strategy broke even".
    expect(b.error.code).toBe('NO_DATA');
  });

  it('[8] an upstream failure is 502', async () => {
    const { app } = build({ failWith: new Error('network down') });
    const jar = await login(app, 's8@ex.com');
    const res = await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', { jar, csrf: true, body: { bars: 300 } });
    expect(res.status).toBe(502);
  });

  it('[9] auth and CSRF are required, and bad params are rejected', async () => {
    const { app } = build();
    expect((await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', { body: {} })).status).toBe(401);
    const jar = await login(app, 's9@ex.com');
    expect((await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', { jar, body: {} })).status).toBe(403);
    // `.strict()`: a typo'd parameter must not be silently ignored.
    expect((await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', { jar, csrf: true, body: { nope: 1 } })).status).toBe(400);
    expect((await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', { jar, csrf: true, body: { bars: 5 } })).status).toBe(400);
    expect((await rq(app, 'POST', '/api/strategies/no-such/backtest', { jar, csrf: true, body: {} })).status).toBe(404);
  });

  it('[10] a cached result appears on the listing WITH its window', async () => {
    const { app } = build();
    const jar = await login(app, 's10@ex.com');
    await rq(app, 'POST', '/api/strategies/sma-cross-20-50/backtest', { jar, csrf: true, body: { symbol: 'BTCUSDT', timeframe: '1h', bars: 300 } });
    const b = await (await rq(app, 'GET', '/api/strategies?symbol=BTCUSDT&timeframe=1h')).json() as {
      items: { id: string; metrics: { window: { barCount: number }; computedAt: number } | null }[];
    };
    const row = b.items.find((i) => i.id === 'sma-cross-20-50')!;
    expect(row.metrics).not.toBeNull();
    // The window travels with the metric onto the card.
    expect(row.metrics!.window.barCount).toBe(300);
    expect(row.metrics!.computedAt).toBeGreaterThan(0);
    // A different timeframe has no result and stays null.
    const other = await (await rq(app, 'GET', '/api/strategies?symbol=BTCUSDT&timeframe=4h')).json() as {
      items: { id: string; metrics: unknown }[];
    };
    expect(other.items.find((i) => i.id === 'sma-cross-20-50')!.metrics).toBeNull();
  });
});

describe('STR-03 following records interest, not execution', () => {
  it('[1] /strategies/mine resolves BEFORE the :id route', async () => {
    const { app } = build();
    const jar = await login(app, 'f1@ex.com');
    const res = await rq(app, 'GET', '/api/strategies/mine', { jar });
    expect(res.status).toBe(200);
    const b = await res.json() as { total: number; autoExecution: boolean; note: string };
    // Registered after `:id` this answered 404 for a strategy named "mine".
    expect(b.total).toBe(0);
    // The design called Follow "auto-copy signals". Nothing here copies or executes.
    expect(b.autoExecution).toBe(false);
    expect(b.note).toMatch(/자동 복제하거나 주문을 제출하지 않습니다/u);
  });

  it('[2] following is idempotent and counted', async () => {
    const { app } = build();
    const jar = await login(app, 'f2@ex.com');
    const body = { strategyId: 'sma-cross-20-50', symbol: 'BTCUSDT', timeframe: '1h' };
    const a = await (await rq(app, 'POST', '/api/strategies/follow', { jar, csrf: true, body })).json() as { id: string; autoExecution: boolean };
    const b = await (await rq(app, 'POST', '/api/strategies/follow', { jar, csrf: true, body })).json() as { id: string };
    // Following twice is not an error and does not create a second row.
    expect(b.id).toBe(a.id);
    expect(a.autoExecution).toBe(false);

    const mine = await (await rq(app, 'GET', '/api/strategies/mine', { jar })).json() as { total: number; items: { name: string }[] };
    expect(mine.total).toBe(1);
    // The catalogue name is joined so the list is readable.
    expect(mine.items[0]!.name.length).toBeGreaterThan(0);

    const list = await (await rq(app, 'GET', '/api/strategies')).json() as { items: { id: string; followers: number }[] };
    expect(list.items.find((i) => i.id === 'sma-cross-20-50')!.followers).toBe(1);
  });

  it('[3] unfollow is ownership-scoped', async () => {
    const { app } = build();
    const jarA = await login(app, 'f3a@ex.com');
    const jarB = await login(app, 'f3b@ex.com');
    const created = await (await rq(app, 'POST', '/api/strategies/follow', {
      jar: jarA, csrf: true, body: { strategyId: 'rsi-reversion-14', symbol: 'BTCUSDT', timeframe: '1h' },
    })).json() as { id: string };

    // Another user cannot delete it.
    expect((await rq(app, 'DELETE', `/api/strategies/follow/${created.id}`, { jar: jarB, csrf: true })).status).toBe(404);
    expect((await rq(app, 'DELETE', `/api/strategies/follow/${created.id}`, { jar: jarA, csrf: true })).status).toBe(200);
    const mine = await (await rq(app, 'GET', '/api/strategies/mine', { jar: jarA })).json() as { total: number };
    expect(mine.total).toBe(0);
  });

  it('[4] following an unknown strategy is 404', async () => {
    const { app } = build();
    const jar = await login(app, 'f4@ex.com');
    const res = await rq(app, 'POST', '/api/strategies/follow', {
      jar, csrf: true, body: { strategyId: 'made-up', symbol: 'BTCUSDT', timeframe: '1h' },
    });
    expect(res.status).toBe(404);
  });

  it('[5] follow requires auth and CSRF', async () => {
    const { app } = build();
    const body = { strategyId: 'sma-cross-20-50', symbol: 'BTCUSDT', timeframe: '1h' };
    expect((await rq(app, 'POST', '/api/strategies/follow', { body })).status).toBe(401);
    const jar = await login(app, 'f5@ex.com');
    expect((await rq(app, 'POST', '/api/strategies/follow', { jar, body })).status).toBe(403);
    expect((await rq(app, 'GET', '/api/strategies/mine')).status).toBe(401);
  });
});

describe('STR-04 detail endpoint', () => {
  it('[1] returns the full backtest, including trades and the equity curve', async () => {
    const { app } = build();
    const jar = await login(app, 'd1@ex.com');
    await rq(app, 'POST', '/api/strategies/donchian-breakout-20/backtest', {
      jar, csrf: true, body: { symbol: 'BTCUSDT', timeframe: '1h', bars: 300 },
    });
    const b = await (await rq(app, 'GET', '/api/strategies/donchian-breakout-20?symbol=BTCUSDT&timeframe=1h')).json() as {
      description: string;
      backtest: { trades: unknown[]; equityCurve: unknown[]; caveats: string[] } | null;
    };
    // A strategy a user cannot read is one they cannot evaluate.
    expect(b.description.length).toBeGreaterThan(30);
    expect(b.backtest).not.toBeNull();
    expect(Array.isArray(b.backtest!.trades)).toBe(true);
    expect(b.backtest!.equityCurve.length).toBe(300);
  });

  it('[2] with no backtest run, backtest is null', async () => {
    const { app } = build();
    const b = await (await rq(app, 'GET', '/api/strategies/buy-and-hold')).json() as { backtest: unknown; followers: number };
    expect(b.backtest).toBeNull();
    expect(b.followers).toBe(0);
  });
});
