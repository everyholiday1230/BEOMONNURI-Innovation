import { randomBytes } from 'node:crypto';
import {
  DATA_MODES,
  TRADING_MODES,
  DEFAULT_SYMBOL,
  TIMEFRAMES,
  BITMART_BROKER_ID,
  type DataMode,
  type TradingMode,
} from '@quantumtrade/config';

/** Parse & validate process env with SAFE DEFAULTS. Missing/invalid -> safest option. */
export interface ApiEnv {
  port: number;
  host: string;
  dataMode: DataMode;
  tradingMode: TradingMode;
  liveOrdersEnabled: boolean;
  corsOrigins: string[];
  bitmartRestBase: string;
  bitmartWsPublic: string;
  bitmartWsPrivate: string;
  /**
   * API Broker id sent as `X-BM-BROKER-ID` so relayed orders are attributed to us for rebate.
   * Defaults to BITMART_BROKER_ID from @quantumtrade/config; override only for a test/partner account.
   */
  bitmartBrokerId: string;
  defaultSymbol: string;
  authEnabled: boolean;
  sqlitePath: string;
  /** PostgreSQL connection string. Required in production (assertProductionDatabaseReadiness). */
  databaseUrl: string | undefined;
  /** Redis/Valkey URL for distributed rate limiting. Required in production (createRateLimiter). */
  redisUrl: string | undefined;
  secureCookies: boolean;
  csrfKey: string;
  cookieName: string;
  cookieDomain?: string;
  bitmartMode: string;
  bitmartLiveTradingEnabled: boolean;
  bitmartKillSwitch: boolean;
  bitmartKek?: string;

  // --- KuCoin (현재 운영 거래소) ---
  kucoinFuturesRest: string;
  kucoinSpotRest: string;
  /** Exchange Broker(ND) 전용 호스트. API Broker 는 일반 호스트를 쓴다. */
  kucoinBrokerRest: string;
  /**
   * 브로커 리베이트 자격증명. KuCoin 이 승인 후 발급하는 3종.
   * 셋 다 있어야 KC-API-PARTNER-* 헤더를 붙인다. 부분 설정은 400201 을 유발하므로
   * 하나라도 비면 헤더를 생략한다 (packages/exchange-kucoin/src/signature.ts).
   */
  kucoinBrokerPartner: string;
  kucoinBrokerKey: string;
  kucoinBrokerName: string;
  /** 공개 REST 레이트리밋. KuCoin 문서상 12회/2초이므로 기본 5rps. */
  kucoinRestMaxRps: number;
  kucoinRestBurst: number;
  // Phase 4 — AI copilot
  aiEnabled: boolean;
  aiProvider: 'openai' | 'mock' | 'fake';
  awsRegion?: string;
  openaiSecretArn?: string;
  openaiModelPrimary: string;
  openaiModelFallback: string;
  openaiStore: boolean;
  aiMaxOutputTokens: number;
  aiRequestTimeoutMs: number;
  aiMaxToolCalls: number;
  aiMaxCostPerRequestMicros: number;
  aiDailyUserBudgetMicros: number;
  adminSeedEnabled: boolean;
  adminRateLimitPerMin: number;
  /** Per-user budget for the B4 order draft/validate endpoints. Low by default: these are deliberate
   *  user actions, not a polling surface. */
  orderValidateRatePerMin: number;
  /** BATCH_1/R6 — distributed LOGIN request budget per minute, applied to the IP and account buckets. */
  loginRateLimitPerMin: number;
  /** BATCH_1/R6 — distributed MFA verification budget per minute, per actor. */
  mfaRateLimitPerMin: number;
  /** BATCH_2/BL-11 — distributed AI request budget per minute, per authenticated user + route category. */
  aiRateLimitPerMin: number;
}

