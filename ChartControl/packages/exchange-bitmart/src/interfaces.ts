import type { BitMartMode } from './modes';

/** Normalized (vendor-neutral) trading domain types. Money is decimal STRING (never JS number). */
export interface AccountBalance {
  asset: string;
  available: string;
  equity: string;
  used: string;
}
export interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: string;
  entryPrice: string;
  markPrice?: string;
  liquidationPrice?: string;
  leverage: number;
  marginMode: 'isolated' | 'cross';
  unrealizedPnl?: string;
}
export interface NormalizedOrder {
  clientOrderId: string;
  exchangeOrderId?: string;
  symbol: string;
  side: 'long' | 'short';
  type: 'market' | 'limit';
  price?: string;
  quantity: string;
  filledQuantity: string;
  status: string;
  reduceOnly?: boolean;
  createdAt: number;
  updatedAt: number;
}
export interface SubmitOrderRequest {
  clientOrderId: string;
  symbol: string;
  side: 'long' | 'short';
  type: 'market' | 'limit';
  price?: string;
  quantity: string;
  leverage?: number;
  marginMode?: 'isolated' | 'cross';
  reduceOnly?: boolean;
}
export type SubmitOutcome =
  | { status: 'ACCEPTED'; order: NormalizedOrder }
  | { status: 'REJECTED'; reason: string }
  | { status: 'SUBMIT_UNKNOWN'; clientOrderId: string; reason: string }; // timeout/ambiguous → reconcile

export interface ExchangeContext {
  mode: BitMartMode;
  credential: { accessKey: string; secretKey: string; memo: string };
}

/** Read-only account data (assets/positions/orders). Safe in READ_ONLY mode. */
export interface IExchangeAccountAdapter {
  getServerTime(): Promise<number>;
  getBalances(ctx: ExchangeContext): Promise<AccountBalance[]>;
  getPositions(ctx: ExchangeContext): Promise<Position[]>;
  getOpenOrders(ctx: ExchangeContext, symbol?: string): Promise<NormalizedOrder[]>;
  getOrderByClientId(ctx: ExchangeContext, clientOrderId: string): Promise<NormalizedOrder | null>;
}

/** Order mutation. In READ_ONLY/SHADOW these MUST NOT transmit to BitMart. */
export interface IExchangeTradingAdapter {
  readonly canPlaceRealOrders: boolean;
  submitOrder(ctx: ExchangeContext, req: SubmitOrderRequest): Promise<SubmitOutcome>;
  cancelOrder(ctx: ExchangeContext, symbol: string, clientOrderId: string): Promise<{ ok: boolean }>;
  modifyOrder(ctx: ExchangeContext, symbol: string, clientOrderId: string, changes: { price?: string; quantity?: string }): Promise<{ ok: boolean }>;
}

export interface PrivateStreamEvent {
  type: 'order' | 'position' | 'balance';
  seq: number;
  ts: number;
  data: unknown;
}
export interface IExchangePrivateStreamAdapter {
  connect(ctx: ExchangeContext, onEvent: (e: PrivateStreamEvent) => void): Promise<void>;
  subscribe(channels: string[]): void;
  disconnect(): void;
  readonly connected: boolean;
}
