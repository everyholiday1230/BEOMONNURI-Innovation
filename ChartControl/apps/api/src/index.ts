import type { Server as HttpServer } from 'node:http';

import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { getCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import type { SymbolInfo } from '@quantumtrade/schemas';
import { SUPPORTED_TIMEFRAMES, loadEnv, assertProductionSigningKeys, assertProductionDatabaseReadiness } from './env';
import { selectProviders } from './providers';
import { computeMarketDataStatus } from './market-freshness';
import { describeStatic, mountStatic } from './static-web';
import { attachWsGateway, type WsGatewayHandle } from './ws-gateway';


import { MockAIProvider } from './ai/mock-ai-provider';
import { SimOrderEngine } from './sim/order-engine';
import { AuthService, MailSink, resendFromEnv, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import { createAuthRouter } from './auth-routes';
import { openDb } from './db/sqlite';
import { createCoreIdentityRepositories, BATCH_1_REPOSITORY_IDS, createUserDataRepositories, BATCH_2_REPOSITORY_IDS, createAdminRepositories, BATCH_3_REPOSITORY_IDS } from './db/repository-factory';
import { ResourceRepo } from './db/resource-repo';
import { CredentialVault, LocalKekProvider } from './trading/credential-vault';
import { KucoinAccountAdapter } from './trading/kucoin-account-adapter';
import { assertProductionCredentialReadiness } from './trading/credential-source';
import { createBrokerRebateReader } from './trading/broker-rebate-source';
import { assertNoDevFixtures } from './security/dev-fixture-guard';
import { SqliteCredentialRepo } from './db/trading-repos';
import { SqliteOrderDraftRepo } from './db/order-draft-repo';
import { SqliteStrategyRepo } from './db/strategy-repo';
import { createStrategyRouter } from './strategy-routes';
import { createTradingRouter } from './trading-routes';
import { BitMartFuturesAdapter } from '@quantumtrade/exchange-bitmart';
import { createAiRouter } from './ai-routes';
import { SqliteConversationRepo, SqliteUsageRepo } from './db/ai-repos';
import { resolveAiProvider } from './ai/production-ai';
import { DEFAULT_COST_CONFIG, type ToolDataSource } from '@quantumtrade/ai';
import { createAdminRouter } from './admin/admin-routes';
import { randomUUID } from 'node:crypto';
import { AesGcmSecretCipher } from '@quantumtrade/mfa';
import { createMfaRouter, mfaChallengeHash } from './mfa/mfa-routes';

import { createMarketSearchRouter } from './market/market-routes';
import { createExchangeRouter } from './exchanges/exchange-routes';
import { createPortfolioRouter } from './portfolio/portfolio-routes';
import { PortfolioRepo } from './db/portfolio-repo';
import { assertProductionRepositoryReadiness, REQUIRED_PRODUCTION_REPOSITORY_IDS, type RepositoryDescriptor } from './db/repository-registry';
import { createRateLimiter } from './security/rate-limiter';
import { SimOrderProjection } from './portfolio/sim-projection';
import { createOrderRouter } from './portfolio/order-routes';
import { createNotificationRouter } from './notifications/notification-routes';
import { createAnalyticsRouter } from './analytics/analytics-routes';
import { SqliteJournalRepo } from './db/journal-repo';
import { buildAiMarketContext, type TickerLike } from './ai/market-context';

const env = loadEnv();
const providers = selectProviders(env);
const ai = new MockAIProvider();
const orders = new SimOrderEngine();
// R6/BL-11 — one distributed rate limiter shared by every rate-limited HTTP path. Production uses Redis
// (fail-closed: REDIS_URL required, runtime failures deny); dev/e2e uses in-memory. Selected by the
// server from env only — never client input.
const rateLimiter = createRateLimiter({ isProduction: process.env.NODE_ENV === 'production', redisUrl: env.redisUrl });

/**
 * BATCH_1 — what the repository FACTORY actually constructed, reported to the production startup guard.
 *
 * It starts EMPTY on purpose. If auth/db initialisation fails, nothing is appended, the guard sees the
 * required repositories as `missing`, and production refuses to start. A wiring failure therefore cannot
 * degrade into "started anyway with no identity layer".
 */
const wiredRepositoryDescriptors: RepositoryDescriptor[] = [];

// ---- Phase 4 AI: read-only tool data source (market data + user-visible read-only positions/orders) ----
const aiToolData: ToolDataSource = {
  async get_market_snapshot(symbol) { return providers.market.getTicker(symbol); },
  async get_candles(symbol, timeframe, limit) { return providers.market.getCandles({ symbol, timeframe: timeframe as (typeof SUPPORTED_TIMEFRAMES)[number], limit }); },
  async get_order_book_summary(symbol, depth) { const b = await providers.book.getSnapshot(symbol, depth); return { bids: b.bids?.length ?? 0, asks: b.asks?.length ?? 0 }; },
  async get_recent_trades_summary(symbol, limit) { const t = await providers.trades.getRecent(symbol, limit); return { count: t.length }; },
  async get_funding_rate(symbol) { const tk = (await providers.market.getTicker(symbol)) as { fundingRate?: string }; return { fundingRate: tk.fundingRate ?? null }; },
  async get_market_metadata(symbol) { return { symbol, note: 'metadata via market provider' }; },
  async get_current_chart_context(symbol, timeframe) { return { symbol, timeframe }; },
  // Read-only + user-scoped. Live positions/orders are gated elsewhere; default empty (shadow).
  async get_user_visible_positions() { return []; },
  async get_user_visible_open_orders() { return []; },
};

// Resolve the AI provider at startup (fail-closed for openai without a Secrets Manager key).
const aiResolution = await resolveAiProvider({
  enabled: env.aiEnabled,
  provider: env.aiProvider,
  isProduction: process.env.NODE_ENV === 'production',
  model: env.openaiModelPrimary,
  secret: { isProduction: process.env.NODE_ENV === 'production', secretArn: env.openaiSecretArn, region: env.awsRegion },
  estimateCostMicros: (_m, i, o) => Math.ceil((i / 1000) * 5000 + (o / 1000) * 15000),
});

const app = new Hono();

// ---- security middleware ----
app.use('*', secureHeaders());
app.use(
  '/api/*',
  cors({
    origin: env.corsOrigins, // allowlist, no wildcard
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }),
);

const corr = () => Math.random().toString(36).slice(2, 10);
const errBody = (code: string, message: string, extra: Record<string, unknown> = {}) => ({
  error: { code, message, correlationId: corr(), ...extra },
});

// ---- health / readiness / liveness (Phase 6 §11) ----
app.get('/health', (c) => c.json({ status: 'ok', uptimeMs: Math.round(process.uptime() * 1000) }));
// Liveness: process is up (never touches dependencies). Readiness: safe to receive traffic.
app.get('/health/live', (c) => c.json({ status: 'ok', uptimeMs: Math.round(process.uptime() * 1000) }));
app.get('/health/ready', (c) =>
  c.json({ status: 'ok', version: process.env.GIT_SHA ?? 'dev', dataMode: env.dataMode, tradingMode: env.tradingMode, liveTradingEnabled: env.liveOrdersEnabled }),
);
app.get('/ready', (c) => {
  // 스트림이 끊겨도 status 는 ok 다 — REST 경로가 살아 있으면 트래픽을 받을 수 있고,
  // 로드밸런서가 인스턴스를 빼버리면 오히려 전면 장애가 된다.
  //
  // 대신 스트림 상태를 그대로 노출한다. 이 값이 없으면 운영자가 "시세가 멈춘 것"을
  // 알 방법이 없다. 죽은 시세를 live 로 보여주는 것이 가장 위험한 실패 모드다.
  let marketStream: unknown = null;
  try {
    marketStream = providers.streaming ? providers.streaming.status() : 'not_applicable';
  } catch (e) {
    marketStream = { error: (e as Error).message };
  }

  return c.json({
    status: 'ok',
    dataMode: env.dataMode,
    tradingMode: env.tradingMode,
    checks: {
      marketDataSource: providers.source,
      marketDataStatus: computeMarketDataStatus(providers),
      marketStream,
    },
  });
});

// ---- config (public, safe values only) ----
app.get('/api/config', (c) =>
  c.json({
    dataMode: env.dataMode,
    tradingMode: env.tradingMode,
    liveOrdersEnabled: env.liveOrdersEnabled, // false in Phase 1
    // The client MUST be able to block the order CTA on the emergency kill switch rather than
    // guessing a value; this is a read-only mirror of BITMART_EMERGENCY_KILL_SWITCH.
    killSwitchActive: env.bitmartKillSwitch,
    defaultSymbol: env.defaultSymbol,
    timeframes: SUPPORTED_TIMEFRAMES,
    marketDataSource: providers.source,
  }),
);

// ---- market data (public) ----
// MKT-01 search lives in its own mountable router (see market/market-routes.ts) so it is testable
// without starting a listener; the remaining market reads stay inline for now.
app.route('/api', createMarketSearchRouter({
  getSymbols: (signal) => providers.market.getSymbols(signal),
  source: providers.source,
  tradingMode: env.tradingMode,
}));

// G1 — exchange catalogue. Public and unauthenticated: /wallet and the landing page both render it
// before a session exists. Mounted here, with the other public reads, rather than behind the auth
// router. See exchanges/exchange-routes.ts.
app.route('/api', createExchangeRouter({}));

app.get('/api/market/symbols', async (c) => {
  try {
    const symbols = await providers.market.getSymbols();
    return c.json({ symbols, source: providers.source });
  } catch (e) {
    return c.json(errBody('UPSTREAM_ERROR', (e as Error).message), 502);
  }
});

app.get('/api/market/candles', async (c) => {
  const symbol = c.req.query('symbol') ?? env.defaultSymbol;
  const timeframe = c.req.query('timeframe') ?? '15m';
  const limit = Number(c.req.query('limit') ?? 300);
  const before = c.req.query('before') ? Number(c.req.query('before')) : undefined;
  if (!(SUPPORTED_TIMEFRAMES as readonly string[]).includes(timeframe)) {
    return c.json(errBody('BAD_REQUEST', `unsupported timeframe ${timeframe}`), 400);
  }
  try {
    const candles = await providers.market.getCandles({
      symbol,
      timeframe: timeframe as (typeof SUPPORTED_TIMEFRAMES)[number],
      limit,
      before,
    });
    return c.json({ symbol, timeframe, candles, source: providers.source });
  } catch (e) {
    return c.json(errBody('UPSTREAM_ERROR', (e as Error).message), 502);
  }
});

app.get('/api/market/orderbook', async (c) => {
  const symbol = c.req.query('symbol') ?? env.defaultSymbol;
  const depth = Number(c.req.query('depth') ?? 20);
  const book = await providers.book.getSnapshot(symbol, depth);
  return c.json(book);
});

app.get('/api/market/trades', async (c) => {
  const symbol = c.req.query('symbol') ?? env.defaultSymbol;
  const limit = Number(c.req.query('limit') ?? 30);
  const trades = await providers.trades.getRecent(symbol, limit);
  return c.json({ symbol, trades });
});

app.get('/api/market/ticker', async (c) => {
  const symbol = c.req.query('symbol') ?? env.defaultSymbol;
  try {
    const ticker = await providers.market.getTicker(symbol);
    return c.json(ticker);
  } catch (e) {
    return c.json(errBody('UPSTREAM_ERROR', (e as Error).message), 502);
  }
});

/**
 * All tickers in one response — what the markets screen needs.
 *
 * Without this the client would issue one request per symbol (21 round trips for one screen) and burn
 * 21 rate-limit tokens for data the exchange returns in a single upstream call. `source`/`asOf` follow
 * the provenance convention used by the other market reads: a table rendered from a mock catalogue must
 * not be indistinguishable from a live one.
 */
app.get('/api/market/tickers', async (c) => {
  try {
    const [tickers, symbols] = await Promise.all([
      providers.market.getTickers(),
      providers.market.getSymbols(),
    ]);
    // Base/quote come from the symbol catalogue, not parsed out of the ticker id: splitting "BTCUSDT"
    // by guessing the quote length breaks on symbols like 1000PEPEUSDT and on non-USDT quotes.
    const meta = new Map(symbols.map((s) => [s.id, s]));
    return c.json({
      items: tickers.map((t) => {
        const m = meta.get(t.symbol);
        return {
          ...t,
          base: m?.base ?? t.symbol,
          quote: m?.quote ?? '',
          contractType: m?.contractType ?? 'perpetual',
          pricePrecision: m?.pricePrecision ?? 2,
        };
      }),
      total: tickers.length,
      source: providers.source,
      asOf: Date.now(),
      dataMode: env.dataMode,
    });
  } catch (e) {
    return c.json(errBody('UPSTREAM_ERROR', (e as Error).message), 502);
  }
});

// ---- AI analyze (SSE streaming, abortable) ----
/**
 * B9 — the market context is assembled SERVER-SIDE.
 *
 * `body.lastPrice` is accepted in the type only so an old client is not a parse error; the value is
 * IGNORED. Two things were wrong with using it: it defaulted to a hard-coded 68000 (so an unpriced
 * symbol produced a confident analysis of a fictional Bitcoin price), and it let the caller choose the
 * number the model reasons about.
 *
 * Anonymous callers get market context only. Position and balance context requires a session, and it is
 * read from the user's own rows — never from the request.
 */
let aiUserContext: ((c: Context) => Promise<{
  positions: { symbol: string; side: string; size: string; entryPrice: string | null }[];
  availableBalance: string | null;
}>) | null = null;

app.post('/api/ai/analyze', async (c) => {
  const body = await c.req.json<{
    symbol?: string;
    timeframe?: string;
    prompt?: string;
    /** Accepted for backwards compatibility and deliberately NOT used. */
    lastPrice?: number;
  }>();
  const symbol = body.symbol ?? env.defaultSymbol;
  const timeframe = (body.timeframe ?? '15m') as (typeof SUPPORTED_TIMEFRAMES)[number];

  const userCtx = aiUserContext ? await aiUserContext(c) : { positions: [], availableBalance: null };
  const built = await buildAiMarketContext(
    { symbol, timeframe },
    {
      getTicker: (s) => providers.market.getTicker(s) as Promise<TickerLike | null>,
      getPositions: () => userCtx.positions,
      getAvailableBalance: () => userCtx.availableBalance,
      source: env.dataMode === 'MOCK_REPLAY' ? 'MOCK' : 'SNAPSHOT',
      tradingMode: env.tradingMode,
      liveTradingEnabled: env.liveOrdersEnabled && env.bitmartLiveTradingEnabled,
      killSwitchActive: env.bitmartKillSwitch,
    },
  );

  // Fail closed: no price, a stale price or a provider outage stops the analysis. The client is told
  // which of the three it was so it can show something truthful.
  if (!built.ok) {
    return c.json(
      errBody('AI_CONTEXT_UNAVAILABLE', `cannot build market context: ${built.reason}`),
      built.reason === 'PROVIDER_UNAVAILABLE' ? 502 : 409,
    );
  }
  const ctx = built.context;

  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort()); // cancel when the client disconnects
    // The context is emitted FIRST so the UI can label the answer with its provenance before any token
    // of the answer arrives.
    await stream.writeSSE({ event: 'context', data: JSON.stringify({ type: 'context', context: ctx }) });
    try {
      for await (const ev of ai.analyze(
        {
          symbol,
          timeframe,
          prompt: body.prompt ?? '',
          dataAsOf: ctx.asOf,
          // Decimal string → number at the provider boundary only, after it has been validated as a real
          // positive price. There is no fallback value.
          lastPrice: Number(ctx.lastPrice),
          context: ctx,
        },
        abort.signal,
      )) {
        await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
      }
    } catch (e) {
      await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: (e as Error).message }) });
    }
  });
});

