# PHASE 3 — Mock / Real Matrix

Labels: FI=Fully implemented · RO=Executed vs BitMart Production Read-Only · SH=Shadow tested ·
CL=Controlled Live executed · UT=Unit-tested only · IT=Integration-tested only · NE=Not Executed ·
DOC=Documented only · KI=Known issue · PB=Production blocked.

| Capability | Status |
|---|---|
| BitMart HMAC-SHA256 signature + X-BM headers + test vector | FI, UT |
| Query/body deterministic serialization, timestamp drift | FI, UT |
| Mode separation READ_ONLY/SHADOW/TRADE + server live gate | FI, UT |
| Futures REST adapter (assets/positions/orders/submit/cancel/modify) | FI, IT (mock HTTP) |
| BitMart Production Read-Only real connection | NE (no API key) |
| Deployment env (egress IP, prod REST/WS URL, TLS, server-time drift, safe defaults, redaction) | RO-env verified credential-free (phase3-stageA-env.log); auth items NE |
| Order state machine (17 states, SUBMIT_UNKNOWN) | FI, UT |
| Idempotency (client_order_id, key, race) | FI, UT/IT (+ PG unique) |
| Server Risk Engine (base + policy + live gate) | FI, UT |
| Credential vault (envelope enc, rotation, masking, no plaintext/return) | FI, UT |
| Cross-user credential/data isolation | FI, IT |
| Private WS event dedup / out-of-order | FI, UT |
| Private WS live auth/heartbeat/reconnect | DOC + mock; NE (real) |
| Production private WS URL allowlist + demo-reject (fail-closed) + `BitMartPrivateStreamAdapter` | FI, UT (ws-config.test.ts) |
| Runtime credential source (AWS Secrets Manager via IAM role, fail-closed) | FI, UT (credential-source.test.ts); live fetch NE (no SDK/ARN in runtime) |
| Stage A Production Read-Only (authenticated) | NE / fail-closed (managed credential source not connected) |
| Reconciliation (timeout→query, mismatch→INCONSISTENT) | FI, IT (mock) |
| DB migration 0003 (SQLite + Postgres up/down) | FI; PG IT (real) |
| Trading routes (credentials/verify/status/submit-shadow) + auth/CSRF/RBAC/idempotency | FI, IT |
| Shadow order flow (build/validate, never transmit) | FI, SH (IT) |
| Controlled Live Order | NE / PB (not approved) |
| Kill switch (env + admin table) | FI (env), DOC (admin actions) |
| Withdraw / transfer / margin loan | intentionally ABSENT (forbidden) |
| Rate limit: central config + token bucket (apiKey/ip/uid) + backoff+jitter + Retry-After + circuit breaker | FI, UT (rate-limit.test.ts); breaker wired into adapter (IT) |
| Rate limit: distributed priority queue / Redis coalescing | DOC only (single-node; KI) |
