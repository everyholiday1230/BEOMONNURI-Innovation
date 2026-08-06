# PHASE 6-06 — Alerting & Incident

Implemented in `@quantumtrade/observability` (`AlertManager`, `defaultAlertRules`, `MockNotifier`);
verified within the observability + chaos suites.

## Rule engine
Each rule has: id, description, `severity` (critical/warning/info), `runbook` (→ this doc anchor),
`owner`, and a `condition(ctx)`. The manager supports **dedup** (suppress repeat firing within a window),
**silence** (per-rule until timestamp), and **recovery** notifications (fires `recovered` when the
condition clears). The notifier is an injectable adapter.

## Default alert rules (conditions)
`api_error_rate` (>5%), `api_latency_p95` (>1s), `db_pool_exhausted`, `redis_down`,
`bitmart_ws_reconnects` (>10/min), `stale_market_data`, `dropped_messages` (>100/min),
`reconciliation_mismatch`, `submit_unknown`, `openai_errors` (>10%), `cost_budget`,
`login_attack` (>50/min), `mfa_attack` (>20/min), `admin_role_change`, `kill_switch_change`,
`secret_read_failure`, `backup_failure` — covering every condition required by §6, each with an owner
and a runbook reference.

## Verified
- Fire → dedup within window → recovery on clear (observability test).
- Silence suppresses firing (observability test).
- Outage context fires the right critical rules: redis_down, db_pool_exhausted, submit_unknown,
  reconciliation_mismatch (chaos test).

## Not Executed
Real PagerDuty / Slack / email delivery → **Not Executed** (no channel credentials). Only the adapter +
`MockNotifier` are exercised; wiring a live `Notifier` is a deployment step (Production Release Gate).