// ---- simulated market-data SSE fan-out (single-node, in-memory) ----
app.get('/api/stream/market', (c) => {
  const symbol = c.req.query('symbol') ?? env.defaultSymbol;
  const timeframe = (c.req.query('timeframe') ?? '15m') as (typeof SUPPORTED_TIMEFRAMES)[number];
  return streamSSE(c, async (stream) => {
    let seq = 0;
    await stream.writeSSE({ event: 'status', data: JSON.stringify({ type: 'status', state: 'LIVE' }) });
    const unsub = providers.market.subscribeCandles(symbol, timeframe, (candle) => {
      void stream.writeSSE({
        event: 'candle',
        data: JSON.stringify({ seq: seq++, type: 'candle', symbol, ts: Date.now(), data: candle }),
      });
    });
    stream.onAbort(() => unsub());
    // keep the stream open until the client disconnects
    await new Promise<void>((resolve) => stream.onAbort(resolve));
  });
});

// ---- simulation order flow ----
const DEFAULT_SYMBOL_INFO: Record<string, SymbolInfo> = {
  BTCUSDT: { id: 'BTCUSDT', base: 'BTC', quote: 'USDT', contractType: 'perpetual', pricePrecision: 1, quantityPrecision: 3, tickSize: '0.1', stepSize: '0.001', minQty: '0.001', maxLeverage: 125 },
  ETHUSDT: { id: 'ETHUSDT', base: 'ETH', quote: 'USDT', contractType: 'perpetual', pricePrecision: 2, quantityPrecision: 3, tickSize: '0.01', stepSize: '0.001', minQty: '0.001', maxLeverage: 100 },
};

