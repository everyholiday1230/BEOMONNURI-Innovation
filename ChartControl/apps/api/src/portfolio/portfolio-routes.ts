import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService, hasPermission, type PublicUser } from '@quantumtrade/auth';
import { D } from '@quantumtrade/domain';
import type {
  BalanceRow, OrderRow, Page, PositionRow, TradeRow,
} from '../db/portfolio-repo';
import {
  OPEN_ORDER_STATES,
  OrderQuerySchema,
  PositionQuerySchema,
  TERMINAL_ORDER_STATES,
  TradeQuerySchema,
  resolveStatusFilter,
  type OrderQuery,
  type PositionQuery,
  type TradeQuery,
} from './query';
import {
  MARK_PRICE_FRESHNESS_MS,
  buildProvenance,
  type Provenance,
  type TradingPosture,
} from './provenance';

/**
 * B3 + B5 — user portfolio read model.
 *
 * Read-only by construction: there is no route in this file that mutates an order, a position or a
 * balance, and none that reaches an exchange. The position-close and margin-adjust contracts are
 * validation-only and return `executable: false` (Prompt 5 §9), so a client cannot mistake them for
 * an action endpoint.
 */

const CSRF_COOKIE = 'qt_csrf';
const corr = () => Math.random().toString(36).slice(2, 10);
const err = (code: string, message: string) => ({ error: { code, message, correlationId: corr() } });

/**
 * 거래 읽기 저장소 계약.
 *
 * ★ SQLite 판은 동기, PostgreSQL 판은 비동기다. 라우터가 둘 다 받을 수 있어야
 *   배포에 따라 갈리지 않는다 — 한쪽만 지원하면 "저장은 됐는데 안 보인다" 가
 *   되고, 화면은 목업으로 그 자리를 채워 아무도 알아채지 못한다.
 *
 * 반환값을 `T | Promise<T>` 로 두고 호출부에서 await 한다. 동기 값에 await 를
 * 붙이는 것은 무해하다.
 */
export interface PortfolioReadRepo {
  listOrders(
    userId: string, states: readonly string[], q: OrderQuery,
  ): Page<OrderRow> | Promise<Page<OrderRow>>;
  listTrades(userId: string, q: TradeQuery): Page<TradeRow> | Promise<Page<TradeRow>>;
  listPositions(userId: string, q: PositionQuery): Page<PositionRow> | Promise<Page<PositionRow>>;
  getPosition(userId: string, id: string): (PositionRow | null) | Promise<PositionRow | null>;
  listBalances(
    userId: string,
  ): { items: BalanceRow[]; asOf: number | null } | Promise<{ items: BalanceRow[]; asOf: number | null }>;
}

export interface PortfolioRouterDeps {
  service: AuthService;
  repo: PortfolioReadRepo;
  /**
   * 일별 자산 스냅샷.
   *
   * ★ 없으면 자산곡선 API 가 "이력 없음" 을 명시한다. 빈 배열만 주면 화면이
   *   "자산이 0" 으로 오해할 수 있다.
   */
  equitySnapshots?: import('../db/equity-snapshot-repo').PgEquitySnapshotRepo;
  posture: TradingPosture;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  /** Injectable clock so provenance/staleness assertions in tests are deterministic. */
  now?: () => number;
  /** CSRF verification, injected to keep this router independent of the auth package's internals. */
  verifyCsrf: (token: string | undefined, cookie: string | undefined, secret: string, key: string) => boolean;
  originAllowed: (origin: string | undefined, referer: string | undefined, allowed: string[]) => boolean;
}

