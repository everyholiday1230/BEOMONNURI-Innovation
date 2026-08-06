# 08 — Signal & Order State Machines

Implemented and unit-tested in `packages/domain`. Illegal transitions throw; every transition is
recorded as an event (audit).

## Signal state machine
```
DRAFT → ANALYZING → PROPOSED → USER_EDITED → APPROVED → ORDER_DRAFT_CREATED
      → RISK_CHECKED → CONFIRMATION_REQUIRED → SIMULATED_SUBMITTED
      → FILLED | CANCELLED | REJECTED
```
Rules:
- `PROPOSED → USER_EDITED` is optional (user may approve as-is).
- **`APPROVED` does NOT submit an order.** It only permits creating an OrderDraft.
- `CONFIRMATION_REQUIRED → SIMULATED_SUBMITTED` requires an explicit user confirmation token.
- Terminal: `FILLED, CANCELLED, REJECTED`.

## The mandatory human gate (enforced in code)
```
AI Signal → User Review → Approve Signal → Create Order Draft → Order Preview
          → Risk Check → Final User Confirmation → Simulation Submit
```
AI is structurally prevented from: submitting real orders, changing leverage autonomously,
changing API permissions, withdrawing, reading API keys, or bypassing final confirmation.

## Order state machine (12 states)
```
DRAFT → VALIDATING → READY → SUBMITTING → ACCEPTED
      → PARTIALLY_FILLED → FILLED
      → CANCEL_PENDING → CANCELLED
      → REJECTED
      → EXPIRED
      → UNKNOWN_RECONCILING
```
- `SUBMITTING` failure with unknown outcome → `UNKNOWN_RECONCILING` (never blind resubmit).
- Recovery from `UNKNOWN_RECONCILING`: query-by-`clientOrderId` → reconcile → terminal state.
- `ACCEPTED → PARTIALLY_FILLED*` (repeatable) → `FILLED`.
- Cancel path: `ACCEPTED|PARTIALLY_FILLED → CANCEL_PENDING → CANCELLED`.
- Idempotency: `clientOrderId` dedups double-submit; duplicate confirm is a no-op returning
  the existing order.

## Idempotency & reconciliation
- Client generates `clientOrderId` (UUID) once per draft; retries reuse it.
- Server stores `(user_id, client_order_id)` unique; on retry returns existing order.
- Reconciliation queries by `clientOrderId`, never resends on ambiguous state.
