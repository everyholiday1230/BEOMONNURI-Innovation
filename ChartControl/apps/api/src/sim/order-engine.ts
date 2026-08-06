import { randomUUID } from 'node:crypto';
import {
  OrderDraftSchema,
  validate,
  type Order,
  type OrderDraft,
  type OrderPreview,
  type SymbolInfo,
} from '@quantumtrade/schemas';
import { checkPrecision, computeOrderMath, transitionOrder } from '@quantumtrade/domain';

interface DraftRecord {
  draftId: string;
  draft: OrderDraft;
  preview: OrderPreview;
  confirmationToken: string;
  symbol: SymbolInfo;
}

/**
 * In-memory SIMULATION order engine. Enforces:
 *  - draft validation + symbol precision checks + Decimal risk math,
 *  - a CONFIRMATION GATE: submit requires the confirmationToken issued at draft time AND the
 *    caller's explicit final confirmation (ADR-0004). No token => rejected.
 *  - idempotency by clientOrderId (duplicate confirm returns the existing order — no double submit).
 * NOTHING here places a real order. isSimulated is always true.
 */
export class SimOrderEngine {
  private drafts = new Map<string, DraftRecord>();
  private orders = new Map<string, Order>(); // keyed by clientOrderId

  createDraft(
    input: unknown,
    symbol: SymbolInfo,
  ): { ok: true; draftId: string; preview: OrderPreview } | { ok: false; error: string } {
    const v = validate(OrderDraftSchema, input);
    if (!v.ok) return { ok: false, error: v.error };
    const draft = v.data;

    const precision = checkPrecision(symbol, draft.price, draft.quantity);
    if (!precision.ok) return { ok: false, error: precision.errors.join('; ') };

    const entryPrice = draft.price ?? '0';
    const math = computeOrderMath({
      side: draft.side,
      entryPrice,
      quantity: draft.quantity,
      leverage: draft.leverage,
      stopLoss: draft.stopLoss,
      takeProfit: draft.takeProfit,
    });

    const preview: OrderPreview = {
      symbol: draft.symbol,
      marketType: draft.marketType,
      side: draft.side,
      positionAction: draft.positionAction,
      orderType: draft.orderType,
      entryPrice,
      quantity: draft.quantity,
      leverage: draft.leverage,
      marginMode: draft.marginMode,
      positionValue: math.positionValue,
      stopLoss: draft.stopLoss,
      takeProfit: draft.takeProfit,
      estFee: math.estFee,
      estLiquidationPrice: math.estLiquidationPrice,
      riskReward: math.riskReward,
      maxEstLoss: math.maxEstLoss,
      aiGenerated: draft.aiGenerated,
      isSimulated: true,
    };

    const draftId = randomUUID();
    const confirmationToken = randomUUID(); // issued only here; required at confirm time
    this.drafts.set(draftId, { draftId, draft, preview, confirmationToken, symbol });
    return { ok: true, draftId, preview };
  }

  /** The confirmation token for a draft (a real UI would deliver this only after final confirm). */
  getConfirmationToken(draftId: string): string | undefined {
    return this.drafts.get(draftId)?.confirmationToken;
  }

  confirmAndSubmit(params: {
    draftId: string;
    clientOrderId: string;
    confirmationToken: string;
    userConfirmed: boolean;
  }): { ok: true; order: Order } | { ok: false; code: 'FORBIDDEN' | 'NOT_FOUND'; error: string } {
    const rec = this.drafts.get(params.draftId);
    if (!rec) return { ok: false, code: 'NOT_FOUND', error: 'draft not found' };

    // Idempotency: duplicate confirm with same clientOrderId returns the existing order.
    const existing = this.orders.get(params.clientOrderId);
    if (existing) return { ok: true, order: existing };

    // CONFIRMATION GATE — explicit user confirmation + matching token required.
    if (!params.userConfirmed || params.confirmationToken !== rec.confirmationToken) {
      return { ok: false, code: 'FORBIDDEN', error: 'explicit user confirmation token required' };
    }

    const now = Date.now();
    // Drive the order state machine through the legal simulated lifecycle.
    let state = transitionOrder('DRAFT', 'VALIDATING');
    state = transitionOrder(state, 'READY');
    state = transitionOrder(state, 'SUBMITTING');
    state = transitionOrder(state, 'ACCEPTED');
    state = transitionOrder(state, 'FILLED'); // simulated immediate fill

    const order: Order = {
      ...rec.draft,
      clientOrderId: params.clientOrderId,
      id: randomUUID(),
      status: state,
      filledQuantity: rec.draft.quantity,
      isSimulated: true,
      createdAt: now,
      updatedAt: now,
      events: [
        { fromState: null, toState: 'VALIDATING', actor: 'system', at: now },
        { fromState: 'VALIDATING', toState: 'READY', actor: 'risk', at: now },
        { fromState: 'READY', toState: 'SUBMITTING', actor: 'user', at: now },
        { fromState: 'SUBMITTING', toState: 'ACCEPTED', actor: 'exchange', at: now },
        { fromState: 'ACCEPTED', toState: 'FILLED', actor: 'exchange', at: now },
      ],
    };
    this.orders.set(params.clientOrderId, order);
    return { ok: true, order };
  }

  listOrders(): Order[] {
    return [...this.orders.values()];
  }
}
