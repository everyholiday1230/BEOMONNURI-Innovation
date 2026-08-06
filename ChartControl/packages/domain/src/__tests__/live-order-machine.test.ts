import { describe, it, expect } from 'vitest';
import {
  LIVE_ORDER_STATES,
  canTransitionLiveOrder,
  transitionLiveOrder,
  isTerminalLiveOrder,
  requiresReconciliation,
} from '../live-order-machine';

describe('live order machine (17 states)', () => {
  it('has exactly 17 states incl SUBMIT_UNKNOWN/RECONCILING/INCONSISTENT', () => {
    expect(LIVE_ORDER_STATES.length).toBe(17);
    for (const s of ['SUBMIT_UNKNOWN', 'RECONCILING', 'INCONSISTENT']) expect(LIVE_ORDER_STATES).toContain(s);
  });

  it('happy path DRAFT→…→FILLED is legal', () => {
    let s = transitionLiveOrder('DRAFT', 'VALIDATING');
    s = transitionLiveOrder(s, 'READY');
    s = transitionLiveOrder(s, 'AWAITING_USER_CONFIRMATION');
    s = transitionLiveOrder(s, 'SUBMITTING');
    s = transitionLiveOrder(s, 'ACCEPTED');
    s = transitionLiveOrder(s, 'OPEN');
    s = transitionLiveOrder(s, 'PARTIALLY_FILLED');
    s = transitionLiveOrder(s, 'FILLED');
    expect(s).toBe('FILLED');
  });

  it('SUBMIT_UNKNOWN must go through RECONCILING (never blind resubmit)', () => {
    expect(canTransitionLiveOrder('SUBMITTING', 'SUBMIT_UNKNOWN')).toBe(true);
    expect(canTransitionLiveOrder('SUBMIT_UNKNOWN', 'RECONCILING')).toBe(true);
    expect(canTransitionLiveOrder('SUBMIT_UNKNOWN', 'SUBMITTING')).toBe(false);
    expect(requiresReconciliation('SUBMIT_UNKNOWN')).toBe(true);
    // reconcile resolves to a real state
    expect(canTransitionLiveOrder('RECONCILING', 'FILLED')).toBe(true);
    expect(canTransitionLiveOrder('RECONCILING', 'INCONSISTENT')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(() => transitionLiveOrder('FILLED', 'OPEN')).toThrow(/illegal/);
    expect(canTransitionLiveOrder('DRAFT', 'FILLED')).toBe(false);
  });

  it('terminal states have no exits', () => {
    for (const s of ['FILLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'RISK_REJECTED'] as const) {
      expect(isTerminalLiveOrder(s)).toBe(true);
    }
  });

  it('INCONSISTENT is surfaced and can re-reconcile', () => {
    expect(requiresReconciliation('INCONSISTENT')).toBe(true);
    expect(canTransitionLiveOrder('INCONSISTENT', 'RECONCILING')).toBe(true);
  });
});
