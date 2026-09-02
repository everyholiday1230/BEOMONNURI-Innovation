import { buildSignedHeaders, normalizeQuery, serializeBody } from './signature';
import { isOrderMutationAllowed } from './modes';
import { normalizeBalances, normalizeOrder, normalizeOrders, normalizePositions } from './normalize';
import {
  TRANSACTION_HISTORY_PATH,
  buildTransactionParams,
  parseExchangeTransactions,
  type ExchangeTransaction,
  type ExchangeTransactionQuery,
} from './transaction-history';
import { CircuitBreaker, parseRetryAfterMs } from './rate-limit';
import type {
  AccountBalance,
  ExchangeContext,
  IExchangeAccountAdapter,
  IExchangeTradingAdapter,
  NormalizedOrder,
  Position,
  SubmitOrderRequest,
  SubmitOutcome,
} from './interfaces';

export interface BitMartFuturesConfig {
  restBase: string; // PRODUCTION base, e.g. https://api-cloud-v2.bitmart.com (NEVER demo)
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** request timeout ms; on timeout submit resolves to SUBMIT_UNKNOWN (never auto-retry). */
  timeoutMs?: number;
  /** optional circuit breaker (§15). When open, requests fail fast → SUBMIT_UNKNOWN for orders. */
  breaker?: CircuitBreaker;
  /**
   * API Broker id sent as `X-BM-BROKER-ID` on every signed request, so relayed orders are attributed
   * to us for rebate (see BITMART_BROKER_ID in @quantumtrade/config). Optional: omitted when absent,
   * which loses attribution but never breaks a request.
   */
  brokerId?: string;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
  }
}

/**
 * BitMart USDT-M Futures adapter (PRODUCTION). READ_ONLY/SHADOW never transmit order mutations.
 * TRADE transmits, and on an ambiguous outcome (network timeout after a possible send) returns
 * SUBMIT_UNKNOWN — the caller MUST reconcile by client_order_id, never blindly re-submit.
 */
export class BitMartFuturesAdapter implements IExchangeAccountAdapter, IExchangeTradingAdapter {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly breaker?: CircuitBreaker;

  constructor(private readonly cfg: BitMartFuturesConfig) {
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
    this.now = cfg.now ?? Date.now;
    this.timeoutMs = cfg.timeoutMs ?? 8000;
    this.breaker = cfg.breaker;
  }

  get canPlaceRealOrders(): boolean {
    return true; // capability exists; per-call mode gate decides transmission
  }

  private async signedGet(ctx: ExchangeContext, path: string, params: Record<string, string | number | undefined> = {}): Promise<unknown> {
    if (this.breaker && !this.breaker.canRequest()) throw new HttpError(503, 'circuit_open');
    const ts = String(this.now());
    const query = normalizeQuery(params);
    const headers = buildSignedHeaders(ctx.credential, ts, query, this.cfg.brokerId);
    const url = `${this.cfg.restBase}${path}${query ? `?${query}` : ''}`;
    const res = await this.fetchImpl(url, { method: 'GET', headers: headers as unknown as Record<string, string> });
    return this.handle(res);
  }

  private async signedPost(ctx: ExchangeContext, path: string, body: Record<string, unknown>): Promise<unknown> {
    if (this.breaker && !this.breaker.canRequest()) throw new HttpError(503, 'circuit_open');
    const ts = String(this.now());
    const payload = serializeBody(body); // EXACT bytes signed == bytes sent
    const headers = { ...buildSignedHeaders(ctx.credential, ts, payload, this.cfg.brokerId), 'content-type': 'application/json' };
    const res = await this.fetchImpl(`${this.cfg.restBase}${path}`, { method: 'POST', headers: headers as unknown as Record<string, string>, body: payload });
    return this.handle(res);
  }

  private async handle(res: Response): Promise<unknown> {
    if (res.status === 429 || res.status === 418) {
      this.breaker?.onFailure();
      throw new HttpError(res.status, `rate_limited_${res.status}`, parseRetryAfterMs(res.headers?.get?.('retry-after'), this.now()));
    }
    if (res.status >= 500) {
      this.breaker?.onFailure();
      throw new HttpError(res.status, `upstream_${res.status}`);
    }
    if (!res.ok) throw new HttpError(res.status, `http_${res.status}`);
    this.breaker?.onSuccess();
    return res.json();
  }

