import { describe, it, expect } from 'vitest';
import {
  canTransitionOrder,
  transitionOrder,
  isOrderTerminal,
  canTransitionSignal,
  transitionSignal,
  confirmAndSubmit,
  IllegalTransitionError,
} from '../index';

describe('order state machine', () => {
  it('allows the happy path DRAFT->...->FILLED', () => {
    let s = transitionOrder('DRAFT', 'VALIDATING');
    s = transitionOrder(s, 'READY');
    s = transitionOrder(s, 'SUBMITTING');
    s = transitionOrder(s, 'ACCEPTED');
    s = transitionOrder(s, 'PARTIALLY_FILLED');
    s = transitionOrder(s, 'FILLED');
    expect(s).toBe('FILLED');
    expect(isOrderTerminal(s)).toBe(true);
  });

  it('routes ambiguous submit to UNKNOWN_RECONCILING (never blind resubmit)', () => {
    expect(canTransitionOrder('SUBMITTING', 'UNKNOWN_RECONCILING')).toBe(true);
    // From reconciling we can only resolve to a known state, not re-submit.
    expect(canTransitionOrder('UNKNOWN_RECONCILING', 'SUBMITTING')).toBe(false);
    expect(canTransitionOrder('UNKNOWN_RECONCILING', 'FILLED')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(() => transitionOrder('FILLED', 'ACCEPTED')).toThrow(IllegalTransitionError);
    expect(() => transitionOrder('DRAFT', 'FILLED')).toThrow();
  });

  it('terminal states have no outgoing transitions', () => {
    for (const t of ['FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'] as const) {
      expect(isOrderTerminal(t)).toBe(true);
    }
  });
});

describe('signal state machine + confirmation gate', () => {
  it('approving a signal does NOT submit an order', () => {
    let s = transitionSignal('PROPOSED', 'APPROVED');
    s = transitionSignal(s, 'ORDER_DRAFT_CREATED');
    s = transitionSignal(s, 'RISK_CHECKED');
    s = transitionSignal(s, 'CONFIRMATION_REQUIRED');
    expect(s).toBe('CONFIRMATION_REQUIRED');
  });

  it('transitionSignal refuses to reach SIMULATED_SUBMITTED (must use confirmAndSubmit)', () => {
    expect(() => transitionSignal('CONFIRMATION_REQUIRED', 'SIMULATED_SUBMITTED')).toThrow();
  });

  it('confirmAndSubmit requires explicit user confirmation token (AI cannot bypass)', () => {
    expect(() => confirmAndSubmit('CONFIRMATION_REQUIRED', { userConfirmed: false })).toThrow();
    expect(() =>
      confirmAndSubmit('CONFIRMATION_REQUIRED', { userConfirmed: true }),
    ).toThrow(); // missing token
    expect(
      confirmAndSubmit('CONFIRMATION_REQUIRED', { userConfirmed: true, token: 'user-tok-1' }),
    ).toBe('SIMULATED_SUBMITTED');
  });

  it('cannot submit from a non-gate state even with a token', () => {
    expect(() =>
      confirmAndSubmit('APPROVED', { userConfirmed: true, token: 'x' }),
    ).toThrow(IllegalTransitionError);
  });

  it('supports user editing loop before approval', () => {
    let s = transitionSignal('PROPOSED', 'USER_EDITED');
    s = transitionSignal(s, 'USER_EDITED');
    s = transitionSignal(s, 'APPROVED');
    expect(s).toBe('APPROVED');
    expect(canTransitionSignal('APPROVED', 'ORDER_DRAFT_CREATED')).toBe(true);
  });
});
