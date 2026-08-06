# PHASE 7 — Incident Response Runbook

On-call runbook referenced by the 21 CloudWatch alarm descriptions in
`infrastructure/terraform/phase7/alerting.tf` (`local.runbook_base`). Each alarm links to the matching
section anchor below. Section headings are the alarm anchor tokens verbatim so the `#anchor` links
resolve; `apps/api/src/__tests__/runbook-links.test.ts` fails the build if any alarm points at a missing
file or anchor.

Global safety context (unchanged by any procedure here): `TRADING_MODE=MOCK`,
`FEATURE_LIVE_ORDERS_ENABLED=false`, emergency kill switch defaults ACTIVE. **No procedure here enables
live trading, relaxes a kill switch, or calls a live BitMart/OpenAI/AWS-mutating API on its own
authority.** Live-order re-enable is a separate owner-authorized change (`docs/PHASE3-12-OPERATIONS-RUNBOOK.md`).

Severity: **P1** page immediately, **P2** notify on-call, **P3** ticket.

---

## api-5xx

**API 5xx responses elevated** (P1). Symptom: spike of 500/503 on `/api/*`. Immediate: check ECS service
health + target-group healthy count; `/health/ready` on a task; if a bad deploy, the ECS deployment
circuit-breaker rollback is enabled. Diagnose: `/qt/api` logs by the 5xx envelope correlationId; check
`db-pool`/`redis` for a shared cause. Recover: roll back to the previous task definition; scale out on
saturation. Escalate: service owner if not cleared in 15 min.

## auth-failures

**Authentication failures elevated — possible credential stuffing** (P1). Symptom: 401 spike on
`/api/auth/login`. Immediate: confirm `LoginRateLimiter` + per-IP throttle engaged (429 + Retry-After).
Diagnose: group by IP/account; one compromised account vs broad spray; check `mfa-lockout`. Recover:
block offending ranges at the WAF/SG edge; targeted resets. Do NOT disable MFA. Escalate: security
on-call if a success follows many failures on one account.

## mfa-lockout

**MFA lockouts elevated** (P2). Symptom: users locked after failed TOTP. Lockout state is persisted in
`account_lockouts` — a containment control, not a bug. Diagnose:
`SELECT count(*),source FROM account_lockouts WHERE locked_until>now GROUP BY source`. Recover: admin
`POST /admin/users/:id/unlock` (step-up + CSRF + audit; self-unlock refused); never bulk-clear without a
cause. Escalate: security if correlated with `auth-failures`.

## db-pool

**Database connection pool exhausted** (P1). Symptom: requests time out acquiring a connection.
Immediate: RDS active connections vs `max_connections`; look for a stuck migration or long transaction.
Diagnose: `pg_stat_activity` long-runners; app pool vs instance class. Recover: terminate stuck
sessions; raise pool ceiling or scale. Escalate: DBA; cross-check `rds-cpu`/`rds-storage`.

## redis

**Cache connection failures** (P2). Symptom: ElastiCache connect/auth errors. Immediate: confirm safe
degradation — cache is not the source of truth; sessions and rate limits fail closed. Diagnose: node
status, TLS/auth-token validity, SG reachability. Recover: fail over to replica; rotate auth token if
expired. Escalate: platform; cross-check `redis-memory`.

## ws-reconnect

**WebSocket reconnect storm** (P2). Symptom: clients reconnecting in a tight loop. Immediate: gateway
task health + fan-out backpressure (`queue-depth`). Diagnose: upstream feed drop vs gateway restart
(`restart-loop`). Recover: stabilise gateway (admin gateway resync/reconnect on the LOCAL mock control);
clients back off automatically. Escalate: gateway owner if not settled in 10 min.

## market-data-stale

**Market data stale** (P1 for trading UX). Symptom: aged `asOf`; `stale:true` provenance. Immediate:
read models already report `stale:true` rather than serving silent stale numbers — confirm the UI stale
badge. Diagnose: upstream provider health; gateway last-message timestamp. Recover: resync gateway; if
the provider is down the AI copilot fails closed (no price → no analysis). Escalate: data provider owner.

## reconciliation

**REST/WS reconciliation mismatch** (P1). Symptom: REST snapshot vs WS-derived state diverge. Immediate:
data-integrity signal; live orders are disabled so exposure is limited to the read model — freeze
operator actions assuming position state. Diagnose: `reconciliation_runs` detail; affected symbols/users.
Recover: force a reconciliation run; correct the drifted source once root cause is known. Escalate:
trading systems owner immediately.

## exchange-auth

**Exchange authentication failure — key or IP allowlist** (P1). Symptom: BitMart auth rejections from the
fixed egress IP. Immediate: confirm the NAT fixed EIP is unchanged and still on the BitMart allowlist
(out-of-band). Live orders unaffected (disabled); read-only probes will fail. Diagnose: Secrets Manager
credential current + read-only scoped. Recover: re-register the egress IP; rotate the key if compromised.
Escalate: exchange-integration owner.

