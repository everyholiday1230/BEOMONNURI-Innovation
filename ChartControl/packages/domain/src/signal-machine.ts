import type { SignalState } from '@quantumtrade/schemas';
import { IllegalTransitionError } from './order-machine';

/** Legal transitions for the signal machine (docs/08). */
const SIGNAL_TRANSITIONS: Record<SignalState, readonly SignalState[]> = {
  DRAFT: ['ANALYZING'],
  ANALYZING: ['PROPOSED', 'REJECTED'],
  PROPOSED: ['USER_EDITED', 'APPROVED', 'REJECTED'],
  USER_EDITED: ['USER_EDITED', 'APPROVED', 'REJECTED'],
  // APPROVED permits creating an order draft; it does NOT submit an order.
  APPROVED: ['ORDER_DRAFT_CREATED', 'REJECTED'],
  ORDER_DRAFT_CREATED: ['RISK_CHECKED', 'REJECTED'],
  RISK_CHECKED: ['CONFIRMATION_REQUIRED', 'REJECTED'],
  // Only an explicit user confirmation advances past this gate.
  CONFIRMATION_REQUIRED: ['SIMULATED_SUBMITTED', 'REJECTED', 'CANCELLED'],
  SIMULATED_SUBMITTED: ['FILLED', 'CANCELLED', 'REJECTED'],
  FILLED: [],
  CANCELLED: [],
  REJECTED: [],
};

export const SIGNAL_TERMINAL_STATES: readonly SignalState[] = ['FILLED', 'CANCELLED', 'REJECTED'];

export function canTransitionSignal(from: SignalState, to: SignalState): boolean {
  return SIGNAL_TRANSITIONS[from].includes(to);
}

/**
 * The confirmation gate. Advancing from CONFIRMATION_REQUIRED to SIMULATED_SUBMITTED requires an
 * explicit user confirmation token. AI/system callers cannot provide it. See ADR-0004.
 */
export function confirmAndSubmit(
  from: SignalState,
  confirmation: { userConfirmed: boolean; token?: string },
): SignalState {
  if (from !== 'CONFIRMATION_REQUIRED') {
    throw new IllegalTransitionError(from, 'SIMULATED_SUBMITTED', 'signal');
  }
  if (!confirmation.userConfirmed || !confirmation.token) {
    throw new Error('Explicit user confirmation token required to submit (AI cannot bypass).');
  }
  return 'SIMULATED_SUBMITTED';
}

export function transitionSignal(from: SignalState, to: SignalState): SignalState {
  // Guard: never allow reaching SIMULATED_SUBMITTED via the plain transition function.
  if (to === 'SIMULATED_SUBMITTED') {
    throw new Error('Use confirmAndSubmit() with a user confirmation token to submit.');
  }
  if (!canTransitionSignal(from, to)) throw new IllegalTransitionError(from, to, 'signal');
  return to;
}
