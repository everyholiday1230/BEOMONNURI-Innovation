import { z } from 'zod';

/**
 * B3 — read-model query contract for orders / trades / positions.
 *
 * Filters and sorts are ALLOW-LISTED, not passed through. A sort column taken from the query string
 * and interpolated into SQL is an injection hole; a sort column that is merely unvalidated silently
 * produces an arbitrary order, which then breaks offset pagination (rows repeat or vanish between
 * pages). Both problems are closed here rather than in the repository.
 */

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/** Lifecycle states that mean "still working". Mirrors the order state machine. */
export const OPEN_ORDER_STATES = [
  'DRAFT',
  'VALIDATING',
  'READY',
  'SUBMITTING',
  'ACCEPTED',
  'PARTIALLY_FILLED',
  'CANCEL_PENDING',
] as const;

/** Lifecycle states that mean "finished". Union with OPEN_ORDER_STATES must be exhaustive. */
export const TERMINAL_ORDER_STATES = ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'] as const;

export const ORDER_SORT_COLUMNS = {
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  symbol: 'symbol',
} as const;

export const TRADE_SORT_COLUMNS = {
  at: 'at',
  symbol: 'symbol',
} as const;

export const POSITION_SORT_COLUMNS = {
  updatedAt: 'updated_at',
  symbol: 'symbol',
} as const;

const SymbolFilter = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{2,20}$/i)
  .transform((s) => s.toUpperCase());

const Pagination = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
};

/**
 * Time range. Bounds are inclusive-from / exclusive-to so adjacent pages built from the previous
 * page's last timestamp cannot double-count a boundary row.
 */
const TimeRange = {
  from: z.coerce.number().int().min(0).optional(),
  to: z.coerce.number().int().min(0).optional(),
};

export const OrderQuerySchema = z
  .object({
    symbol: SymbolFilter.optional(),
    side: z.enum(['long', 'short']).optional(),
    type: z.enum(['market', 'limit', 'stop', 'stop_limit']).optional(),
    status: z.string().trim().max(32).optional(),
    sort: z.enum(['createdAt', 'updatedAt', 'symbol']).optional(),
    ...Pagination,
    ...TimeRange,
  })
  .strict()
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

export const TradeQuerySchema = z
  .object({
    symbol: SymbolFilter.optional(),
    side: z.enum(['long', 'short']).optional(),
    sort: z.enum(['at', 'symbol']).optional(),
    ...Pagination,
    ...TimeRange,
  })
  .strict()
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

export const PositionQuerySchema = z
  .object({
    symbol: SymbolFilter.optional(),
    side: z.enum(['long', 'short']).optional(),
    sort: z.enum(['updatedAt', 'symbol']).optional(),
    ...Pagination,
  })
  .strict();

export type OrderQuery = z.infer<typeof OrderQuerySchema>;
export type TradeQuery = z.infer<typeof TradeQuerySchema>;
export type PositionQuery = z.infer<typeof PositionQuerySchema>;

/**
 * Resolve `status` against the state set legal for the endpoint.
 *
 * Returns `null` for an unknown status rather than silently ignoring it: a filter the server does not
 * understand must be a 400, otherwise the client believes it filtered and it did not.
 */
export function resolveStatusFilter(
  requested: string | undefined,
  allowed: readonly string[],
): { ok: true; states: readonly string[] } | { ok: false } {
  if (requested === undefined) return { ok: true, states: allowed };
  const upper = requested.toUpperCase();
  if (!allowed.includes(upper)) return { ok: false };
  return { ok: true, states: [upper] };
}

export interface ResolvedPage {
  limit: number;
  offset: number;
  column: string;
  dir: 'ASC' | 'DESC';
}

/**
 * Map a validated query onto concrete SQL fragments.
 *
 * `column` can only ever be a value from the supplied allow-list map, so the caller may interpolate
 * it. That is asserted by the type: the key is constrained to `keyof typeof columns`.
 */
export function resolvePage<M extends Record<string, string>>(
  q: { limit?: number; offset?: number; sort?: keyof M & string; dir?: 'asc' | 'desc' },
  columns: M,
  defaultSort: keyof M & string,
): ResolvedPage {
  const key = q.sort ?? defaultSort;
  return {
    limit: q.limit ?? DEFAULT_PAGE_SIZE,
    offset: q.offset ?? 0,
    column: columns[key]!,
    dir: (q.dir ?? 'desc') === 'asc' ? 'ASC' : 'DESC',
  };
}
