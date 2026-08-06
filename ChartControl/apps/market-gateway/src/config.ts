/** Gateway configuration (Phase 6 §3). Safe defaults; production default upstream = INTERNAL_GATEWAY
 *  semantics (this process IS the internal gateway; its own upstream to the exchange is MOCK_REPLAY
 *  unless explicitly set to BITMART_PUBLIC). Browsers connect ONLY to this gateway, never to BitMart. */
export type UpstreamMode = 'MOCK_REPLAY' | 'BITMART_PUBLIC';

export interface GatewayConfig {
  host: string;
  port: number;
  upstream: UpstreamMode;
  originAllowlist: string[];
  maxSubsPerUser: number;
  allowedSymbols: string[];
  allowedTimeframes: string[];
  redisUrl?: string;
  bitmartWsUrl: string;
  bitmartRestBase: string;
  gitSha: string;
  /**
   * Dev-only auth: accept `token=user:<id>` when true and NODE_ENV!=production.
   *
   * Two problems make this unusable outside a laptop, and both are now closed by `sessionValidateUrl`:
   *  - the value is trusted verbatim, so any client could claim to be any user by editing a query param;
   *  - it travels in the QUERY STRING, which lands in access logs and `Referer` headers. Even a real token
   *    belongs in a cookie or header, never there.
   */
  devAuth: boolean;
  /**
   * Endpoint that validates the forwarded session cookie and returns the user.
   *
   * The BFF's own `GET /auth/me` — reused deliberately rather than adding a new endpoint, so the gateway
   * authenticates through the exact same path as every other authenticated request. Called once per socket, not
   * per message.
   */
  sessionValidateUrl: string;
  /** Session cookie name; forwarded as-is. */
  sessionCookieName: string;
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const mode = env.GATEWAY_UPSTREAM === 'BITMART_PUBLIC' ? 'BITMART_PUBLIC' : 'MOCK_REPLAY';
  return {
    host: env.GATEWAY_HOST ?? '127.0.0.1',
    port: Number(env.GATEWAY_PORT ?? 8790),
    upstream: mode,
    // 5174 is apps/broker-web. Omitting it makes the WS upgrade 403 while the REST app works, which
    // presents as "charts never update" rather than as an origin error.
    originAllowlist: (env.GATEWAY_ORIGIN_ALLOWLIST ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174')
      .split(',').map((s) => s.trim()).filter(Boolean),
    maxSubsPerUser: Number(env.GATEWAY_MAX_SUBS_PER_USER ?? 20),
    allowedSymbols: (env.GATEWAY_SYMBOLS ?? 'BTCUSDT,ETHUSDT,SOLUSDT').split(',').map((s) => s.trim()),
    // 1m/5m/15m/30m/1h/2h/4h/1d/1w are streamable on BitMart futures. 3m is deliberately absent: there is
    // no klineBin3m channel (verified against the live venue), so advertising it would accept a
    // subscription that can never push.
    allowedTimeframes: (env.GATEWAY_TIMEFRAMES ?? '1m,5m,15m,30m,1h,2h,4h,1d,1w').split(',').map((s) => s.trim()),
    redisUrl: env.GATEWAY_REDIS_URL ?? env.REDIS_URL,
    bitmartWsUrl: env.BITMART_WS_PUBLIC ?? 'wss://openapi-ws-v2.bitmart.com/api?protocol=1.1',
    bitmartRestBase: env.BITMART_REST_BASE ?? 'https://api-cloud-v2.bitmart.com',
    gitSha: env.GIT_SHA ?? 'dev',
    devAuth: env.NODE_ENV !== 'production' && env.GATEWAY_DEV_AUTH === 'true',
    sessionValidateUrl: env.GATEWAY_SESSION_VALIDATE_URL ?? 'http://127.0.0.1:8787/api/auth/me',
    sessionCookieName: env.SESSION_COOKIE_NAME ?? 'qt_session',
  };
}

export const CHANNELS = ['ticker', 'candle', 'orderbook', 'trades'] as const;
export type Channel = (typeof CHANNELS)[number];
