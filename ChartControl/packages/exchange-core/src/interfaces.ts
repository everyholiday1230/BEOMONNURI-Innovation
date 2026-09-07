import type { ExecutionMode } from './modes';

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
  /**
   * 거래소에 **실제로 등록된** 브래킷 익절가. 등록하지 않았으면 null/undefined.
   *
   * ★ 요청에 담았다는 사실과 등록됐다는 사실은 다르다. 화면이 "보호가 걸렸다" 고
   *   말해도 되는지는 이 값으로만 판단한다.
   */
  takeProfitPrice?: string | null;
  /** 거래소에 실제로 등록된 브래킷 손절가. */
  stopLossPrice?: string | null;
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
  postOnly?: boolean;
  /** GTC | IOC | FOK */
  timeInForce?: string;
  /**
   * 발동(스톱) 가격. 있으면 어댑터가 발동 주문 경로로 보낸다. 없으면 일반 주문이다.
   * 이 값을 조용히 버리면 손절 주문이 즉시 체결된다 — 절대 무시하지 않는다.
   */
  stopPrice?: string;
  /** 발동 방향. 'up' = 가격이 stopPrice 이상으로 오르면 발동, 'down' = 이하로 내리면 발동. */
  stopDirection?: 'up' | 'down';
  /** 발동 기준가 종류. TP=최종거래가, IP=지수가, MP=마크가(기본). */
  stopPriceType?: 'TP' | 'IP' | 'MP';
  /**
   * 브래킷 익절가 — 진입 주문에 함께 등록한다.
   *
   * ★ 거래소 필드는 방향(위/아래)이지만 여기서는 **의미**로 받는다. long/short 에
   *   따라 대응이 뒤바뀌므로, 변환은 거래소 클라이언트 한 곳에서만 한다.
   *   상위에서 변환하면 한 번 뒤집히는 순간 손절 자리에 익절이 걸린다.
   *
   * ★ 어댑터가 이 값을 지원하지 않으면 **주문을 거부해야 한다.** 조용히 무시하면
   *   이용자는 보호가 걸렸다고 믿은 채 무방비로 남는다.
   */
  takeProfitPrice?: string;
  /** 브래킷 손절가. takeProfitPrice 와 같은 규칙이 적용된다. */
  stopLossPrice?: string;
}
export type SubmitOutcome =
  | { status: 'ACCEPTED'; order: NormalizedOrder }
  | { status: 'REJECTED'; reason: string }
  | { status: 'SUBMIT_UNKNOWN'; clientOrderId: string; reason: string }; // timeout/ambiguous → reconcile

export interface ExchangeContext {
  mode: ExecutionMode;
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
