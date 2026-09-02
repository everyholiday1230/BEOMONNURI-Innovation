import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService, hasPermission, type IAuditRepository, type PublicUser } from '@quantumtrade/auth';
import { ORDER_BLOCKING_KILL_SCOPES } from '@quantumtrade/admin-domain';
import type { SymbolInfo } from '@quantumtrade/schemas';
import type { IOrderDraftRepo } from '../db/order-draft-repo';
import type { PortfolioReadRepo } from './portfolio-routes';
import type { TradingPolicy } from '../trading/risk-engine';
import { OrderIntentSchema, validateOrderIntent, type ValidationContext } from './order-validation';
import { buildProvenance, MARK_PRICE_FRESHNESS_MS, type TradingPosture } from './provenance';
import { InMemoryRateLimiter, type RateLimiter } from '../security/rate-limiter';

/**
 * B4 — order draft and validation contracts.
 *
 * There is deliberately NO submit route in this file, and no code path that constructs an exchange
 * client. The two endpoints here compute a verdict and (for `draft`) store it. `executable: false` is
 * part of every response.
 *
 * Both are POST and both require CSRF: they are audited, rate-limited user actions, and a draft write is
 * a state change even though it never reaches an exchange.
 */

const CSRF_COOKIE = 'qt_csrf';
const MAX_BODY = 16 * 1024;
const corr = () => Math.random().toString(36).slice(2, 10);
const err = (code: string, message: string) => ({ error: { code, message, correlationId: corr() } });

export interface OrderRouterDeps {
  service: AuthService;
  audit: IAuditRepository;
  drafts: IOrderDraftRepo;
  /*
     거래 읽기 저장소.

     ★ 동기(SQLite)·비동기(PostgreSQL) 양쪽을 받는 계약을 쓴다. 한쪽만 지원하면
       배포가 갈릴 때 조회가 조용히 빈 결과를 준다.
  */
  portfolio: PortfolioReadRepo;
  symbolInfo: Record<string, SymbolInfo>;
  policy: TradingPolicy;
  posture: TradingPosture;
  /** 운영 컨트롤 게이트. 있으면 global_live_trading/new_positions 킬스위치를 강제한다. */
  controls?: { killActive(scope: string): boolean };
  /** Reference price provider (public market data only — never a private endpoint). */
  referencePrice: (symbol: string) => Promise<{ price: string; at: number } | null>;
  minNotional: string;
  makerFeeRate: string;
  takerFeeRate: string;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  ratePerMin?: number;
  /** Distributed limiter (Redis in production; in-memory in dev). Injected so the real HTTP path uses it. */
  rateLimiter?: RateLimiter;
  now?: () => number;
  verifyCsrf: (token: string | undefined, cookie: string | undefined, secret: string, key: string) => boolean;
  originAllowed: (origin: string | undefined, referer: string | undefined, allowed: string[]) => boolean;
}

