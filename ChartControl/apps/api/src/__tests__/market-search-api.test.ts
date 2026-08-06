import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { SymbolInfo } from '@quantumtrade/schemas';
import { createMarketSearchRouter } from '../market/market-routes';

/**
 * MKT-01 route contract over real HTTP.
 *
 * The router is mounted exactly as `index.ts` mounts it, so schema/handler/response drift fails here.
 * The catalogue is injected, which keeps the test offline and lets the provider-failure path be
 * exercised for real instead of being assumed.
 */

const sym = (id: string, base: string, quote: string, contractType: 'perpetual' | 'spot' = 'perpetual'): SymbolInfo => ({
  id, base, quote, contractType,
  pricePrecision: 2, quantityPrecision: 3,
  tickSize: '0.01', stepSize: '0.001', minQty: '0.001', maxLeverage: 20,
});

const CAT: SymbolInfo[] = [
  sym('BTCUSDT', 'BTC', 'USDT'),
  sym('WBTCUSDT', 'WBTC', 'USDT'),
  sym('ETHUSDT', 'ETH', 'USDT'),
  sym('BTCUSDC', 'BTC', 'USDC'),
  sym('SOLUSDT', 'SOL', 'USDT'),
  sym('ADAUSDT', 'ADA', 'USDT', 'spot'),
];

function build(opts: { fail?: boolean } = {}) {
  const app = new Hono();
  app.route(
    '/api',
    createMarketSearchRouter({
      getSymbols: async () => {
        if (opts.fail) throw new Error('provider unavailable');
        return CAT;
      },
      source: 'MOCK_REPLAY',
      tradingMode: 'MOCK',
      now: () => 1_700_000_000_000,
    }),
  );
  return app;
}

const get = (app: Hono, path: string) => app.request(path);

describe('GET /api/market/search', () => {
  it('returns ranked items with a total and provenance', async () => {
    const res = await get(build(), '/api/market/search?q=BTC');
    expect(res.status).toBe(200);
    const b = (await res.json()) as {
      items: { symbol: { id: string }; matched: string; score: number }[];
      total: number; normalizedQuery: string; source: string; asOf: number; stale: boolean; tradingMode: string;
    };
    expect(b.total).toBeGreaterThanOrEqual(b.items.length);
    expect(b.normalizedQuery).toBe('BTC');
    // Provenance is mandatory: a mock catalogue must not be indistinguishable from a live one.
    expect(b.source).toBe('MOCK_REPLAY');
    expect(b.asOf).toBe(1_700_000_000_000);
    expect(b.stale).toBe(false);
    expect(b.tradingMode).toBe('MOCK');
    // Ranking reaches the wire, not just the pure function.
    const ids = b.items.map((i) => i.symbol.id);
    expect(ids.indexOf('BTCUSDT')).toBeLessThan(ids.indexOf('WBTCUSDT'));
  });

  it('normalizes case and whitespace identically', async () => {
    const app = build();
    const a = (await (await get(app, '/api/market/search?q=btc')).json()) as { normalizedQuery: string; total: number };
    const b = (await (await get(app, '/api/market/search?q=%20BTC%20')).json()) as { normalizedQuery: string; total: number };
    expect([a.normalizedQuery, b.normalizedQuery]).toEqual(['BTC', 'BTC']);
    expect(a.total).toBe(b.total);
  });

  it('an empty query is a 200 catalogue head, not an error and not the whole catalogue', async () => {
    const res = await get(build(), '/api/market/search');
    expect(res.status).toBe(200);
    const b = (await res.json()) as { items: unknown[]; emptyQueryPolicy: string; total: number };
    expect(b.emptyQueryPolicy).toBe('catalogue-head');
    expect(b.total).toBe(CAT.length);
    expect(b.items.length).toBeLessThanOrEqual(20);
  });

  it('an unsupported symbol is an empty 200, not a 404', async () => {
    const res = await get(build(), '/api/market/search?q=NOSUCHSYMBOL');
    expect(res.status).toBe(200);
    const b = (await res.json()) as { items: unknown[]; total: number };
    expect(b.items).toEqual([]);
    expect(b.total).toBe(0);
  });

  it('rejects an over-long query with 400 and names the field, without echoing the input', async () => {
    const long = 'A'.repeat(200);
    const res = await get(build(), `/api/market/search?q=${long}`);
    expect(res.status).toBe(400);
    const raw = await res.text();
    const b = JSON.parse(raw) as { error: { code: string; correlationId: string }; issues: { path: string }[] };
    expect(b.error.code).toBe('BAD_REQUEST');
    expect(b.error.correlationId).toBeTruthy();
    expect(b.issues.map((i) => i.path)).toContain('q');
    // The rejected value must not be reflected back.
    expect(raw).not.toContain(long);
  });

  it('rejects out-of-range paging', async () => {
    const app = build();
    expect((await get(app, '/api/market/search?limit=10000')).status).toBe(400);
    expect((await get(app, '/api/market/search?limit=0')).status).toBe(400);
    expect((await get(app, '/api/market/search?offset=-1')).status).toBe(400);
  });

  it('rejects an unknown parameter instead of silently ignoring it', async () => {
    expect((await get(build(), '/api/market/search?quotes=USDT')).status).toBe(400);
  });

  it('paging is stable: two half-pages equal the first whole page', async () => {
    const app = build();
    const j = async (p: string) => ((await (await get(app, p)).json()) as { items: { symbol: { id: string } }[] }).items.map((i) => i.symbol.id);
    const all = await j('/api/market/search?limit=4&offset=0');
    const p1 = await j('/api/market/search?limit=2&offset=0');
    const p2 = await j('/api/market/search?limit=2&offset=2');
    expect([...p1, ...p2]).toEqual(all);
    expect(new Set([...p1, ...p2]).size).toBe(4);
  });

  it('filters narrow the result set', async () => {
    const app = build();
    const usdc = (await (await get(app, '/api/market/search?q=BTC&quote=USDC')).json()) as {
      items: { symbol: { id: string; quote: string } }[];
    };
    expect(usdc.items.map((i) => i.symbol.id)).toEqual(['BTCUSDC']);
    const spot = (await (await get(app, '/api/market/search?contractType=spot')).json()) as { total: number };
    expect(spot.total).toBe(1);
  });

  it('a provider failure is a 502, NOT an empty result set', async () => {
    const res = await get(build({ fail: true }), '/api/market/search?q=BTC');
    expect(res.status).toBe(502);
    const b = (await res.json()) as { error: { code: string } };
    expect(b.error.code).toBe('UPSTREAM_ERROR');
  });

  it('is a public market read: it works with no session and no credential', async () => {
    // No cookie, no CSRF token, no auth header.
    expect((await get(build(), '/api/market/search?q=ETH')).status).toBe(200);
  });
});