app.post('/api/sim/order-drafts', async (c) => {
  const body = await c.req.json<{ symbol?: string }>();
  const sym = DEFAULT_SYMBOL_INFO[body.symbol ?? env.defaultSymbol] ?? DEFAULT_SYMBOL_INFO.BTCUSDT!;
  const result = orders.createDraft(body, sym);
  if (!result.ok) return c.json(errBody('VALIDATION_FAILED', result.error), 400);
  // NOTE: the confirmation token is issued but, in a real UI flow, is only revealed after the user
  // passes the final-confirmation gate. Exposed here for the local simulation walkthrough.
  return c.json({
    draftId: result.draftId,
    preview: result.preview,
    confirmationToken: orders.getConfirmationToken(result.draftId),
  });
});

/**
 * Durable projection of a confirmed simulated order (Prompt 5 §7).
 *
 * Assigned inside the auth/DB block below, which is where a session can actually be validated. Left
 * null when auth is disabled or the DB failed to open, in which case the simulation keeps its previous
 * in-memory-only behaviour rather than failing the request.
 */
let projectSimOrder: ((c: Context, order: unknown) => Promise<void>) | null = null;

app.post('/api/sim/orders/confirm', async (c) => {
  const body = await c.req.json<{
    draftId?: string;
    clientOrderId?: string;
    confirmationToken?: string;
    userConfirmed?: boolean;
  }>();
  if (!body.draftId || !body.clientOrderId) {
    return c.json(errBody('BAD_REQUEST', 'draftId and clientOrderId required'), 400);
  }
  const result = orders.confirmAndSubmit({
    draftId: body.draftId,
    clientOrderId: body.clientOrderId,
    confirmationToken: body.confirmationToken ?? '',
    userConfirmed: body.userConfirmed === true,
  });
  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 403;
    return c.json(errBody(result.code, result.error), status);
  }
  // Persist under the signed-in user so /api/orders/* and /api/positions can serve it. A projection
  // failure must not fail the simulation itself, so it is logged and swallowed.
  if (projectSimOrder) {
    try {
      await projectSimOrder(c, result.order);
    } catch (e) {
       
      console.error('[api] sim order projection failed:', (e as Error).message);
    }
  }
  return c.json({ order: result.order });
});

app.get('/api/sim/orders', (c) => c.json({ orders: orders.listOrders() }));

