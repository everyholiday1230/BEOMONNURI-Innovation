import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { AuthService, MailSink, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import { openDb } from '../db/sqlite';
import {
  SqliteUserRepository,
  SqliteSessionRepository,
  SqliteAuditRepository,
  SqliteTokenRepository,
} from '../db/repos';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { ResourceRepo } from '../db/resource-repo';
import { createAuthRouter } from '../auth-routes';
import { createAnalyticsRouter } from '../analytics/analytics-routes';
import {
  SqliteJournalRepo,
  computeRealizedPnl,
  computeRoiPct,
  utcDateKey,
} from '../db/journal-repo';

/**
 * G7 — trade journal + realized PnL, over real HTTP with a real database and a real session.
 *
 * The load-bearing claims:
 *  - PnL is computed by the SERVER from prices, never accepted from the client (an auditable journal
 *    cannot take the number on trust);
 *  - money maths is exact (decimal), because a journal that cannot be reconciled against an exchange
 *    statement is useless;
 *  - prices and size are immutable after creation;
 *  - "no trades" is reported as absence, not as 0% win rate;
 *  - one user cannot see or touch another user's entries.
 */

const ORIGIN = 'http://localhost:5173';

function build() {
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
    createAnalyticsRouter({
      service,
      repo: new SqliteJournalRepo(db),
      posture: {
        source: 'MOCK',
        tradingMode: 'MOCK',
        liveTradingEnabled: false,
        killSwitchActive: true,
      },
      csrfKey: 'k',
      corsOrigins: [ORIGIN],
      cookieName: 'qt_session',
      verifyCsrf,
      originAllowed,
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

async function rq(
  app: App,
  method: string,
  path: string,
  o: { jar?: Record<string, string>; csrf?: boolean; body?: unknown } = {},
) {
  const h: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN };
  if (o.jar) h['cookie'] = cj(o.jar);
  if (o.csrf && o.jar?.['qt_csrf']) h['x-csrf-token'] = o.jar['qt_csrf'];
  const init: RequestInit = { method, headers: h };
  if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(o.body ?? {});
  return app.request(path, init);
}

async function mkUser(app: App, email: string) {
  await rq(app, 'POST', '/api/auth/register', { body: { email, password: 'longenough123' } });
  return jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email, password: 'longenough123' } }));
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 7, 1, 12, 0, 0); // 2026-08-01T12:00:00Z

const ENTRY = {
  symbol: 'BTCUSDT',
  side: 'long' as const,
  entryPrice: '67000',
  exitPrice: '68000',
  size: '0.01',
  fees: '0.408',
  openedAt: T0 - 3_600_000,
  closedAt: T0,
};

// ===========================================================================
describe('JRN-01 PnL maths', () => {
  it('[1] long and short signs are correct', () => {
    expect(computeRealizedPnl('long', '100', '110', '2')).toBe('20');
    expect(computeRealizedPnl('long', '110', '100', '2')).toBe('-20');
    expect(computeRealizedPnl('short', '110', '100', '2')).toBe('20');
    expect(computeRealizedPnl('short', '100', '110', '2')).toBe('-20');
  });

  it('[2] exact with operands that drift in floats', () => {
    // (0.3 - 0.1) * 3 is 0.6000000000000001 in doubles.
    expect(computeRealizedPnl('long', '0.1', '0.3', '3')).toBe('0.6');
    expect(computeRealizedPnl('long', '67000.12', '68000.34', '0.03')).toBe('30.0066');
  });

  it('[3] ROI is a percentage of the cost basis', () => {
    // (110-100)*2 = 20 on a basis of 200 → 10%.
    expect(computeRoiPct('long', '100', '110', '2')).toBe('10');
  });

  it('[3b] ROI is rounded to 4dp — a repeating decimal must not be stored to 40 digits', () => {
    const roi = computeRoiPct('long', '67000', '68000', '0.01')!;
    expect(roi).toBe('1.4925');
    expect((roi.split('.')[1] ?? '').length).toBeLessThanOrEqual(4);
  });

  it('[4] a zero cost basis has no ROI — null, not Infinity', () => {
    expect(computeRoiPct('long', '0', '110', '2')).toBeNull();
    expect(computeRoiPct('long', '100', '110', '0')).toBeNull();
  });

  it('[5] UTC day keys, so two viewers never disagree about the date', () => {
    // 23:30 UTC and 00:30 UTC the next day are different days regardless of the reader's timezone.
    expect(utcDateKey(Date.UTC(2026, 7, 1, 23, 30))).toBe('2026-08-01');
    expect(utcDateKey(Date.UTC(2026, 7, 2, 0, 30))).toBe('2026-08-02');
  });
});

