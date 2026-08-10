/**
 * @quantumtrade/exchange-kucoin
 *
 * KuCoin USDT 무기한 선물 어댑터. @quantumtrade/exchange-adapters 의
 * 인터페이스(IMarketDataProvider / IOrderBookAdapter / ITradesAdapter)를 구현해
 * 거래소를 교체 가능하게 유지한다.
 *
 * 왜 KuCoin 인가: BitMart 가 2026-08-26 01:00 UTC 에 거래를 종료하고
 * 2026-07-26 부터 이미 신규 가입을 중단했다. 브로커 수익 모델이 성립하지 않는다.
 */

export {
  UNSUPPORTED_SYMBOLS,
  UNSUPPORTED_TIMEFRAMES,
  SUPPORTED_TIMEFRAMES,
  toKucoinSymbol,
  toInternalSymbol,
  toGranularity,
  toWsCandleSuffix,
  fromWsCandleSuffix,
} from './symbols.js';

export {
  toDecimalString,
  requireDecimalString,
  precisionFromStep,
  nanosToMs,
  secondsToMs,
} from './decimal.js';

export {
  normalizeInstrument,
  normalizeTickerFromContract,
  normalizeLiveTicker,
  normalizeOrderBook,
  normalizeTrade,
  normalizeTrades,
  normalizeRestCandle,
  normalizeRestCandles,
  normalizeWsCandle,
  type KucoinContract,
  type KucoinDepth,
  type KucoinInstrument,
  type KucoinTickerMsg,
  type KucoinTradeMsg,
  type KucoinRestKlineRow,
} from './normalize.js';

export {
  MAX_ROWS_PER_REQUEST,
  MAX_PAGES,
  planKlinePages,
  mergeCandlePages,
  inspectCandleContinuity,
  isContinuitySuspicious,
  type CandleContinuity,
  type KlinePage,
} from './klines.js';

export {
  buildAuthHeaders,
  buildPrehash,
  hasCompleteBrokerCredentials,
  signPartner,
  signPassphrase,
  signRequest,
  type BrokerCredentials,
  type UserCredentials,
} from './signature.js';

export {
  KucoinFuturesRest,
  KucoinApiError,
  DEFAULT_KUCOIN_RATE_LIMIT,
  DEFAULT_KUCOIN_FUTURES_REST,
  type KucoinRestConfig,
} from './rest.js';

export {
  tickerTopic,
  depth5Topic,
  depth50Topic,
  executionTopic,
  candleTopic,
  subscribeFrame,
  unsubscribeFrame,
  pingFrame,
  buildConnectUrl,
  assertSecureWsEndpoint,
  parseFrame,
  parseTopic,
  KUCOIN_WS_HOSTS,
  type KucoinFrame,
  type ParsedTopic,
} from './ws-protocol.js';

export {
  KucoinWsClient,
  createNodeSocketFactory,
  SOCKET_CONNECTING,
  SOCKET_OPEN,
  type ConnectionState,
  type SocketFactory,
  type SocketHandlers,
  type SocketLike,
  type KucoinWsClientConfig,
  type KucoinWsEvents,
} from './ws-client.js';

export {
  KucoinFuturesAdapter,
  type KucoinAdapterConfig,
} from './futures-adapter.js';

export { MAX_TOLERABLE_GAP } from './klines.js';

export {
  KucoinFuturesPrivate,
  type KucoinPrivateConfig,
  type KucoinBalance,
  type KucoinPosition,
  type KucoinLedgerEntry,
  type KucoinOrder,
  type KucoinFill,
  type KucoinSubmitRequest,
  type KucoinSubmitResult,
} from './private-rest.js';

/*
   브로커 정산 조회 (API Broker / Broker Pro).

   ★ 스팟 도메인(api.kucoin.com)을 쓴다 — 선물 도메인에는 이 경로가 없다.
     그래서 KucoinFuturesPrivate 와 별도 클라이언트다.
*/
export {
  KucoinBrokerClient,
  KucoinBrokerError,
  DEFAULT_KUCOIN_SPOT_REST,
  type KucoinBrokerConfig,
  type BrokerTradeType,
  type BrokerCommissionRow,
  type BrokerUserRow,
  type BrokerUserTransactionRow,
  type BrokerPage,
} from './broker-rest.js';
