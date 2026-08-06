import { describe, it, expect } from 'vitest';
import type { SymbolInfo } from '@quantumtrade/schemas';
import {
  DEFAULT_SEARCH_LIMIT,
  EMPTY_QUERY_POLICY,
  MAX_SEARCH_LIMIT,
  normalizeQuery,
  searchSymbols,
} from '../market/search';

const sym = (id: string, base: string, quote: string, contractType: 'perpetual' | 'spot' = 'perpetual'): SymbolInfo => ({
  id, base, quote, contractType,
  pricePrecision: 2, quantityPrecision: 3,
  tickSize: '0.01', stepSize: '0.001', minQty: '0.001', maxLeverage: 20,
});

const CAT: SymbolInfo[] = [
  sym('BTCUSDT', 'BTC', 'USDT'),
  sym('WBTCUSDT', 'WBTC', 'USDT'),
  sym('ETHUSDT', 'ETH', 'USDT'),
  sym('ETHBTC', 'ETH', 'BTC'),
  sym('SOLUSDT', 'SOL', 'USDT'),
  sym('BTCUSDC', 'BTC', 'USDC'),
  sym('ADAUSDT', 'ADA', 'USDT', 'spot'),
];

describe('normalizeQuery', () => {
  it('trims, strips inner whitespace and upper-cases', () => {
    expect(normalizeQuery('  btc usdt ')).toBe('BTCUSDT');
    expect(normalizeQuery(undefined)).toBe('');
    expect(normalizeQuery('   ')).toBe('');
  });
});

describe('ranking', () => {
  it('a symbol whose base IS the query outranks one that merely contains it', () => {
    // The trap: searching BTC must not put WBTCUSDT above the BTC-based pairs. Note that BTCUSDT vs
    // BTCUSDC is NOT decidable from the data — both have base BTC — so no quote preference is asserted
    // here; ranking a "primary" quote higher would be business logic this module does not model.
    const ids = searchSymbols(CAT, { q: 'btc' }).items.map((r) => r.symbol.id);
    const wbtc = ids.indexOf('WBTCUSDT');
    expect(ids.indexOf('BTCUSDT')).toBeLessThan(wbtc);
    expect(ids.indexOf('BTCUSDC')).toBeLessThan(wbtc);
  });

  it('an exact id match is first even when other rows share the prefix', () => {
    const out = searchSymbols(CAT, { q: 'BTCUSDT' });
    expect(out.items[0]!.symbol.id).toBe('BTCUSDT');
    expect(out.items[0]!.matched).toBe('exact');
  });

  it('a base-asset match ranks above a bare substring match', () => {
    const out = searchSymbols(CAT, { q: 'eth' });
    expect(out.items[0]!.symbol.base).toBe('ETH');
    expect(['base', 'prefix', 'exact']).toContain(out.items[0]!.matched);
  });

  it('ties break on symbol id, so the order is total and reproducible', () => {
    const a = searchSymbols(CAT, { q: 'usdt' }).items.map((r) => r.symbol.id);
    const b = searchSymbols([...CAT].reverse(), { q: 'usdt' }).items.map((r) => r.symbol.id);
    // Same query over the same set in a different input order yields the same page.
    expect(a).toEqual(b);
  });

  it('reports why each row matched', () => {
    for (const r of searchSymbols(CAT, { q: 'btc' }).items) {
      expect(['exact', 'prefix', 'substring', 'base', 'quote']).toContain(r.matched);
    }
  });
});

describe('filters', () => {
  it('quote filter is applied and is case-insensitive', () => {
    const out = searchSymbols(CAT, { q: 'btc', quote: 'usdc' });
    expect(out.items.map((r) => r.symbol.id)).toEqual(['BTCUSDC']);
  });

  it('contractType filter is applied', () => {
    expect(searchSymbols(CAT, { q: 'ada', contractType: 'perpetual' }).total).toBe(0);
    expect(searchSymbols(CAT, { q: 'ada', contractType: 'spot' }).total).toBe(1);
  });
});

describe('empty query policy', () => {
  it('is not an error and does not return the whole catalogue', () => {
    const out = searchSymbols(CAT, {});
    expect(out.emptyQueryPolicy).toBe(EMPTY_QUERY_POLICY);
    expect(out.total).toBe(CAT.length);
    expect(out.items.length).toBeLessThanOrEqual(DEFAULT_SEARCH_LIMIT);
    for (const r of out.items) expect(r.matched).toBe('catalogue');
  });

  it('still honours filters when the query is empty', () => {
    const out = searchSymbols(CAT, { quote: 'USDC' });
    expect(out.items.map((r) => r.symbol.id)).toEqual(['BTCUSDC']);
  });
});

describe('paging', () => {
  it('total is the match count BEFORE paging', () => {
    const out = searchSymbols(CAT, { q: 'usdt', limit: 2 });
    expect(out.items).toHaveLength(2);
    expect(out.total).toBeGreaterThan(2);
  });

  it('offset walks the same stable order without repeats or gaps', () => {
    const all = searchSymbols(CAT, { q: 'usdt', limit: MAX_SEARCH_LIMIT }).items.map((r) => r.symbol.id);
    const p1 = searchSymbols(CAT, { q: 'usdt', limit: 2, offset: 0 }).items.map((r) => r.symbol.id);
    const p2 = searchSymbols(CAT, { q: 'usdt', limit: 2, offset: 2 }).items.map((r) => r.symbol.id);
    expect([...p1, ...p2]).toEqual(all.slice(0, 4));
    expect(new Set([...p1, ...p2]).size).toBe(4);
  });

  it('limit is clamped, so a client cannot request the whole catalogue', () => {
    expect(searchSymbols(CAT, { q: '', limit: 10_000 }).items.length).toBeLessThanOrEqual(MAX_SEARCH_LIMIT);
    expect(searchSymbols(CAT, { q: '', limit: 0 }).items.length).toBe(1);
    expect(searchSymbols(CAT, { q: '', offset: -5 }).items.length).toBeGreaterThan(0);
  });
});

describe('no match', () => {
  it('an unsupported symbol returns an empty page, not an error', () => {
    const out = searchSymbols(CAT, { q: 'DOESNOTEXIST' });
    expect(out.items).toEqual([]);
    expect(out.total).toBe(0);
    expect(out.normalizedQuery).toBe('DOESNOTEXIST');
  });

  it('a punctuation-only query matches nothing rather than everything', () => {
    expect(searchSymbols(CAT, { q: '!!' }).total).toBe(0);
  });
});
