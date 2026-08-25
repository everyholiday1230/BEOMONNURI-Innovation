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
import { AuthService, MailSink, resendFromEnv, smtpFromEnv, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import { createAuthRouter } from './auth-routes';
import { openDb } from './db/sqlite';
import { bootstrapSuperAdmin } from './admin/bootstrap-admin';
import { createCoreIdentityRepositories, BATCH_1_REPOSITORY_IDS, createUserDataRepositories, BATCH_2_REPOSITORY_IDS, createAdminRepositories, BATCH_3_REPOSITORY_IDS } from './db/repository-factory';
import { ResourceRepo } from './db/resource-repo';
import { CredentialVault, LocalKekProvider } from './trading/credential-vault';
import { KucoinAccountAdapter } from './trading/kucoin-account-adapter';
import { KucoinTradingAdapter } from './trading/kucoin-trading-adapter';
import { KucoinSpotTradingAdapter } from './trading/kucoin-spot-trading-adapter';
import { PgNoticeRepo } from './db/notice-repo';
import { PgSupportRepo } from './db/support-repo';
import { createSupportRouter } from './support/support-routes';
import { createAlertRouter } from './alerts/alert-routes';
import { PgPriceAlertRepo } from './db/price-alert-repo';
import { runAlertSweep } from './alerts/alert-watcher';
import { PgReferralRepo } from './db/referral-repo';
import { createReferralRouter } from './referral/referral-routes';
import { PgPointsRepo } from './db/points-repo';
import { createPointsRouter } from './points/points-routes';
import { createPaymentRouter } from './payment-routes';
import { PgPointOrderRepo } from './db/point-order-repo';
import { resolvePaymentProviders } from './payments/providers';
import { createSavedRouter } from './saved-routes';
import { PgSavedItemRepo } from './db/saved-item-repo';import { KucoinBrokerClient } from '@quantumtrade/exchange-kucoin';
import { PgLegalRepo } from './db/legal-repo';
import { seedLegalDocuments } from './legal/seed-legal';
import { createLegalRouter } from './legal/legal-routes';
import { PgSimOrderProjection } from './portfolio/pg-sim-projection';
import { PgPortfolioRepo } from './db/pg-portfolio-repo';
import { PgEquitySnapshotRepo } from './db/equity-snapshot-repo';
import { PgLearningRepo } from './db/learning-repo';
import { PgCredentialRepo } from './db/pg-credential-repo';
import { PgTierRepo } from './db/pg-tier-repo';
import { PgChartTemplateRepo } from './db/chart-template-repo';
import { RiskWatchLoop } from './trading/risk-watch-loop';

/*
   청산 위험 감시 루프.

   ★ 모듈 스코프에 둔다. `health()` 가 이 값을 읽어 운영자에게 감시 상태를
     보여주는데, health 는 감시 루프보다 먼저 정의되기 때문이다.
     클로저이므로 호출 시점에 값이 있으면 된다.
*/
let riskWatch: RiskWatchLoop | null = null;
import { assertProductionCredentialReadiness } from './trading/credential-source';
import { createBrokerRebateReader } from './trading/broker-rebate-source';
import { assertNoDevFixtures } from './security/dev-fixture-guard';
import { SqliteCredentialRepo } from './db/trading-repos';
import { SqliteOrderDraftRepo } from './db/order-draft-repo';
import { SqliteStrategyRepo } from './db/strategy-repo';
import { PgStrategyRepo } from './db/pg-strategy-repo';
import { createStrategyRouter } from './strategy-routes';
import { createTradingRouter } from './trading-routes';
import { createKucoinOauthRouter, isKucoinOauthConfigured } from './kucoin-oauth-routes';
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
import { getConfirmedReferrals } from './exchanges/exchange-catalog';
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
const aiModel = env.aiProvider === 'bedrock' ? (env.bedrockModelId || env.openaiModelPrimary) : env.openaiModelPrimary;
const aiResolution = await resolveAiProvider({
  enabled: env.aiEnabled,
  provider: env.aiProvider,
  isProduction: process.env.NODE_ENV === 'production',
  model: aiModel,
  secret: { isProduction: process.env.NODE_ENV === 'production', secretArn: env.openaiSecretArn, region: env.awsRegion, directKey: env.openaiApiKey },
  bedrockRegion: env.bedrockRegion,
  estimateCostMicros: (_m, i, o) => Math.ceil((i / 1000) * 5000 + (o / 1000) * 15000),
});

const app = new Hono();

// ---- security middleware ----

/*
   Content-Security-Policy.

   ★ 없었다. HSTS·X-Frame-Options·nosniff 는 붙어 있었지만 CSP 헤더는 아예
     생성되지 않았다(secureHeaders() 를 인자 없이 호출하면 CSP 를 만들지 않는다).

   왜 'unsafe-eval' 과 'unsafe-inline' 이 들어가는가
   ----------------------------------------------
   프론트엔드가 브라우저에서 Babel 로 JSX 를 변환한다(빌드 단계가 없다).
   그래서 script-src 에 'unsafe-eval' 이 필요하고, 인라인 babel 블록 때문에
   'unsafe-inline' 도 필요하다.

   ★ 이 두 값이 들어가면 CSP 의 XSS 차단 효과는 크게 줄어든다. 과장하지 않고
     적어둔다 — CSP 가 있다고 XSS 가 막히는 것이 아니다.

   그래도 남는 실질적 방어:
     · frame-ancestors 'none'  — 클릭재킹. 우리 화면을 남의 사이트에 끼워
       주문 버튼을 누르게 만드는 공격을 막는다.
     · object-src 'none'       — 플러그인 실행 경로 제거.
     · base-uri 'self'         — <base> 주입으로 모든 상대 경로를 공격자
       서버로 돌리는 것을 막는다.
     · connect-src 제한        — 침해된 스크립트가 데이터를 외부로 보내기
       어렵게 한다.
     · form-action 'self'      — 입력값을 외부로 제출하지 못하게 한다.

   ★ 나중에 빌드 단계를 도입하면 'unsafe-eval' 과 'unsafe-inline' 을 지워야
     한다. 그때가 CSP 가 실제로 XSS 를 막기 시작하는 시점이다.
*/
/*
   CSP 가 허용하는 외부 스크립트 출처.

   ★ 실서비스 화면(index.html)은 이 목록을 **쓰지 않는다.** React·Babel·폰트를
     모두 자체 호스팅한다(vendor/ · src/fonts/).

   ★ 그런데 목록을 비우지 못한다. design-library/ 와 design-system.html 이
     아직 CDN 을 쓰고, 이 CSP 는 오리진 전체에 적용되어 문서별로 나눌 수 없다.
     그 문서들은 디자이너·개발자용이며 실사용자에게 링크를 노출하지 않는다.

   ★ 그래서 재발 방지는 CSP 가 아니라 검사 도구로 한다:
       node tools/external-ref-check.mjs
     실서비스 화면과 src/ 에 외부 도메인 참조가 생기면 실패한다. CSP 를
     좁히는 것보다 정확하다 — 무엇이 어디서 쓰이는지 구분할 수 있기 때문이다.
*/
const CDN = ['https://unpkg.com', 'https://cdn.jsdelivr.net'];

app.use('*', secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    // 브라우저 Babel 변환 때문에 eval 과 인라인이 필요하다 (위 주석 참고).
    scriptSrc: ["'self'", "'unsafe-eval'", "'unsafe-inline'", ...CDN],
    scriptSrcElem: ["'self'", "'unsafe-inline'", ...CDN],
    /*
       인라인 style 속성(React style={{...}})만 허용한다.

       ★ 전에는 `https://fonts.googleapis.com` 을 허용했다. 폰트를 자체
         호스팅하면서(src/fonts.css) 필요 없어졌다. 허용 목록에 남겨 두면
         나중에 누군가 다시 외부 CDN 링크를 넣어도 CSP 가 막지 않는다 —
         그러면 이용자 IP 가 다시 제3자로 나가고, 우리 개인정보처리방침
         4절과 어긋난다. 좁혀서 실수를 막는다.
    */
    styleSrc: ["'self'", "'unsafe-inline'", ...CDN],
    // 폰트도 자체 호스팅이므로 외부 도메인이 필요 없다. data: 는 인라인 폰트용.
    fontSrc: ["'self'", 'data:', ...CDN],
    // 차트가 canvas 를 이미지로 내보낼 때 blob: 를 쓴다.
    imgSrc: ["'self'", 'data:', 'blob:'],
    /*
       API 와 WebSocket 은 같은 오리진이다 (단일 오리진 서빙).

       ★ 거래소를 브라우저에서 직접 부르지 않는다 — 키가 브라우저에 있으면
         안 되기 때문이다. 그래서 외부 API 도메인을 허용하지 않는다.
    */
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    // 상위 문서를 다른 곳으로 돌리는 것을 막는다.
    frameSrc: ["'none'"],
    workerSrc: ["'self'", 'blob:'],
  },
  // X-Frame-Options 와 함께 둔다 — 오래된 브라우저는 CSP frame-ancestors 를 모른다.
  xFrameOptions: 'DENY',
  crossOriginEmbedderPolicy: false,
}));
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
    /*
       서버가 강제하는 주문 상한.

       ★★ 화면은 레버리지를 최대 125× 까지 고르게 하지만, 서버 정책이 그보다 낮으면
         주문은 리스크 게이트에서 거부된다(policy.leverage). 사용자는 이유를 모른 채
         "주문 실패" 만 본다. 상한을 내보내면 화면이 미리 막거나 알릴 수 있다.

       ★ allowedSymbols 가 ['*'] 면 심볼 제한이 없다는 뜻이다 — 화면은 '제한 없음' 과
         '목록' 을 구분해 표시해야 한다.
    */
    orderPolicy: {
      allowedSymbols: env.tradingPolicy.allowedSymbols,
      maxLeverage: env.tradingPolicy.maxLeverage,
      maxOrderNotional: env.tradingPolicy.maxOrderNotional,
      maxOpenPositions: env.tradingPolicy.maxOpenPositions,
      dailyOrderLimit: env.tradingPolicy.dailyOrderLimit,
      dailyLossLimit: env.tradingPolicy.dailyLossLimit,
      priceDeviationLimitPct: env.tradingPolicy.priceDeviationLimitPct,
    },
    /*
       AI 분석 사용 가능 여부.

       ★★ 이 값이 없어서 클라이언트가 AI 연결 상태를 알 수 없었다. 그 결과
         코파일럿이 **AI 가 연결되지 않았는데도** 사전에 박힌 예시 문구
         ("저항: 69,120 · 지지: 67,200 · 손절 67,480")를 분석 결과처럼 답하고,
         그 값으로 차트에 선까지 그렸다.

       ★ 사용자는 그 숫자로 진입·손절을 정한다. 근거 없는 가격을 분석으로
         내보내는 것은 이 서비스에서 가장 위험한 거짓이다. 화면이 이 값을 보고
         "아직 분석할 수 없다" 고 말해야 한다.
    */
    aiAvailable: aiResolution.kind !== 'unavailable' && aiResolution.available === true,
    aiProvider: aiResolution.kind,
    defaultSymbol: env.defaultSymbol,
    timeframes: SUPPORTED_TIMEFRAMES,
    marketDataSource: providers.source,
    /*
       KuCoin 가입 링크 (레퍼럴).

       여기로 내보내는 이유: 우리는 비수탁이라 사용자가 **자기 KuCoin 계정**을
       만들어 API 키를 연결해야 한다. 계정이 없는 사람에게 가입 경로를 주는 것은
       기능이고, 그 링크에 추천 코드가 붙어 있으면 수익이 된다.

       ★ 브로커 리베이트와 다른 수익원이다. 브로커는 주문 헤더로 집계되고,
         레퍼럴은 가입 귀속으로 집계된다. 화면에서 둘을 섞어 표시하면 안 된다.
       설정이 없으면 빈 문자열 → 화면이 가입 유도를 감춘다.
    */
    // 화면이 브랜드 이름을 여기서 받는다 (i18n 의 {brand} 치환에 쓰인다).
    brandName: env.brandName,
    brandShortName: env.brandShortName,
    // 비어 있으면 화면이 이메일 문의 경로를 감춘다.
    supportEmail: env.supportEmail,
    exchangeSignupUrl: env.kucoinReferralUrl,
    /*
       거래소별 추천 가입 링크.

       ★ 설정에 없는 거래소는 여기 없다. 화면은 링크가 없으면 유도 카드를
         감춰야 한다. 예시 코드가 박힌 링크를 보여주면 사용자는 가입하는데
         귀속이 안 돼 수익이 0 이 된다 — 조용히 새기 때문에 알아채기 어렵다.
    */
    /*
       거래소 추천 링크·코드.

       ★ 코드에 있는 **확인된** 값이 기본이고, 환경설정이 있으면 그쪽이 이긴다.

         전에는 환경설정만 읽었다. 그래서 변수를 빠뜨린 배포는 링크를 아예 보여주지
         않고 모든 신규 가입이 귀속되지 않았는데, 화면에는 아무 표시도 없어 알아챌
         수 없었다. 확인된 값은 배포마다 다르지 않으므로(운영자 자기 계정) 코드에
         두고, 바꿔야 할 때만 환경설정으로 덮는다.

       ★ 확인되지 않은 거래소는 기본값에 들어가지 않는다 — 자리표시자 코드로
         가입이 일어나면 정상 가입되고 리베이트만 0 이 된다.

       ★ 코드가 따로 필요한 이유: 거래소 모바일 앱에서 가입하는 사람은 링크를
         열지 않아, 가입 화면에 코드를 넣는 것이 유일한 귀속 수단이다.
    */
    exchangeReferralUrls: { ...getConfirmedReferrals().urls, ...env.exchangeReferralUrls },
    exchangeReferralCodes: { ...getConfirmedReferrals().codes, ...env.exchangeReferralCodes },
    /*
       KuCoin Fast API (OAuth) 사용 가능 여부.

       ★ 화면이 이 값으로 "KuCoin 으로 연결" 버튼을 보일지 결정한다. 설정이
         없으면 버튼을 만들지 않는다 — 누르면 404 인 버튼을 두면 이용자가
         고장으로 여긴다.
       ★ client_id 자체는 내보내지 않는다. 공개해도 치명적이지는 않지만
         필요하지 않은 값을 내보내지 않는 것이 기본이다.
    */
    kucoinOauthAvailable: isKucoinOauthConfigured(env),
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

