import { Hono } from 'hono';
import { z } from 'zod';
import type { SymbolInfo } from '@quantumtrade/schemas';
import { MAX_QUERY_LENGTH, MAX_SEARCH_LIMIT, searchSymbols } from './search';

/**
 * MKT-01 — market search router.
 *
 * Lives in its own router rather than inline in `index.ts` for the same reason the auth and trading
 * routes do: `index.ts` calls `serve()` at module load, so anything defined there can only be tested by
 * starting a real listener. A router is mountable and directly testable.
 */

export interface MarketSearchDeps {
  /** Catalogue source. Injected so a test does not need the real provider wiring. */
  getSymbols: (signal?: AbortSignal) => Promise<SymbolInfo[]>;
  /** Provenance reported to the client: which data source produced the catalogue. */
  source: string;
  tradingMode: string;
  /** Overridable for deterministic tests. */
  now?: () => number;
}

/**
 * Query contract. `.strict()` so an unexpected parameter is a 400 rather than being ignored — a typo'd
 * filter that silently returns unfiltered results is a correctness trap, not a convenience.
 */
export const MarketSearchQuerySchema = z
  .object({
    q: z.string().max(MAX_QUERY_LENGTH).optional(),
    quote: z.string().max(16).optional(),
    contractType: z.enum(['perpetual', 'spot']).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
    offset: z.coerce.number().int().min(0).max(100_000).optional(),
  })
  .strict();

const corr = () => Math.random().toString(36).slice(2, 10);

export function createMarketSearchRouter(d: MarketSearchDeps): Hono {
  const app = new Hono();
  const now = d.now ?? Date.now;

  app.get('/market/search', async (c) => {
    const params = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsed = MarketSearchQuerySchema.safeParse(params);
    if (!parsed.success) {
      // Field path + rule code only. The raw input is never echoed back into the error.
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code }));
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'invalid search query', correlationId: corr() }, issues },
        400,
      );
    }
    try {
      const catalogue = await d.getSymbols(undefined);
      const out = searchSymbols(catalogue, parsed.data);
      // Provenance is part of the contract: a search over a stale mock catalogue must not be
      // indistinguishable from a live one.
      return c.json({
        items: out.items,
        total: out.total,
        normalizedQuery: out.normalizedQuery,
        emptyQueryPolicy: out.emptyQueryPolicy,
        source: d.source,
        asOf: now(),
        stale: false,
        tradingMode: d.tradingMode,
      });
    } catch (e) {
      // Provider unavailable is reported as an upstream failure, NOT as an empty result set.
      return c.json(
        { error: { code: 'UPSTREAM_ERROR', message: (e as Error).message, correlationId: corr() } },
        502,
      );
    }
  });

  return app;
}