// ---- Phase 2: Authentication / account / admin (ADDITIVE — existing routes unchanged) ----
// Guarded by AUTH_ENABLED (default on). DB/auth failure is isolated: market/sim/ai keep working.
if (env.authEnabled) {
  try {
    const db = openDb(env.sqlitePath);

    // Phase 7 §4 — production fail-closed: refuse to start if this database still holds known
    // development / E2E fixture accounts. Matching is by SHA-256 digest of the normalized identifier
    // (see src/security/dev-fixture-guard.ts), so no development e-mail or password is present in
    // the production bundle, and nothing identifying is written to the log on failure.
    if (process.env.NODE_ENV === 'production') {
      try {
        const result = assertNoDevFixtures(
          {
            listIdentifiers: () =>
              (db.prepare('SELECT email FROM users').all() as Array<{ email: string }>)
                .map((r) => r.email)
                .filter((e): e is string => typeof e === 'string'),
            hasFixtureMarker: () => {
              try {
                const row = db
                  .prepare("SELECT 1 AS present FROM feature_flags WHERE key='e2e_seed' LIMIT 1")
                  .get() as { present?: number } | undefined;
                return Boolean(row?.present);
              } catch {
                // Flag table absent (older schema) — hash matching still applies.
                return false;
              }
            },
          },
          true,
        );
         
        console.log(
          `[api] production fixture scan: OK (identifiers inspected=${result.inspected}, fixture matches=0)`,
        );
      } catch (e) {
        // Deliberately logs the code + counts only — never an identifier.
         
        console.error('[api] FAIL-CLOSED startup:', (e as Error).message);
        process.exit(1);
      }
    }

    // BATCH_1 / BL-10 — identity persistence comes from the FACTORY, which picks PostgreSQL in production
    // (via createPool(DATABASE_URL)) and SQLite in dev/test/E2E. The selection is made from NODE_ENV +
    // DATABASE_URL by the server; there is no production SQLite fallback, so this throws in production
    // rather than opening the local file. `wiredRepositoryDescriptors` then reports the REAL backend to
    // the startup guard below.
    let core;
    try {
      core = createCoreIdentityRepositories({
        db,
        isProduction: process.env.NODE_ENV === 'production',
        databaseUrl: env.databaseUrl,
      });
    } catch (e) {
      // In production this is a hard stop: an identity layer that cannot be built on PostgreSQL must not
      // be replaced by one that can be built on SQLite.
       
      console.error('[api] FAIL-CLOSED startup:', (e as Error).message);
      process.exit(1);
    }
    wiredRepositoryDescriptors.push(...core.descriptors);
     
    console.log(`[api] core identity repositories: backend=${core.backend} (${BATCH_1_REPOSITORY_IDS.join(', ')})`);

    // BATCH_2 / BL-10 — user/trading persistence (favorites, preferences, notifications, order drafts).
    // Same server-selected backend rule and no production SQLite fallback; reuses the ONE pool created by
    // the core-identity factory in production. Reports its backends to the startup guard below.
    let userData;
    try {
      userData = createUserDataRepositories({
        db,
        isProduction: process.env.NODE_ENV === 'production',
        pool: core.pool,
      });
    } catch (e) {
       
      console.error('[api] FAIL-CLOSED startup:', (e as Error).message);
      process.exit(1);
    }
    wiredRepositoryDescriptors.push(...userData.descriptors);
     
    console.log(`[api] user/trading repositories: backend=${userData.backend} (${BATCH_2_REPOSITORY_IDS.join(', ')})`);

    const auditRepo = core.audit;
    const resendProvider = resendFromEnv();
    const mailProvider = resendProvider ?? new MailSink();
    if (resendProvider === null) {
       
      console.warn(
        '[api] MAIL NOT CONFIGURED — using in-memory sink. Verification and password-reset links will NOT ' +
          'reach users. Set RESEND_API_KEY, MAIL_FROM and APP_BASE_URL.',
      );
    } else {
       
      console.log(`[api] mail provider: ${resendProvider.name} (from=${process.env.MAIL_FROM ?? '?'})`);
    }
    const authService = new AuthService(core.users, core.sessions, auditRepo, {
      emailTokens: core.emailTokens,
      resetTokens: core.resetTokens,
      // Real provider when configured, sink otherwise. The choice is logged below: a deployment silently
      // falling back to the sink means no user ever receives a verification link, and that must be visible in
      // the boot output rather than discovered from a support ticket.
      mail: mailProvider,
    });
    const resource = new ResourceRepo(db);

    // Phase 5 — Admin & operations dashboard. Mounted BEFORE the auth router so /api/admin/* resolves
    // to the Phase-5 admin handlers (RBAC/redaction/append-only audit) rather than the legacy Phase-2
    // /admin/audit + /admin/users/:id support endpoints (which remain for the auth router's own tests).
    try {
      // BATCH_3 / BL-10 — admin/gateway/ai-policy persistence from the FACTORY (PostgreSQL in production
      // via the shared core pool; SQLite adapter in dev/test). Reports admin_operations/gateway_state/
      // ai_policy descriptors to the startup guard below.
      const adminOps = createAdminRepositories({ db, isProduction: process.env.NODE_ENV === 'production', pool: core.pool });
      wiredRepositoryDescriptors.push(...adminOps.descriptors);
      const adminRepo = adminOps.admin;
       
      console.log(`[api] admin/gateway/ai-policy repositories: backend=${adminOps.backend} (${BATCH_3_REPOSITORY_IDS.join(', ')})`);
      // Singleton rows (idempotent) — awaited so production has them before serving the admin console.
      await adminRepo.seedMockGateway();
      await adminRepo.seedAiPolicy();
      // Seed kill switches (live-trading scopes default ACTIVE/blocked — fail-closed).
      for (const s of ['global_live_trading', 'bitmart_live_trading', 'new_positions'] as const) await adminRepo.seedKill(s, null, true);
      for (const s of ['ai_provider', 'ai_signal_generation', 'ai_order_draft'] as const) await adminRepo.seedKill(s, null, false);
      // Seed feature flags (safe defaults).
      await adminRepo.seedFlag('ai_enabled', env.aiEnabled, 'AI copilot enabled');
      await adminRepo.seedFlag('bitmart_live_trading_enabled', false, 'BitMart live trading (default off)');
      // Seed release gates — pending items stay NOT_EXECUTED (never auto-Passed).
      const gates: Array<[string, string, string, boolean]> = [
        ['bitmart-stage-a', 'Phase3', 'BitMart Production Read-Only Stage A', true],
        ['bitmart-private-ws-soak', 'Phase3', 'BitMart Private WS 30-min/2-h soak', true],
        ['controlled-live-order', 'Phase3', 'Controlled Live Order (real order)', true],
        ['live-openai', 'Phase4', 'Live OpenAI Responses API', true],
        ['live-model-eval', 'Phase4', 'Live-model AI evaluation', true],
        ['live-ai-e2e', 'Phase4', 'Live AI E2E / fault injection', true],
        ['firefox-webkit-e2e', 'Phase1', 'Firefox/WebKit E2E in CI', false],
        ['load-1k-10k', 'Phase1', '1k-user / 10k-WS load test', true],
        ['central-market-data-gateway', 'Phase1', 'Central market-data gateway + scale', true],
        ['backup-restore-pitr', 'Phase2', 'Managed PG backup/restore + PITR', true],
        ['mfa', 'Phase5', 'Admin MFA (Not Implemented)', true],
      ];
      for (const [key, phase, desc, prod] of gates) await adminRepo.seedGate({ key, phase, description: desc, status: 'NOT_EXECUTED', productionRequired: prod });

      const health = (): Record<string, string> => ({
        api: 'ok',
        postgres: 'Unavailable (dev store is SQLite)',
        secretsManager: env.awsRegion ? 'Configured' : 'Not Connected',
        bitmartRest: 'Not Connected (not probed at runtime)',
        bitmartWs: 'Not Connected',
        openai: aiResolution.kind === 'openai' && aiResolution.available ? 'Configured' : 'Not Connected',
        aiProvider: aiResolution.kind,
        redisQueue: 'Not Connected',
        buildVersion: '0.5.0-rc',
        gitSha: process.env.GIT_SHA ?? 'Unavailable',
        mfa: 'Not Implemented / Release Gate',
        latencyP50: 'Unavailable', latencyP95: 'Unavailable', latencyP99: 'Unavailable',
        cpu: 'Unavailable', memory: 'Unavailable',
      });

      // G10 — operator rebate statement reader. Constructed once at mount time; `undefined` when this
      // deployment has no operator BitMart credential. Never throws: a missing broker key must not stop
      // the API from starting, it must make one admin endpoint report NOT_CONFIGURED.
      const brokerRebates = createBrokerRebateReader({
        brokerId: env.bitmartBrokerId,
        isProduction: process.env.NODE_ENV === 'production',
        ...(process.env.BITMART_CREDENTIAL_SOURCE ? { source: process.env.BITMART_CREDENTIAL_SOURCE } : {}),
        ...(process.env.BITMART_SECRET_ARN ?? process.env.BITMART_SECRET_ID
          ? { secretId: process.env.BITMART_SECRET_ARN ?? process.env.BITMART_SECRET_ID }
          : {}),
        ...(env.awsRegion ? { region: env.awsRegion } : {}),
      });
      console.log(
        `[api] broker rebate reader: ${brokerRebates ? `configured (brokerId=${env.bitmartBrokerId})` : 'not configured (no operator BitMart credential)'}`,
      );

      app.route('/api', createAdminRouter({
        service: authService, repo: adminRepo, csrfKey: env.csrfKey, corsOrigins: env.corsOrigins,
        cookieName: env.cookieName, health, ratePerMin: env.adminRateLimitPerMin, rateLimiter,
        // ADM-API-08: only the LOCAL MOCK gateway is ever controllable, and only when this deployment is
        // actually running in MOCK trading mode. Any other mode reports DISABLED_BY_POLICY rather than
        // mutating state and calling it a reconnect. Decided here, at mount time, from the environment.
        gatewayControl: { controllable: env.tradingMode === 'MOCK', target: 'LOCAL_MOCK' },
        // The real posture, so /admin/overview reports what this deployment actually does rather than a
        // hardcoded READ_ONLY/killSwitch-on triple.
        posture: {
          mode: env.bitmartMode,
          liveTradingEnabled: env.bitmartLiveTradingEnabled,
          killSwitch: env.bitmartKillSwitch,
        },
        // G10: operator rebate statement. `undefined` when no operator BitMart credential is
        // configured, which the route reports as NOT_CONFIGURED rather than as an empty statement.
        ...(brokerRebates ? { brokerRebates } : {}),
      }));
       
      console.log('[api] admin mounted (/api/admin, admin RBAC, no-store)');

      // Dev/E2E ONLY seed (never production). The fixture credentials live in `src/dev/seed.ts`,
      // which is NOT part of the production import graph: the specifier below is assembled at
      // runtime so esbuild cannot resolve it and cannot inline the module into `dist/index.js`
      // (verified by scripts/phase7-artifact-scan.sh, not assumed). In production `adminSeedEnabled`
      // is already false, and the dev module additionally refuses to run.
      if (env.adminSeedEnabled) {
        void (async () => {
          try {
            // Assembled at runtime on purpose — do NOT turn this into a literal import specifier.
            // The module's shape is declared locally so even a *type* reference to './dev/seed'
            // stays out of this file (a type import would still name the path in source).
            const devSeedSpecifier = ['.', 'dev', `seed.${process.env.QT_DEV_SEED_EXT ?? 'ts'}`].join('/');
            const mod = (await import(devSeedSpecifier)) as {
              runDevSeed(deps: {
                register(input: { email: string; password: string }): Promise<unknown>;
                findUserId(email: string): string | undefined;
                setUserRole(userId: string, role: string): void;
                markSeeded(): void;
                log?(message: string): void;
              }): Promise<number>;
            };
            await mod.runDevSeed({
              register: (input) => authService.register(input),
              findUserId: (email) =>
                (db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string } | undefined)?.id,
              setUserRole: (userId, role) => { void adminRepo.setUserRole(userId, role); },
              markSeeded: () => { void adminRepo.seedFlag('e2e_seed', true, 'e2e seed marker'); },
               
              log: (message) => console.log(message),
            });
          } catch (e) {
             
            console.error('[api] dev seed unavailable (expected in production builds):', (e as Error).message);
          }
        })();
      }
    } catch (e) {
       
      console.error('[api] admin init failed; admin endpoints disabled:', (e as Error).message);
    }

    // Phase 6 — MFA (TOTP + recovery). Secret encrypted at rest; recovery codes hashed. The auth login
    // route consults this gate: MFA-enabled users get a pending challenge instead of a full session.
    const mfaRepo = core.mfa;
    const mfaCipher = new AesGcmSecretCipher(
      process.env.MFA_KEK ? Buffer.from(process.env.MFA_KEK, 'base64') : Buffer.alloc(32, 9), // dev key; prod uses KMS-managed key
    );
    const MFA_COOKIE = 'qt_mfa';
    const MFA_TTL = 5 * 60_000;
    const mfaGate = {
      isEnabled: (uid: string) => mfaRepo.isEnabled(uid),
      // AWAITED: the challenge row must exist before the pending cookie is handed to the client. A
      // fire-and-forget write here would let a user hold a cookie for a challenge that was never stored.
      startChallenge: async (uid: string) => {
        const raw = randomUUID() + randomUUID();
        await mfaRepo.createChallenge(mfaChallengeHash(raw), uid, MFA_TTL);
        return raw;
      },
      cookie: MFA_COOKIE,
      ttlMs: MFA_TTL,
    };

    app.route(
      '/api',
      createAuthRouter({
        service: authService,
        audit: auditRepo,
        resource,
        favorites: userData.favorites,
        preferences: userData.preferences,
        csrfKey: env.csrfKey,
        secureCookies: env.secureCookies,
        corsOrigins: env.corsOrigins,
        cookieName: env.cookieName,
        cookieDomain: env.cookieDomain,
        mfa: mfaGate,
        // R6/BL-11 — the SAME distributed limiter instance every other rate-limited path uses. In
        // production this is Redis/Valkey and fail-closed, so the login budget is shared across instances.
        rateLimiter,
        loginRatePerMin: env.loginRateLimitPerMin,
      }),
    );
    app.route('/api', createMfaRouter({
      service: authService, repo: mfaRepo, cipher: mfaCipher, csrfKey: env.csrfKey, corsOrigins: env.corsOrigins,
      cookieName: env.cookieName, challengeCookie: MFA_COOKIE, secureCookies: env.secureCookies,
      activeSuperAdminIds: () => (db.prepare("SELECT id FROM users WHERE role='SUPER_ADMIN' AND status='active'").all() as { id: string }[]).map((r) => r.id),
      // B7 / ADM-API-13 + BATCH_1: lockout state is PERSISTED rather than process-local, so it survives a
      // restart and is observable and clearable through the admin console. Same algorithm, different store
      // (PostgreSQL in production, SQLite in dev/E2E) — chosen by the factory, not here.
      lockouts: core.lockouts,
      // R6/BL-11 — distributed per-actor budget on the MFA verification surfaces, shared with every other
      // rate-limited path. Enforced IN ADDITION TO the persistent lockout above.
      rateLimiter,
      ratePerMin: env.mfaRateLimitPerMin,
    }));

    // Phase 7 / Prompt 5 — B3 + B5 user portfolio read model (orders/trades/positions/account) and the
    // validation-only position contracts. Read-only; no exchange call; `executable:false` enforced.
    // `posture` is built from env here, at mount time, so no request can influence what the response
    // reports about live-trading state.
    const tradingPosture = {
      // MOCK until a real provider read is verified end-to-end. Never promoted by a request parameter.
      source: (env.tradingMode === 'MOCK' ? 'MOCK' : 'SNAPSHOT') as 'MOCK' | 'SNAPSHOT' | 'LIVE',
      tradingMode: env.tradingMode,
      liveTradingEnabled: env.liveOrdersEnabled && env.bitmartLiveTradingEnabled,
      killSwitchActive: env.bitmartKillSwitch,
    };
    app.route('/api', createPortfolioRouter({
      service: authService,
      repo: new PortfolioRepo(db),
      posture: tradingPosture,
      csrfKey: env.csrfKey,
      corsOrigins: env.corsOrigins,
      cookieName: env.cookieName,
      verifyCsrf,
      originAllowed,
    }));
     
    console.log(`[api] portfolio read model mounted (source=${tradingPosture.source}, live=${tradingPosture.liveTradingEnabled}, killSwitch=${tradingPosture.killSwitchActive})`);

    // B4 — order draft/validate. Validation-only by construction: this router has no submit route and
    // constructs no exchange client. The reference price comes from the PUBLIC market provider, never
    // from a private endpoint.
    app.route('/api', createOrderRouter({
      service: authService,
      audit: auditRepo,
      drafts: userData.orderDrafts,
      portfolio: new PortfolioRepo(db),
      symbolInfo: DEFAULT_SYMBOL_INFO,
      policy: { allowedSymbols: ['BTCUSDT', 'ETHUSDT'], maxOrderNotional: '100000', maxLeverage: 20, maxOpenPositions: 5, dailyOrderLimit: 50, dailyLossLimit: '1000', priceDeviationLimitPct: 5 },
      posture: tradingPosture,
      referencePrice: async (symbol) => {
        const t = await providers.market.getTicker(symbol);
        const px = t.markPrice ?? t.last;
        return px === undefined ? null : { price: String(px), at: Date.now() };
      },
      minNotional: '5',
      makerFeeRate: '0.0002',
      takerFeeRate: '0.0006',
      csrfKey: env.csrfKey,
      corsOrigins: env.corsOrigins,
      cookieName: env.cookieName,
      ratePerMin: env.orderValidateRatePerMin,
      rateLimiter,
      verifyCsrf,
      originAllowed,
    }));
     
    console.log('[api] order draft/validate mounted (validation-only, executable=false)');

    // B6 — notifications (NTF-01/02). Polling contract; no real-time channel exists in this deployment.
    // BATCH_2 — async repository (PostgreSQL in production, SQLite in dev/test), selected by the factory.
    const notificationRepo = userData.notifications;
    app.route('/api', createNotificationRouter({
      service: authService,
      audit: auditRepo,
      repo: notificationRepo,
      posture: tradingPosture,
      csrfKey: env.csrfKey,
      corsOrigins: env.corsOrigins,
      cookieName: env.cookieName,
      verifyCsrf,
      originAllowed,
    }));
     
    console.log('[api] notifications mounted (delivery=POLL)');

    // G7 — trade journal + realized-PnL analytics. SQLite-backed for now; the repository interface is
    // the seam a PostgreSQL implementation slots into, like the other user-data repos.
    app.route('/api', createAnalyticsRouter({
      service: authService,
      repo: new SqliteJournalRepo(db),
      posture: tradingPosture,
      csrfKey: env.csrfKey,
      corsOrigins: env.corsOrigins,
      cookieName: env.cookieName,
      verifyCsrf,
      originAllowed,
    }));

    console.log('[api] analytics mounted (trade journal, realized PnL; derivation-from-fills=off)');


    // Phase 8 G6 — strategy gallery. The catalogue is code (@quantumtrade/strategy); only backtest
    // results and per-user follows are stored.
    try {
      app.route(
        '/api',
        createStrategyRouter({
          service: authService,
          repo: new SqliteStrategyRepo(db),
          candles: {
            // Provenance travels with every result: a backtest over MOCK fixtures is not a market result,
            // and a response without the source would be read as if it were.
            source: () => providers.source,
            getCandles: async ({ symbol, timeframe, limit }) =>
              (await providers.market.getCandles({ symbol, timeframe: timeframe as never, limit })).map((cd) => ({
                time: cd.time,
                open: cd.open,
                high: cd.high,
                low: cd.low,
                close: cd.close,
                volume: cd.volume,
              })),
          },
          csrfKey: env.csrfKey,
          corsOrigins: env.corsOrigins,
          cookieName: env.cookieName,
        }),
      );
       
      console.log('[api] strategies mounted (/api/strategies, catalogue in code, backtests cached)');
    } catch (e) {
       
      console.error('[api] strategy init failed:', (e as Error).message);
    }

    // B9 — position/risk context for the AI copilot, read from the caller's OWN rows. Requires a valid
    // session; an anonymous analysis gets market context only rather than someone else's exposure.
    const aiPortfolio = new PortfolioRepo(db);
    aiUserContext = async (c) => {
      const raw = getCookie(c, env.cookieName);
      const v = raw ? await authService.validateSession(raw) : null;
      if (!v) return { positions: [], availableBalance: null };
      const positions = aiPortfolio.listPositions(v.user.id, { limit: 20 });
      const balances = aiPortfolio.listBalances(v.user.id);
      const quote = balances.items.find((b) => b.asset === 'USDT');
      return {
        positions: positions.items.map((p) => ({ symbol: p.symbol, side: p.side, size: p.size, entryPrice: p.entryPrice })),
        // Null, not 0: an unknown balance must not read as an empty account.
        availableBalance: quote ? quote.available : null,
      };
    };

    // Durable projection for confirmed SIMULATED orders. Ownership is taken from the validated session
    // cookie only — never from the request body — so a caller cannot write rows into another account.
    const simProjection = new SimOrderProjection(db);
    projectSimOrder = async (c, order) => {
      const raw = getCookie(c, env.cookieName);
      if (!raw) return; // anonymous simulation stays in memory (previous behaviour, unchanged)
      const v = await authService.validateSession(raw);
      if (!v) return;
      const o = order as Record<string, unknown>;
      const projected = simProjection.project(v.user.id, {
        id: String(o.id),
        clientOrderId: String(o.clientOrderId),
        symbol: String(o.symbol),
        side: String(o.side),
        orderType: String(o.orderType ?? 'limit'),
        price: o.price === undefined || o.price === null ? undefined : String(o.price),
        quantity: String(o.quantity),
        filledQuantity: o.filledQuantity === undefined ? undefined : String(o.filledQuantity),
        leverage: o.leverage === undefined ? undefined : Number(o.leverage),
        marginMode: o.marginMode === undefined ? undefined : String(o.marginMode),
        status: String(o.status),
        createdAt: Number(o.createdAt ?? Date.now()),
        updatedAt: Number(o.updatedAt ?? Date.now()),
        events: (o.events as { fromState: string | null; toState: string; actor: string; at: number }[] | undefined) ?? [],
      });

      // A real, server-side notification for a real, server-side event. Only on a first projection: a
      // replayed confirm must not produce a second notification for one fill.
      if (projected.ok && String(o.status) === 'FILLED') {
        await notificationRepo.create({
          userId: v.user.id,
          type: 'order_filled',
          severity: 'info',
          // Plain text only. The client renders this as a text node, never as markup.
          message: `Simulated order filled: ${String(o.symbol)} ${String(o.side)} ${String(o.filledQuantity ?? o.quantity)}`,
          correlationId: projected.orderId,
        });
      }
    };
     
    console.log(`[api] auth + mfa mounted (sqlite=${env.sqlitePath}, secureCookies=${env.secureCookies})`);

    // Phase 3 — BitMart trading (additive). Read-only by default; live disabled + kill switch on.
    try {
      const kek = env.bitmartKek ?? Buffer.alloc(32, 7).toString('base64'); // dev-only fixed KEK when unset
      const vault = new CredentialVault(new LocalKekProvider(kek));
      // brokerId: attribution for the BitMart Broker Program. Every relayed order must carry it or
      // the fill earns no rebate, so it is wired at the single place the adapter is constructed.
      /*
         계정 어댑터 선택.

         DATA_MODE 가 KuCoin 이면 계정·포지션도 KuCoin 이어야 한다. 시세는
         KuCoin 인데 잔고는 BitMart 를 조회하면, 사용자 화면에 다른 거래소의
         숫자가 섞인다. BitMart 는 2026-08-26 거래 종료로 조회 자체가 불가하다.

         브로커 파트너 헤더를 여기서 한 번만 주입한다. 어댑터를 만드는 곳이
         한 군데뿐이므로, 헤더를 빠뜨려 리베이트가 집계되지 않는 사고를 막는다.
      */
      const useKucoinAccounts = env.dataMode === 'KUCOIN_PUBLIC';

      const accountAdapter = useKucoinAccounts
        ? new KucoinAccountAdapter({
            restBase: env.kucoinFuturesRest,
            broker: {
              partner: env.kucoinBrokerPartner,
              key: env.kucoinBrokerKey,
              name: env.kucoinBrokerName,
            },
            // 계약 승수는 공개 어댑터가 이미 664심볼을 캐시하고 있다.
            // 따로 조회하면 레이트리밋을 두 번 쓰고 값이 어긋날 수 있다.
            multiplierOf: (symbol) => {
              const info = (providers.market as unknown as {
                getCachedSymbol?: (s: string) => { multiplier?: number } | undefined;
              }).getCachedSymbol?.(symbol);
              return info?.multiplier;
            },
          })
        : new BitMartFuturesAdapter({
            restBase: env.bitmartRestBase,
            brokerId: env.bitmartBrokerId,
          });

      if (useKucoinAccounts) {
        const attached = (accountAdapter as KucoinAccountAdapter).brokerAttached;
         
        console.log(
          `[api] kucoin account adapter (broker headers ${attached ? 'ON — rebate attributed' : 'OFF — NO REBATE, set KUCOIN_BROKER_*'})`,
        );
      }
      app.route(
        '/api',
        createTradingRouter({
          service: authService,
          vault,
          credRepo: new SqliteCredentialRepo(db),
          accountAdapter,
          // 저장되는 자격증명에 기록될 거래소. 어댑터 선택과 같은 조건을 쓴다.
          exchangeId: useKucoinAccounts ? 'kucoin' : 'bitmart',
          policy: { allowedSymbols: ['BTCUSDT'], maxOrderNotional: '100000', maxLeverage: 20, maxOpenPositions: 5, dailyOrderLimit: 50, dailyLossLimit: '1000', priceDeviationLimitPct: 5 },
          symbolInfo: DEFAULT_SYMBOL_INFO,
          csrfKey: env.csrfKey,
          corsOrigins: env.corsOrigins,
          cookieName: env.cookieName,
          mode: env.bitmartMode as 'BITMART_LIVE_READ_ONLY',
          liveTradingEnabled: env.bitmartLiveTradingEnabled,
          killSwitch: env.bitmartKillSwitch,
          // Same adapter instance: transaction history is a Read-only call and must carry the same broker
          // ID header as every other request so attribution is consistent.
          transactionSource: accountAdapter,
          // Real risk-engine state. These inputs were hardcoded literals, so the daily-order, daily-loss,
          // open-position and credential gates could never fail.
          riskState: {
            countOrdersSince: (userId, since) => new SqliteOrderDraftRepo(db).countOrdersSince(userId, since),
            openPositions: async (ctx) => {
              try {
                return (await accountAdapter.getPositions(ctx)).length;
              } catch {
                // Unknown, NOT zero: a failed read must not satisfy a position limit.
                return null;
              }
            },
            // Freshness of the market-data provider actually serving this deployment.
            // 실 거래소 피드만 LIVE 로 인정한다. mock_replay 는 결정적 픽스처이므로
            // 신선도 게이트를 통과시켜서는 안 된다 — 목업 가격으로 주문이 나가면 안 되기 때문.
            //
            // 출처를 하드코딩으로 나열하지 않는다. 새 거래소를 추가할 때 이 줄을
            // 잊으면 실피드인데도 STALE 로 판정되어 주문이 조용히 막힌다.
            marketDataStatus: () => computeMarketDataStatus(providers),
          },
        }),
      );
       
      console.log(`[api] trading mounted (mode=${env.bitmartMode}, live=${env.bitmartLiveTradingEnabled}, killSwitch=${env.bitmartKillSwitch})`);
    } catch (e) {
       
      console.error('[api] trading init failed; trading endpoints disabled:', (e as Error).message);
    }

    // Phase 4 — AI copilot (additive). Provider-agnostic; mock/fake default; openai when configured
    // (fail-closed → AI unavailable, never a silent mock swap). Read-only tools only; no order submit.
    try {
      app.route(
        '/api',
        createAiRouter({
          service: authService,
          conversations: new SqliteConversationRepo(db),
          usage: new SqliteUsageRepo(db),
          toolData: aiToolData,
          costConfig: { ...DEFAULT_COST_CONFIG, dailyCostMicros: env.aiDailyUserBudgetMicros },
          csrfKey: env.csrfKey,
          corsOrigins: env.corsOrigins,
          cookieName: env.cookieName,
          ai: { available: aiResolution.available, provider: aiResolution.provider, kind: aiResolution.kind, reason: aiResolution.reason },
          model: env.openaiModelPrimary,
          maxOutputTokens: env.aiMaxOutputTokens,
          store: env.openaiStore,
          maxToolCalls: env.aiMaxToolCalls,
          toolTimeoutMs: env.aiRequestTimeoutMs,
          // BL-11 — the SAME distributed limiter instance every other rate-limited path uses (Redis in
          // production, fail-closed). Bounds AI request RATE, separate from the token/cost budget.
          rateLimiter,
          aiRatePerMin: env.aiRateLimitPerMin,
        }),
      );
       
      console.log(`[api] ai mounted (enabled=${env.aiEnabled}, provider=${aiResolution.kind}, available=${aiResolution.available})`);
    } catch (e) {
       
      console.error('[api] ai init failed; ai endpoints disabled:', (e as Error).message);
    }

    // Phase 5 admin dashboard is mounted earlier (before the auth router) so that /api/admin/* routes
    // resolve to the Phase-5 admin handlers rather than the legacy Phase-2 /admin/* support endpoints.
  } catch (e) {
     
    console.error('[api] auth/db init failed; auth endpoints disabled:', (e as Error).message);
  }
}

