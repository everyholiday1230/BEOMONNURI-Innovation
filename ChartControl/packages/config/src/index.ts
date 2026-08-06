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

/** Supported chart timeframes (KLineChart periods). */
export const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '1d', '1w'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Map a timeframe to milliseconds — used for gap-fill and candle bucketing. */
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '2h': 7_200_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
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

