# PHASE 6-02 — Multinode State Propagation

Package: `@quantumtrade/cluster` (10 tests incl. a REAL Redis integration, `pnpm test:cluster`).

## Design
A versioned key/value shared store (`SharedStateStore`) with optimistic concurrency (CAS) and a pub/sub
invalidation channel, so API / WS / Admin instances converge. Providers: `RedisSharedState`
(atomic CAS + PUBLISH via a Lua script over a zero-dependency RESP client) and `InMemorySharedState`
(single-node/tests). Cross-node events are de-duplicated (`EventDeduper`).

## Shared-state scopes
Session, rate limit, kill switch, feature flag, AI circuit breaker, trading policy, WS subscription,
revoked credential, incident state, release gate — all modeled as versioned keys with pub/sub invalidation.

## Verified against REAL Redis (`127.0.0.1:16379`)
- Versioned CAS visible across two independent connections; stale-version write rejected.
- Pub/sub invalidation propagates node→node; **measured propagation latency ≈ 1 ms** (`< 1000 ms` assert).
- Fail-closed: when the store throws (Redis outage), live-trading kill-switch scopes
  (`global_live_trading`, `bitmart_live_trading`, `new_positions`) default to **BLOCKED (active)**;
  non-live scopes default open. `degraded` flag surfaced for alerting.
- State restored after restart (same store) — reader observes persisted kill-switch.

## Distributed lock scope
Explicitly bounded: CAS covers concurrent config edits (flags/gates/kill-switches). A distributed lock is
only required for exactly-once side-effecting jobs (e.g. a singleton reconciliation sweep or migration
runner); documented as a deployment concern, not implemented in this pass.

## Not Executed
- Multi-HOST cluster (this run uses two connections to one Redis) and rolling-deploy consistency under
  real traffic → **Documented / Not Executed** (no multi-host orchestrator here).
- Redis Sentinel/Cluster failover → **Not Executed**.
