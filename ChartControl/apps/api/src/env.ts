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
  /**
   * Exchange Broker(ND) 전용 호스트. API Broker 는 일반 호스트를 쓴다.
   *
   * ★ 브로커 **정산 조회**(리베이트·커미션·사용자 목록)는 이 호스트가 아니라
   *   `kucoinSpotRest`(api.kucoin.com)를 쓴다. 문서에서 확인한 경로가 전부
   *   그쪽에 있다 — 선물 호스트에도, 이 호스트에도 없다.
   */
  kucoinBrokerRest: string;

  /**
   * 운영자 자신의 KuCoin 키.
   *
   * ★★ 사용자 키와 다르다. 브로커 정산은 **우리 실적**이므로 우리 키로 조회한다.
   *   사용자 키로 부르면 그 사용자의 브로커 실적(없음)을 조회하게 된다.
   *
   * ★ 없으면 정산 조회를 제공하지 않는다. 지어내지 않고 "설정되지 않음" 을
   *   화면에 표시한다.
   */
  /**
   * 청산 위험 감시를 켤지.
   *
   * ★★ 기본은 **꺼짐**이다. 실주문이 없는 배포에서 사용자 키로 거래소를 주기
   *   호출할 이유가 없다. 실주문을 여는 시점에 함께 켠다.
   *
   * ★ 켜지 않으면 화면이 열려 있을 때만 경고가 계산된다(클라이언트 계산).
   *   사용자가 자는 동안에는 경고가 없다 — 그 사실을 운영자가 알아야 한다.
   */
  riskWatchEnabled: boolean;
  /** 감시 주기(ms). 최소 30초. 너무 짧으면 거래소 rate limit 에 걸린다. */
  riskWatchIntervalMs: number;

  kucoinOperatorKey: string;
  kucoinOperatorSecret: string;
  kucoinOperatorPassphrase: string;
  /**
   * 브로커 리베이트 자격증명. KuCoin 이 승인 후 발급하는 3종.
   * 셋 다 있어야 KC-API-PARTNER-* 헤더를 붙인다. 부분 설정은 400201 을 유발하므로
   * 하나라도 비면 헤더를 생략한다 (packages/exchange-kucoin/src/signature.ts).
   */
  /**
   * KuCoin 레퍼럴(추천) 가입 링크.
   *
   * ★ 브로커 프로그램과 완전히 다른 것이다. 혼동하면 수익 계산이 틀린다.
   *   - 레퍼럴: 이 링크로 **신규 가입**한 사람의 수수료 일부를 받는다.
   *     API 키·서명·헤더가 필요 없다. 지금 당장 동작한다.
   *   - 브로커: 주문에 KC-API-PARTNER-* 헤더를 붙여 리베이트를 받는다.
   *     파트너 자격증명 3종이 있어야 하고 계약이 선행된다.
   *   둘은 별개 수익원이고 동시에 가질 수 있다.
   *
   * 이미 KuCoin 계정이 있는 사람은 이 링크로 소급 귀속되지 않는다.
   * 신규 가입자에게만 의미가 있다.
   *
   * 비어 있으면 화면이 가입 유도를 표시하지 않는다 (빈 링크로 보내지 않는다).
   */
  /**
   * 서비스 표시 이름.
   *
   * 설정으로 두는 이유: 이름은 바뀐다(QuantumTrade → ChartControl 로 실제로
   * 바뀌었다). 코드 34곳에 박아두면 다음에 바뀔 때 또 34곳을 고치고,
   * 한 곳을 빠뜨려 옛 이름이 남는다. 화이트라벨 배포도 가능해진다.
   */
  brandName: string;
  /**
   * 고객 지원 이메일.
   *
   * 설정하지 않으면 화면이 이메일 문의 경로를 **표시하지 않는다**. 존재하지
   * 않는 주소를 보여주면 고객이 메일을 보내고 답을 기다리는데 아무도 받지
   * 않는다 — 조용히 신뢰를 잃는 방식이다.
   */
  supportEmail: string;
  /**
   * 공개 접속 주소 (초대 링크 생성용).
   *
   * 예: https://chartcontrol.app
   *
   * 설정하지 않으면 초대 링크를 **만들지 않는다**. 서버가 자기 주소를 추측해
   * 링크를 만들면(예: 요청 Host 헤더) 프록시·개발 서버 주소가 그대로 들어가
   * 사용자가 열리지 않는 링크를 공유한다. 링크 없이 코드만 주는 편이 낫다.
   */
  publicBaseUrl: string;
  kucoinReferralUrl: string;
  /**
   * 거래소별 추천 가입 링크. `EXCHANGE_REFERRAL_URL_<거래소ID>` 로 설정한다.
   *
   * 예: `EXCHANGE_REFERRAL_URL_KUCOIN=https://www.kucoin.com/r/rf/XXXX`
   *
   * 접두어 방식을 쓰는 이유: 거래소를 추가할 때마다 코드를 고치지 않아도 된다.
   * 설정에 없는 거래소는 링크가 없다 — 없는 코드로 링크를 만들면 가입은
   * 일어나지만 귀속이 안 돼 수익이 0 이 된다. 조용히 새는 종류의 손실이다.
   */
  exchangeReferralUrls: Readonly<Record<string, string>>;
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
  /*
     실주문 허용 조건: 플래그 + 실주문을 지원하는 거래 모드.

     모드를 화이트리스트로 둔다. 'MOCK' 이나 알 수 없는 값이 실주문을 열지
     못하게 하려면, 부정 조건(!== 'MOCK')이 아니라 긍정 목록이어야 한다 —
     새 모드를 추가할 때 실주문이 자동으로 열리면 안 된다.

     KUCOIN_LIVE 는 사용자 자기 키로 실주문을 낸다. 이것만으로 주문이 나가지
     않는다: 킬스위치·리스크 게이트·자격증명 검증을 모두 통과해야 한다.
  */
  const LIVE_ORDER_MODES: readonly string[] = ['BITMART_DEMO', 'KUCOIN_LIVE'];
  const liveOrdersEnabled =
    env.FEATURE_LIVE_ORDERS_ENABLED === 'true' && LIVE_ORDER_MODES.includes(tradingMode);
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
    /*
       브로커 정산 조회 도메인.

       ★★ 기본값이 `api-broker.kucoin.com` 이었는데, **우리가 쓰는 경로는 그
         도메인에 없다.** 두 도메인에 직접 요청해 확인했다(2026-08-10):
           /api/v2/broker/queryMyCommission → api.kucoin.com 400(있음) / api-broker 404
           /api/v1/broker/nd/info           → api.kucoin.com 404 / api-broker 400(있음)
         (400001 은 "인증 헤더 없음" 이므로 경로가 존재한다는 뜻)

       ★ KuCoin 브로커는 두 종류이고 도메인이 갈린다:
           · Broker Pro (API Broker) — 사용자가 자기 키로 거래. **우리 형태.**
             경로 `/broker/api/*`, `/broker/query*` → api.kucoin.com
           · Exchange Broker — 브로커가 하위계정을 발급. `/broker/nd/*`
             → api-broker.kucoin.com

       ★ 잘못된 기본값을 두면, 나중에 이 값을 실제로 연결하는 순간 모든 정산
         조회가 404 가 되고 "리베이트가 0원" 으로 보인다.
    */
    kucoinBrokerRest: env.KUCOIN_BROKER_REST ?? 'https://api.kucoin.com',

    /*
       운영자 키. 브로커 정산 조회 전용이다.

       ★ 기본값을 두지 않는다. 빈 값이면 정산 조회 기능이 꺼지고, 화면이
         "설정되지 않음" 을 표시한다 — 없는 수익을 0 으로 보여주는 것보다
         설정이 빠졌다고 말하는 편이 정확하다.
    */
    /*
       청산 감시.

       ★ 명시적으로 'true' 여야 켠다. 실수로 켜지면 사용자 키로 거래소를 주기
         호출하게 되고, rate limit 을 사용자 본인의 거래에서 빼앗는다.
    */
    riskWatchEnabled: env.RISK_WATCH_ENABLED === 'true',
    riskWatchIntervalMs: (() => {
      const n = Number(env.RISK_WATCH_INTERVAL_MS ?? 120_000);
      return Number.isFinite(n) ? Math.max(30_000, n) : 120_000;
    })(),

    kucoinOperatorKey: env.KUCOIN_API_KEY?.trim() ?? '',
    kucoinOperatorSecret: env.KUCOIN_API_SECRET?.trim() ?? '',
    kucoinOperatorPassphrase: env.KUCOIN_API_PASSPHRASE?.trim() ?? '',
    /*
       레퍼럴 링크. http(s) 만 허용한다.

       검증하는 이유: 잘못된 스킴(javascript: 등)이 그대로 화면의 링크가 되면
       클릭 한 번에 스크립트가 실행된다. 설정 파일은 신뢰 경계 밖일 수 있다.
    */
    // 비어 있으면 화면 기본값(ChartControl)이 쓰인다.
    brandName: env.BRAND_NAME?.trim() || 'ChartControl',
    /*
       기본값을 두지 않는다.

       'support@example.com' 같은 그럴듯한 기본값이 있으면 설정을 잊은 채
       배포되고, 고객 문의가 아무도 없는 주소로 간다. 비어 있으면 화면이
       그 경로를 감추므로, 설정을 잊었다는 사실이 화면에서 드러난다.
    */
    /*
       http(s) 만 허용하고 끝의 슬래시를 없앤다.
       잘못된 값은 없는 것으로 본다 — 깨진 링크를 만드는 것보다 안 만드는 게 낫다.
    */
    publicBaseUrl: (() => {
      const raw = env.PUBLIC_BASE_URL?.trim() ?? '';
      if (!raw) return '';
      try {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        return u.origin;
      } catch {
        return '';
      }
    })(),
    supportEmail: (() => {
      const v = env.SUPPORT_EMAIL?.trim() ?? '';
      // 최소한의 형식 검증. 잘못된 값은 없는 것으로 본다.
      return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v) ? v : '';
    })(),
    kucoinReferralUrl: (() => {
      const raw = env.KUCOIN_REFERRAL_URL?.trim() ?? '';
      if (!raw) return '';
      try {
        const u = new URL(raw);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        return u.toString();
      } catch {
        // 형식이 잘못되면 없는 것으로 본다. 부팅을 막지는 않는다 —
        // 레퍼럴은 부가 기능이고, 이것 때문에 서비스가 안 뜨면 안 된다.
        return '';
      }
    })(),
    /*
       거래소별 추천 링크 수집.

       KUCOIN_REFERRAL_URL 도 kucoin 항목으로 합친다 — 같은 정보를 두 곳에
       따로 두면 한쪽만 고쳐서 어긋난다.
    */
    exchangeReferralUrls: (() => {
      const out: Record<string, string> = {};
      const safe = (raw: string | undefined): string => {
        const v = raw?.trim();
        if (!v) return '';
        try {
          const u = new URL(v);
          // http(s) 만 허용. javascript: 등이 화면의 링크가 되면 클릭 한 번에 실행된다.
          return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
        } catch {
          return '';
        }
      };

      const PREFIX = 'EXCHANGE_REFERRAL_URL_';
      for (const [k, v] of Object.entries(env)) {
        if (!k.startsWith(PREFIX)) continue;
        const id = k.slice(PREFIX.length).toLowerCase();
        const url = safe(v as string | undefined);
        if (id && url) out[id] = url;
      }

      // 전용 변수는 접두어 설정보다 우선한다 (더 구체적인 설정이 이긴다).
      const kucoin = safe(env.KUCOIN_REFERRAL_URL);
      if (kucoin) out.kucoin = kucoin;

      return Object.freeze(out);
    })(),
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