const port = env.port;

// Production fail-closed startup guard (PHASE3 §2/item 2): in production, refuse to start unless the
// AWS SDK is installed AND a Secret ARN/id + region are configured (credentials load only via AWS
// Secrets Manager). Dev / e2e (NODE_ENV !== 'production') are unaffected.
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  try {
    // Application signing material must be explicitly provided in production (no generated or
    // hard-coded fallback) — Phase 7 §3.
    assertProductionSigningKeys();
    // R5/BL-10 — production must run on Managed PostgreSQL, never SQLite. Refuse to start otherwise.
    const dbReadiness = assertProductionDatabaseReadiness();
     
    console.log(`[api] production database readiness: OK (backend=${dbReadiness.backend})`);
    // R5/BL-10 (repository-aware) — a postgres:// URL is NOT proof the repositories use PostgreSQL, so
    // this guard reads the backend each repository was ACTUALLY constructed with.
    //
    // BATCH_1 has cut the core identity domains over: when the factory selected PostgreSQL, `auth.users`,
    // `auth.sessions`, `auth.audit`, `mfa` and `account_lockout` report postgres/ready from real wiring.
    // Every OTHER required domain still runs on better-sqlite3 (`openDb`) and is reported as sqlite /
    // not-production-ready — which is the truth, not a placeholder.
    //
    // Consequence, and it is intentional: production STILL refuses to start. Batch 1 alone does not make
    // the deployment safe, and a partially-migrated persistence layer must not be able to advertise
    // itself as ready. The remaining ids flip only when Batch 2/3 actually wire them.
    const REMAINING_SQLITE_BACKEND = 'sqlite' as const; // openDb(env.sqlitePath) — flipped by Batch 2/3
    const wiredById = new Map(wiredRepositoryDescriptors.map((d) => [d.repositoryId, d]));
    const repoDescriptors: RepositoryDescriptor[] = REQUIRED_PRODUCTION_REPOSITORY_IDS.map(
      (repositoryId) =>
        wiredById.get(repositoryId) ?? {
          repositoryId,
          backend: REMAINING_SQLITE_BACKEND,
          productionReady: false,
        },
    );
     
    console.log(
      `[api] wired repository backends: ${repoDescriptors.map((d) => `${d.repositoryId}=${d.backend}`).join(', ')}`,
    );
    assertProductionRepositoryReadiness(repoDescriptors, isProduction);
     
    console.log('[api] production repository readiness: OK (all required repositories on PostgreSQL)');
    await assertProductionCredentialReadiness({
      isProduction,
      secretId: process.env.BITMART_SECRET_ARN ?? process.env.BITMART_SECRET_ID,
      region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
    });
     
    console.log('[api] production credential readiness: OK (AWS Secrets Manager configured)');
  } catch (e) {
     
    console.error('[api] FAIL-CLOSED startup:', (e as Error).message);
    process.exit(1);
  }
}