  async getServerTime(): Promise<number> {
    const raw = (await (await this.fetchImpl(`${this.cfg.restBase}/system/time`)).json()) as { data?: { server_time?: number } };
    return Number(raw?.data?.server_time ?? this.now());
  }
  /**
   * Futures transaction history — transfers, realized PnL, funding and commission fees, liquidations.
   *
   * Read-only permission, so it works with the key a user grants us for reading. This is the data behind
   * `/wallet/transactions`: we hold no funds, so the only real ledger is the exchange's.
   */
  async getTransactionHistory(
    ctx: ExchangeContext,
    query: ExchangeTransactionQuery = {},
  ): Promise<ExchangeTransaction[]> {
    const raw = await this.signedGet(ctx, TRANSACTION_HISTORY_PATH, buildTransactionParams(query));
    return parseExchangeTransactions(raw);
  }

  async getBalances(ctx: ExchangeContext): Promise<AccountBalance[]> {
    return normalizeBalances(await this.signedGet(ctx, '/contract/private/assets-detail'));
  }
  async getPositions(ctx: ExchangeContext): Promise<Position[]> {
    return normalizePositions(await this.signedGet(ctx, '/contract/private/position'));
  }
  async getOpenOrders(ctx: ExchangeContext, symbol?: string): Promise<NormalizedOrder[]> {
    return normalizeOrders(await this.signedGet(ctx, '/contract/private/get-open-orders', symbol ? { symbol } : {}));
  }
  async getOrderByClientId(ctx: ExchangeContext, clientOrderId: string): Promise<NormalizedOrder | null> {
    const raw = (await this.signedGet(ctx, '/contract/private/order', { client_order_id: clientOrderId })) as { data?: unknown };
    const d = raw?.data;
    if (!d || (Array.isArray(d) && d.length === 0)) return null;
    return normalizeOrder((Array.isArray(d) ? d[0] : d) as Record<string, unknown>);
  }

  async submitOrder(ctx: ExchangeContext, req: SubmitOrderRequest): Promise<SubmitOutcome> {
    // READ_ONLY / SHADOW: build + sign happens upstream; the adapter MUST NOT transmit.
    if (!isOrderMutationAllowed(ctx.mode)) {
      return { status: 'REJECTED', reason: `mode ${ctx.mode} does not transmit orders (shadow/read-only)` };
    }
    const body = {
      symbol: req.symbol,
      client_order_id: req.clientOrderId,
      side: req.side === 'long' ? 4 : 2, // BitMart futures side codes (open long / open short)
      type: req.type,
      size: req.quantity,
      ...(req.price ? { price: req.price } : {}),
      ...(req.leverage ? { leverage: String(req.leverage) } : {}),
      open_type: req.marginMode ?? 'isolated',
      ...(req.reduceOnly ? { reduce_only: true } : {}),
    };
    try {
      const raw = (await this.withTimeout(this.signedPost(ctx, '/contract/private/submit-order', body))) as { data?: unknown };
      return { status: 'ACCEPTED', order: normalizeOrder({ ...(raw.data as Record<string, unknown>), client_order_id: req.clientOrderId, symbol: req.symbol }) };
    } catch (e) {
      const err = e as Error;
      // Rejections with a definite 4xx are terminal; timeouts/5xx are AMBIGUOUS → reconcile.
      if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429 && err.status !== 418) {
        return { status: 'REJECTED', reason: err.message };
      }
      return { status: 'SUBMIT_UNKNOWN', clientOrderId: req.clientOrderId, reason: err.message };
    }
  }

  async cancelOrder(ctx: ExchangeContext, symbol: string, clientOrderId: string): Promise<{ ok: boolean }> {
    if (ctx.mode === 'LIVE_READ_ONLY') return { ok: false };
    if (ctx.mode === 'LIVE_SHADOW') return { ok: true }; // shadow: no transmit
    await this.signedPost(ctx, '/contract/private/cancel-order', { symbol, client_order_id: clientOrderId });
    return { ok: true };
  }
  async modifyOrder(ctx: ExchangeContext, symbol: string, clientOrderId: string, changes: { price?: string; quantity?: string }): Promise<{ ok: boolean }> {
    if (ctx.mode !== 'LIVE_TRADE') return { ok: ctx.mode === 'LIVE_SHADOW' };
    await this.signedPost(ctx, '/contract/private/modify-limit-order', { symbol, client_order_id: clientOrderId, ...changes });
    return { ok: true };
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('request_timeout')), this.timeoutMs);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
}