export function createOrderRouter(d: OrderRouterDeps): Hono {
  const app = new Hono();
  const now = d.now ?? Date.now;
  const limit = d.ratePerMin ?? 30;
  const rl: RateLimiter = d.rateLimiter ?? new InMemoryRateLimiter(now);

  const authed = async (c: Context): Promise<{ user: PublicUser; csrfSecret: string } | null> => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };

  const csrfOk = (c: Context, secret: string) =>
    d.originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    d.verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF_COOKIE), secret, d.csrfKey);

  const noStore = (c: Context) => {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  };

  /**
   * Shared entry guard: session → CSRF → permission → rate limit → body.
   *
   * Order matters. Rate limiting AFTER authentication means an unauthenticated flood cannot consume a
   * real user's budget, and permission before body parsing means an unauthorised caller never gets to
   * exercise the parser.
   */
  async function enter(c: Context): Promise<
    | { ok: true; user: PublicUser; body: unknown }
    | { ok: false; res: Response }
  > {
    const a = await authed(c);
    if (!a) return { ok: false, res: c.json(err('UNAUTHENTICATED', 'not logged in'), 401) };
    if (!csrfOk(c, a.csrfSecret)) return { ok: false, res: c.json(err('CSRF_FAILED', 'csrf validation failed'), 403) };
    if (!hasPermission(a.user.role, 'order-draft.write.self')) {
      return { ok: false, res: c.json(err('FORBIDDEN', 'permission'), 403) };
    }
    const budget = await rl.allow(`order:${a.user.id}`, limit, 60_000);
    if (!budget.ok) {
      c.header('Retry-After', String(Math.ceil(budget.retryAfterMs / 1000)));
      return { ok: false, res: c.json(err('RATE_LIMITED', 'too many order validations'), 429) };
    }
    const raw = await c.req.text();
    if (raw.length > MAX_BODY) return { ok: false, res: c.json(err('BAD_REQUEST', 'oversized body'), 400) };
    try {
      return { ok: true, user: a.user, body: raw ? JSON.parse(raw) : {} };
    } catch {
      return { ok: false, res: c.json(err('BAD_REQUEST', 'invalid json'), 400) };
    }
  }

  /** Assemble the validation context from server-side sources only. */
  async function contextFor(userId: string, symbol: string): Promise<ValidationContext> {
    let referencePrice: string | null = null;
    let referenceStale = true;
    try {
      const ref = await d.referencePrice(symbol);
      if (ref) {
        referencePrice = ref.price;
        referenceStale = now() - ref.at > MARK_PRICE_FRESHNESS_MS;
      }
    } catch {
      // Provider failure means no reference price, which the validator treats as blocking for a market
      // order. It must not be silently substituted with a stale or default value.
      referencePrice = null;
      referenceStale = true;
    }

    // 두 조회는 서로 독립이므로 병렬로 보낸다.
    const [balances, positions] = await Promise.all([
      d.portfolio.listBalances(userId),
      d.portfolio.listPositions(userId, {}),
    ]);
    // Quote-currency balance only. Summing every asset would overstate the margin available for a
    // USDT-margined order.
    const quote = balances.items.find((b) => b.asset === 'USDT');
    const dayStart = new Date(now()).setUTCHours(0, 0, 0, 0);

    return {
      symbolInfo: d.symbolInfo[symbol],
      policy: d.policy,
      referencePrice,
      referenceStale,
      minNotional: d.minNotional,
      makerFeeRate: d.makerFeeRate,
      takerFeeRate: d.takerFeeRate,
      liveTradingEnabled: d.posture.liveTradingEnabled,
      /*
         ★★ 주문을 막는 킬스위치를 **한 곳의 목록**으로 검사한다.

           예전에는 여기서 'global_live_trading' 하나만 직접 이름으로 봤다. 그래서
           'bitmart_live_trading' 은 시드만 되고 **아무도 검사하지 않았다** —
           관리자 화면에서 켤 수 있었지만 주문은 그대로 나갔다. 운영자가 거래를
           멈췄다고 믿는 동안 실주문이 계속 나가는 상태였다.

           ORDER_BLOCKING_KILL_SCOPES 를 근거로 삼으면, 다음에 스코프를 추가할 때
           강제 경로가 함께 따라온다. new_positions 는 의미가 달라(감소 주문은 허용)
           아래에서 따로 본다.
      */
      killSwitchActive: d.posture.killSwitchActive
        || ORDER_BLOCKING_KILL_SCOPES.some((sc) => sc !== 'new_positions' && (d.controls?.killActive(sc) ?? false)),
      newPositionsHalted: d.controls?.killActive('new_positions') ?? false,
      tradingMode: d.posture.tradingMode,
      availableBalance: quote ? quote.available : null,
      openPositions: positions.total,
      dailyOrderCount: await d.drafts.countOrdersSince(userId, dayStart),
    };
  }

  const provenance = () =>
    buildProvenance({ posture: d.posture, asOf: now(), now: now(), freshnessMs: null });

  /**
   * ORD-04 — POST /orders/validate. Computes a verdict and stores NOTHING.
   *
   * Idempotency is not required here precisely because it is not a mutation; adding a key would imply
   * the call had a side effect.
   */
  app.post('/orders/validate', async (c) => {
    const e = await enter(c);
    if (!e.ok) return e.res;
    noStore(c);

    const parsed = OrderIntentSchema.safeParse(e.body ?? {});
    if (!parsed.success) {
      return c.json(
        {
          ...err('UNPROCESSABLE', 'invalid order intent'),
          // Field path + rule code. The rejected values are not echoed back.
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
        },
        422,
      );
    }
    const ctx = await contextFor(e.user.id, parsed.data.symbol);
    const result = validateOrderIntent(parsed.data, ctx);

    await d.audit.record({
      id: corr(),
      actorUserId: e.user.id,
      action: 'order.validate',
      target: parsed.data.symbol,
      ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      at: now(),
      // Verdict + reason CODES only. The order's prices and sizes are the user's data and are not copied
      // into the audit trail.
      meta: {
        result: result.allowed ? 'allowed' : 'blocked',
        valid: result.valid,
        blockingCodes: result.blockingReasons.map((r) => r.code),
      },
    });

    return c.json({ draftId: null, ...result, ...provenance() });
  });

  /**
   * ORD-03 — POST /orders/draft. Validates, then persists the intent AND the verdict.
   *
   * Requires an Idempotency-Key. A draft is a stored record; a retried request that created a second row
   * would leave the user with two drafts they only meant to create once.
   */
  app.post('/orders/draft', async (c) => {
    const e = await enter(c);
    if (!e.ok) return e.res;
    noStore(c);

    const idemKey = c.req.header('idempotency-key');
    if (!idemKey || idemKey.length < 8 || idemKey.length > 128) {
      return c.json(err('BAD_REQUEST', 'Idempotency-Key header (8-128 chars) required'), 400);
    }

    const parsed = OrderIntentSchema.safeParse(e.body ?? {});
    if (!parsed.success) {
      return c.json(
        {
          ...err('UNPROCESSABLE', 'invalid order intent'),
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
        },
        422,
      );
    }

    const ctx = await contextFor(e.user.id, parsed.data.symbol);
    const result = validateOrderIntent(parsed.data, ctx);

    const { row, replayed } = await d.drafts.create({
      userId: e.user.id,
      symbol: parsed.data.symbol,
      side: parsed.data.side,
      idempotencyKey: idemKey,
      valid: result.valid,
      allowed: result.allowed,
      data: { intent: parsed.data, result },
    });

    if (!replayed) {
      await d.audit.record({
        id: corr(),
        actorUserId: e.user.id,
        action: 'order.draft.create',
        target: row.id,
        ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        at: now(),
        meta: {
          result: result.allowed ? 'allowed' : 'blocked',
          valid: result.valid,
          blockingCodes: result.blockingReasons.map((r) => r.code),
          version: row.version,
        },
      });
    }

    // A replayed draft returns the STORED verdict, so a retry can never report a different outcome than
    // the call it is replaying.
    const stored = (row.data as { result?: typeof result } | null)?.result;
    const payload = replayed && stored ? stored : result;

    return c.json(
      {
        draftId: row.id,
        version: row.version,
        replayed,
        ...payload,
        // Re-asserted after the spread: whatever was stored, the row and the response agree that this
        // draft is not executable.
        executable: false as const,
        ...provenance(),
      },
      replayed ? 200 : 201,
    );
  });

  /** Draft list, so the UI can show what it stored rather than assuming the write worked. */
  app.get('/orders/drafts', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!hasPermission(a.user.role, 'order-draft.read.self')) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);
    const limitRaw = new URL(c.req.url).searchParams.get('limit');
    const offsetRaw = new URL(c.req.url).searchParams.get('offset');
    const limit = Math.min(Math.max(Number(limitRaw ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(offsetRaw ?? 0) || 0, 0);
    const out = await d.drafts.listOwned(a.user.id, limit, offset);
    return c.json({
      items: out.items.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        side: r.side,
        version: r.version,
        source: r.source,
        executable: r.executable,
        valid: r.valid,
        allowed: r.allowed,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
      page: { limit, offset, total: out.total, hasMore: offset + out.items.length < out.total },
      ...provenance(),
    });
  });

  return app;
}
