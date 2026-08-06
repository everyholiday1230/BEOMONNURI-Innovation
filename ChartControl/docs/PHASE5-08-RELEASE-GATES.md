# PHASE 5 — Release Gate Management

`docs/PRODUCTION-RELEASE-GATE.md` content is structured into the `release_gates` table (queryable via
`/api/admin/release-gates`). Each gate: gate id/key, phase, description, owner, exit criteria, status,
production_required, evidence (`release_gate_evidence`), reason, approvedBy, expiresAt, version, updatedAt.

## Statuses
NOT_STARTED, NOT_EXECUTED, IN_PROGRESS, PASSED, FAILED, WAIVED, BLOCKED.

## Guards (`evaluateReleaseGateUpdate`, unit-tested)
- **No fake pass**: a gate cannot move to PASSED without evidence.
- Only ADMIN/SUPER_ADMIN may update; only **SUPER_ADMIN** may WAIVE.
- WAIVED requires a reason + a **future** expiry; a **production-required** gate's waiver cannot exceed
  30 days (no permanent single-approver waiver).
- Pending items are seeded as **NOT_EXECUTED** and are never auto-Passed.

## Seeded pending gates (stay NOT_EXECUTED)
bitmart-stage-a, bitmart-private-ws-soak, controlled-live-order, live-openai, live-model-eval,
live-ai-e2e, firefox-webkit-e2e, load-1k-10k, central-market-data-gateway, backup-restore-pitr, mfa.
These are owned by the AWS admin / operator and verified separately in a Live Validation pass — Phase 5
does not change any of them to Passed.
