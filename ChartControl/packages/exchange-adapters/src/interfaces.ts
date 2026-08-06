import type {
  Candle,
  OrderBook,
  Trade,
  Ticker,
  SymbolInfo,
  OrderDraft,
  Order,
} from '@quantumtrade/schemas';
import type { Timeframe } from '@quantumtrade/config';

/**
 * Provider interfaces (ADR-0002). Program against these; concrete adapters
 * (BitMart public, MockReplay, future BitMart Demo) implement them so vendors are swappable.
 */

export interface CandleQuery {
  symbol: string;
  timeframe: Timeframe;
  /** max candles */
  limit?: number;
  /** fetch candles strictly before this epoch-ms (pagination) */
  before?: number;
  /** AbortSignal for request cancellation (latest-request-wins) */
  signal?: AbortSignal;
}

export interface Unsubscribe {
  (): void;
}

/** Read-only market data source (candles, ticker). */
export interface IMarketDataProvider {
  readonly name: string;
  getSymbols(signal?: AbortSignal): Promise<SymbolInfo[]>;
  getCandles(query: CandleQuery): Promise<Candle[]>;
  getTicker(symbol: string, signal?: AbortSignal): Promise<Ticker>;
  /**
   * Tickers for the whole catalogue in ONE upstream call.
   *
   * Exists because the markets screen needs every symbol at once: looping `getTicker` over 21 symbols
   * would be 21 round trips and 21 rate-limit tokens for data the exchange already returns in a single
   * response (BitMart's `/contract/public/details` with no symbol filter).
   *
   * A symbol whose row fails validation is omitted rather than rejecting the batch, so one malformed
   * upstream row cannot blank the whole screen.
   */
  getTickers(signal?: AbortSignal): Promise<Ticker[]>;
  /** Realtime candle stream. Returns an unsubscribe that MUST remove listeners + upstream subs. */
  subscribeCandles(
    symbol: string,
    timeframe: Timeframe,
    onCandle: (candle: Candle) => void,
  ): Unsubscribe;
}

/** Order book snapshot + incremental stream. */
export interface IOrderBookAdapter {
  getSnapshot(symbol: string, depth?: number, signal?: AbortSignal): Promise<OrderBook>;
  subscribeBook(symbol: string, onUpdate: (book: OrderBook) => void): Unsubscribe;
}

/** Recent trades stream. */
export interface ITradesAdapter {
  getRecent(symbol: string, limit?: number, signal?: AbortSignal): Promise<Trade[]>;
  subscribeTrades(symbol: string, onTrade: (trade: Trade) => void): Unsubscribe;
}

/** Private account data (balances/positions/orders). Interface-only in Phase 1. */
export interface IAccountDataAdapter {
  getBalances(signal?: AbortSignal): Promise<Record<string, string>>;
  getPositions(signal?: AbortSignal): Promise<unknown[]>;
  getOpenOrders(signal?: AbortSignal): Promise<Order[]>;
  subscribeAccount(onEvent: (event: unknown) => void): Unsubscribe;
}

/**
 * Trading adapter. Phase 1: MockTradingAdapter only. BitMart Demo / production adapters implement
 * this later. `submitOrder` REQUIRES an already-confirmed draft carrying a confirmation token;
 * adapters must reject submissions lacking it (defense in depth — see ADR-0004).
 */
export interface ConfirmedOrderSubmission {
  draft: OrderDraft;
  /** Issued only after explicit user final confirmation. */
  confirmationToken: string;
  /** Idempotency key; duplicate submits with same key return the existing order. */
  clientOrderId: string;
}

export interface IExchangeTradingAdapter {
  readonly name: string;
  /** true only for adapters permitted to place non-mock orders (never in Phase 1). */
  readonly canPlaceRealOrders: boolean;
  previewOrder(draft: OrderDraft, symbol: SymbolInfo): Promise<Order>;
  submitOrder(submission: ConfirmedOrderSubmission): Promise<Order>;
  cancelOrder(clientOrderId: string): Promise<Order>;
  /** Reconcile an order whose submit outcome was ambiguous (UNKNOWN_RECONCILING). */
  reconcileByClientOrderId(clientOrderId: string): Promise<Order | null>;
}