export function createPortfolioRouter(d: PortfolioRouterDeps): Hono {
  const app = new Hono();
  const now = d.now ?? Date.now;

  const authed = async (c: Context): Promise<{ user: PublicUser; csrfSecret: string } | null> => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };

  const csrfOk = (c: Context, secret: string) =>
    d.originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    d.verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF_COOKIE), secret, d.csrfKey);

  /**
   * Account-scoped data is never cacheable by a shared cache: the response depends entirely on the
   * session cookie, and a proxy that ignored that would hand one user another's positions.
   */
  const noStore = (c: Context) => {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    c.header('Pragma', 'no-cache');
  };

  const badQuery = (c: Context, issues: { path: string; code: string }[]) =>
    // Field path + rule code only; the rejected value is never echoed back.
    c.json({ ...err('BAD_REQUEST', 'invalid query'), issues }, 400);

  const searchParams = (c: Context) => Object.fromEntries(new URL(c.req.url).searchParams);

  const issuesOf = (e: { issues: { path: (string | number)[]; code: string }[] }) =>
    e.issues.map((i) => ({ path: i.path.join('.'), code: i.code }));

  /** Envelope shared by every read model in this router. */
  const envelope = <T>(
    items: T[],
    total: number,
    limit: number,
    offset: number,
    provenance: Provenance,
  ) => ({
    items,
    page: { limit, offset, total, hasMore: offset + items.length < total },
    ...provenance,
  });

  // ---------------------------------------------------------------- orders

  /** ORD-05 — working orders. */
  app.get('/orders/open', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!hasPermission(a.user.role, 'order-draft.read.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);
    const parsed = OrderQuerySchema.safeParse(searchParams(c));
    if (!parsed.success) return badQuery(c, issuesOf(parsed.error));
    const states = resolveStatusFilter(parsed.data.status, OPEN_ORDER_STATES);
    if (!states.ok) return badQuery(c, [{ path: 'status', code: 'not_open_state' }]);
    const out = await d.repo.listOrders(a.user.id, states.states, parsed.data);
    return c.json(
      envelope(
        out.items,
        out.total,
        parsed.data.limit ?? 50,
        parsed.data.offset ?? 0,
        // Orders are records in our own store, not a sampled feed: staleness does not apply.
        buildProvenance({ posture: d.posture, asOf: out.asOf, now: now(), freshnessMs: null }),
      ),
    );
  });

  /** ORD-06 — terminal orders. */
  app.get('/orders/history', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!hasPermission(a.user.role, 'order-draft.read.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);
    const parsed = OrderQuerySchema.safeParse(searchParams(c));
    if (!parsed.success) return badQuery(c, issuesOf(parsed.error));
    const states = resolveStatusFilter(parsed.data.status, TERMINAL_ORDER_STATES);
    if (!states.ok) return badQuery(c, [{ path: 'status', code: 'not_terminal_state' }]);
    const out = await d.repo.listOrders(a.user.id, states.states, parsed.data);
    return c.json(
      envelope(
        out.items,
        out.total,
        parsed.data.limit ?? 50,
        parsed.data.offset ?? 0,
        buildProvenance({ posture: d.posture, asOf: out.asOf, now: now(), freshnessMs: null }),
      ),
    );
  });

  /** ORD-07 — fills. */
  app.get('/trades', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!hasPermission(a.user.role, 'order-draft.read.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);
    const parsed = TradeQuerySchema.safeParse(searchParams(c));
    if (!parsed.success) return badQuery(c, issuesOf(parsed.error));
    const out = await d.repo.listTrades(a.user.id, parsed.data);
    return c.json(
      envelope(
        out.items,
        out.total,
        parsed.data.limit ?? 50,
        parsed.data.offset ?? 0,
        buildProvenance({ posture: d.posture, asOf: out.asOf, now: now(), freshnessMs: null }),
      ),
    );
  });

  /** ORD-08 — open exposure. Mark prices come from a feed, so this one DOES report staleness. */
  app.get('/positions', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!hasPermission(a.user.role, 'order-draft.read.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);
    const parsed = PositionQuerySchema.safeParse(searchParams(c));
    if (!parsed.success) return badQuery(c, issuesOf(parsed.error));
    const out = await d.repo.listPositions(a.user.id, parsed.data);
    return c.json(
      envelope(
        out.items,
        out.total,
        parsed.data.limit ?? 50,
        parsed.data.offset ?? 0,
        buildProvenance({
          posture: d.posture,
          asOf: out.asOf,
          now: now(),
          freshnessMs: MARK_PRICE_FRESHNESS_MS,
        }),
      ),
    );
  });

  // ---------------------------------------------------------------- account (B5)

  /**
   * ACC-01 — account summary.
   *
   * Every total is computed with decimal.js from the stored strings. A summary that reported
   * `0.30000000000000004` for equity would be worse than reporting nothing.
   *
   * Fields that genuinely have no source in this deployment are `null` with a companion
   * `unavailable[]` list, never `0`. Zero is a value the position sizer would act on.
   */
  app.get('/account/summary', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!hasPermission(a.user.role, 'account.read.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);
    // 두 조회는 서로 독립이므로 병렬로 보낸다.
    const [balances, positions] = await Promise.all([
      d.repo.listBalances(a.user.id),
      d.repo.listPositions(a.user.id, {}),
    ]);

    const unavailable: string[] = [];
    let available: string | null = null;
    let equity: string | null = null;
    let used: string | null = null;
    if (balances.items.length === 0) {
      unavailable.push('available', 'equity', 'usedMargin');
    } else {
      available = balances.items.reduce((acc, b) => acc.plus(D(b.available)), D(0)).toString();
      equity = balances.items.reduce((acc, b) => acc.plus(D(b.equity)), D(0)).toString();
      used = balances.items.reduce((acc, b) => acc.plus(D(b.used)), D(0)).toString();
    }

    // Exposure is notional at MARK price where available, else at entry. Positions missing both are
    // counted but excluded from the notional, and that exclusion is reported rather than hidden.
    let notional = D(0);
    let priced = 0;
    let unrealized = D(0);
    let unrealizedKnown = 0;
    for (const p of positions.items) {
      const px = p.markPrice ?? p.entryPrice;
      if (px !== null) {
        notional = notional.plus(D(px).mul(D(p.size)));
        priced += 1;
      }
      if (p.unrealizedPnl !== null) {
        unrealized = unrealized.plus(D(p.unrealizedPnl));
        unrealizedKnown += 1;
      }
    }
    if (priced === 0 && positions.items.length > 0) unavailable.push('exposureNotional');
    if (unrealizedKnown === 0 && positions.items.length > 0) unavailable.push('unrealizedPnl');

    // Margin ratio needs BOTH an equity figure and a used-margin figure. Deriving it from one of them
    // would produce a number that looks like a risk metric and is not one.
    const marginRatio =
      equity !== null && used !== null && !D(equity).isZero() ? D(used).div(D(equity)).toString() : null;
    if (marginRatio === null) unavailable.push('marginRatio');

    const asOf = [balances.asOf, positions.asOf].filter((x): x is number => x !== null);
    return c.json({
      available,
      equity,
      usedMargin: used,
      marginRatio,
      exposure: {
        positionCount: positions.total,
        pricedPositionCount: priced,
        notional: priced > 0 ? notional.toString() : null,
        unrealizedPnl: unrealizedKnown > 0 ? unrealized.toString() : null,
      },
      assetCount: balances.items.length,
      unavailable,
      ...buildProvenance({
        posture: d.posture,
        asOf: asOf.length === 0 ? null : Math.max(...asOf),
        now: now(),
        freshnessMs: MARK_PRICE_FRESHNESS_MS,
      }),
    });
  });

  /** ACC-02 — per-asset balances (latest snapshot per asset). */
  app.get('/account/assets', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!hasPermission(a.user.role, 'account.read.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);
    const out = await d.repo.listBalances(a.user.id);
    const items = out.items.map((b) => ({
      asset: b.asset,
      available: b.available,
      // `locked` is the schema's `used` column under the name the UI uses. Derived by subtraction it
      // would drift from the exchange's own figure, so it is passed through instead.
      locked: b.used,
      equity: b.equity,
      at: b.at,
    }));
    return c.json({
      items,
      page: { limit: items.length, offset: 0, total: items.length, hasMore: false },
      ...buildProvenance({
        posture: d.posture,
        asOf: out.asOf,
        now: now(),
        freshnessMs: MARK_PRICE_FRESHNESS_MS,
      }),
    });
  });

  // ------------------------------------------- position close / margin: VALIDATION ONLY (§9)

  /**
   * POST /positions/:id/close-draft — computes what a close WOULD look like. It writes nothing, calls
   * no exchange, and always returns `executable: false`.
   *
   * It is a POST (not a GET) because it is a deliberate user action that is audited and rate-limited
   * alongside the other order-intent contracts; CSRF therefore applies.
   */
  app.post('/positions/:id/close-draft', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', 'csrf validation failed'), 403);
    if (!hasPermission(a.user.role, 'order-draft.write.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);
    const pos = await d.repo.getPosition(a.user.id, c.req.param('id'));
    // Ownership: a position belonging to another user is a 404, not a 403 — a 403 would confirm the id exists.
    if (!pos) return c.json(err('NOT_FOUND', 'position not found'), 404);

    const px = pos.markPrice ?? pos.entryPrice;
    const blockingReasons = [
      // Fail-closed and explicit: this build cannot close a position, and the response says why.
      { code: 'LIVE_TRADING_DISABLED', message: 'live trading is disabled in this deployment' },
      ...(d.posture.killSwitchActive
        ? [{ code: 'KILL_SWITCH_ACTIVE', message: 'emergency kill switch is active' }]
        : []),
      ...(px === null ? [{ code: 'NO_REFERENCE_PRICE', message: 'no mark or entry price available' }] : []),
    ];

    return c.json({
      positionId: pos.id,
      normalizedClose: {
        symbol: pos.symbol,
        // Closing a long is a short order of the same size, and vice versa.
        side: pos.side === 'long' ? 'short' : 'long',
        type: 'market',
        quantity: pos.size,
        reduceOnly: true,
      },
      referencePrice: px,
      estimatedNotional: px === null ? null : D(px).mul(D(pos.size)).toString(),
      valid: px !== null,
      allowed: false,
      executable: false,
      blockingReasons,
      warnings: [],
      ...buildProvenance({
        posture: d.posture,
        asOf: pos.updatedAt,
        now: now(),
        freshnessMs: MARK_PRICE_FRESHNESS_MS,
      }),
    });
  });

  /** POST /positions/:id/margin-adjustment/validate — validation only; never adjusts margin. */
  app.post('/positions/:id/margin-adjustment/validate', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', 'csrf validation failed'), 403);
    if (!hasPermission(a.user.role, 'order-draft.write.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);
    const pos = await d.repo.getPosition(a.user.id, c.req.param('id'));
    if (!pos) return c.json(err('NOT_FOUND', 'position not found'), 404);

    const raw = await c.req.text();
    if (raw.length > 8 * 1024) return c.json(err('BAD_REQUEST', 'oversized body'), 400);
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return c.json(err('BAD_REQUEST', 'invalid json'), 400);
    }
    const amount = (body as { amount?: unknown }).amount;
    // Decimal strings only. Accepting a JS number here would round the very value being validated.
    if (typeof amount !== 'string' || !/^-?\d+(\.\d+)?$/.test(amount)) {
      return c.json({ ...err('BAD_REQUEST', 'amount must be a decimal string'), issues: [{ path: 'amount', code: 'invalid_decimal' }] }, 400);
    }

    const blockingReasons = [
      { code: 'MARGIN_ADJUST_DISABLED_BY_POLICY', message: 'margin adjustment is not executable in this deployment' },
      ...(d.posture.killSwitchActive
        ? [{ code: 'KILL_SWITCH_ACTIVE', message: 'emergency kill switch is active' }]
        : []),
      ...(D(amount).isZero() ? [{ code: 'ZERO_AMOUNT', message: 'amount must be non-zero' }] : []),
    ];

    return c.json({
      positionId: pos.id,
      requestedAmount: amount,
      currentLeverage: pos.leverage,
      marginMode: pos.marginMode,
      valid: !D(amount).isZero(),
      allowed: false,
      executable: false,
      blockingReasons,
      warnings: [],
      ...buildProvenance({
        posture: d.posture,
        asOf: pos.updatedAt,
        now: now(),
        freshnessMs: MARK_PRICE_FRESHNESS_MS,
      }),
    });
  });

  /**
   * 자산곡선 (기간별).
   *
   * ★★ **보간하지 않는다.** 접속하지 않은 날은 점이 없다. 앞뒤를 이어 그리면
   *   없었던 자산 변화를 만들고, 사용자는 그 곡선으로 성과를 판단한다.
   *
   * ★ `points` 가 2 미만이면 곡선을 그릴 수 없다. 화면이 그 사실로 기간 선택
   *   버튼을 켤지 판단한다 — 서버가 "그릴 수 있다" 를 판정해 주는 편이,
   *   화면마다 다른 기준을 쓰는 것보다 안전하다.
   */
  app.get('/portfolio/equity-curve', async (c) => {
    const a = await authed(c);
    if (!a) return c.json({ error: { code: 'UNAUTHENTICATED', message: '' } }, 401);

    if (!d.equitySnapshots) {
      /*
         저장소가 없다 (PostgreSQL 미사용 배포).

         ★ 200 으로 준다. 이력이 없는 것은 장애가 아니고, 503 을 주면 화면을
           열 때마다 콘솔에 오류가 쌓인다.
      */
      return c.json({
        supported: false,
        points: [],
        canPlot: false,
        reason: 'not_configured',
      });
    }

    const days = Math.min(Math.max(1, Number(c.req.query('days') ?? 30) || 30), 1825);
    const source = c.req.query('source') === 'mock' ? 'mock' : 'exchange';

    const [points, summary] = await Promise.all([
      d.equitySnapshots.range(a.user.id, { days, source }),
      d.equitySnapshots.summary(a.user.id, source),
    ]);

    return c.json({
      supported: true,
      source,
      days,
      points,
      // 점이 하나면 선을 만들 수 없다. 그 판정을 서버가 한 곳에서 한다.
      canPlot: points.length >= 2,
      history: summary,
      /*
         ★ 빈 구간을 채우지 않았다는 사실을 명시한다. 화면이 점 사이를 직선으로
           이을지, 끊어 그릴지 결정할 근거다.
      */
      interpolated: false,
    });
  });

  return app;
}