function pickEnum<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
  fallback: T[number],
): T[number] {
  return value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

/**
 * Per-process random signing key for non-production runtimes. Never used in production: the startup
 * guard below requires an explicitly provided `AUTH_CSRF_KEY` there. Generating it avoids shipping a
 * fixed development secret inside the production bundle (Phase 7 §3).
 */
/**
 * 숫자 환경변수를 범위 안으로 강제한다.
 *
 * 레이트리밋 값이 범위를 벗어나면 거래소가 IP 를 차단한다. 잘못된 값을
 * 그대로 쓰는 대신 안전한 기본값으로 떨어뜨린다 (fail-safe).
 */
function numberFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 서버 자신의 오리진을 CORS/CSRF 허용 목록에 넣는다.
 *
 * API 가 프론트엔드를 직접 서빙하므로(단일 오리진) 브라우저가 보내는 Origin 은
 * 서버 자신의 오리진이다. 그걸 CORS_ALLOWED_ORIGINS 에 넣어두는 것을 잊으면
 * 로그인 이후 모든 변경 요청이 403 CSRF_FAILED 로 막힌다. 실제로 겪은 실패이고,
 * 로그인/회원가입은 오리진을 검사하지 않아 "일부만 되는" 형태로 나타나서
 * 원인을 찾기 어렵다.
 *
 * 안전한 이유: Origin 이 서버 자신과 같다면 same-origin 요청이고, CSRF 는
 * 정의상 cross-origin 공격이다. 여기서 넣는 값은 설정(환경변수)에서 오므로
 * 공격자가 조작할 수 없다 — Host 헤더를 쓰지 않는다.
 *
 * 리버스 프록시 뒤에서는 공개 주소가 다르다. PUBLIC_ORIGIN 으로 지정한다.
 */
function withSelfOrigins(
  configured: string[],
  host: string | undefined,
  port: string | undefined,
  publicOrigin: string | undefined,
): string[] {
  const out = new Set(configured);

  const p = port?.trim() || '8787';
  const h = host?.trim() || '127.0.0.1';
  // 0.0.0.0 은 "모든 인터페이스" 이므로 브라우저가 그 주소를 Origin 으로 보내지
  // 않는다. 그때는 루프백 표기를 대신 넣는다.
  const hosts = h === '0.0.0.0' || h === '::' ? ['127.0.0.1', 'localhost'] : [h];
  for (const hh of hosts) {
    out.add(`http://${hh}:${p}`);
    out.add(`https://${hh}:${p}`);
  }

  if (publicOrigin?.trim()) {
    try {
      const u = new URL(publicOrigin.trim());
      out.add(`${u.protocol}//${u.host}`);
    } catch {
      // 잘못된 값은 무시한다. 여기서 던지면 서버가 아예 뜨지 않는다.
    }
  }

  return [...out];
}

function ephemeralDevKey(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Production fail-closed check for application signing material (Phase 7 §3/§4). Production must
 * never fall back to a generated or default key, because a per-instance random key would silently
 * break CSRF validation across a multi-instance deployment.
 */
export function assertProductionSigningKeys(
  env: NodeJS.ProcessEnv = process.env,
  isProduction = env.NODE_ENV === 'production',
): void {
  if (!isProduction) return;
  const missing: string[] = [];
  if (!env.AUTH_CSRF_KEY || env.AUTH_CSRF_KEY.length < 32) missing.push('AUTH_CSRF_KEY (min 32 chars)');
  if (missing.length > 0) {
    throw new Error(
      `fail-closed startup: ${missing.join(', ')} must be provided in production ` +
        '(load from AWS Secrets Manager: quantumtrade/prod/app/session-csrf)',
    );
  }
}

/**
 * R5 — production data-layer fail-closed guard (BL-10).
 *
 * The production target is Managed PostgreSQL. The application MUST NOT run its persistence on SQLite in
 * production: doing so would mean MFA, favourites, preferences, notifications, order drafts, admin
 * operations, AI policy and lockout state silently live in an ephemeral local file even after RDS is
 * provisioned. This guard refuses to start production unless a PostgreSQL `DATABASE_URL` is configured,
 * and it refuses a `DATABASE_URL` that points at anything other than postgres. The backend is chosen by
 * the SERVER from the environment only — never from client input.
 *
 * Dev / test (NODE_ENV !== 'production') are unaffected and continue on SQLite.
 */
export function assertProductionDatabaseReadiness(
  env: NodeJS.ProcessEnv = process.env,
  isProduction = env.NODE_ENV === 'production',
): { backend: 'postgres' | 'sqlite' } {
  if (!isProduction) return { backend: 'sqlite' };
  const url = env.DATABASE_URL;
  if (!url || url.trim().length === 0) {
    throw new Error(
      'fail-closed startup: DATABASE_URL (PostgreSQL) is required in production — SQLite is refused as a ' +
        'production store (load from AWS Secrets Manager: quantumtrade/prod/postgres). See BL-10.',
    );
  }
  if (!/^postgres(ql)?:\/\//i.test(url.trim())) {
    throw new Error(
      'fail-closed startup: DATABASE_URL must be a postgres:// connection string in production ' +
        '(SQLite / other backends are refused).',
    );
  }
  return { backend: 'postgres' };
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const tradingMode = pickEnum(env.TRADING_MODE, TRADING_MODES, 'MOCK');
  // Live orders require BOTH the flag AND a non-production trading mode. Production is disabled.
  const liveOrdersEnabled =
    env.FEATURE_LIVE_ORDERS_ENABLED === 'true' && tradingMode === 'BITMART_DEMO';
  return {
    port: Number(env.API_PORT ?? 8787),
    host: env.API_HOST ?? '127.0.0.1',
    dataMode: pickEnum(env.DATA_MODE, DATA_MODES, 'MOCK_REPLAY'),
    tradingMode,
    liveOrdersEnabled,
    // Dev defaults cover BOTH frontends: apps/web on 5173 and apps/broker-web on 5174. The origin is
    // checked on password reset and on every CSRF-guarded mutation, so omitting 5174 made those routes
    // answer 403 from the new app while login/register (which do not check origin) appeared to work —
    // a failure that only shows up on some endpoints.
    corsOrigins: withSelfOrigins(
      (env.CORS_ALLOWED_ORIGINS ??
        'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      env.API_HOST,
      env.API_PORT,
      env.PUBLIC_ORIGIN,
    ),
    bitmartRestBase: env.BITMART_REST_BASE ?? 'https://api-cloud-v2.bitmart.com',
    bitmartWsPublic: env.BITMART_WS_PUBLIC ?? 'wss://openapi-ws-v2.bitmart.com/api?protocol=1.1',
    bitmartWsPrivate: env.BITMART_WS_PRIVATE ?? 'wss://openapi-ws-v2.bitmart.com/user?protocol=1.1',
    // `||` not `??`: an env var set to the empty string is a misconfiguration, not an intentional
    // "no broker", and must fall back to the real id rather than silently dropping attribution.
    bitmartBrokerId: env.BITMART_BROKER_ID?.trim() || BITMART_BROKER_ID,
    defaultSymbol: env.VITE_DEFAULT_SYMBOL ?? DEFAULT_SYMBOL,
    authEnabled: env.AUTH_ENABLED !== 'false',
    sqlitePath: env.SQLITE_PATH ?? '.data/quantumtrade.db',
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL ?? env.GATEWAY_REDIS_URL,
    // Secure cookies by default; disable ONLY for local http dev via AUTH_COOKIE_INSECURE=true.
    secureCookies: env.AUTH_COOKIE_INSECURE !== 'true',
    // CSRF signing key. REQUIRED in production (enforced by assertProductionSigningKeys at startup).
    // Outside production an ephemeral random key is generated per process: there is deliberately no
    // hard-coded development key, so no fixed signing secret can end up in the production bundle
    // (Phase 7 §3). A process restart invalidates previously issued CSRF tokens, which is acceptable
    // for dev/E2E because every scenario obtains its token after logging in.
    csrfKey: env.AUTH_CSRF_KEY ?? ephemeralDevKey(),
    cookieName: env.AUTH_COOKIE_NAME ?? 'qt_session',
    cookieDomain: env.AUTH_COOKIE_DOMAIN,
    // Phase 3 — BitMart live trading. SAFE DEFAULTS: read-only mode, live disabled, kill switch ON.
    bitmartMode: pickEnum(env.BITMART_MODE, ['BITMART_LIVE_READ_ONLY', 'BITMART_LIVE_SHADOW', 'BITMART_LIVE_TRADE'] as const, 'BITMART_LIVE_READ_ONLY'),
    bitmartLiveTradingEnabled: env.BITMART_LIVE_TRADING_ENABLED === 'true',
    bitmartKillSwitch: env.BITMART_EMERGENCY_KILL_SWITCH !== 'false', // default true (blocked)
    bitmartKek: env.BITMART_DEV_KEK,

    kucoinFuturesRest: env.KUCOIN_FUTURES_REST ?? 'https://api-futures.kucoin.com',
    kucoinSpotRest: env.KUCOIN_SPOT_REST ?? 'https://api.kucoin.com',
    kucoinBrokerRest: env.KUCOIN_BROKER_REST ?? 'https://api-broker.kucoin.com',
    kucoinBrokerPartner: env.KUCOIN_BROKER_PARTNER?.trim() ?? '',
    kucoinBrokerKey: env.KUCOIN_BROKER_KEY?.trim() ?? '',
    kucoinBrokerName: env.KUCOIN_BROKER_NAME?.trim() ?? '',
    kucoinRestMaxRps: numberFromEnv(env.KUCOIN_REST_MAX_RPS, 5, 1, 12),
    kucoinRestBurst: numberFromEnv(env.KUCOIN_REST_BURST, 10, 1, 30),
    // Phase 4 — AI. SAFE DEFAULTS: disabled, mock provider, store off. Models are config-driven (not
    // hardcoded per call-site); defaults are placeholders overridden by env in each environment.
    aiEnabled: env.AI_ENABLED === 'true',
    aiProvider: pickEnum(env.AI_PROVIDER, ['openai', 'mock', 'fake'] as const, 'mock'),
    awsRegion: env.AWS_REGION ?? env.AWS_DEFAULT_REGION,
    openaiSecretArn: env.OPENAI_SECRET_ARN,
    openaiModelPrimary: env.OPENAI_MODEL_PRIMARY ?? 'gpt-4.1-mini',
    openaiModelFallback: env.OPENAI_MODEL_FALLBACK ?? 'gpt-4.1-mini',
    openaiStore: env.OPENAI_STORE === 'true', // default false — no provider-side retention
    aiMaxOutputTokens: Number(env.AI_MAX_OUTPUT_TOKENS ?? 1200),
    aiRequestTimeoutMs: Number(env.AI_REQUEST_TIMEOUT_MS ?? 30_000),
    aiMaxToolCalls: Number(env.AI_MAX_TOOL_CALLS ?? 6),
    aiMaxCostPerRequestMicros: Number(env.AI_MAX_COST_PER_REQUEST ?? 200_000),
    aiDailyUserBudgetMicros: Number(env.AI_DAILY_USER_BUDGET ?? 5_000_000),
    // Dev/E2E ONLY: seed a SUPER_ADMIN + a normal USER for admin E2E. Never in production.
    adminSeedEnabled: env.ADMIN_SEED === 'true' && env.NODE_ENV !== 'production',
    // Per-actor admin request budget. Production default 120/min; a local/e2e run drives many admin
    // requests as a SINGLE seeded actor, so the e2e config raises this to avoid false 429s (the real
    // rate-limit enforcement is covered by the admin-api unit test [21]).
    adminRateLimitPerMin: Number(env.ADMIN_RATE_LIMIT_PER_MIN ?? 120),
    orderValidateRatePerMin: Number(env.ORDER_VALIDATE_RATE_LIMIT_PER_MIN ?? 30),
    // Credential-surface budgets. Low by default: these bound password/OTP guessing throughput, and a
    // legitimate user needs only a few attempts (a success clears the bucket). The DURABLE penalty is the
    // separate `account_lockouts` control in PostgreSQL, which these do not replace.
    loginRateLimitPerMin: Number(env.LOGIN_RATE_LIMIT_PER_MIN ?? 10),
    mfaRateLimitPerMin: Number(env.MFA_RATE_LIMIT_PER_MIN ?? 10),
    // BATCH_2/BL-11 — AI request RATE budget (distinct from the AI token/cost budget enforced by the
    // CostController). Bounds how often a user can trigger an expensive model call in a short window.
    aiRateLimitPerMin: Number(env.AI_RATE_LIMIT_PER_MIN ?? 20),
  };
}

export const SUPPORTED_TIMEFRAMES = TIMEFRAMES;
