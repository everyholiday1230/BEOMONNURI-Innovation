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

/*
   현물 시세 어댑터.

   ★ 선물 어댑터와 나란히 두되 섞지 않는다. 심볼 규칙·캔들 배열 순서·수량 의미가
     모두 다르므로, 한 곳에서 분기하면 어느 시장의 규칙이 적용됐는지 알 수 없다.
*/
export {
  KucoinSpotAdapter,
  toSpotSymbol,
  fromSpotSymbol,
  type KucoinSpotAdapterOptions,
} from './spot-adapter.js';

/*
   현물 비공개 REST (잔고·주문).

   ★★ 선물 클라이언트와 절대 섞지 않는다. 수량 의미(계약수 vs 기초자산)와
     레버리지 유무가 다르므로, 한쪽 코드를 다른 쪽에 쓰면 주문 크기가 1000배
     달라지거나 거래소가 거부한다.
*/
export {
  KucoinSpotPrivate,
  KucoinSpotApiError,
  type KucoinSpotPrivateConfig,
  type SpotSubmitRequest,
  type SpotStopSubmitRequest,
  type SpotSubmitResult,
  type SpotBalance,
} from './spot-private-rest.js';

/*
   현물 실시간 스트림 (토픽 · 프레임 해석 · bullet).

   ★ 선물 토픽과 접두어가 다르다(/market/ vs /contractMarket/, 호가는
     /spotMarket/). 잘못된 토픽은 오류가 아니라 조용한 무응답이라, 화면은
     실시간이라고 믿으며 영원히 기다린다.
*/
export {
  spotTickerTopic,
  spotMatchTopic,
  spotDepth5Topic,
  spotCandleTopic,
  symbolFromSpotTopic,
  parseSpotTicker,
  parseSpotCandle,
  parseSpotBook,
  parseSpotTrade,
  createSpotBulletProvider,
  type SpotBulletProvider,
} from './spot-ws.js';