/**
 * GET /api/market/contract-specs — 계약 사양 (수수료·증거금률·승수).
 *
 * 왜 /symbols 에 섞지 않는가
 * ------------------------
 * /symbols 는 정규 SymbolInfo 스키마를 그대로 내보낸다. 거래소별로 다른
 * 부가 정보를 그 안에 넣으면 스키마가 거래소에 종속되고, 다른 거래소로
 * 갈아탈 때 소비자가 전부 깨진다. 부가 정보는 별도 표면에 둔다.
 *
 * ★ 여기 수수료율은 거래소 **기본값**이다. 사용자별 VIP 할인은 반영되지 않는다.
 *   "고객이 실제로 내는 수수료" 로 표시하면 안 된다.
 */
/**
 * GET /api/notices — 사용자용 공지 목록.
 *
 * 인증을 요구하지 않는다. 점검 공지는 로그인하지 못하는 상황에서도 보여야 한다 —
 * "로그인이 안 되는데 왜인지 모르는" 상태가 가장 나쁘다.
 *
 * 게시된 것 중 게시 기간 안에 있는 것만 나간다. 그 판단은 저장소가 SQL 에서
 * 하므로, 이 라우트가 조건을 다시 쓰지 않는다 (규칙이 두 곳에 있으면 어긋난다).
 */
/*
   공지 저장소.

   라우트는 파일 앞쪽에서 정의되고 Postgres 풀은 뒤쪽(부팅 절차)에서 만들어진다.
   그래서 여기서 선언만 하고 풀이 준비되면 채운다. 채워지기 전 요청은
   supported:false 를 받는다 — 빈 목록으로 위장하지 않는다.
*/
let noticeRepo: PgNoticeRepo | null = null;

/*
   고객 지원 티켓 저장소.

   사용자용 라우트(/api/support/*)와 관리자 라우트가 같은 인스턴스를 쓴다.
   준비되기 전 요청은 supported:false 를 받는다 — 빈 배열로 위장하면
   "문의가 없다" 로 읽히고, 티켓 생성이 조용히 성공한 것처럼 보인다.
*/
let supportRepo: PgSupportRepo | null = null;
let priceAlertRepo: PgPriceAlertRepo | null = null;

/*
   리퍼럴 저장소.

   사용자 라우터·관리자 라우터·회원가입 귀속 훅이 같은 인스턴스를 쓴다.
   없으면 제도를 사용할 수 없다고 알린다(supported:false) — 빈 응답으로
   위장하면 "초대가 0명" 으로 읽힌다.
*/
let referralRepo: PgReferralRepo | null = null;

/*
   포인트 저장소.

   ★ 포인트는 부채다. 원장이 유일한 기록이므로 Postgres 가 없으면 제도를
     운영하지 않는다 — 휘발성 저장소에 부채를 기록하면 재시작 때 사라진다.
*/
let pointsRepo: PgPointsRepo | null = null;

/*
   법적 문서 저장소.

   ★ 파일이나 코드에 약관을 넣지 않는다. 어느 버전에 동의했는지 기록해야 하고,
     그 기록은 분쟁 시 유일한 증거다. 그래서 DB 가 없으면 제공하지 않는다.
*/
let legalRepo: PgLegalRepo | null = null;

app.get('/api/notices', async (c) => {
  if (!noticeRepo) {
    // 공지 기능이 없는 배포. 빈 목록이 아니라 미지원임을 알린다.
    return c.json({ notices: [], supported: false });
  }
  try {
    const locale = c.req.query('locale') || undefined;
    const notices = await noticeRepo.listVisible(locale, Number(c.req.query('limit') ?? 20));
    return c.json({
      notices: notices.map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        category: n.category,
        pinned: n.pinned,
        publishedAt: n.publishedAt ?? n.publishAt,
        expiresAt: n.expiresAt,
        locale: n.locale,
        /* 목록에서도 긴급도를 보여준다 — 배지 색이 갈린다. */
        severity: n.severity,
        popup: n.popup,
      })),
      supported: true,
      asOf: Date.now(),
    });
  } catch (e) {
    return c.json(errBody('UPSTREAM_ERROR', (e as Error).message), 502);
  }
});

app.get('/api/market/contract-specs', async (c) => {
  const cache = providers.market as unknown as {
    getCachedSymbol?: (s: string) => {
      multiplier?: number;
      takerFeeRate?: number;
      makerFeeRate?: number;
      fundingFeeRate?: number;
      initialMarginRate?: number;
      maintenanceMarginRate?: number;
      firstOpenDate?: number;
    } | undefined;
  };

  if (typeof cache.getCachedSymbol !== 'function') {
    // 어댑터가 지원하지 않으면 빈 배열이 아니라 미지원을 알린다.
    return c.json({ specs: [], source: providers.source, supported: false });
  }

  try {
    // 사양 캐시를 채우기 위해 심볼 목록을 먼저 확보한다(이미 캐시돼 있으면 즉시 반환).
    const symbols = await providers.market.getSymbols();
    const wanted = c.req.query('symbols');
    const filter = wanted ? new Set(wanted.split(',').map((x) => x.trim().toUpperCase())) : null;

    const specs = symbols
      .filter((s) => !filter || filter.has(s.id))
      .map((s) => {
        const raw = cache.getCachedSymbol!(s.id);
        return {
          symbol: s.id,
          multiplier: raw?.multiplier ?? null,
          // 값이 없으면 null 이다. 0 으로 채우면 "수수료 무료" 라는 거짓이 된다.
          takerFeeRate: raw?.takerFeeRate ?? null,
          makerFeeRate: raw?.makerFeeRate ?? null,
          fundingFeeRate: raw?.fundingFeeRate ?? null,
          initialMarginRate: raw?.initialMarginRate ?? null,
          maintenanceMarginRate: raw?.maintenanceMarginRate ?? null,
          maxLeverage: s.maxLeverage,
          /*
             상장 시각(ms). 마켓 화면의 'New' 정렬에 쓴다.
             없으면 null — 화면은 그때 신규 정렬을 제공하지 않는다.
          */
          firstOpenDate: raw?.firstOpenDate ?? null,
        };
      });

    return c.json({ specs, total: specs.length, source: providers.source, supported: true, asOf: Date.now() });
  } catch (e) {
    return c.json(errBody('UPSTREAM_ERROR', (e as Error).message), 502);
  }
});

/*
   현물(Spot) 시세.
   ------------------------------------------------------------
   ★★ 선물 경로에 `market=spot` 을 얹지 않고 **별도 경로**로 둔다.

     심볼 표기·캔들 배열 순서·수량 의미가 다르므로, 같은 경로에서 분기하면
     응답을 받은 쪽이 어느 시장의 규칙으로 해석해야 하는지 알 수 없다. 경로가
     다르면 그 혼동이 생기지 않는다.

   ★ 어댑터가 없으면 `supported: false` 를 준다. 선물 데이터로 대신 채우지
     않는다 — 이용자는 현물 시세를 본다고 믿으면서 선물 가격으로 판단하게 된다.

   ★ 스트리밍은 아직 없다. `streaming: false` 로 분명히 밝혀서, 화면이 실시간을
     기다리며 멈춰 있지 않게 한다.
*/
app.get('/api/market/spot/symbols', async (c) => {
  if (!providers.spot) return c.json({ symbols: [], supported: false, source: providers.source });
  try {
    const symbols = await providers.spot.getSymbols();
    return c.json({
      symbols, total: symbols.length, supported: true,
      source: 'kucoin_spot', streaming: providers.spot.supportsStreaming, asOf: Date.now(),
    });
  } catch (e) {
    return c.json(errBody('UPSTREAM_ERROR', (e as Error).message), 502);
  }
});

