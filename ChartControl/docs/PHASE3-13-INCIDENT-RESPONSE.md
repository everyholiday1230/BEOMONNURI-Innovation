# PHASE 3 — Incident Response

## Immediate containment
1. Set `BITMART_EMERGENCY_KILL_SWITCH=true` (or admin kill switch global) → blocks all new live orders.
2. If credential compromise suspected: revoke credential (`DELETE /api/trading/credentials/:id`),
   rotate KEK, revoke BitMart API key at the exchange.

## Ambiguous submit / SUBMIT_UNKNOWN
- NEVER resubmit. Query by `client_order_id`; run reconciliation. If unresolved → mark INCONSISTENT
  and escalate; compare `orders` + `executions` vs BitMart.

## Data mismatch (INCONSISTENT)
- Do not hide. Surface state; run manual reconciliation; if exchange shows a fill we lack, ingest via
  REST snapshot; if we show an order the exchange lacks, mark REJECTED after confirmation.

## Rate limit / IP block (429/418)
- Back off (exponential + jitter), honor Retry-After, open circuit breaker. Verify IP whitelist.

## Secrets
- Never log secret/memo/CSRF/reset tokens. If a leak is suspected, rotate immediately and audit
  `audit_logs` for access. Access keys are only ever stored masked + encrypted.

## Postmortem
- Capture correlation/trace IDs, `order_events`, `reconciliation_runs`, `audit_logs`; record remaining risk.
