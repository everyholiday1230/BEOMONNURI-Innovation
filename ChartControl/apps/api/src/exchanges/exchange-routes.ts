import { Hono } from 'hono';
import { z } from 'zod';
import { EXCHANGE_CATALOGUE_SOURCE, EXCHANGES, getExchange } from './exchange-catalog';

/**
 * G1 — `GET /api/v1/exchanges` (+ `/:id`).
 *
 * Path and response shape come from the design handoff (`team_delivery/README.md`:
 * "`EXCHANGES` → `GET /api/v1/exchanges` (거래소 리스트 · referral 포함)").
 *
 * A mountable router rather than inline in `index.ts`, for the reason stated in
 * `market/market-routes.ts`: `index.ts` calls `serve()` at module load, so routes defined there can
 * only be exercised by starting a real listener.
 *
 * Public and unauthenticated by design: `/wallet` renders the catalogue before a user has connected
 * anything, and the landing page (`/`) lists supported exchanges to visitors who are not logged in.
 * The catalogue contains no user data and no secrets — only public referral URLs the operator wants
 * distributed. Nothing here is per-user, so there is nothing to authorize.
 */

export interface ExchangeRouterDeps {
  /** Overridable for deterministic tests. */
  now?: () => number;
}

/**
 * Query contract. `.strict()` so a typo'd filter is a 400 instead of silently returning the
 * unfiltered list — same reasoning as `MarketSearchQuerySchema`.
 */
export const ExchangeListQuerySchema = z
  .object({
    status: z.enum(['available', 'beta', 'coming-soon']).optional(),
    /** `?recommended=true` narrows to the highlighted set the UI sorts first. */
    recommended: z.enum(['true', 'false']).optional(),
  })
  .strict();

const corr = () => Math.random().toString(36).slice(2, 10);

export function createExchangeRouter(d: ExchangeRouterDeps = {}): Hono {
  const app = new Hono();
  const now = d.now ?? Date.now;

  app.get('/v1/exchanges', (c) => {
    const params = Object.fromEntries(new URL(c.req.url).searchParams);
    const parsed = ExchangeListQuerySchema.safeParse(params);
    if (!parsed.success) {
      // Field path + rule code only; the rejected input is never echoed back.
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code }));
      return c.json(
        {
          error: { code: 'BAD_REQUEST', message: 'invalid exchange query', correlationId: corr() },
          issues,
        },
        400,
      );
    }

    const { status, recommended } = parsed.data;
    const items = EXCHANGES.filter(
      (e) =>
        (status === undefined || e.status === status) &&
        (recommended === undefined || e.recommended === (recommended === 'true')),
    );

    // Public, non-user-specific, and changes only on deploy — safe to cache briefly at the edge.
    c.header('cache-control', 'public, max-age=300');
    return c.json({
      items,
      total: items.length,
      asOf: now(),
      source: EXCHANGE_CATALOGUE_SOURCE,
    });
  });

  app.get('/v1/exchanges/:id', (c) => {
    const ex = getExchange(c.req.param('id'));
    if (!ex) {
      return c.json(
        {
          error: { code: 'NOT_FOUND', message: 'unknown exchange', correlationId: corr() },
        },
        404,
      );
    }
    c.header('cache-control', 'public, max-age=300');
    return c.json(ex);
  });

  return app;
}