app.get('/api/market/spot/candles', async (c) => {
  if (!providers.spot) return c.json({ candles: [], supported: false, source: providers.source });
  const symbol = c.req.query('symbol') ?? 'BTCUSDT';
  const timeframe = c.req.query('timeframe') ?? '15m';
  const limit = Number(c.req.query('limit') ?? 300);
  const before = c.req.query('before') ? Number(c.req.query('before')) : undefined;
  try {
    const candles = await providers.spot.getCandles({ symbol, timeframe, limit, before });
    return c.json({ symbol, timeframe, candles, supported: true, source: 'kucoin_spot' });
  } catch (e) {
    return c.json(errBody('UPSTREAM_ERROR', (e as Error).message), 502);
  }
});

app.get('/api/market/spot/tickers', async (c) => {
  if (!providers.spot) return c.json({ tickers: [], supported: false, source: providers.source });
  try {
    const tickers = await providers.spot.getTickers();
    return c.json({
      tickers, total: tickers.length, supported: true,
      source: 'kucoin_spot', streaming: providers.spot.supportsStreaming, asOf: Date.now(),
    });
  } catch (e) {
    return c.json(errBody('UPSTREAM_ERROR', (e as Error).message), 502);
  }
});

app.get('/api/market/spot/ticker', async (c) => {
  if (!providers.spot) return c.json({ supported: false, source: providers.source });
  const symbol = c.req.query('symbol') ?? 'BTCUSDT';
  try {
    const ticker = await providers.spot.getTicker(symbol);
    return c.json({ ...(ticker as object), supported: true, source: 'kucoin_spot' });
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
  /*
     ★★ AI 가 실제로 연결돼 있지 않으면 여기서 멈춘다.

       이 엔드포인트의 분석기는 MockAIProvider(대본 응답)다. 프런트엔드는 이제
       /ai/copilot(인증·게이트된 경로)만 쓰고 이 경로는 호출하지 않지만, 라우트가
       열려 있으면 실서비스에서 목업 분석이 그대로 나간다(비인증). aiAvailable 이
       false 인 동안에는 목업을 흘리지 않고 '아직 없음' 을 명확히 알린다.
       진짜 provider 를 붙이면(aiResolution.available) 그때 실제 분석을 연결한다.
  */
  if (aiResolution.kind === 'unavailable' || aiResolution.available !== true) {
    return c.json(errBody('AI_UNAVAILABLE', 'AI analysis is not enabled on this deployment'), 503);
  }

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

    /*
       Phase 7 §4 — production fail-closed: refuse to start when the database still holds accounts
       that cannot belong to real users.

       ★★ This block only inspects SQLite. When the deployment runs on PostgreSQL (which production
         does), `users` lives in PostgreSQL and this scan sees nothing — it passed while 16 accounts,
         one of them a hand-made SUPER_ADMIN in a `.local` domain, sat in the real database.

         The PostgreSQL scan is below, right after the repositories are wired (the pool does not
         exist yet at this point). Both run; neither replaces the other, because a SQLite deployment
         is still possible.
    */
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
        /*
           개발에서 Postgres 를 쓰려면 USE_POSTGRES=true 를 함께 준다.
           DATABASE_URL 만으로 전환하지 않는 이유: 테스트가 환경변수를 물려받아
           개발 DB 를 오염시키는 것을 막기 위함이다 (repository-factory.test.ts 가
           이 동작을 고정해 두었다).
        */
        usePostgres: process.env.USE_POSTGRES,
      });
    } catch (e) {
      // In production this is a hard stop: an identity layer that cannot be built on PostgreSQL must not
      // be replaced by one that can be built on SQLite.
       
      console.error('[api] FAIL-CLOSED startup:', (e as Error).message);
      process.exit(1);
    }
    wiredRepositoryDescriptors.push(...core.descriptors);

    /*
       거래소 자격증명 저장소.

       ★★ PostgreSQL 이 있으면 반드시 그쪽을 쓴다.

         `exchange_credentials` 에는 `user_id → users(id)` 외래키가 있다. 회원이
         PostgreSQL 에 있는데 자격증명을 SQLite 에 넣으면 그 회원이 SQLite 에
         없으므로 **저장이 외래키 위반으로 실패한다.** 실제로 500 이 났고,
         읽기 경로는 빈 목록을 주므로(`credentialStatus: NONE`) "아직 연결
         안 함" 과 구분되지 않아 실제 키로 시도할 때까지 드러나지 않았다.

       ★ 두 라우터(거래·Fast API)가 **같은 인스턴스**를 쓴다. 따로 만들면 한쪽에
         등록한 키가 다른 쪽 목록에 없는 상태가 생긴다.
    */
    /*
       고객 등급 저장소.

       ★ PostgreSQL 에만 둔다. 등급은 30일 실거래 집계이므로 재시작마다 사라지는
         저장소에서는 의미가 없다.
    */
    const tierRepo = core.pool ? new PgTierRepo(core.pool) : undefined;

    const credentialRepo = core.pool
      ? new PgCredentialRepo(core.pool)
      : new SqliteCredentialRepo(db);
     
    console.log(`[api] exchange credential store: ${core.pool ? 'postgres' : 'sqlite'}`);

    /*
       거래 학습 데이터 수집기.

       ★★ PostgreSQL 에만 둔다.

         이 기록은 **다시 만들 수 없다.** 어떤 지표를 켜고 있었는지는 그 순간에만
         알 수 있고, 지나간 화면 상태를 나중에 복원할 방법이 없다. 휘발성
         저장소(메모리 SQLite)에 두면 재시작 때마다 사라져 학습 표본이 되지 못한다.

       ★ 없으면 수집하지 않고 주문은 그대로 나간다. 수집 여부는
         `/api/admin/learning/stats` 에서 확인한다 — 조용히 안 모이는 것을
         알아채기 위한 유일한 창구다.
    */
    const learningRepo = core.pool
      ? new PgLearningRepo(core.pool, (event, detail) => {
        /*
           감사기록으로 남긴다. 여기서 던지면 주문 경로가 죽는다.
        */
        try { console.warn(`[learning] ${event}`, JSON.stringify(detail).slice(0, 300)); } catch { /* noop */ }
      })
      : undefined;
     
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
    /*
       메일 발송 경로 선택.

       ★★ 전에는 Resend 하나뿐이었다. `RESEND_API_KEY` 가 없으면 인증·비밀번호 재설정
         메일이 **한 통도 나가지 않는다**(메모리 싱크에만 쌓인다). 비밀번호를 잊은
         사용자는 복구할 방법이 없다.

       ★ 그래서 SMTP 를 먼저 본다. 운영자가 이미 회사 메일 계정을 가지고 있으면
         추가 비용도 외부 의존도 없이 보낼 수 있다(SMTP_HOST·SMTP_USER·SMTP_PASS).
         둘 다 없으면 싱크로 떨어지고, 그 사실을 경고로 남긴다 — 조용히 넘기지 않는다.
    */
    const smtpProvider = smtpFromEnv();
    const resendProvider = smtpProvider ? null : resendFromEnv();
    const mailProvider = smtpProvider ?? resendProvider ?? new MailSink();
    if (smtpProvider === null && resendProvider === null) {
       
      console.warn(
        '[api] MAIL NOT CONFIGURED — using in-memory sink. Verification and password-reset links will NOT ' +
          'reach users. Set either SMTP_HOST/SMTP_USER/SMTP_PASS or RESEND_API_KEY, together with ' +
          'MAIL_FROM and APP_BASE_URL.',
      );
    } else {
       
      console.log(
        `[api] mail provider: ${mailProvider.name} (from=${process.env.MAIL_FROM ?? '?'})`,
      );
    }

    /*
       PostgreSQL 사용자 계정 검사 (프로덕션 전용).

       ★ 위쪽 SQLite 검사만 있던 시절 이 경로가 비어 있었다. 프로덕션이 PostgreSQL 을
         쓰므로 실제 사용자 계정은 전부 여기에 있고, 검사하지 않으면 개발 중 손으로
         만든 관리자 계정이 그대로 배포된다.

       ★ 조회에 실패하면 **기동을 막는다.**
         "확인할 수 없으니 통과" 는 가장 나쁜 선택이다 — 확인이 안 되는 상태와
         안전한 상태를 구분할 수 없다.
    */
    if (process.env.NODE_ENV === 'production' && core.pool) {
      try {
        const rows = await core.pool.query<{ email: string }>('SELECT email FROM users');
        const emails = rows.rows
          .map((r) => r.email)
          .filter((e): e is string => typeof e === 'string');

        const result = assertNoDevFixtures({ listIdentifiers: () => emails }, true);
        // 개수만 남긴다 — 어떤 주소였는지는 로그에 쓰지 않는다.
        console.log(
          `[api] production fixture scan (postgres): OK (identifiers inspected=${result.inspected})`,
        );
      } catch (e) {
        console.error('[api] FAIL-CLOSED startup (postgres):', (e as Error).message);
        process.exit(1);
      }
    }

    const authService = new AuthService(core.users, core.sessions, auditRepo, {
      emailTokens: core.emailTokens,
      resetTokens: core.resetTokens,
      // Real provider when configured, sink otherwise. The choice is logged below: a deployment silently
      // falling back to the sink means no user ever receives a verification link, and that must be visible in
      // the boot output rather than discovered from a support ticket.
      mail: mailProvider,
      /*
         ★★ 이메일 인증을 로그인 필수로 만든다.

           비밀번호 재설정이 이메일로 가는 서비스라, 인증되지 않은(=소유 확인 안 된)
           주소로는 계정을 되찾을 수 없다. 그래서 최초 로그인 전에 이메일 소유를
           확인한다. 인증 안 된 계정이 로그인하면 EMAIL_NOT_VERIFIED 로 막고
           인증 메일을 다시 보낸다. 관리자(SUPER_ADMIN·ADMIN)는 예외(서비스에서 제외).

           REQUIRE_EMAIL_VERIFICATION=false 로 끌 수 있다(기본 켜짐). 메일 발송이
           설정돼 있어야 의미가 있다 — SMTP/Resend 가 없으면 아무도 인증을 못 해
           로그인이 막히므로, 메일 provider 가 없으면(싱크) 자동으로 요구를 끈다.
      */
      requireEmailVerification:
        (process.env.REQUIRE_EMAIL_VERIFICATION ?? 'true') !== 'false'
        && mailProvider.name !== 'mail-sink-dev',
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

      /*
         첫 관리자 승격.

         ★★ 개발용 씨드는 프로덕션에서 돌지 않고, 가입은 모두 'user' 역할이다.
           그래서 배포만 하면 관리자로 들어갈 사람이 아무도 없다. 운영자가 자기
           이메일로 가입한 뒤 BOOTSTRAP_ADMIN_EMAIL 에 그 주소를 넣으면 올려 준다.
           관리자가 이미 있으면 아무것도 하지 않는다(뒷문을 남기지 않는다).
      */
      {
        const outcome = await bootstrapSuperAdmin({
          email: process.env.BOOTSTRAP_ADMIN_EMAIL,
          findByEmail: async (mail) => {
            const u = await core.users.findByEmail(mail);
            return u ? { id: u.id, email: u.email, role: String(u.role), status: String(u.status) } : null;
          },
          activeSuperAdminIds: () => adminRepo.activeSuperAdminIds(),
          setUserRole: (id, role) => adminRepo.setUserRole(id, role),
          recordAudit: (entry) => auditRepo.record(entry),
          newId: () => randomUUID(),
           
          log: (m) => console.log(m),
        });
        if (outcome === 'blocked_user_not_found' || outcome === 'blocked_user_not_active') {
           
          console.warn(`[api] 첫 관리자 승격을 하지 못했다 (${outcome}).`);
        }
      }
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

      /*
         시스템 상태.

         이전에는 전부 고정 문자열이었다. 특히 postgres 가 항상
         'Unavailable (dev store is SQLite)' 였는데 이 배포는 실제로 Postgres 로
         돌고 있었다 — 운영자가 상태 화면을 보고 "DB 가 죽었다" 고 판단하면
         엉뚱한 곳을 고친다. 상태 화면이 거짓이면 없는 것보다 나쁘다.

         이제 실제로 측정한다. 측정할 수 없는 항목은 'Unavailable' 로 남긴다 —
         'ok' 로 채우면 죽은 것을 살았다고 보고한다.
      */
      const health = (): Record<string, string> => {
        // 실제 시세 출처. 설정 문자열이 아니라 지금 붙어 있는 어댑터를 본다.
        const marketSource = providers.source;
        const ws = wsGateway ? wsGateway.status() : null;

        const mem = process.memoryUsage();
        const mb = (n: number) => `${Math.round(n / 1024 / 1024)}MB`;

        return {
          api: 'ok',
          // core.pool 이 있으면 Postgres 로 붙어 있다는 뜻이다(부팅 시 연결 확인됨).
          postgres: core.pool ? 'Connected' : 'Unavailable (dev store is SQLite)',
          secretsManager: env.awsRegion ? 'Configured' : 'Not Connected',
          // 시세 어댑터. KuCoin 으로 전환했으므로 BitMart 고정 표기는 사실과 다르다.
          marketDataSource: marketSource,
          marketDataRest: marketSource === 'mock_replay' ? 'Mock replay' : 'Connected',
          marketDataWs: ws && ws.symbols > 0 ? `Connected (${ws.symbols} symbols)` : 'Idle',
          wsClients: ws ? String(ws.clients) : 'Unavailable',
          wsCandleSeries: ws ? String(ws.candles) : 'Unavailable',
          /*
             청산 위험 감시.

             ★★ 꺼져 있으면 **화면이 열려 있을 때만** 경고가 계산된다. 사용자가
               자는 동안에는 알림이 없다 — 운영자가 그 사실을 알아야 한다.

             ★ 연속 실패가 쌓이면 감시가 사실상 죽은 것이다. 개수를 함께 보여준다.
          */
          riskWatch: (() => {
            if (!riskWatch) return 'Off — alerts only while a screen is open';
            const st = riskWatch.status();
            if (!st.running) return 'Stopped';
            if (st.consecutiveFailures >= 3) return `FAILING (${st.consecutiveFailures} in a row)`;
            const last = st.lastRun;
            if (!last) return `Running (every ${Math.round(st.intervalMs / 1000)}s, no run yet)`;
            return `Running (every ${Math.round(st.intervalMs / 1000)}s, ${last.targets} watched)`;
          })(),
          openai: aiResolution.kind === 'openai' && aiResolution.available ? 'Configured' : 'Not Connected',
          aiProvider: aiResolution.kind,
          redisQueue: env.redisUrl ? 'Configured' : 'Not Connected',
          /*
             메일 발송 준비 상태.

             ★★ 설정되지 않으면 메일이 **메모리에만 쌓이고 아무에게도 도달하지
               않는다.** 서버는 경고 로그만 남기고 정상 동작하므로, 배포한 뒤
               "비밀번호를 잊었다" 는 문의가 올 때까지 모를 수 있다.
               그래서 상태 화면에서 바로 보이게 한다.

             ★ 발송 성공을 뜻하지 않는다. 설정 여부만 본다 — 실제 도달은
               회원가입 메일을 직접 받아 확인해야 한다.
          */
          mail: (() => {
            const missing: string[] = [];
            /* SMTP 로 보내는 배포도 있다 — 둘 중 하나면 준비된 것이다. */
            const hasSmtp = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
            if (!process.env.RESEND_API_KEY && !hasSmtp) missing.push('RESEND_API_KEY 또는 SMTP_HOST/SMTP_USER/SMTP_PASS');
            if (!process.env.MAIL_FROM) missing.push('MAIL_FROM');
            if (!process.env.APP_BASE_URL) missing.push('APP_BASE_URL');
            if (missing.length === 0) return 'Configured';
            return `NOT SENDING — password reset impossible (missing ${missing.join(', ')})`;
          })(),
          /*
             브로커 자격증명 — 우리 수익이 붙는지.

             ★★ 3종이 다 있어야 주문에 브로커 서명이 붙는다. 하나라도 없으면
               거래는 정상 동작하지만 **리베이트가 0원**이다. 거래가 잘 되는 것을
               보고 수익도 들어온다고 오해하기 쉬우므로 명시한다.
          */
          /*
             브로커 리베이트 귀속 — 선물.

             ★ 이름에 상품이 없어서 오해하기 쉬운데, `KUCOIN_BROKER_*` 는
               **선물** 자격증명이다. 우리가 현재 거래하는 상품이다.
          */
          brokerRebate: (() => {
            const missing: string[] = [];
            if (!env.kucoinBrokerPartner) missing.push('PARTNER');
            if (!env.kucoinBrokerKey) missing.push('KEY');
            if (!env.kucoinBrokerName) missing.push('NAME');
            if (missing.length === 0) return 'Configured — futures orders carry broker attribution';
            if (missing.length === 3) return 'Not Connected — rebate is 0 (no broker credential)';
            return `INCOMPLETE — rebate is 0 (missing ${missing.join(', ')})`;
          })(),
          /*
             브로커 리베이트 귀속 — 현물.

             ★★ 현물은 **다른 자격증명**이다. 선물 값으로 대체하면 서명은
               만들어지지만 거래가 귀속되지 않고, 오류도 나지 않는다. 그래서
               상태를 따로 보고한다 — 한 줄로 묶으면 "설정됨" 으로 보이면서
               절반이 새는 상태를 놓친다.

             ★ 현물 어댑터가 아직 없으므로 비어 있는 것이 지금은 정상이다.
               현물을 열 때 이 줄이 Configured 인지 먼저 확인해야 한다.
          */
          /*
             KuCoin Fast API (OAuth) 설정 상태.

             ★ 이것이 꺼져 있으면 이용자가 KuCoin 에서 키를 손으로 만들어야
               한다 — 그 단계에서 이탈이 생기고 실수로 출금 권한을 켤 위험도
               있다. 수익에 직접 영향은 없지만 가입 전환에 영향이 크므로
               상태를 드러낸다.
          */
          kucoinFastApi: (() => {
            const missing: string[] = [];
            if (!env.kucoinOauthClientId) missing.push('KUCOIN_OAUTH_CLIENT_ID');
            if (!env.kucoinOauthRedirectUri) missing.push('KUCOIN_OAUTH_REDIRECT_URI');
            if (missing.length === 0) return 'Configured — users can connect with one click';
            return `Not Connected — users must create API keys manually (missing ${missing.join(', ')})`;
          })(),
          brokerRebateSpot: (() => {
            const missing: string[] = [];
            if (!env.kucoinBrokerSpotPartner) missing.push('SPOT_PARTNER');
            if (!env.kucoinBrokerSpotKey) missing.push('SPOT_KEY');
            if (!env.kucoinBrokerSpotName) missing.push('SPOT_NAME');
            if (missing.length === 0) return 'Configured — spot orders carry broker attribution';
            if (missing.length === 3) return 'Not Connected — spot rebate would be 0 (spot trading is not enabled yet)';
            return `INCOMPLETE — spot rebate is 0 (missing ${missing.join(', ')})`;
          })(),
          /*
             운영자 조회 키 — 리베이트가 실제로 들어오는지 확인하는 수단.

             ★ 브로커 자격증명과 다르다. 이것이 없으면 정산 조회를 할 수 없어
               "수익이 들어오는지 아닌지 알 방법이 없다".
          */
          brokerSettlementRead: (() => {
            const missing: string[] = [];
            if (!env.kucoinOperatorKey) missing.push('KUCOIN_API_KEY');
            if (!env.kucoinOperatorSecret) missing.push('KUCOIN_API_SECRET');
            if (!env.kucoinOperatorPassphrase) missing.push('KUCOIN_API_PASSPHRASE');
            if (missing.length === 0) return 'Configured';
            return `Not Connected — cannot verify revenue (missing ${missing.join(', ')})`;
          })(),
          tradingMode: env.tradingMode,
          liveOrders: env.liveOrdersEnabled ? 'Enabled' : 'Locked',
          buildVersion: process.env.BUILD_VERSION ?? '0.5.0-rc',
          gitSha: process.env.GIT_SHA ?? 'Unavailable',
          mfa: 'Not Implemented / Release Gate',
          // 프로세스 지표는 실제로 읽을 수 있다.
          uptimeSeconds: String(Math.floor(process.uptime())),
          memoryHeapUsed: mb(mem.heapUsed),
          memoryRss: mb(mem.rss),
          nodeVersion: process.version,
          latencyP50: 'Unavailable', latencyP95: 'Unavailable', latencyP99: 'Unavailable',
          cpu: 'Unavailable',
        };
      };

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
        // 운영자가 특정 사용자에게 직접 이메일을 보낼 때 쓴다(관리자 사용자 상세).
        mail: mailProvider,
        // ADM-API-08: only the LOCAL MOCK gateway is ever controllable, and only when this deployment is
        // actually running in MOCK trading mode. Any other mode reports DISABLED_BY_POLICY rather than
        // mutating state and calling it a reconnect. Decided here, at mount time, from the environment.
        gatewayControl: { controllable: env.tradingMode === 'MOCK', target: 'LOCAL_MOCK' },
        /*
           거래 학습 데이터셋. 현황 조회·내보내기 라우트가 이것을 쓴다.

           ★ 없으면 라우트가 `configured:false` 를 준다 — 0 건을 주면 "수집
             중인데 아직 없다" 로 읽혀, 아무 것도 안 쌓이는 동안 운영자가
             데이터가 모이고 있다고 믿는다.
        */
        ...(learningRepo ? { learning: learningRepo } : {}),
        /* 고객 등급 — /admin/tiers 가 기준·분포를 읽는다. */
        ...(tierRepo ? { tiers: tierRepo } : {}),
        /*
           공지 저장소. Postgres 풀이 있을 때만 주입한다.

           sqlite 구현을 만들지 않은 이유: 공지는 관리자가 작성하고 전체 사용자에게
           나가는 게시물이다. 단일 사용자 개발 환경(sqlite)에서는 쓸 일이 없다.
           주입하지 않으면 라우트가 503 을 낸다 — 빈 목록을 주면 "공지가 없다" 는
           거짓이 되고, 작성 시도가 조용히 성공한 것처럼 보인다.
        */
        notices: (() => {
          if (!core.pool) return undefined;
          // 사용자용 라우트(/api/notices)도 같은 인스턴스를 쓴다.
          noticeRepo = new PgNoticeRepo(core.pool);
          return noticeRepo;
        })(),
        support: (() => {
          if (!core.pool) return undefined;
          supportRepo = new PgSupportRepo(core.pool);
          return supportRepo;
        })(),
        referral: (() => {
          if (!core.pool) return undefined;
          referralRepo = new PgReferralRepo(core.pool);
          return referralRepo;
        })(),
        points: (() => {
          if (!core.pool) return undefined;
          pointsRepo = new PgPointsRepo(core.pool);
          return pointsRepo;
        })(),
        legal: (() => {
          if (!core.pool) return undefined;
          legalRepo = new PgLegalRepo(core.pool);
          return legalRepo;
        })(),
        /*
           알림 저장소.

           ★ 운영자 행동(답변·포인트 조정)이 고객에게 전달되게 한다.
             전에는 서버가 만드는 알림이 주문 체결 하나뿐이었다.

           ★ `userData.notifications` 를 직접 쓴다. 아래에서 선언되는
             `notificationRepo` 를 참조하면 초기화 전 접근이 된다.
        */
        notifications: userData.notifications,

        /*
           KuCoin 브로커 정산 조회.

           ★★ 운영자 키가 셋 다 있어야 주입한다. 하나라도 없으면 조회가 인증
             오류로 실패하고, 화면은 그것을 "수익 0원" 으로 오해할 수 있다.
             주입하지 않으면 라우트가 `configured: false` 를 명시해 준다.

           ★ 스팟 도메인을 쓴다 — 브로커 정산 경로는 선물 도메인에 없다.

           ★ 브로커 자격증명(partner/key/name)은 없어도 조회는 시도한다.
             그래야 "아직 브로커 승인 전" 인지 확인할 수 있다.
        */
        kucoinBroker: (() => {
          const k = env.kucoinOperatorKey;
          const sec = env.kucoinOperatorSecret;
          const pass = env.kucoinOperatorPassphrase;
          if (!k || !sec || !pass) return undefined;
          const brokerReady = Boolean(env.kucoinBrokerPartner && env.kucoinBrokerKey && env.kucoinBrokerName);
          return {
            client: new KucoinBrokerClient({ restBase: env.kucoinSpotRest }),
            operator: { apiKey: k, apiSecret: sec, passphrase: pass },
            broker: brokerReady
              ? { partner: env.kucoinBrokerPartner, key: env.kucoinBrokerKey, name: env.kucoinBrokerName }
              : null,
          };
        })(),
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

    /*
       차트 템플릿 저장소 (기기 간 동기화).

       ★ Postgres 가 있을 때만 만든다. SQLite 개발 환경에는 이 테이블이 없으므로
         undefined 로 두고, 라우트도 등록되지 않는다. 그때 화면은 기존처럼 기기
         저장만 쓴다 — 기능이 깨지는 대신 동기화만 빠진다.

       ★ createAuthRouter 호출보다 **먼저** 선언해야 한다(블록 스코프).
    */
    const chartTemplates = core.pool ? new PgChartTemplateRepo(core.pool) : undefined;

    app.route(
      '/api',
      createAuthRouter({
        service: authService,
        audit: auditRepo,
        resource,
        favorites: userData.favorites,
        preferences: userData.preferences,
        chartTemplates,
        csrfKey: env.csrfKey,
        secureCookies: env.secureCookies,
        corsOrigins: env.corsOrigins,
        cookieName: env.cookieName,
        cookieDomain: env.cookieDomain,
        /*
           리퍼럴 귀속.

           가입 시점에만 가능하다 — 나중에 "내가 초대했다" 는 주장을 검증할
           근거가 없으므로 소급 귀속을 허용하지 않는다.
           저장소가 없거나 제도가 꺼져 있으면 아무 일도 하지 않는다.
        */
        onRegistered: async (userId, referralCode) => {
          if (!referralRepo || !referralCode) return;
          const attributed = await referralRepo.attribute(referralCode, userId);
          if (!attributed) return;

          /*
             초대 보상을 포인트로 적립한다.

             ★ 이것이 우리가 **실제로 할 수 있는 지급**이다. 포인트는 사이트
               내부 재화이므로 원장에 적립하면 그것으로 끝난다. 현금 송금은
               운영자가 손으로 해야 하고, 비수탁이라 사용자 계정에 넣을 수도 없다.

             ★ 적립 시점을 가입으로 잡는다.
               "거래를 시작해야 우리 수익이 생긴다" 는 것은 사실이지만, 그
               시점을 기다리면 초대자가 보상을 언제 받는지 알 수 없다.
               가입 자체에 정해진 포인트를 주는 편이 약속이 명확하다.
               (그래서 금액이 크면 안 된다 — 가짜 가입으로 남용될 수 있다.)

             ★ 같은 초대 건에 두 번 적립하지 않는다.
               ref 로 초대받은 사용자 ID 를 넣으면 DB UNIQUE 가 막는다.

             실패를 삼킨다 — 포인트 적립 때문에 회원가입이 실패하면 안 된다.
          */
          if (!pointsRepo) return;
          try {
            const ps = await pointsRepo.getSettings();
            if (!ps.enabled || !ps.referralAsPoints || ps.referralPoints <= 0) return;

            const code = await referralRepo.findCode(referralCode);
            if (!code) return;

            await pointsRepo.grant({
              userId: code.userId,
              amount: ps.referralPoints,
              reason: 'referral_signup',
              refType: 'referred_user',
              refId: userId,
              memo: `referral signup (referrer)`,
            });
            /*
               초대받은 신규 가입자에게도 동일 포인트를 지급한다(양쪽 지급 — 오픈 이벤트).
               멱등: (referee_id, referral_signup, referral_bonus, referee_id) 는 uq_points_ref 로
               한 번만 반영된다. 실패해도 위 referrer 지급/가입은 유지된다(catch).
            */
            await pointsRepo.grant({
              userId,
              amount: ps.referralPoints,
              reason: 'referral_signup',
              refType: 'referral_bonus',
              refId: userId,
              memo: `referral signup (referee)`,
            });
          } catch (e) {
            console.warn('[points] 초대 보상 적립 실패 — 가입은 유지한다:', (e as Error).message);
          }
        },
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
    /*
       고객 지원 티켓 (사용자용).

       Postgres 저장소가 없으면 repo 를 넘기지 않는다 → 라우터가
       supported:false 로 답한다. 빈 배열로 위장하지 않는다.
    */
    /*
       리퍼럴 (사용자용).

       publicBaseUrl 이 없으면 초대 링크를 만들지 않고 코드만 준다 —
       열리지 않는 주소를 주면 사용자가 그것을 공유한다.
    */
    /*
       포인트 (사용자용).

       현금 출금·환전 경로가 없다 — 있으면 자금 이동업이 된다.
       구매도 없다 — 결제 대행사가 연결되지 않았다.
    */
    /*
       법적 문서 (약관·개인정보·위험고지).

       ★ 인증 없이 열린다 — 회원가입 전에 읽어야 하기 때문이다.
    */
    app.route('/api', createLegalRouter({
      service: authService,
      ...(legalRepo ? { repo: legalRepo } : {}),
      cookieName: env.cookieName,
      supportEmail: env.supportEmail,
    }));

    app.route('/api', createPointsRouter({
      service: authService,
      ...(pointsRepo ? { repo: pointsRepo } : {}),
      csrfKey: env.csrfKey,
      corsOrigins: env.corsOrigins,
      cookieName: env.cookieName,
      verifyCsrf,
      originAllowed,
    }));

    /*
       포인트 충전(결제) 라우터. PayPal/USDT 자격증명이 없으면 각 수단이 비활성으로
       정직하게 보고된다(NOT_CONFIGURED). 적립은 결제 검증 후 point_ledger 로 멱등 처리.
    */
    const paymentProviders = resolvePaymentProviders({
      paypalClientId: env.paypalClientId,
      paypalClientSecret: env.paypalClientSecret,
      paypalMode: env.paypalMode,
      cryptoWebhookSecret: env.cryptoWebhookSecret,
      cryptoUsdtAddress: env.cryptoUsdtAddress,
      cryptoNetwork: env.cryptoNetwork,
    });
    const pointOrderRepo = core.pool && pointsRepo ? new PgPointOrderRepo(core.pool, pointsRepo) : undefined;
    app.route('/api', createPaymentRouter({
      service: authService,
      ...(pointOrderRepo ? { orders: pointOrderRepo } : {}),
      ...(pointsRepo ? { points: pointsRepo } : {}),
      providers: paymentProviders,
      csrfKey: env.csrfKey,
      corsOrigins: env.corsOrigins,
      cookieName: env.cookieName,
      verifyCsrf,
      originAllowed,
      ...(env.publicBaseUrl ? { publicBaseUrl: env.publicBaseUrl } : {}),
    }));
    console.log(`[api] payments mounted (paypal=${Boolean(paymentProviders.paypal)}, usdt=${Boolean(paymentProviders.crypto)})`);

    /* 저장 항목(신호·지표·드로잉) — PG. 저장 시 포인트 차감(제도 켜져 있을 때). */
    const savedItemRepo = core.pool ? new PgSavedItemRepo(core.pool) : undefined;
    app.route('/api', createSavedRouter({
      service: authService,
      ...(savedItemRepo ? { repo: savedItemRepo } : {}),
      ...(pointsRepo ? { points: pointsRepo } : {}),
      csrfKey: env.csrfKey,
      corsOrigins: env.corsOrigins,
      cookieName: env.cookieName,
      verifyCsrf,
      originAllowed,
    }));

    app.route('/api', createReferralRouter({
      service: authService,
      ...(referralRepo ? { repo: referralRepo } : {}),
      csrfKey: env.csrfKey,
      corsOrigins: env.corsOrigins,
      cookieName: env.cookieName,
      verifyCsrf,
      originAllowed,
      ...(env.publicBaseUrl ? { publicBaseUrl: env.publicBaseUrl } : {}),
      /*
         초대 보상을 포인트로 줄 때, 화면이 "초대하면 N 포인트" 를 정확히 보여주도록
         포인트 설정을 읽어 준다. 포인트 저장소가 없으면 제공하지 않는다(화면은 sharePct 만 표시).
      */
      ...(pointsRepo ? { pointsReward: async () => {
        const ps = await pointsRepo!.getSettings();
        return { enabled: Boolean(ps.enabled && ps.referralAsPoints), points: ps.referralPoints, unit: ps.unitName };
      } } : {}),
    }));

    app.route('/api', createSupportRouter({
      service: authService,
      ...(supportRepo ? { repo: supportRepo } : {}),
      csrfKey: env.csrfKey,
      corsOrigins: env.corsOrigins,
      cookieName: env.cookieName,
      verifyCsrf,
      originAllowed,
    }));

    /* 가격 알림 — PostgreSQL 배포에만 있다. */
    if (core.pool) priceAlertRepo = new PgPriceAlertRepo(core.pool);
    app.route('/api', createAlertRouter({
      service: authService,
      ...(priceAlertRepo ? { repo: priceAlertRepo } : {}),
      csrfKey: env.csrfKey,
      corsOrigins: env.corsOrigins,
      cookieName: env.cookieName,
      verifyCsrf,
      originAllowed,
    }));

    /*
       거래 읽기 저장소.

       ★★ 쓰기와 읽기가 같은 저장소를 가리켜야 한다.

         모의 주문 기록은 PostgreSQL 에 쓰는데 조회는 SQLite 를 보고 있었다.
         그래서 `/api/positions` 가 DB 에 포지션이 1건 있는데도 빈 배열을 줬고,
         화면은 그 빈 응답을 받자 목업으로 폴백했다 — 화면만 보면 정상처럼
         보이므로 아무도 알아채지 못한다.
    */
    const portfolioRepo = core.pool ? new PgPortfolioRepo(core.pool) : new PortfolioRepo(db);

    /*
       청산 위험 감시 (서버).

       ★★ 지금은 **화면이 열려 있을 때만** 경고가 계산된다. 사용자가 자는 동안
         가격이 청산가에 접근하면 알릴 방법이 없다.

       ★ 기본은 꺼짐이다(`RISK_WATCH_ENABLED=true` 로 켠다). 실주문이 없는
         배포에서 사용자 키로 거래소를 주기 호출할 이유가 없고, 그 호출은
         사용자 본인의 rate limit 을 갉아먹는다.

       ★ 감시 대상은 **거래소 키가 검증된 사용자**뿐이다. 실주문이 닫혀 있으면
         대상이 0명이므로 부하도 0이다.
    */
    if (env.riskWatchEnabled) {
      riskWatch = new RiskWatchLoop({
        notifications: userData.notifications,
        intervalMs: env.riskWatchIntervalMs,
        listWatchTargets: async () => {
          /*
             감시 대상 수집.

             ★ 우리 DB 의 포지션을 쓴다. 거래소를 직접 호출하려면 사용자별로
               키를 복호화해 요청해야 하고, 그것은 rate limit 과 키 취급 위험을
               크게 늘린다. 우리 DB 포지션은 잔고·포지션 조회 시 갱신된다.

             ★★ **이 방식의 한계를 명확히 한다:** 사용자가 한 번도 접속하지
               않았다면 우리 DB 에 포지션이 없고, 그러면 감시하지 못한다.
               거래소를 직접 폴링하는 방식으로 바꾸려면 rate limit 예산을 먼저
               정해야 한다. 지금은 "접속한 적 있는 사용자" 만 감시한다.
          */
          if (!core.pool) return [];
          const { rows } = await core.pool.query<{
            user_id: string; symbol: string; side: string;
            liquidation_price: string | null; mark_price: string | null;
          }>(
            `SELECT user_id, symbol, side, liquidation_price, mark_price
               FROM positions
              WHERE size <> 0
                AND liquidation_price IS NOT NULL
                AND mark_price IS NOT NULL`,
          );
          const byUser = new Map<string, { userId: string; positions: {
            symbol: string; side: string; liquidationPrice: number | null; markPrice: number | null;
          }[] }>();
          for (const r of rows) {
            const uid = String(r.user_id);
            if (!byUser.has(uid)) byUser.set(uid, { userId: uid, positions: [] });
            const num = (v: string | null) => {
              if (v === null) return null;
              const n = Number(v);
              return Number.isFinite(n) ? n : null;
            };
            byUser.get(uid)!.positions.push({
              symbol: String(r.symbol),
              side: String(r.side),
              liquidationPrice: num(r.liquidation_price),
              markPrice: num(r.mark_price),
            });
          }
          return [...byUser.values()];
        },
      });
      riskWatch.start();
    } else {
      console.log('[api] 청산 위험 감시: 꺼짐 (RISK_WATCH_ENABLED=true 로 켠다). 화면이 열려 있을 때만 경고가 계산됩니다.');
    }

    /*
       일별 자산 스냅샷.

       ★ PostgreSQL 에만 있다. 자산 이력은 과거를 소급할 수 없으므로(거래소가
         지난 잔고를 주지 않는다) 휘발성 저장소에 두면 의미가 없다.
    */
    const equitySnapshots = core.pool ? new PgEquitySnapshotRepo(core.pool) : undefined;



    app.route('/api', createPortfolioRouter({
      service: authService,
      repo: portfolioRepo,
      ...(equitySnapshots ? { equitySnapshots } : {}),
      /*
         모의 주문의 학습 결과 수집. 거래소 경로는 실주문만 보므로, 모의는
         이 라우터가 이어 붙인다 — 초기에는 표본의 대부분이 모의 거래다.
      */
      ...(learningRepo ? { learning: learningRepo } : {}),
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
      portfolio: portfolioRepo,
      symbolInfo: DEFAULT_SYMBOL_INFO,
      /*
         주문 정책은 env.tradingPolicy 한 곳에서 온다.

         ★★ 전에는 이 줄과 실주문 라우터의 policy 가 **각각 하드코딩**돼 있었고 값이
           달랐다(여기 BTCUSDT+ETHUSDT / 저기 BTCUSDT). ETHUSDT 는 확인창까지
           통과한 뒤 전송에서 거부됐다.
      */
      policy: { ...env.tradingPolicy, allowedSymbols: [...env.tradingPolicy.allowedSymbols] },
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

    /*
       가격 알림 감시기.

       ★ 30초마다 활성 알림을 훑어 실제 시세와 비교하고, 조건 충족 시 한 번만 발동한다.
         발동하면 앱 알림을 남기고(notificationRepo), notifyEmail 이면 이메일도 보낸다.
       ★ 시세를 지어내지 않는다 — 조회 실패/무가격 심볼은 건너뛴다(watcher 내부 처리).
       ★ Postgres 배포에만 켠다. 겹쳐 도는 것을 막기 위해 진행 중이면 이번 주기를 건너뛴다.
    */
    if (priceAlertRepo) {
      const alertRepo = priceAlertRepo;
      const brand = env.brandName;
      let sweeping = false;
      const sweep = async () => {
        if (sweeping) return;
        sweeping = true;
        try {
          await runAlertSweep({
            repo: alertRepo,
            getPrice: async (symbol) => {
              try {
                const tk = (await providers.market.getTicker(symbol)) as { last?: string | number; markPrice?: string | number } | null;
                const raw = tk ? (tk.last ?? tk.markPrice) : null;
                const n = raw == null ? NaN : Number(raw);
                return Number.isFinite(n) && n > 0 ? n : null;
              } catch { return null; }
            },
            notify: async (ev) => {
              const arrow = ev.direction === 'above' ? '≥' : '≤';
              await notificationRepo.create({
                userId: ev.userId,
                type: 'price_alert',
                severity: 'info',
                message: `${ev.symbol} ${arrow} ${ev.target} — now ${ev.price}`,
                at: Date.now(),
              });
            },
            sendEmail: async (ev) => {
              const arrow = ev.direction === 'above' ? '≥' : '≤';
              await mailProvider.send({
                to: ev.to,
                subject: `${ev.symbol} price alert`,
                text:
                  `Your ${brand} price alert triggered.\n\n` +
                  `${ev.symbol} is now ${ev.price} (target ${arrow} ${ev.target}).\n\n` +
                  `This is a notification only — no order was placed.`,
              });
            },
             
            log: (m) => console.warn(m),
          });
        } finally {
          sweeping = false;
        }
      };
      const alertTimer = setInterval(() => { void sweep(); }, 30_000);
      if (typeof alertTimer.unref === 'function') alertTimer.unref();
       
      console.log('[api] price-alert watcher started (30s interval)');
    }

    app.route('/api', createNotificationRouter({
      /*
         공지 팝업 — 알림과 같은 라우터에 둔다(읽음 규칙을 한 곳에서 관리).
      */
      ...(noticeRepo ? { notices: noticeRepo } : {}),
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
          /*
             전략 저장소.

             Postgres 배포에서는 반드시 Postgres 구현을 써야 한다. 사용자
             테이블이 Postgres 에 있으므로 팔로우를 SQLite 에 쓰면 외래키가
             깨져 500 이 난다(실제로 겪었다 — 화면에서 Follow 가 조용히 실패).
          */
          repo: core.pool ? new PgStrategyRepo(core.pool) : new SqliteStrategyRepo(db),
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
    /*
       모의 주문 투영.

       ★★ 배포에 맞는 저장소를 골라야 한다.

         전에는 SQLite 판만 있었다. 이 배포는 사용자를 PostgreSQL 에 두므로
         `orders.user_id` 외래키가 깨져 `FOREIGN KEY constraint failed` 가 났고,
         그 예외는 아래 호출 지점에서 로그만 남기고 삼켜졌다. 주문은 성공으로
         응답했으므로 화면은 정상이었고 **기록만 사라졌다** — 8개 거래 테이블이
         전부 0행이었다.
    */
    const simProjection = core.pool
      ? new PgSimOrderProjection(core.pool)
      : new SimOrderProjection(db);
    projectSimOrder = async (c, order) => {
      const raw = getCookie(c, env.cookieName);
      if (!raw) return; // anonymous simulation stays in memory (previous behaviour, unchanged)
      const v = await authService.validateSession(raw);
      if (!v) return;
      const o = order as Record<string, unknown>;
      const projected = await simProjection.project(v.user.id, {
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

      /*
         ★★ 모의 주문도 학습 판단으로 기록한다.

           전에는 이 경로가 학습 데이터를 남기지 않았다. 그래서 모의 주문은
           결과(체결)만 존재하고 **이을 판단이 없어** 표본이 되지 못했다.
           초기에는 모의 거래가 표본의 대부분이므로, 빼면 데이터가 거의 비어 있다.

         ★ `executionMode: 'paper'` 로 분리한다. 실주문과 체결 성질이 다르므로
           (모의는 슬리피지가 실제와 다르다) 섞이면 학습이 오염된다.

         ★ 화면 문맥(uiContext)은 이 경로로 오지 않는다 — 모의 주문 확인 API 는
           그 필드를 받지 않는다. 없으면 비운다(없는 값을 만들지 않는다).
      */
      if (learningRepo) {
        await learningRepo.recordDecision({
          userId: v.user.id,
          market: 'futures',
          executionMode: 'paper',
          symbol: String(o.symbol),
          side: String(o.side),
          orderType: String(o.orderType ?? 'limit'),
          price: o.price === undefined || o.price === null ? null : String(o.price),
          quantity: String(o.quantity),
          leverage: o.leverage === undefined ? null : Number(o.leverage),
          marginMode: o.marginMode === undefined ? null : String(o.marginMode),
          submitStatus: 'ACCEPTED',
          clientOrderId: String(o.clientOrderId),
        });
      }

      /*
         모의 거래의 자산 이력.

         ★★ 출처를 `mock` 으로 분리해 기록한다. 거래소 실값과 같은 곡선에 섞으면
           사용자가 모의 성과를 실제 성과로 읽는다. 조회할 때도 하나만 읽는다.

         ★ 모의 주문에는 잔고 개념이 없다. 대신 **누적 포지션 가치**를 남긴다 —
           이것이 자산은 아니지만, 곡선 기능이 실제로 동작하는지 실주문 전에
           확인할 수 있는 유일한 값이다. 화면이 출처를 표시하므로 오해가 없다.
      */
      if (equitySnapshots && projected.ok) {
        try {
          const pos = await portfolioRepo.listPositions(v.user.id, {});
          const value = pos.items.reduce((acc, p) => {
            const size = Number(p.size);
            const entry = p.entryPrice === null ? NaN : Number(p.entryPrice);
            // 진입가를 모르면 그 포지션은 값을 계산할 수 없다 — 0 으로 세지 않는다.
            return Number.isFinite(size) && Number.isFinite(entry) ? acc + size * entry : acc;
          }, 0);
          await equitySnapshots.record({
            userId: v.user.id,
            equity: value,
            available: null,
            used: null,
            unrealizedPnl: null,
            currency: 'USDT',
            source: 'mock',
          });
        } catch {
          /* 이력 기록 실패가 주문 기록을 되돌리지 않는다 */
        }
      }

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
          credRepo: credentialRepo,
          accountAdapter,
          // 저장되는 자격증명에 기록될 거래소. 어댑터 선택과 같은 조건을 쓴다.
          exchangeId: useKucoinAccounts ? 'kucoin' : 'bitmart',
          /*
             자산 이력. 잔고 조회가 성공할 때 하루 한 번 기록한다 —
             자산곡선의 유일한 근거다.
          */
          ...(equitySnapshots ? { equitySnapshots } : {}),
          /*
             거래 학습 데이터 수집. 주문을 낸 순간의 지표·시장·위험 판정을 남긴다.

             ★ 거부·차단·타임아웃도 남긴다 — 손실과 실패가 학습 대상이다.
          */
          ...(learningRepo ? { learning: learningRepo } : {}),
          /* 고객 등급 — /me/tier 가 이것을 쓴다. */
          ...(tierRepo ? { tiers: tierRepo } : {}),
          /*
             학습 기록용 시장 스냅샷.

             ★★ 화면이 보낸 가격을 쓰지 않기 위해 서버 원천에서 읽는다.
               조작된 요청이 학습 데이터를 오염시키면, 그 데이터로 학습한 모델이
               실제로 없었던 시장 상황을 배운다.
          */
          marketSnapshot: async (symbol, market) => {
            try {
              /*
                 ★ 시장별 원천을 쓴다. 현물 어댑터가 없으면 선물 시세로 대체하지
                   않는다 — 다른 시장의 가격을 그 시장의 값으로 기록하면,
                   학습 데이터에 실제로 없었던 시장 상황이 들어간다.
              */
              const src = market === 'spot' ? providers.spot : providers.market;
              if (!src || typeof src.getTicker !== 'function') return null;
              /*
                 ★★ 필드 이름은 우리 Ticker 스키마를 따른다.

                   처음에 `mark`·`chg24hPct` 로 읽었는데 스키마는 `markPrice`·
                   `changePct` 다. 그래서 값이 있는데도 전부 null 로 기록됐다 —
                   오류 없이 **데이터만 비었다.** 학습 데이터에서 이런 실수는
                   나중에 "그때 마크가가 없었다" 로 읽힌다.
              */
              const t = (await src.getTicker(symbol)) as {
                last?: unknown; changePct?: unknown;
                markPrice?: unknown; indexPrice?: unknown;
                fundingRate?: unknown; high24h?: unknown; low24h?: unknown; vol24h?: unknown;
              } | null;
              if (!t) return null;

              /*
                 호가와 스프레드.

                 ★★ 티커에는 호가가 없다(스키마에 bid/ask 가 없다). 호가창에서
                   읽어야 한다. 스프레드는 그 순간에만 알 수 있는 값이라 나중에
                   계산할 수 없으므로, 여기서 얻어 함께 저장한다.

                 ★ 실패하면 넣지 않는다. 0 을 넣으면 "스프레드가 없었다" 가 되고,
                   그런 시장은 존재하지 않는다.
              */
              let quote: Record<string, unknown> = {};
              try {
                const book = market === 'spot' ? null : await providers.book.getSnapshot(symbol, 1);
                const bid = Number(book?.bids?.[0]?.[0]);
                const ask = Number(book?.asks?.[0]?.[0]);
                if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
                  quote = {
                    bid: String(book!.bids[0]![0]),
                    ask: String(book!.asks[0]![0]),
                    spreadBps: String((((ask - bid) / ((ask + bid) / 2)) * 10_000).toFixed(4)),
                  };
                }
              } catch { /* 호가를 못 읽는 것이 주문을 막지 않는다 */ }

              return {
                last: t.last ?? null,
                ...quote,
                markPrice: t.markPrice ?? null,
                indexPrice: t.indexPrice ?? null,
                fundingRate: t.fundingRate ?? null,
                changePct: t.changePct ?? null,
                high24h: t.high24h ?? null,
                low24h: t.low24h ?? null,
                vol24h: t.vol24h ?? null,
                capturedAt: Date.now(),
                market,
              };
            } catch {
              // 시세를 못 읽는 것이 주문을 막지 않는다. 스냅샷 없이 기록한다.
              return null;
            }
          },
          /*
             실주문 어댑터.

             주입하지 않으면 실주문 경로가 존재하지 않는다. 기본 배포는 잠겨
             있으므로 이것이 정상 상태다 — 실수로 열리는 것보다 실수로 닫히는
             편이 안전하다.

             어댑터를 만들어도 canPlaceRealOrders 가 매 호출마다 킬스위치와
             플래그를 다시 확인한다. 즉 잠금이 두 겹이다.
          */
          tradingAdapter: useKucoinAccounts
            ? new KucoinTradingAdapter({
                restBase: env.kucoinFuturesRest,
                broker: {
                  partner: env.kucoinBrokerPartner,
                  key: env.kucoinBrokerKey,
                  name: env.kucoinBrokerName,
                },
                multiplierOf: (symbol) =>
                  (providers.market as unknown as {
                    getCachedSymbol?: (s: string) => { multiplier?: number } | undefined;
                  }).getCachedSymbol?.(symbol)?.multiplier,
                // 함수로 넘긴다 — 부팅 시점 값을 캡처하면 킬스위치가 무력해진다.
                liveEnabled: () =>
                  env.liveOrdersEnabled && env.bitmartLiveTradingEnabled && !env.bitmartKillSwitch,
                onAudit: (event, detail) => {
                  // 실주문은 반드시 기록을 남긴다. 나중에 "누가 언제 무엇을" 확인해야 한다.
                   
                  console.log(`[order-audit] ${event} ${JSON.stringify(detail)}`);
                },
              })
            : undefined,
          /*
             현물 실주문 어댑터.

             ★★ 선물과 **별도 인스턴스**다. 수량 의미(계약수 vs 기초자산)와
               레버리지 유무가 달라서 하나로 합치면 주문 크기가 1000배 틀린다.

             ★ 브로커 자격증명도 현물용을 쓴다(partner=CCAI). 선물용(CCAIF)으로
               서명하면 서명은 만들어지지만 거래가 귀속되지 않고 오류도 나지
               않는다 — 리베이트만 0 이 된다.

             ★ 현물 브로커 자격증명이 없으면 헤더를 붙이지 않는다. 선물 값으로
               대체하지 않는다(대체하면 위와 같은 조용한 손실이 된다).
          */
          spotTradingAdapter: useKucoinAccounts
            ? new KucoinSpotTradingAdapter({
                restBase: env.kucoinSpotRest,
                broker: {
                  partner: env.kucoinBrokerSpotPartner,
                  key: env.kucoinBrokerSpotKey,
                  name: env.kucoinBrokerSpotName,
                },
                liveEnabled: () =>
                  env.liveOrdersEnabled && env.bitmartLiveTradingEnabled && !env.bitmartKillSwitch,
                onAudit: (event, detail) => {
                  console.log(`[order-audit] ${event} ${JSON.stringify(detail)}`);
                },
              })
            : undefined,
          /* 검증 경로와 **같은** 정책을 쓴다(위 주석 참조). */
          policy: { ...env.tradingPolicy, allowedSymbols: [...env.tradingPolicy.allowedSymbols] },
          symbolInfo: DEFAULT_SYMBOL_INFO,
          csrfKey: env.csrfKey,
          corsOrigins: env.corsOrigins,
          cookieName: env.cookieName,
          mode: env.bitmartMode as 'BITMART_LIVE_READ_ONLY',
          liveTradingEnabled: env.bitmartLiveTradingEnabled,
          killSwitch: env.bitmartKillSwitch,
          /*
             실주문을 여는 **실제** 조건. 안내 문구가 이 값으로 만들어진다.

             ★★ 전에는 문구가 `TRADING_MODE` 와 `FEATURE_LIVE_ORDERS_ENABLED` 를
               말했는데, 이 라우터가 검사하는 것은 `BITMART_MODE` 와
               `BITMART_LIVE_TRADING_ENABLED` 였다. 안내대로 켜도 열리지 않는다.

             ★ 두 겹으로 유지한다. 하나만 실수로 켜져도 실주문이 열리면 안 된다 —
               플래그를 합치면 그 보호가 사라진다.
          */
          liveGateEnv: {
            modeVar: 'BITMART_MODE',
            modeRequired: 'BITMART_LIVE_TRADE',
            modeActual: env.bitmartMode,
            flags: [
              { name: 'BITMART_LIVE_TRADING_ENABLED', value: env.bitmartLiveTradingEnabled },
              { name: 'FEATURE_LIVE_ORDERS_ENABLED', value: env.liveOrdersEnabled },
              { name: 'BITMART_EMERGENCY_KILL_SWITCH=false', value: !env.bitmartKillSwitch },
            ],
          },
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
       
      /*
         KuCoin Fast API (OAuth 2.0) — 이용자 키 자동 연결.

         ★★ 설정이 완전할 때만 등록한다(fail-closed).

           `client_id` 나 redirect URI 가 없으면 라우트를 아예 만들지 않는다.
           반쯤 설정된 상태로 켜면 이용자가 KuCoin 승인 화면까지 갔다가
           콜백에서 실패하고, 그 사이 KuCoin 계정에는 우리 이름의 키가
           만들어져 남는다. "있는데 안 되는" 상태보다 "없는" 상태가 낫다 —
           화면은 /api/config 의 kucoinOauthAvailable 로 그 사실을 표시한다.

         ★ state 저장이 Postgres 를 요구한다(마이그레이션 0024). 개발 SQLite
           환경에는 표가 없으므로 pgPool 이 있을 때만 등록한다.
      */
      if (core?.pool && isKucoinOauthConfigured(env)) {
        app.route(
          '/api',
          createKucoinOauthRouter({
            service: authService,
            vault,
            credRepo: credentialRepo,
            pool: core.pool,
            csrfKey: env.csrfKey,
            corsOrigins: env.corsOrigins,
            cookieName: env.cookieName,
            csrfCookieName: 'qt_csrf',
            clientId: env.kucoinOauthClientId,
            ...(env.kucoinOauthClientSecret ? { clientSecret: env.kucoinOauthClientSecret } : {}),
            redirectUri: env.kucoinOauthRedirectUri,
            oauthBase: env.kucoinOauthBase,
            apiKeyPath: env.kucoinOauthApiKeyPath,
          }),
        );
        console.log('[api] KuCoin Fast API (OAuth) mounted');
      } else {
        /*
           왜 꺼졌는지 남긴다. 조용히 없으면 "왜 버튼이 안 보이나" 를
           코드에서 찾게 된다.
        */
        const why = !core?.pool
          ? 'requires PostgreSQL (migration 0024)'
          : 'KUCOIN_OAUTH_CLIENT_ID / KUCOIN_OAUTH_REDIRECT_URI not set';
        console.log(`[api] KuCoin Fast API (OAuth) NOT mounted — ${why}`);
      }

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
          model: aiModel,
          maxOutputTokens: env.aiMaxOutputTokens,
          store: env.openaiStore,
          maxToolCalls: env.aiMaxToolCalls,
          toolTimeoutMs: env.aiRequestTimeoutMs,
          // BL-11 — the SAME distributed limiter instance every other rate-limited path uses (Redis in
          // production, fail-closed). Bounds AI request RATE, separate from the token/cost budget.
          rateLimiter,
          aiRatePerMin: env.aiRateLimitPerMin,
          // 사용량 기반 포인트 차감(제도가 켜져 있을 때만). 없으면 AI 무료.
          ...(pointsRepo ? { points: pointsRepo } : {}),
          /*
             Server-verified grounding for the copilot. Reuses the same fail-closed market-context
             builder as /api/ai/analyze: no real price → returns null → the orchestrator refuses
             price-bearing proposals instead of letting the model invent a level. Positions/balance are
             read from the caller's own rows via aiUserContext when available.
          */
          groundContext: async (_userId, symbol, timeframe, clientContext) => {
            const built = await buildAiMarketContext(
              { symbol, timeframe: timeframe as (typeof SUPPORTED_TIMEFRAMES)[number] },
              {
                getTicker: (s) => providers.market.getTicker(s) as Promise<TickerLike | null>,
                getPositions: () => [],
                getAvailableBalance: () => null,
                source: env.dataMode === 'MOCK_REPLAY' ? 'MOCK' : 'SNAPSHOT',
                tradingMode: env.tradingMode,
                liveTradingEnabled: env.liveOrdersEnabled && env.bitmartLiveTradingEnabled,
                killSwitchActive: env.bitmartKillSwitch,
              },
            );
            if (!built.ok) return null;
            const ctx = built.context;

            /*
               고객이 보는 차트를 실제로 읽게 하려면 봉 시계열이 필요하다(지지/저항·추세선은
               가격 히스토리에서 나온다). 봉은 **서버에서** 가져온다(클라이언트가 준 가격을
               믿지 않는다는 B9 원칙 유지). 토큰 예산을 위해 최근 N봉만, 정밀도를 줄여 담는다.
            */
            const BARS = 90;
            let candles: Array<{ t: number; o: number; h: number; l: number; c: number }> = [];
            let window: { from: number; to: number; high: number; low: number } | null = null;
            try {
              const raw = (await providers.market.getCandles({
                symbol, timeframe: timeframe as (typeof SUPPORTED_TIMEFRAMES)[number], limit: BARS,
              })) as Array<Record<string, unknown>>;
              const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };
              const rows = (Array.isArray(raw) ? raw : []).map((k) => ({
                t: num(k.timestamp ?? k.time ?? k.t ?? k.ts),
                o: num(k.open ?? k.o), h: num(k.high ?? k.h), l: num(k.low ?? k.l), c: num(k.close ?? k.c),
              })).filter((k) => Number.isFinite(k.t) && Number.isFinite(k.c));
              // 정밀도: 가격 크기에 따라 반올림(BTC 수천~수만이면 소수1, 소액이면 더 정밀).
              const p0 = rows.length ? Math.abs(rows[rows.length - 1]!.c) : 0;
              const dp = p0 >= 1000 ? 1 : p0 >= 1 ? 3 : 6;
              const r = (x: number) => Number(x.toFixed(dp));
              candles = rows.map((k) => ({ t: k.t, o: r(k.o), h: r(k.h), l: r(k.l), c: r(k.c) }));
              if (candles.length) {
                window = {
                  from: candles[0]!.t, to: candles[candles.length - 1]!.t,
                  high: r(Math.max(...rows.map((k) => k.h))), low: r(Math.min(...rows.map((k) => k.l))),
                };
              }
            } catch { /* 봉 조회 실패는 비치명 — 가격만으로 진행(구조 분석은 제한) */ }

            /*
               클라이언트가 보낸 화면 상태(활성 지표·사용자 드로잉). UNTRUSTED 로 취급하되,
               "사용자가 지금 화면에 무엇을 켜뒀는지"를 모델에 알려 준다. 가격 주장에는 쓰지
               않는다(가격은 위 서버 값이 authoritative). 크기를 방어적으로 제한한다.
            */
            let screen: { indicators?: unknown; drawings?: unknown } | null = null;
            if (clientContext && typeof clientContext === 'object') {
              const cc = clientContext as Record<string, unknown>;
              const inds = Array.isArray(cc.indicators) ? cc.indicators.slice(0, 12) : undefined;
              const draws = Array.isArray(cc.drawings) ? cc.drawings.slice(0, 20) : undefined;
              if (inds || draws) screen = { ...(inds ? { indicators: inds } : {}), ...(draws ? { drawings: draws } : {}) };
            }

            const marketData = JSON.stringify({
              symbol, timeframe,
              price: { last: ctx.lastPrice, mark: ctx.markPrice, asOf: ctx.asOf, source: ctx.source, stale: ctx.stale },
              window, candles,
              screen,
              positions: ctx.positions, risk: ctx.risk,
            });
            return { marketData, dataSnapshotId: `snap-${ctx.asOf}`, marketType: 'perpetual' };
          },
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
     
    /*
       ★ 어느 경로로 통과했는지 밝힌다.

         전에는 항상 "AWS Secrets Manager configured" 라고 적었다. 환경변수
         경로로 뜬 배포에서도 그렇게 말하므로, 로그만 보면 **키가 어디에 있는지
         알 수 없다.** 사고 조사에서 가장 먼저 확인할 값이다.
    */
    console.log(
      process.env.CREDENTIAL_SOURCE === 'env'
        ? '[api] production credential readiness: OK (CREDENTIAL_SOURCE=env — broker keys come from the process environment, not AWS Secrets Manager)'
        : '[api] production credential readiness: OK (AWS Secrets Manager configured)',
    );
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
/*
   법적 문서 등록.

   ★★ 가입 화면은 이용약관·개인정보처리방침 동의를 받는데, 문서가 게시돼 있지 않으면
     그 동의는 아무것도 가리키지 않는다(라이브에서 4종 모두 not_published 였다).
     그래서 부팅 때 빠진 문서를 채운다. 문서 본문은 docs/legal/*.md 에 있다.

   ★ 기본은 초안까지만. 공개는 되돌릴 수 없으므로 LEGAL_AUTOPUBLISH=true 를
     명시할 때만 공개한다. 실주문이 열려 있는데 사업자 정보(COMPANY_INFO)가 없으면
     공개하지 않는다 — 실거래를 제공하는 사업자가 자기 정보를 밝히지 않는 약관을
     게시할 수는 없다.
*/
if (legalRepo) {
  void seedLegalDocuments(legalRepo, {
    publish: process.env.LEGAL_AUTOPUBLISH === 'true',
    version: (process.env.LEGAL_VERSION ?? '2026-08-22').trim(),
    supportEmail: env.supportEmail ?? '',
    brandName: env.brandName,
    companyInfo: (process.env.COMPANY_INFO ?? '').trim(),
    liveOrdersEnabled: env.liveOrdersEnabled,
  })
    .then((r) => {
      const parts = [
        `생성 ${r.created.length}`,
        `공개 ${r.published.length}`,
        /* 파일이 바뀌어 초안을 다시 맞춘 수 — 낡은 약관이 게시되는 것을 막은 흔적이다. */
        `본문갱신 ${r.refreshed.length}`,
        `건너뜀 ${r.skipped.length}`,
      ];
      console.log(`[legal] 문서 시딩: ${parts.join(' · ')}`);
      if (r.created.length > 0) console.log(`[legal] 생성: ${r.created.join(', ')}`);
      if (r.published.length > 0) console.log(`[legal] 공개: ${r.published.join(', ')}`);
      if (r.refreshed.length > 0) console.log(`[legal] 본문 갱신: ${r.refreshed.join(', ')}`);
      /* 막힌 것과 빠진 파일은 반드시 눈에 보이게 남긴다 — 조용히 넘기면 아무도 모른다. */
      if (r.blocked.length > 0) console.warn(`[legal] 공개하지 않음: ${r.blocked.join(', ')}`);
      if (r.missingFiles.length > 0) console.warn(`[legal] 문서 없음/실패: ${r.missingFiles.join(', ')}`);
      if (!process.env.LEGAL_AUTOPUBLISH) {
        console.log('[legal] 초안만 만들었다. /admin/legal 에서 검토 후 공개하거나 LEGAL_AUTOPUBLISH=true 로 배포할 것.');
      }
    })
    .catch((e: unknown) => console.warn(`[legal] 시딩 실패: ${(e as Error).message}`));
}

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
