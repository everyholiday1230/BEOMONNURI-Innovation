import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { AuthService, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import {
  BACKTEST_CAVEATS,
  DEFAULT_CONFIG,
  STRATEGY_CATALOG,
  barsPerYear,
  findStrategy,
  runBacktest,
  type BacktestBar,
  type BacktestConfig,
  type BacktestResult,
} from '@quantumtrade/strategy';
import { hashConfig, type BacktestRow, type FollowRow } from './db/strategy-repo';

/**
 * G6 — strategy gallery.
 *
 * The design's gallery carried per-strategy `pnl30`, `winRate`, `sharpe`, `maxDD` and `followers` as static
 * card fields. None of those can be static: a metric exists only as the output of a backtest over a stated
 * window, and follower counts are real counts that start at zero.
 *
 * So this router is built around one rule: **no metric is ever returned without the window and assumptions
 * that produced it.** The listing returns catalogue entries with `metrics: null` until a backtest has been
 * run, and every backtest response carries its window, its config and its caveats.
 *
 * Following records interest. It does NOT copy trades — there is no auto-execution anywhere in this product,
 * and Follow is not Submit Order any more than Approve Signal is.
 */

const CSRF = 'qt_csrf';
const corr = () => Math.random().toString(36).slice(2, 10);
const err = (code: string, message: string) => ({ error: { code, message, correlationId: corr() } });

/** Candle source. Injected so the router is testable without a network. */
export interface CandleSource {
  getCandles(input: { symbol: string; timeframe: string; limit: number }): Promise<BacktestBar[]>;
  /**
   * Where the candles came from.
   *
   * Load-bearing: a backtest over MOCK_REPLAY fixtures produces plausible numbers from a deterministic
   * path that a trend strategy can trivially exploit (observed: +4.08%, Sharpe 7.54 on the mock feed). Those
   * are not market results, and a response without provenance would be read as if they were.
   */
  source(): string;
}

export interface StrategyRouterDeps {
  service: AuthService;
  /**
   * 전략 저장소.
   *
   * SQLite 와 Postgres 두 구현을 모두 받는다. 메서드 모양은 같지만 Postgres
   * 구현은 Promise 를 돌려주므로, 호출부에서 전부 await 한다 — 동기 구현을
   * await 하는 것은 무해하다(값이 그대로 온다).
   *
   * 왜 두 구현이 필요한가: 사용자 테이블이 Postgres 에 있는 배포에서 팔로우를
   * SQLite 에 쓰면 외래키가 깨진다(실제로 500 이 났다).
   */
  repo: StrategyRepoLike;
  candles: CandleSource;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  /** Bars requested per backtest. Bounded: one BitMart kline call returns at most 500. */
  maxBars?: number;
}

const BacktestRequestSchema = z
  .object({
    symbol: z.string().min(1).max(32).default('BTCUSDT'),
    timeframe: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w']).default('1h'),
    /** Bars to test over. Capped by `maxBars`. */
    bars: z.coerce.number().int().min(60).max(500).default(500),
    /** Fee/slippage overrides, so a user can see how sensitive a result is to costs. */
    takerFee: z.string().regex(/^\d*\.?\d+$/u).optional(),
    slippage: z.string().regex(/^\d*\.?\d+$/u).optional(),
  })
  .strict();

/**
 * 저장소 계약. 동기(SQLite) 구현과 비동기(Postgres) 구현을 함께 받기 위해
 * 반환 타입을 `T | Promise<T>` 로 둔다.
 */
export interface StrategyRepoLike {
  findBacktest(q: {
    strategyId: string; symbol: string; timeframe: string;
    fromTime: number; toTime: number; inputHash: string;
  }): BacktestRow | null | Promise<BacktestRow | null>;
  saveBacktest(result: BacktestResult, inputHash: string): BacktestRow | Promise<BacktestRow>;
  latestPerStrategy(symbol: string, timeframe: string): BacktestRow[] | Promise<BacktestRow[]>;
  listFollows(userId: string): FollowRow[] | Promise<FollowRow[]>;
  follow(userId: string, input: { strategyId: string; symbol: string; timeframe: string; note?: string }): FollowRow | Promise<FollowRow>;
  unfollow(userId: string, id: string): boolean | Promise<boolean>;
  countFollowers(strategyId: string): number | Promise<number>;
}

const FollowSchema = z
  .object({
    strategyId: z.string().min(1).max(64),
    symbol: z.string().min(1).max(32),
    timeframe: z.enum(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w']),
    note: z.string().max(500).optional(),
  })
  .strict();

export function createStrategyRouter(d: StrategyRouterDeps): Hono {
  const app = new Hono();
  const maxBars = d.maxBars ?? 500;

  const authed = async (c: Context) => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };
  const csrfOk = (c: Context, secret: string) =>
    originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF), secret, d.csrfKey);

  /**
   * GET /strategies — the catalogue.
   *
   * Public and metric-free by default. `metrics` is populated ONLY from a cached backtest for the requested
   * symbol/timeframe, and carries the window that produced it. A card cannot show a Sharpe that nobody
   * computed.
   */
  app.get('/strategies', async (c) => {
    const symbol = c.req.query('symbol') ?? 'BTCUSDT';
    const timeframe = c.req.query('timeframe') ?? '1h';
    const cached = new Map((await d.repo.latestPerStrategy(symbol, timeframe)).map((r) => [r.strategy_id, r]));

    /*
       팔로워 수를 먼저 모아둔다.

       map 콜백 안에서 await 할 수 없고, 전략마다 순차로 기다리면 카탈로그가
       커질 때 응답이 선형으로 느려진다. 병렬로 한 번에 센다.
    */
    const followerCounts = new Map(
      await Promise.all(
        STRATEGY_CATALOG.map(async (e) => [e.id, await d.repo.countFollowers(e.id)] as const),
      ),
    );

    const items = STRATEGY_CATALOG.map((e) => {
      const row = cached.get(e.id);
      return {
        ...e,
        // Real count, starting at 0. The design showed 1,240 / 2,140 followers for strategies nobody follows.
        followers: followerCounts.get(e.id) ?? 0,
        metrics:
          row === undefined
            ? null
            : {
                totalReturnPct: row.total_return_pct,
                winRatePct: row.win_rate_pct,
                maxDrawdownPct: row.max_drawdown_pct,
                sharpe: row.sharpe,
                tradeCount: row.trade_count,
                window: { fromTime: row.from_time, toTime: row.to_time, barCount: row.bar_count },
                computedAt: row.computed_at,
              },
      };
    });

    return c.json({
      items,
      symbol,
      timeframe,
      /** Stated so a consumer knows a null metric means "not computed", not "zero". */
      /*
         ★ 문장이 아니라 번역 키다. 서버는 요청 언어를 모르므로 한국어 문장을
           담으면 다른 언어 화면에 그대로 나온다(caveats 와 같은 이유).
      */
      metricsNoteKey: 'bt_metrics_note',
      dataSource: d.candles.source(),
      caveats: [...BACKTEST_CAVEATS],
      /** No tiers and no user-authored strategies exist. */
      unavailable: ['subscriptionTiers', 'userAuthoredStrategies', 'liveTrackRecord'],
    });
  });

  // Registered BEFORE `/strategies/:id`: Hono matches in registration order, so `/strategies/mine` would
  // otherwise be captured by the parameterised route with id='mine' and answer 404.
  /** GET /strategies/mine — this user's follows. */
  app.get('/strategies/mine', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    const rows = await d.repo.listFollows(a.user.id);
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        strategyId: r.strategy_id,
        symbol: r.symbol,
        timeframe: r.timeframe,
        note: r.note,
        createdAt: r.created_at,
        /*
           ★ 이름과 번역 키를 함께 준다.
             화면은 nameKey 가 있으면 번역하고, 없으면 name 을 그대로 쓴다
             (사용자 작성 전략처럼 사전에 없는 경우).
        */
        name: STRATEGY_CATALOG.find((e) => e.id === r.strategy_id)?.name ?? r.strategy_id,
        nameKey: STRATEGY_CATALOG.find((e) => e.id === r.strategy_id)?.nameKey,
      })),
      total: rows.length,
      /**
       * The single most important statement on this endpoint.
       *
       * The design's Follow button was described as "auto-copy signals". Nothing here copies or executes
       * anything: following records interest so the strategy appears on this list.
       */
      autoExecution: false,
      /*
         ★ 문장이 아니라 번역 키다.

           이 문구는 "팔로우해도 주문이 나가지 않는다" 를 알리는 안내다. 읽지
           못하는 언어로 나오면 안내를 하지 않은 것과 같고, 사용자는 주문이
           자동으로 나갈 줄 알고 기다린다.
      */
      noteKey: 'strat_follow_note',
    });
  });


  /** GET /strategies/:id — one entry plus its cached backtest, if any. */
  app.get('/strategies/:id', async (c) => {
    const id = c.req.param('id');
    const entry = STRATEGY_CATALOG.find((e) => e.id === id);
    if (!entry) return c.json(err('NOT_FOUND', 'strategy not found'), 404);
    const symbol = c.req.query('symbol') ?? 'BTCUSDT';
    const timeframe = c.req.query('timeframe') ?? '1h';
    const row = (await d.repo.latestPerStrategy(symbol, timeframe)).find((r) => r.strategy_id === id);
    return c.json({
      ...entry,
      followers: await d.repo.countFollowers(id),
      symbol,
      timeframe,
      // The full result, including trades and the equity curve, so the detail page never has to infer.
      backtest: row === undefined ? null : (JSON.parse(row.result_json) as unknown),
      caveats: [...BACKTEST_CAVEATS],
    });
  });

  /**
   * POST /strategies/:id/backtest — run one.
   *
   * Authenticated: a backtest fetches candles and burns CPU, so it is not an anonymous endpoint. Results are
   * cached by their exact inputs and re-served rather than recomputed.
   */
  app.post('/strategies/:id/backtest', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);

    const rules = findStrategy(c.req.param('id'));
    if (!rules) return c.json(err('NOT_FOUND', 'strategy not found'), 404);

    const parsed = BacktestRequestSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json(err('BAD_REQUEST', parsed.error.issues[0]?.message ?? 'invalid request'), 400);
    const { symbol, timeframe, takerFee, slippage } = parsed.data;
    const bars = Math.min(parsed.data.bars, maxBars);

    const config: BacktestConfig = {
      ...DEFAULT_CONFIG,
      barsPerYear: barsPerYear(timeframe),
      ...(takerFee !== undefined ? { takerFee } : {}),
      ...(slippage !== undefined ? { slippage } : {}),
    };
    const inputHash = hashConfig(config);

    let candles: BacktestBar[];
    try {
      candles = await d.candles.getCandles({ symbol, timeframe, limit: bars });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
    if (candles.length === 0) {
      // Not "zero return": we could not test at all.
      return c.json(err('NO_DATA', `no candles for ${symbol} ${timeframe}`), 503);
    }

    const fromTime = candles[0]!.time;
    const toTime = candles[candles.length - 1]!.time;

    const dataSource = d.candles.source();
    // A non-live feed makes every metric meaningless as a market result; said in the caveats, not a footnote.
    const sourceCaveats =
      dataSource === 'bitmart_public'
        ? []
        : [`이 백테스트는 실시장 데이터가 아닌 '${dataSource}' 소스로 계산되었습니다. 수치를 시장 성과로 읽으면 안 됩니다.`];

    const hit = await d.repo.findBacktest({ strategyId: rules.id, symbol, timeframe, fromTime, toTime, inputHash });
    if (hit) {
      const cachedResult = JSON.parse(hit.result_json) as { caveats?: string[] };
      return c.json({
        ...cachedResult,
        caveats: [...sourceCaveats, ...(cachedResult.caveats ?? [])],
        dataSource,
        cached: true,
        computedAt: hit.computed_at,
      });
    }

    let result;
    try {
      result = runBacktest(rules, candles, symbol, timeframe, config);
    } catch (e) {
      // Too few bars for the warmup, etc. Refused rather than returned as a flat, loss-free curve.
      return c.json(err('INSUFFICIENT_DATA', (e as Error).message), 422);
    }
    const saved = await d.repo.saveBacktest(result, inputHash);
    return c.json({
      ...result,
      caveats: [...sourceCaveats, ...result.caveats],
      dataSource,
      cached: false,
      computedAt: saved.computed_at,
    });
  });

  // ---- follows ----

  app.post('/strategies/follow', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    const parsed = FollowSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json(err('BAD_REQUEST', parsed.error.issues[0]?.message ?? 'invalid request'), 400);
    if (!findStrategy(parsed.data.strategyId)) return c.json(err('NOT_FOUND', 'strategy not found'), 404);
    const row = await d.repo.follow(a.user.id, parsed.data);
    return c.json({ id: row.id, strategyId: row.strategy_id, symbol: row.symbol, timeframe: row.timeframe, createdAt: row.created_at, autoExecution: false }, 201);
  });

  app.delete('/strategies/follow/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    return (await d.repo.unfollow(a.user.id, c.req.param('id')))
      ? c.json({ ok: true })
      : c.json(err('NOT_FOUND', 'follow not found'), 404);
  });

  return app;
}