/**
 * 디자이너 프론트엔드 정적 서빙 — 반드시 모든 API 라우트 등록 뒤에 붙인다.
 *
 * 단일 오리진으로 합치면 CORS 와 SameSite 쿠키 문제가 사라지고 배포 대상도 하나가 된다.
 * 프론트엔드를 찾지 못해도 API 는 정상 동작한다 (헤드리스 배포를 막지 않는다).
 */
const webRoot = mountStatic(app);
if (webRoot) {
   
  console.log(`[api] serving designer frontend from ${webRoot}`);
  for (const item of describeStatic(webRoot)) {
    if (!item.exists) {
       
      console.warn(`[api] static target missing: ${item.path}`);
    }
  }
} else {
   
  console.warn('[api] designer frontend not found — running API only (set WEB_ROOT to override)');
}

/** 실시간 게이트웨이 핸들. 서버가 뜬 뒤에 채워진다. */
let wsGateway: WsGatewayHandle | null = null;

const server = serve({ fetch: app.fetch, hostname: env.host, port }, (info) => {
   
  console.log(
    `[api] QuantumTrade BFF on http://${env.host}:${info.port} | dataMode=${env.dataMode} tradingMode=${env.tradingMode} liveOrders=${env.liveOrdersEnabled}`,
  );

  // 실시간 스트리밍을 시작한다.
  //
  // 서버 리스닝 이후에 시작하는 이유: 거래소 WS 연결이 실패해도 HTTP 는 떠야 한다.
  // 프론트엔드는 REST 로 폴백할 수 있고, 스트림은 자체 백오프로 재연결한다.
  // 여기서 await 하면 거래소 장애 때 서버가 아예 뜨지 않는다.
  if (providers.streaming) {
    providers.streaming.start().catch((e: unknown) => {
       
      console.error('[market] 스트리밍 시작 실패 — REST 는 계속 동작한다:', (e as Error).message);
    });
  }

  // 실시간 게이트웨이. HTTP 서버가 뜬 뒤에 붙인다 (업그레이드 핸들러 등록 대상이 필요).
  wsGateway = attachWsGateway(server as unknown as HttpServer, providers, {
    timeframes: SUPPORTED_TIMEFRAMES,
    onDiagnostic: (message, meta) => {
       
      console.warn(`[ws] ${message}`, meta ? JSON.stringify(meta) : '');
    },
  });
   
  console.log('[ws] realtime gateway mounted at /ws');
});

// Graceful shutdown (Phase 6 §11): stop accepting connections, allow in-flight to drain, then exit.
// Rolling deploys send SIGTERM; the kill switch stays fail-closed for live trading throughout.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
     
    console.log(`[api] ${sig} received — draining and shutting down gracefully`);
    // 클라이언트 연결을 먼저 닫는다. 남겨두면 프로세스가 종료되지 않는다.
    void wsGateway?.close();
    // 업스트림 WS 를 끊는다.
    try { providers.streaming?.stop(); } catch { /* noop */ }
    try { (server as unknown as { close?: (cb?: () => void) => void }).close?.(() => process.exit(0)); } catch { process.exit(0); }
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}

export { app };