## ai-provider

**AI provider errors elevated** (P2). Symptom: provider 5xx/timeout. Immediate: copilot fails closed to a
safe fallback, never auto-executes an order, never silently swaps to a live provider. Diagnose: provider
status; token/timeout limits; `ai_runs` error class (no prompt/response bodies stored). Recover: back off;
AI features report unavailable. Escalate: AI platform owner; cross-check `ai-budget`.

## ai-budget

**AI cost budget exceeded** (P2). Symptom: daily cost/token ceiling hit. Immediate: per-user daily budget
caps spend; new AI requests refused with a budget error, not billed. Diagnose: `ai_usage_records` spike;
runaway vs legitimate growth. Recover: raise the budget deliberately if legitimate; else investigate the
caller. Escalate: AI platform + finance if sustained.

## queue-depth

**Fan-out queue depth growing** (P2). Symptom: market-data fan-out backlog rising. Immediate: consumer
health + backpressure; confirm no reconnect storm (`ws-reconnect`). Diagnose: producer vs consumer rate;
slow/stalled worker. Recover: scale consumers; restart a stalled worker; shed bounded load. Escalate:
gateway owner if depth keeps growing after scaling.

## restart-loop

**Container restart loop** (P1). Symptom: a task crash-looping. Immediate: check the fail-closed startup
guards — production refuses to start without signing keys / Secrets Manager config, which is a legitimate
hard stop, not a loop to paper over. Diagnose: last task logs before exit; config/secret error vs code
crash. Recover: fix the missing config/secret; roll back a bad image via the circuit breaker. Escalate:
service owner; do NOT loosen the startup guard to stop the loop.

## kill-switch

**Kill switch state changed — always paged** (P1). Symptom: any change of a trading kill switch.
Immediate: confirm WHO and WHY via the admin audit trail (`admin_actions`; step-up required). If
unauthorized, treat as a security incident. Diagnose: the kill switch defaults ACTIVE (blocked); a change
to allow must be deliberate and owner-authorized. Recover: if unauthorized/accidental, re-assert ACTIVE
immediately. Escalate: trading owner + security; never auto-resolve without human confirmation.

## live-trading-flag

**Live-trading flag changed — always paged** (P1). Symptom: change to `FEATURE_LIVE_ORDERS_ENABLED` /
`BITMART_LIVE_TRADING_ENABLED`. Immediate: confirm it was part of an approved controlled-live-order
procedure (`docs/PHASE3-12-OPERATIONS-RUNBOOK.md`); if not, revert to disabled at once. Diagnose: audit
trail + release gate; the flag must be false outside an authorized window. Recover: set false; verify
orders remain blocked. Escalate: trading owner + security immediately.

## admin-role-change

**Admin role changed** (P2). Symptom: a user's admin role modified. Immediate: confirm actor and target
from the audit trail (step-up + audited; actor≠target enforced). Diagnose: approved
provisioning/deprovisioning? Recover: revert an unauthorized change; revoke the actor's session if
compromised. Escalate: security for any unexplained privilege escalation.

## secret-rotation

**Secret rotation failed** (P2). Symptom: a Secrets Manager rotation did not complete. Immediate: the
previous secret version remains valid — no immediate outage; do not delete the old version. Diagnose:
rotation logs; KMS permissions; secret format. Recover: re-run rotation once fixed; verify the app picks
up the new version. Escalate: platform + security owner.

## release-gate

**Release gate state changed** (P2). Symptom: a production release gate flipped. Immediate: confirm it is
intentional; gates default `NOT_EXECUTED` and must never be auto-passed. Diagnose: `release_gates` + audit
trail; which gate and by whom. Recover: if marked passed without evidence, revert and investigate.
Escalate: release manager.

## rds-cpu

**RDS CPU high** (P2). Symptom: sustained high database CPU. Immediate: check for a query storm or a
missing-index regression; correlate with `db-pool`. Diagnose: `pg_stat_statements` top consumers; recent
deploy changing query patterns. Recover: add/repair indexes; scale the instance class if at capacity.
Escalate: DBA on-call.

## rds-storage

**RDS free storage low** (P1 if trending to zero). Symptom: free storage below threshold. Immediate:
confirm autoscaling headroom; identify runaway growth (logs, bloat, WAL). Diagnose: largest
tables/indexes; vacuum/bloat; backup retention. Recover: vacuum to reclaim; extend allocated storage
(online). Escalate: DBA before free space reaches zero.

## redis-memory

**Redis memory high** (P2). Symptom: ElastiCache memory near maxmemory. Immediate: confirm eviction
policy; cache is not the source of truth so eviction is survivable. Diagnose: key growth, TTL coverage, a
hot namespace without expiry. Recover: ensure TTLs; scale the node if the working set exceeds memory.
Escalate: platform; cross-check `redis`.
