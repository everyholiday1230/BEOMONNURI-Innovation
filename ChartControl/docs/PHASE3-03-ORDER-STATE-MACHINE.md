# PHASE 3 — Order State Machine (17 states)

`packages/domain/live-order-machine.ts`. States: DRAFT, VALIDATING, RISK_REJECTED, READY,
AWAITING_USER_CONFIRMATION, SUBMITTING, SUBMIT_UNKNOWN, ACCEPTED, OPEN, PARTIALLY_FILLED, FILLED,
CANCEL_PENDING, CANCELED, REJECTED, EXPIRED, RECONCILING, INCONSISTENT.

- Server-authoritative; illegal transitions throw.
- **SUBMIT_UNKNOWN** on REST timeout / ambiguous submit → must go SUBMIT_UNKNOWN → RECONCILING; never
  blind-resubmit. Reconcile by `client_order_id` resolves to a real state or INCONSISTENT (surfaced).
- Terminal: FILLED, CANCELED, REJECTED, EXPIRED, RISK_REJECTED. INCONSISTENT → RECONCILING.
- Tested: happy path, SUBMIT_UNKNOWN path, illegal transitions, terminals (live-order-machine.test.ts).
