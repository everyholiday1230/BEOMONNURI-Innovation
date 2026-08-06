# PHASE 6-10 — Chaos / Fault Injection

Package: `@quantumtrade/chaos` (11 tests, `pnpm test:chaos`). Faults are reproduced via mocks/proxies —
**never against real production services**.

## Executed (mock/proxy-driven)
| Scenario | Asserted safe behavior |
|---|---|
| Redis disconnect | live-trading kill switch **fails CLOSED** (blocked); `degraded` surfaced |
| State restart recovery | persisted kill-switch restored; invalidation re-propagates |
| BitMart WS repeated disconnect | circuit breaker **opens**, shields upstream, half-opens after cooldown |
| BitMart REST 429/5xx | circuit breaker + bounded jittered reconnect backoff |
| Malformed message | rejected without crashing the pipeline |
| Duplicate / out-of-order / stale | `SequenceTracker` classifies; gap → REST gap-fill |
| Order book gap | `resync_required` (no state corruption) |
| Cross-node duplicate events | `EventDeduper` suppresses |
| Kill-switch propagation | pub/sub delivers to subscriber |
| Slow consumer | isolated; healthy consumer unaffected |
| Alerting under fault | critical alerts fire (redis/db-pool/submit-unknown/reconciliation) |

## Not Executed (real infra faults — recorded, not simulated)
API/WS instance kill + rolling restart under live traffic, real PostgreSQL/Redis process restart, real
BitMart timeouts, OpenAI live faults, Secret Manager / KMS failure, DNS failure, network partition,
disk-full, clock drift, real queue backlog, real backup/restore failure injection → **Not Executed**
(no production-like multi-host chaos harness). Browser offline/resume is covered by the E2E suites.
