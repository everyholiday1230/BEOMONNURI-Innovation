import type { SymbolInfo } from '@quantumtrade/schemas';

/**
 * B1 / MKT-01 — server-side market search.
 *
 * The user app previously fetched the whole symbol catalogue and filtered it in the browser. That works
 * for a demo catalogue and stops working the moment the catalogue is large; it also means every client
 * re-implements matching and ranking. The matching rules therefore live here, as a pure function, so the
 * route stays thin and the ranking is unit-testable without HTTP.
 *
 * Deliberate choices:
 * - **Ranking is explicit, not incidental.** An exact symbol match must outrank a prefix match, which
 *   must outrank a substring match, otherwise typing "BTC" can surface "WBTC" above "BTCUSDT".
 * - **Ties break on a stable key.** Equal-scoring rows are ordered by symbol id, so the same query
 *   always returns the same page — pagination over an unstable order silently drops or repeats rows.
 * - **No name field exists** on `SymbolInfo`, so matching uses id / base / quote only. Claiming to search
 *   names would be a promise the data cannot keep.
 */

/** Upper bound on the query length; anything longer is a client error, not something to truncate silently. */
export const MAX_QUERY_LENGTH = 32;

/** Upper bound on page size, to stop a client asking for the whole catalogue via `limit`. */
export const MAX_SEARCH_LIMIT = 50;
export const DEFAULT_SEARCH_LIMIT = 20;

export interface MarketSearchQuery {
  /** Free text. Empty is allowed and returns the catalogue head (see `EMPTY_QUERY_POLICY`). */
  q?: string;
  /** Filter by quote asset, e.g. `USDT`. */
  quote?: string;
  /** Filter by contract type. */
  contractType?: 'perpetual' | 'spot';
  limit?: number;
  offset?: number;
}

/**
 * Empty-query policy, stated rather than implied: an empty query is NOT an error and does NOT return
 * everything. It returns the first page of the catalogue in stable order, so the search box can show
 * something useful before the user types.
 */
export const EMPTY_QUERY_POLICY = 'catalogue-head' as const;

export interface MarketSearchResult {
  symbol: SymbolInfo;
  /** Why this row matched — surfaced so the UI can highlight, and so ranking is explainable. */
  matched: 'exact' | 'prefix' | 'substring' | 'base' | 'quote' | 'catalogue';
  score: number;
}

/** Normalize user input: trim, collapse inner whitespace, upper-case. */
export function normalizeQuery(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/\s+/g, '').toUpperCase();
}

const SCORE = { exact: 100, prefix: 80, base: 60, quote: 40, substring: 20, catalogue: 0 } as const;

function classify(sym: SymbolInfo, q: string): { matched: MarketSearchResult['matched']; score: number } | null {
  if (!q) return { matched: 'catalogue', score: SCORE.catalogue };
  const id = sym.id.toUpperCase();
  const base = sym.base.toUpperCase();
  const quote = sym.quote.toUpperCase();
  if (id === q) return { matched: 'exact', score: SCORE.exact };
  if (base === q) return { matched: 'base', score: SCORE.base };
  if (id.startsWith(q)) return { matched: 'prefix', score: SCORE.prefix };
  if (base.startsWith(q)) return { matched: 'base', score: SCORE.base - 1 };
  if (quote === q) return { matched: 'quote', score: SCORE.quote };
  if (id.includes(q)) return { matched: 'substring', score: SCORE.substring };
  return null;
}

export interface MarketSearchOutcome {
  items: MarketSearchResult[];
  /** Total matches BEFORE paging, so the UI can show a real count instead of guessing. */
  total: number;
  normalizedQuery: string;
  emptyQueryPolicy: typeof EMPTY_QUERY_POLICY;
}

/**
 * Search a catalogue. Pure: no I/O, no clock, no randomness — the same inputs always produce the same
 * page, which is what makes offset paging safe here.
 */
export function searchSymbols(catalogue: readonly SymbolInfo[], query: MarketSearchQuery): MarketSearchOutcome {
  const q = normalizeQuery(query.q);
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_SEARCH_LIMIT), MAX_SEARCH_LIMIT);
  const offset = Math.max(0, query.offset ?? 0);
  const quote = query.quote?.trim().toUpperCase();

  const scored: MarketSearchResult[] = [];
  for (const symbol of catalogue) {
    if (quote && symbol.quote.toUpperCase() !== quote) continue;
    if (query.contractType && symbol.contractType !== query.contractType) continue;
    const hit = classify(symbol, q);
    if (!hit) continue;
    scored.push({ symbol, matched: hit.matched, score: hit.score });
  }

  // Higher score first; ties broken by symbol id so the order is total and reproducible.
  scored.sort((a, b) => (b.score - a.score) || a.symbol.id.localeCompare(b.symbol.id));

  return {
    items: scored.slice(offset, offset + limit),
    total: scored.length,
    normalizedQuery: q,
    emptyQueryPolicy: EMPTY_QUERY_POLICY,
  };
}
