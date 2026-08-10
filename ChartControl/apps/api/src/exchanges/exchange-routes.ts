import { Hono } from 'hono';
import { z } from 'zod';
import {
  EXCHANGE_CATALOGUE_SOURCE,
  EXCHANGES,
  getExchange,
  isConnectable,
} from './exchange-catalog';

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
    /*
       `?include=all` — 어댑터가 없는(=협약 전) 거래소까지 포함한다.

       ★★ 기본값은 **연결 가능한 것만**이다. 카탈로그의 9개 중 어댑터가 있는
         것은 2개뿐인데 전부 `status:'available'` 로 나가고 있었다. 사용자는
         연결된다고 믿고 거래소에서 키를 만들어 등록하고, 아무것도 조회되지
         않는 이유를 알 수 없다.

       ★ 관리자 화면은 `include=all` 로 전부 본다 — 어떤 거래소가 준비 중인지
         운영자는 알아야 한다. 카탈로그는 공개 정보(이름·상품·문서 링크)이므로
         인증으로 감출 대상이 아니다. 기본값을 안전한 쪽에 두는 것이 목적이다.
    */
    include: z.enum(['connectable', 'all']).optional(),
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

    const { status, recommended, include } = parsed.data;
    const matched = EXCHANGES.filter(
      (e) =>
        (status === undefined || e.status === status) &&
        (recommended === undefined || e.recommended === (recommended === 'true')),
    );

    /*
       `connectable` 을 응답에 실어 보낸다.

       ★ 목록에서 빼는 것만으로는 부족하다. 관리자 화면이 `include=all` 로
         전부 받을 때, 어느 것이 실제로 연결되는지 구분할 근거가 필요하다.
         화면이 자기 목록을 따로 들고 있으면 코드와 어긋난다.
    */
    const withFlag = matched.map((e) => ({ ...e, connectable: isConnectable(e.id) }));
    const items = include === 'all' ? withFlag : withFlag.filter((e) => e.connectable);

    // Public, non-user-specific, and changes only on deploy — safe to cache briefly at the edge.
    c.header('cache-control', 'public, max-age=300');
    return c.json({
      items,
      total: items.length,
      /* 감춘 개수를 밝힌다 — 화면이 "N개 준비 중" 을 말할 수 있고, 0개가
         나올 때 필터 때문인지 카탈로그가 빈 것인지 구분된다. */
      hiddenNotConnectable: include === 'all' ? 0 : withFlag.length - items.length,
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
    /* 개별 조회에서도 같은 사실을 밝힌다. 여기서 404 로 감추지 않는 이유:
       링크를 직접 여는 경우가 있고, "없는 거래소" 와 "아직 연결 못 하는
       거래소" 는 다른 사실이다. */
    return c.json({ ...ex, connectable: isConnectable(ex.id) });
  });

  return app;
}
