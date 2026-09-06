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

/*
   주문 생애주기 상태를 '진행 중' 과 '끝남' 으로 나눈다.

   ★★ 두 목록의 합집합은 `packages/domain/order-machine.ts` 의 상태를 **빠짐없이**
     덮어야 한다. 어느 쪽에도 없는 상태의 주문은 미체결 목록에도, 내역에도 나오지
     않는다 — 화면에서 그냥 사라진다.

     실제로 `UNKNOWN_RECONCILING` 이 양쪽에 다 빠져 있었다. 아래 주석이 "합집합은
     빠짐없다" 고 주장했는데 사실이 아니었다. 지금은 테스트가 이 성질을 검사한다.

   ★★ 라이브 주문 상태(live-order-machine.ts)는 여기 넣지 않는다.

     `orders` 테이블에 쓰는 것은 모의 투영(sim-projection)뿐이다. 라이브 주문은
     `trade_decisions` 에 기록되고(운영 확인: orders 0건, trade_decisions 26건),
     거래소 미체결·내역은 거래소 API 를 직접 읽는다. 그래서 OPEN/CANCELED/
     SUBMIT_UNKNOWN 같은 라이브 상태를 이 목록에 넣으면 이 테이블에 존재하지 않는
     상태를 조회하는 셈이 된다.

   ★ 라이브 쪽은 CANCELED(L 하나), 로컬 쪽은 CANCELLED(L 둘)로 철자가 다르다.
     두 어휘를 섞으면 조용히 어긋난다 — 같은 테이블에 섞어 쓰지 않는다.
*/

/** '아직 진행 중' 인 상태. order-machine.ts 를 따른다. */
export const OPEN_ORDER_STATES = [
  'DRAFT',
  'VALIDATING',
  'READY',
  'SUBMITTING',
  'ACCEPTED',
  'PARTIALLY_FILLED',
  'CANCEL_PENDING',
  /*
     ★ 대조 중인 주문. 끝난 것이 아니므로 '진행 중' 이다.

       빠져 있어서 이 상태의 주문은 어디에도 나오지 않았다. 하필 **결과를 모르는
       상태**라 고객이 가장 확인하고 싶어하는 주문이 사라지는 셈이었다.
  */
  'UNKNOWN_RECONCILING',
] as const;

/** '끝남' 인 상태. OPEN_ORDER_STATES 와의 합집합이 order-machine 을 빠짐없이 덮어야 한다. */
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
