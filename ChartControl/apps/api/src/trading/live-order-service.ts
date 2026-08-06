import { transitionLiveOrder, type LiveOrderState } from '@quantumtrade/domain';
import {
  PrivateEventDedup,
  type ExchangeContext,
  type IExchangeAccountAdapter,
  type IExchangeTradingAdapter,
  type SubmitOrderRequest,
} from '@quantumtrade/exchange-bitmart';
import { IdempotencyService } from './idempotency';

export interface LiveOrderRecord {
  clientOrderId: string;
  userId: string;
  state: LiveOrderState;
  exchangeOrderId?: string;
  filledQuantity: string;
  events: { from: LiveOrderState | null; to: LiveOrderState; at: number }[];
}

/**
 * Orchestrates a live/shadow order across the adapter + idempotency + state machine + reconciliation
 * (docs PHASE3-03/05). On an ambiguous submit (SUBMIT_UNKNOWN) it reconciles by client_order_id and
 * NEVER blind-resubmits. Private-WS events are deduped and applied in order.
 */
export class LiveOrderService {
  private orders = new Map<string, LiveOrderRecord>();
  private dedup = new PrivateEventDedup();

  constructor(
    private readonly trading: IExchangeTradingAdapter,
    private readonly account: IExchangeAccountAdapter,
    private readonly idempotency: IdempotencyService,
  ) {}

  get(clientOrderId: string): LiveOrderRecord | undefined {
    return this.orders.get(clientOrderId);
  }

  private set(rec: LiveOrderRecord, to: LiveOrderState) {
    rec.events.push({ from: rec.state, to, at: Date.now() });
    rec.state = transitionLiveOrder(rec.state, to);
  }

  /** Idempotent submit. Duplicate idempotencyKey ⇒ same record (no second order). */
  async submit(ctx: ExchangeContext, userId: string, req: SubmitOrderRequest, idempotencyKey: string): Promise<LiveOrderRecord> {
    const { result } = await this.idempotency.run(idempotencyKey, async () => {
      const rec: LiveOrderRecord = { clientOrderId: req.clientOrderId, userId, state: 'DRAFT', filledQuantity: '0', events: [] };
      this.set(rec, 'VALIDATING');
      this.set(rec, 'READY');
      this.set(rec, 'AWAITING_USER_CONFIRMATION');
      this.set(rec, 'SUBMITTING');
      const out = await this.trading.submitOrder(ctx, req);
      if (out.status === 'ACCEPTED') {
        rec.exchangeOrderId = out.order.exchangeOrderId;
        this.set(rec, 'ACCEPTED');
      } else if (out.status === 'REJECTED') {
        this.set(rec, 'REJECTED');
      } else {
        // SUBMIT_UNKNOWN → reconcile by client_order_id (do NOT resubmit).
        this.set(rec, 'SUBMIT_UNKNOWN');
        await this.reconcile(ctx, rec);
      }
      this.orders.set(req.clientOrderId, rec);
      return rec;
    });
    return result;
  }

  /** Reconcile an order's true state from the exchange (by client_order_id). */
  async reconcile(ctx: ExchangeContext, rec: LiveOrderRecord): Promise<void> {
    if (rec.state !== 'SUBMIT_UNKNOWN' && rec.state !== 'INCONSISTENT') return;
    this.set(rec, 'RECONCILING');
    const found = await this.account.getOrderByClientId(ctx, rec.clientOrderId);
    if (!found) {
      // no order on exchange → truly not placed; safe terminal.
      this.set(rec, 'REJECTED');
      return;
    }
    rec.exchangeOrderId = found.exchangeOrderId;
    rec.filledQuantity = found.filledQuantity;
    const map: Record<string, LiveOrderState> = { OPEN: 'OPEN', PARTIALLY_FILLED: 'PARTIALLY_FILLED', FILLED: 'FILLED', CANCELED: 'CANCELED', REJECTED: 'REJECTED' };
    const target = map[found.status];
    if (target) this.set(rec, target);
    else this.set(rec, 'INCONSISTENT');
  }

  /** Apply a private-WS order event with dedup + out-of-order protection. */
  applyOrderEvent(clientOrderId: string, seq: number, dedupId: string, toStatus: string, filledQuantity?: string): boolean {
    const rec = this.orders.get(clientOrderId);
    if (!rec) return false;
    if (!this.dedup.accept(`order:${clientOrderId}`, seq, dedupId)) return false;
    const map: Record<string, LiveOrderState> = { OPEN: 'OPEN', PARTIALLY_FILLED: 'PARTIALLY_FILLED', FILLED: 'FILLED', CANCELED: 'CANCELED', REJECTED: 'REJECTED' };
    const to = map[toStatus];
    if (!to) return false;
    if (filledQuantity !== undefined) rec.filledQuantity = filledQuantity;
    try {
      this.set(rec, to);
      return true;
    } catch {
      // illegal transition (e.g., after terminal) → ignore, keep newest valid state.
      return false;
    }
  }
}
