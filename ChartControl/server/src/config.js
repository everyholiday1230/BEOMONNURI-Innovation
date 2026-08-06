/**
 * 설정. 모든 비밀값은 환경변수로만 주입한다. 코드/저장소에 넣지 않는다.
 *
 * KuCoin 브로커 자격증명(KUCOIN_BROKER_*)은 주문 라우팅 시에만 필요하며,
 * Phase 1(시세)에서는 없어도 서버가 정상 동작한다.
 */

function str(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function int(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

export const config = {
  env: str('NODE_ENV', 'development'),
  port: int('PORT', 8791),
  host: str('HOST', '127.0.0.1'),

  // 정적 프론트엔드(디자이너 산출물) 경로 — server/ 의 부모 디렉터리
  staticDir: str('STATIC_DIR', ''),

  // 활성 거래소. 어댑터 레지스트리 키.
  exchange: str('EXCHANGE', 'kucoin'),

  kucoin: {
    futuresRest: str('KUCOIN_FUTURES_REST', 'https://api-futures.kucoin.com'),
    spotRest: str('KUCOIN_SPOT_REST', 'https://api.kucoin.com'),
    brokerRest: str('KUCOIN_BROKER_REST', 'https://api-broker.kucoin.com'),

    // 브로커 리베이트용. KuCoin이 발급: partner / broker-key / broker-name
    broker: {
      partner: str('KUCOIN_BROKER_PARTNER'),
      key: str('KUCOIN_BROKER_KEY'),
      name: str('KUCOIN_BROKER_NAME'),
    },
  },

  market: {
    // 프론트엔드가 기본으로 감시하는 심볼 (내부 표기: BASE+QUOTE)
    defaultSymbol: str('DEFAULT_SYMBOL', 'BTCUSDT'),
    // 티커 스냅샷 폴링 주기(ms). WS가 주 경로이고 이건 보정용.
    tickerRefreshMs: int('TICKER_REFRESH_MS', 5000),
    // 캔들 캐시 TTL(ms)
    candleTtlMs: int('CANDLE_TTL_MS', 60000),
    klineLimit: int('KLINE_LIMIT', 300),
  },

  ws: {
    // 브라우저 클라이언트 하트비트 주기(ms)
    heartbeatMs: int('WS_HEARTBEAT_MS', 20000),
    maxClients: int('WS_MAX_CLIENTS', 500),
  },

  logLevel: str('LOG_LEVEL', 'info'),
  trustProxy: bool('TRUST_PROXY', false),
};

/**
 * 브로커 자격증명이 완전히 갖춰졌는지. 셋 중 하나라도 비면 리베이트 헤더를
 * 붙일 수 없으므로 false. (부분 설정은 서명 실패 → 400201 유발)
 */
export function hasBrokerCredentials() {
  const b = config.kucoin.broker;
  return Boolean(b.partner && b.key && b.name);
}
