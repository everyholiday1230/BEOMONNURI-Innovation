import type { OrderState } from '@quantumtrade/schemas';

/** Legal transitions for the 12-state order machine (docs/08). */
const ORDER_TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  DRAFT: ['VALIDATING'],
  VALIDATING: ['READY', 'REJECTED'],
  READY: ['SUBMITTING', 'CANCELLED'],
  // On ambiguous submit outcome we go to UNKNOWN_RECONCILING (never blind resubmit).
  SUBMITTING: ['ACCEPTED', 'REJECTED', 'UNKNOWN_RECONCILING'],
  ACCEPTED: ['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'EXPIRED', 'REJECTED'],
  PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'EXPIRED'],
  FILLED: [],
  CANCEL_PENDING: ['CANCELLED', 'FILLED', 'PARTIALLY_FILLED'],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
  // Reconciliation resolves to a terminal/known state via query-by-clientOrderId.
  UNKNOWN_RECONCILING: ['ACCEPTED', 'FILLED', 'PARTIALLY_FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'],
};

export const ORDER_TERMINAL_STATES: readonly OrderState[] = [
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
];

export function canTransitionOrder(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isOrderTerminal(state: OrderState): boolean {
  return ORDER_TERMINAL_STATES.includes(state);
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly to: string,
    kind: string,
  ) {
    super(`Illegal ${kind} transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

/** Assert & perform an order transition; throws on illegal moves. */
export function transitionOrder(from: OrderState, to: OrderState): OrderState {
  if (!canTransitionOrder(from, to)) throw new IllegalTransitionError(from, to, 'order');
  return to;
}
