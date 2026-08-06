/**
 * Phase 3 server-authoritative LIVE order state machine (docs PHASE3-03). 17 states, including the
 * critical SUBMIT_UNKNOWN (ambiguous submit → must reconcile, never blind-resubmit), RECONCILING,
 * and INCONSISTENT (surfaced, never hidden).
 */
export const LIVE_ORDER_STATES = [
  'DRAFT',
  'VALIDATING',
  'RISK_REJECTED',
  'READY',
  'AWAITING_USER_CONFIRMATION',
  'SUBMITTING',
  'SUBMIT_UNKNOWN',
  'ACCEPTED',
  'OPEN',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCEL_PENDING',
  'CANCELED',
  'REJECTED',
  'EXPIRED',
  'RECONCILING',
  'INCONSISTENT',
] as const;
export type LiveOrderState = (typeof LIVE_ORDER_STATES)[number];

const T: Record<LiveOrderState, LiveOrderState[]> = {
  DRAFT: ['VALIDATING'],
  VALIDATING: ['RISK_REJECTED', 'READY'],
  RISK_REJECTED: [],
  READY: ['AWAITING_USER_CONFIRMATION', 'RISK_REJECTED', 'EXPIRED'],
  AWAITING_USER_CONFIRMATION: ['SUBMITTING', 'EXPIRED'],
  SUBMITTING: ['ACCEPTED', 'REJECTED', 'SUBMIT_UNKNOWN'],
  SUBMIT_UNKNOWN: ['RECONCILING'],
  ACCEPTED: ['OPEN', 'REJECTED', 'CANCELED', 'RECONCILING'],
  OPEN: ['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELED', 'EXPIRED', 'RECONCILING'],
  PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELED', 'RECONCILING'],
  FILLED: [],
  CANCEL_PENDING: ['CANCELED', 'FILLED', 'PARTIALLY_FILLED', 'RECONCILING'],
  CANCELED: [],
  REJECTED: [],
  EXPIRED: [],
  RECONCILING: ['ACCEPTED', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'INCONSISTENT'],
  INCONSISTENT: ['RECONCILING'],
};

export function canTransitionLiveOrder(from: LiveOrderState, to: LiveOrderState): boolean {
  return T[from]?.includes(to) ?? false;
}

export function transitionLiveOrder(from: LiveOrderState, to: LiveOrderState): LiveOrderState {
  if (!canTransitionLiveOrder(from, to)) {
    throw new Error(`illegal live-order transition ${from} -> ${to}`);
  }
  return to;
}

const TERMINAL = new Set<LiveOrderState>(['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'RISK_REJECTED']);
export function isTerminalLiveOrder(s: LiveOrderState): boolean {
  return TERMINAL.has(s);
}

/** SUBMIT_UNKNOWN and INCONSISTENT require reconciliation before any further action. */
export function requiresReconciliation(s: LiveOrderState): boolean {
  return s === 'SUBMIT_UNKNOWN' || s === 'INCONSISTENT';
}