// ===========================================================================
describe('JRN-02 create', () => {
  it('[1] the server computes PnL and ROI from the prices', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'a@x.com');
    const res = await rq(app, 'POST', '/api/analytics/journal', { jar, csrf: true, body: ENTRY });
    expect(res.status).toBe(201);
    const row = (await res.json()) as { realizedPnl: string; roiPct: string; source: string };
    // (68000 - 67000) * 0.01 = 10
    expect(row.realizedPnl).toBe('10');
    // 10 / (67000 * 0.01) * 100 = 1.49253731... — a repeating decimal, rounded to 4dp for storage.
    expect(row.roiPct).toBe('1.4925');
    expect(row.source).toBe('manual');
  });

  it('[2] a client-supplied realizedPnl is rejected, not trusted', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'b@x.com');
    const res = await rq(app, 'POST', '/api/analytics/journal', {
      jar,
      csrf: true,
      body: { ...ENTRY, realizedPnl: '999999' },
    });
    // `.strict()`: an unknown field is a 400 rather than being silently ignored.
    expect(res.status).toBe(400);
  });

  it('[3] fees are stored but NOT subtracted from realized PnL', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'c@x.com');
    const row = (await (
      await rq(app, 'POST', '/api/analytics/journal', { jar, csrf: true, body: ENTRY })
    ).json()) as { realizedPnl: string; fees: string };
    // Gross and net are different figures; conflating them makes the journal unreconcilable.
    expect(row.realizedPnl).toBe('10');
    expect(row.fees).toBe('0.408');
  });

  it('[4] invalid input is rejected without echoing the value back', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'd@x.com');
    const res = await rq(app, 'POST', '/api/analytics/journal', {
      jar,
      csrf: true,
      body: { ...ENTRY, entryPrice: '<script>' },
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain('<script>');
  });

  it('[5] closedAt before openedAt is rejected', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'e@x.com');
    const res = await rq(app, 'POST', '/api/analytics/journal', {
      jar,
      csrf: true,
      body: { ...ENTRY, openedAt: T0, closedAt: T0 - 1000 },
    });
    expect(res.status).toBe(400);
  });

  it('[6] a non-positive price or size is rejected', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'f@x.com');
    for (const bad of [{ size: '0' }, { entryPrice: '0' }, { exitPrice: '-1' }]) {
      const res = await rq(app, 'POST', '/api/analytics/journal', {
        jar,
        csrf: true,
        body: { ...ENTRY, ...bad },
      });
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('[7] duplicate tags are collapsed', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'g@x.com');
    const row = (await (
      await rq(app, 'POST', '/api/analytics/journal', {
        jar,
        csrf: true,
        body: { ...ENTRY, tags: ['breakout', 'breakout', 'news'] },
      })
    ).json()) as { tags: string[] };
    expect(row.tags).toEqual(['breakout', 'news']);
  });

  it('[8] CSRF is required', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'h@x.com');
    const res = await rq(app, 'POST', '/api/analytics/journal', { jar, body: ENTRY });
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
describe('JRN-03 annotations only', () => {
  async function seed(email: string) {
    const { app } = build();
    const jar = await mkUser(app, email);
    const row = (await (
      await rq(app, 'POST', '/api/analytics/journal', { jar, csrf: true, body: ENTRY })
    ).json()) as { id: string };
    return { app, jar, id: row.id };
  }

  it('[1] mood, tags and note can be edited', async () => {
    const { app, jar, id } = await seed('i@x.com');
    const res = await rq(app, 'PATCH', `/api/analytics/journal/${id}`, {
      jar,
      csrf: true,
      body: { mood: 'disciplined', tags: ['plan'], note: '계획대로 진입' },
    });
    expect(res.status).toBe(200);
    const row = (await res.json()) as { mood: string; tags: string[]; note: string };
    expect(row.mood).toBe('disciplined');
    expect(row.tags).toEqual(['plan']);
    expect(row.note).toBe('계획대로 진입');
  });

  it('[2] prices, size and PnL cannot be changed', async () => {
    const { app, jar, id } = await seed('j@x.com');
    for (const bad of [{ entryPrice: '1' }, { size: '99' }, { realizedPnl: '999' }, { symbol: 'ETHUSDT' }]) {
      const res = await rq(app, 'PATCH', `/api/analytics/journal/${id}`, { jar, csrf: true, body: bad });
      // An entry whose PnL is editable after the fact is not a record of anything.
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    const row = (await (await rq(app, 'GET', `/api/analytics/journal`, { jar })).json()) as {
      items: { realizedPnl: string; entryPrice: string }[];
    };
    expect(row.items[0]!.realizedPnl).toBe('10');
    expect(row.items[0]!.entryPrice).toBe('67000');
  });

  it('[3] null clears a field, omission leaves it alone', async () => {
    const { app, jar, id } = await seed('k@x.com');
    await rq(app, 'PATCH', `/api/analytics/journal/${id}`, {
      jar,
      csrf: true,
      body: { mood: 'fomo', note: 'keep' },
    });
    const cleared = (await (
      await rq(app, 'PATCH', `/api/analytics/journal/${id}`, { jar, csrf: true, body: { mood: null } })
    ).json()) as { mood: string | null; note: string | null };
    expect(cleared.mood).toBeNull();
    // `note` was not mentioned, so it survives.
    expect(cleared.note).toBe('keep');
  });

  it('[4] an unknown id is 404', async () => {
    const { app, jar } = await seed('l@x.com');
    const res = await rq(app, 'PATCH', '/api/analytics/journal/nope', { jar, csrf: true, body: { mood: 'neutral' } });
    expect(res.status).toBe(404);
  });

  it('[5] an unsupported mood is rejected', async () => {
    const { app, jar, id } = await seed('m@x.com');
    const res = await rq(app, 'PATCH', `/api/analytics/journal/${id}`, {
      jar,
      csrf: true,
      body: { mood: 'euphoric' },
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
describe('JRN-04 ownership', () => {
  it('[1] one user cannot read or mutate another user\u2019s entry', async () => {
    const { app } = build();
    const alice = await mkUser(app, 'alice@x.com');
    const bob = await mkUser(app, 'bob@x.com');

    const row = (await (
      await rq(app, 'POST', '/api/analytics/journal', { jar: alice, csrf: true, body: ENTRY })
    ).json()) as { id: string };

    const bobList = (await (await rq(app, 'GET', '/api/analytics/journal', { jar: bob })).json()) as {
      items: unknown[];
    };
    expect(bobList.items).toEqual([]);

    // 404, not 403: a 403 would confirm the id exists.
    expect(
      (await rq(app, 'PATCH', `/api/analytics/journal/${row.id}`, { jar: bob, csrf: true, body: { mood: 'neutral' } }))
        .status,
    ).toBe(404);
    expect((await rq(app, 'DELETE', `/api/analytics/journal/${row.id}`, { jar: bob, csrf: true })).status).toBe(404);

    // Alice's entry is untouched.
    const aliceList = (await (await rq(app, 'GET', '/api/analytics/journal', { jar: alice })).json()) as {
      items: unknown[];
    };
    expect(aliceList.items).toHaveLength(1);
  });

  it('[2] unauthenticated access is 401 on every route', async () => {
    const { app } = build();
    expect((await rq(app, 'GET', '/api/analytics/journal')).status).toBe(401);
    expect((await rq(app, 'GET', '/api/analytics/daily-pnl')).status).toBe(401);
    expect((await rq(app, 'POST', '/api/analytics/journal', { body: ENTRY })).status).toBe(401);
    expect((await rq(app, 'DELETE', '/api/analytics/journal/x')).status).toBe(401);
  });
});

// ===========================================================================
describe('JRN-05 list', () => {
  async function seedMany(email: string) {
    const { app } = build();
    const jar = await mkUser(app, email);
    const entries = [
      { ...ENTRY, symbol: 'BTCUSDT', side: 'long' as const, closedAt: T0, mood: 'confident' as const },
      { ...ENTRY, symbol: 'ETHUSDT', side: 'short' as const, entryPrice: '3400', exitPrice: '3300', size: '1', closedAt: T0 + DAY },
      { ...ENTRY, symbol: 'BTCUSDT', side: 'long' as const, entryPrice: '68000', exitPrice: '67000', closedAt: T0 + 2 * DAY },
    ];
    for (const e of entries) {
      await rq(app, 'POST', '/api/analytics/journal', { jar, csrf: true, body: e });
    }
    return { app, jar };
  }

  it('[1] newest first with paging metadata', async () => {
    const { app, jar } = await seedMany('n@x.com');
    const body = (await (await rq(app, 'GET', '/api/analytics/journal', { jar })).json()) as {
      items: { closedAt: number }[];
      page: { total: number; hasMore: boolean };
    };
    expect(body.page.total).toBe(3);
    expect(body.page.hasMore).toBe(false);
    expect(body.items.map((i) => i.closedAt)).toEqual([T0 + 2 * DAY, T0 + DAY, T0]);
  });

  it('[2] filters by symbol, side and mood', async () => {
    const { app, jar } = await seedMany('o@x.com');
    const bySymbol = (await (
      await rq(app, 'GET', '/api/analytics/journal?symbol=BTCUSDT', { jar })
    ).json()) as { items: unknown[] };
    expect(bySymbol.items).toHaveLength(2);

    const bySide = (await (await rq(app, 'GET', '/api/analytics/journal?side=short', { jar })).json()) as {
      items: unknown[];
    };
    expect(bySide.items).toHaveLength(1);

    const byMood = (await (
      await rq(app, 'GET', '/api/analytics/journal?mood=confident', { jar })
    ).json()) as { items: unknown[] };
    expect(byMood.items).toHaveLength(1);
  });

  it('[3] a date range filters on closedAt inclusively', async () => {
    const { app, jar } = await seedMany('p@x.com');
    const body = (await (
      await rq(app, 'GET', `/api/analytics/journal?from=${T0}&to=${T0 + DAY}`, { jar })
    ).json()) as { items: unknown[] };
    expect(body.items).toHaveLength(2);
  });

  it('[4] an unknown query parameter is a 400, not a silently unfiltered list', async () => {
    const { app, jar } = await seedMany('q@x.com');
    expect((await rq(app, 'GET', '/api/analytics/journal?symbl=BTC', { jar })).status).toBe(400);
  });

  it('[5] a reversed range is rejected', async () => {
    const { app, jar } = await seedMany('r@x.com');
    expect((await rq(app, 'GET', '/api/analytics/journal?from=200&to=100', { jar })).status).toBe(400);
  });

  it('[6] the response states that entries are not auto-derived, and why', async () => {
    const { app, jar } = await seedMany('s@x.com');
    const body = (await (await rq(app, 'GET', '/api/analytics/journal', { jar })).json()) as {
      derivation: { automatic: boolean; reason: string };
      tradingMode: string;
    };
    expect(body.derivation.automatic).toBe(false);
    expect(body.derivation.reason).toContain('reduce_only');
    // Provenance: a simulated posture must be visible.
    expect(body.tradingMode).toBe('MOCK');
  });

  it('[7] responses are uncacheable', async () => {
    const { app, jar } = await seedMany('t@x.com');
    const res = await rq(app, 'GET', '/api/analytics/journal', { jar });
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
});

// ===========================================================================
describe('JRN-06 daily PnL', () => {
  async function seedPnl(email: string) {
    const { app } = build();
    const jar = await mkUser(app, email);
    const entries = [
      // day 1: +10 and -5 → net +5, one win one loss
      { ...ENTRY, closedAt: T0, entryPrice: '67000', exitPrice: '68000', size: '0.01', fees: '0.1' },
      { ...ENTRY, closedAt: T0 + 3_600_000, entryPrice: '68000', exitPrice: '67500', size: '0.01', fees: '0.2' },
      // day 2: exactly break-even → counts as neither win nor loss
      { ...ENTRY, closedAt: T0 + DAY, entryPrice: '68000', exitPrice: '68000', size: '0.01', fees: '0.3' },
    ];
    for (const e of entries) {
      await rq(app, 'POST', '/api/analytics/journal', { jar, csrf: true, body: e });
    }
    return { app, jar };
  }

  it('[1] buckets by UTC day with exact decimal sums', async () => {
    const { app, jar } = await seedPnl('u@x.com');
    const body = (await (await rq(app, 'GET', '/api/analytics/daily-pnl', { jar })).json()) as {
      buckets: { date: string; realizedPnl: string; fees: string; tradeCount: number; winCount: number; lossCount: number }[];
      totalRealizedPnl: string;
      totalFees: string;
      timezone: string;
    };
    expect(body.timezone).toBe('UTC');
    expect(body.buckets.map((b) => b.date)).toEqual(['2026-08-01', '2026-08-02']);
    // (68000-67000)*0.01 = 10 ; (67500-68000)*0.01 = -5 → 5
    expect(body.buckets[0]!.realizedPnl).toBe('5');
    expect(body.buckets[0]!.fees).toBe('0.3');
    expect(body.buckets[1]!.realizedPnl).toBe('0');
    expect(body.totalRealizedPnl).toBe('5');
    // 0.1 + 0.2 + 0.3 — floats give 0.6000000000000001.
    expect(body.totalFees).toBe('0.6');
  });

  it('[2] break-even counts as neither a win nor a loss', async () => {
    const { app, jar } = await seedPnl('v@x.com');
    const body = (await (await rq(app, 'GET', '/api/analytics/daily-pnl', { jar })).json()) as {
      winCount: number;
      lossCount: number;
      tradeCount: number;
      winRatePct: string;
      buckets: { winCount: number; lossCount: number; tradeCount: number }[];
    };
    expect(body.tradeCount).toBe(3);
    expect(body.winCount).toBe(1);
    expect(body.lossCount).toBe(1);
    // 1 of 2 decided trades, not 1 of 3.
    expect(body.winRatePct).toBe('50');
    expect(body.buckets[1]).toMatchObject({ tradeCount: 1, winCount: 0, lossCount: 0 });
  });

  it('[3] no trades reports absence, not a 0% win rate', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'w@x.com');
    const body = (await (await rq(app, 'GET', '/api/analytics/daily-pnl', { jar })).json()) as {
      buckets: unknown[];
      winRatePct: string | null;
      totalRealizedPnl: string;
      from: string | null;
      to: string | null;
    };
    expect(body.buckets).toEqual([]);
    // 0% would claim every trade lost.
    expect(body.winRatePct).toBeNull();
    expect(body.totalRealizedPnl).toBe('0');
    expect(body.from).toBeNull();
    expect(body.to).toBeNull();
  });

  it('[4] a date range narrows the buckets', async () => {
    const { app, jar } = await seedPnl('x@x.com');
    const body = (await (
      await rq(app, 'GET', `/api/analytics/daily-pnl?from=${T0 + DAY}`, { jar })
    ).json()) as { buckets: { date: string }[] };
    expect(body.buckets.map((b) => b.date)).toEqual(['2026-08-02']);
  });

  it('[5] an unknown query parameter is a 400', async () => {
    const { app, jar } = await seedPnl('y@x.com');
    expect((await rq(app, 'GET', '/api/analytics/daily-pnl?fromm=1', { jar })).status).toBe(400);
  });
});

// ===========================================================================
describe('JRN-07 delete', () => {
  it('[1] removes the entry and it stops affecting the aggregate', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'z@x.com');
    const row = (await (
      await rq(app, 'POST', '/api/analytics/journal', { jar, csrf: true, body: ENTRY })
    ).json()) as { id: string };

    const before = (await (await rq(app, 'GET', '/api/analytics/daily-pnl', { jar })).json()) as {
      totalRealizedPnl: string;
    };
    expect(before.totalRealizedPnl).toBe('10');

    expect((await rq(app, 'DELETE', `/api/analytics/journal/${row.id}`, { jar, csrf: true })).status).toBe(200);

    const after = (await (await rq(app, 'GET', '/api/analytics/daily-pnl', { jar })).json()) as {
      totalRealizedPnl: string;
      buckets: unknown[];
    };
    expect(after.totalRealizedPnl).toBe('0');
    expect(after.buckets).toEqual([]);
  });

  it('[2] deleting twice is a 404 the second time', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'aa@x.com');
    const row = (await (
      await rq(app, 'POST', '/api/analytics/journal', { jar, csrf: true, body: ENTRY })
    ).json()) as { id: string };
    expect((await rq(app, 'DELETE', `/api/analytics/journal/${row.id}`, { jar, csrf: true })).status).toBe(200);
    expect((await rq(app, 'DELETE', `/api/analytics/journal/${row.id}`, { jar, csrf: true })).status).toBe(404);
  });

  it('[3] CSRF is required', async () => {
    const { app } = build();
    const jar = await mkUser(app, 'bb@x.com');
    const row = (await (
      await rq(app, 'POST', '/api/analytics/journal', { jar, csrf: true, body: ENTRY })
    ).json()) as { id: string };
    expect((await rq(app, 'DELETE', `/api/analytics/journal/${row.id}`, { jar })).status).toBe(403);
  });
});
