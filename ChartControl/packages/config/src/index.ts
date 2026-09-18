/**
 * @quantumtrade/config
 * Central configuration & constants. BitMart limits, timeframes, and mode enums
 * live here — NEVER hardcoded across the codebase (see ADR-0002).
 */

/**
 * 시세 데이터 출처.
 *
 * KUCOIN_PUBLIC 이 현재 운영 모드다. BITMART_PUBLIC 은 남겨둔다 —
 * 지우면 기존 테스트와 어댑터가 깨지고, 거래소를 다시 갈아탈 때 참고할
 * 구현체를 잃는다. BitMart 는 2026-08-26 거래 종료로 실사용은 불가하다.
 */
export const DATA_MODES = ['MOCK_REPLAY', 'BITMART_PUBLIC', 'KUCOIN_PUBLIC'] as const;
export type DataMode = (typeof DATA_MODES)[number];

/**
 * 주문 집행 모드.
 *
 * KUCOIN_LIVE 는 사용자 API 키로 실제 주문을 낸다. 기본값은 MOCK 이며,
 * 실주문은 FEATURE_LIVE_ORDERS_ENABLED 와 킬스위치를 모두 통과해야 열린다.
 */
export const TRADING_MODES = [
  'MOCK',
  'BITMART_DEMO',
  'BITMART_PRODUCTION_DISABLED',
  'KUCOIN_LIVE',
] as const;
export type TradingMode = (typeof TRADING_MODES)[number];

/*
   지원 차트 주기 (KLineChart period).

   ★★★ **KuCoin 이 실제로 주는 것을 API 로 확인해 맞췄다**(2026-09-18). 추측하지 않았다.

     선물 `/api/v1/kline/query` granularity (분 단위):
       1 · 3 · 5 · 15 · 30 · 60 · 120 · 240 · 480 · 720 · 1440 · 10080 · **43200**
       ★ 360(6h) 은 `Unsupported granularity` 를 돌려준다 — 선물에는 6시간이 없다.
     현물 `/api/v1/market/candles` type:
       1min · 3min · 5min · 15min · 30min · 1hour · 2hour · 4hour · **6hour** ·
       8hour · 12hour · 1day · 1week · **1month**

   ★ 그래서 8h·12h·1M 을 새로 넣고, 6h 는 **현물 전용**으로 둔다(선물에서 고르면
     어댑터가 명시적으로 실패한다 — 빈 차트를 보여주는 것보다 낫다).
   ★ `1M` 은 **한 달**이다. `1m`(1분)과 대문자 하나로만 구별된다 — 화면 표기에서
     헷갈리지 않게 주의할 것.
*/
export const TIMEFRAMES = [
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '8h', '12h',
  '1d', '1w', '1M',
] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/*
   주기 → 밀리초. 갭 보정과 봉 버킷 계산에 쓴다.

   ★★ 달은 **길이가 고정이 아니다**(28~31일). 여기서는 30일로 둔다 — 이 값은 갭 보정
     휴리스틱과 "봉이 이어져 있나" 판단에만 쓰이고, 봉의 실제 시각은 거래소가 준
     타임스탬프를 그대로 쓴다. 우리가 달 경계를 계산해 봉을 만들지 않는다.
   ★ 그래서 연속성 검사가 달 단위에서는 느슨해진다. 엄격하게 하려면 달력 계산이
     필요한데, 거래소 값을 그대로 쓰는 지금 구조에서는 이득이 없다.
*/
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '6h': 21_600_000,
  '8h': 28_800_000,
  '12h': 43_200_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
  '1M': 2_592_000_000,
};

/** Rate-limit configuration (token bucket). Values are defaults; override via env. */
export interface RateLimitConfig {
  /** Sustained requests per second. */
  maxRps: number;
  /** Burst capacity (bucket size). */
  burst: number;
  /** Base backoff in ms for retryable failures. */
  backoffBaseMs: number;
  /** Max backoff cap in ms. */
  backoffMaxMs: number;
  /** Jitter ratio 0..1 applied to backoff. */
  jitterRatio: number;
  /** Consecutive failures before opening the circuit breaker. */
  circuitBreakerThreshold: number;
  /** How long the breaker stays open (ms). */
  circuitBreakerResetMs: number;
}

export const DEFAULT_BITMART_RATE_LIMIT: RateLimitConfig = {
  maxRps: 8,
  burst: 15,
  backoffBaseMs: 500,
  backoffMaxMs: 30_000,
  jitterRatio: 0.3,
  circuitBreakerThreshold: 5,
  circuitBreakerResetMs: 30_000,
};

/** Market-data batching window (ms). Account/order events are NEVER batched. */
export const MARKET_DATA_BATCH_MS = 75;

/** Staleness threshold: no message within this window => STALE. */
export const STALE_THRESHOLD_MS = 5_000;

/** Bounded buffer sizes (anti-unbounded-memory). */
export const MAX_CANDLES_IN_MEMORY = 2_000;
export const MAX_TRADES_IN_MEMORY = 200;
export const MAX_ORDERBOOK_DEPTH = 200;

export const CONNECTION_STATES = [
  'CONNECTING',
  'LIVE',
  'DEGRADED',
  'RECONNECTING',
  'STALE',
  'OFFLINE',
  'FALLBACK',
  'RATE_LIMITED',
] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export const DEFAULT_SYMBOL = 'BTCUSDT';

/**
 * BitMart API Broker attribution (`X-BM-BROKER-ID`).
 *
 * Sent on every KEYED/SIGNED BitMart request so that orders we relay on a user's behalf are
 * attributed to us and rebated. Per BitMart's Broker Program access process, an order must carry
 * "the user's APIKey + BrokerID" to be recognised as coming through a specific broker
 * (developer-pro.bitmart.com/en/broker/, step 4). Current tier: Standard.
 *
 * This is an identifier, not a secret — it travels in a plaintext header on every request.
 *
 * Hardcoded here rather than env-only on purpose. A deployment that forgot the variable would keep
 * working while silently earning nothing; a revenue leak that raises no error is the worst failure
 * mode available. `BITMART_BROKER_ID` still overrides it (see apps/api/src/env.ts) for a test or
 * partner account.
 *
 * NOT part of the request signature — see packages/exchange-bitmart/src/signature.ts.
 */
export const BITMART_BROKER_ID = 'BEOMONNURI12345';

