# PHASE 3 — Forced Failure Scenarios (§20)

All 24 required scenarios. Each row: **Reproduction method · Expected · Actual · Result · Evidence · Remaining risk**.
Result legend: **Pass** (reproduced + verified) · **Not Executed** (needs real credentials/infra) · **Documented** (design verified, not executed as an automated test).

Raw test evidence: `artifacts/logs/phase3-test.log`, `artifacts/logs/phase3-integration.log`, `artifacts/logs/phase3-postgres.log`.

| # | Scenario | Reproduction method | Expected | Actual | Result | Evidence | Remaining risk |
|---|---|---|---|---|---|---|---|
| 1 | REST timeout **before** submit | mock fetch hangs on `submit-order`, adapter `timeoutMs=30` | SUBMIT_UNKNOWN → RECONCILING → query by client_order_id → not found → REJECTED; **no resubmit** | exactly 1 submit call; state REJECTED | Pass | trading-integration.test.ts | timeout window tuning vs real latency |
| 2 | REST timeout **after** possible submit | mock hangs on submit; reconcile query returns FILLED | reconcile → FILLED (order was actually placed) | state FILLED, exchangeOrderId set | Pass | trading-integration.test.ts | depends on exchange returning order by client_order_id |
| 3 | HTTP 429 | mock returns 429 on submit | ambiguous → SUBMIT_UNKNOWN → reconcile; breaker.onFailure | reconcile → OPEN | Pass | trading-integration.test.ts, rate-limit.test.ts | real Retry-After header contents |
| 4 | HTTP 418 (IP block) | adapter `handle()` maps 418 → rate_limited_418; breaker trips | ambiguous (never "failed"); circuit opens after threshold | 418 → HttpError; breaker open→fail-fast | Pass | rate-limit.test.ts, futures-rest-adapter.ts | real 418 only observable against production |
| 5 | BitMart 5xx | mock returns 500 on submit ×3 with breaker | SUBMIT_UNKNOWN each; breaker opens; next submit fails fast w/o network | 3× SUBMIT_UNKNOWN, breaker open, no 4th network call | Pass | trading-integration.test.ts (§15) | — |
| 6 | Invalid signature | signature test vectors + wrong-secret produces different HMAC | deterministic signing string; invalid sig rejected by server | vector match; mismatch detectable | Pass (vector) / Not Executed (real reject) | bitmart.test.ts | real server rejection unverified (no key) |
| 7 | Expired timestamp | `timestampDriftMs` + `driftAcceptable` (±5s) | drift beyond tolerance → re-sync before signing | drift computed; out-of-window flagged | Pass (unit) / Not Executed (real reject) | bitmart.test.ts | real server clock window |
| 8 | Invalid API key | verify route decrypts + read-only probe; probe throws → FAILED | connection_status=FAILED, reason surfaced, no secret leak | mock throw → FAILED | Pass (mock) / Not Executed (real) | trading-routes.test.ts | real key rejection unverified |
| 9 | IP not whitelisted | documented: production probe returns auth error → FAILED + guidance | surfaced as connection failure w/ remediation text | design verified | Documented / Not Executed | PHASE3-01, PHASE3-07 | real whitelist behavior |
| 10 | Missing Future-Trade permission | live gate `futureTradePermissionVerified=false` | live gate blocks; order never transmitted | liveGate.allowed=false | Pass | trading-core.test.ts, modes.ts | real permission introspection endpoint |
| 11 | Private WS disconnect | mock stream disconnect; reconnect/backoff design | reconnect w/ exp backoff+jitter; REST gap-fill | dedup + reconnect design; mock only | Documented / Not Executed (real) | private-ws-adapter.ts, rate-limit.test.ts | real WS session lifecycle |
| 12 | Private WS auth failure | documented: auth-fail surfaced, no silent retry storm | surfaced; capped reconnect | design verified | Documented / Not Executed | PHASE3-05 | real WS auth |
| 13 | Duplicate order event | apply same dedupId twice | 2nd dropped | 2nd returns false | Pass | trading-integration.test.ts | — |
| 14 | Out-of-order event | apply stale seq after newer | stale dropped (HWM) | returns false | Pass | trading-integration.test.ts | — |
| 15 | Partial fill then disconnect | OPEN→PARTIALLY_FILLED events, then reconcile fills | state preserved; reconcile completes | filledQuantity preserved; FILLED on reconcile | Pass | trading-integration.test.ts | — |
| 16 | Cancel/fill race | CANCEL_PENDING then FILLED event | fill wins (legal transition) | state FILLED | Pass | trading-integration.test.ts | real event interleaving timing |
| 17 | Duplicate submit click | same idempotency key twice (service + route) | single order; identical result replayed | submits=1; r1===r2; PG: 4/5 concurrent rejected | Pass | trading-core.test.ts, trading-routes.test.ts, postgres.integration.test.ts | — |
| 18 | DB failure during state update | PG transaction rollback test | state consistent; no partial write | tx rollback verified on real PG | Pass | postgres.integration.test.ts | app-store-level failure injection |
| 19 | Redis/Queue failure | single-node design; no distributed queue in Phase 3 | degrade gracefully; no double submit | idempotency guards double submit regardless | Documented only | PHASE3-10, PHASE3-12 | distributed queue not implemented (KI) |
| 20 | Stale market data | risk engine `marketDataStatus != LIVE` | risk fail + live gate blocks | pass=false, liveGate blocked | Pass | trading-core.test.ts | real feed staleness detection thresholds |
| 21 | Kill switch during submit | `emergencyKillSwitch=true` | live gate blocks even if risk passes | liveGate.allowed=false | Pass | trading-core.test.ts | admin-triggered mid-flight switch (env-level verified) |
| 22 | Reconciliation mismatch | reconcile maps unknown exchange status | INCONSISTENT surfaced (never hidden); can re-reconcile | INCONSISTENT reachable; re-reconcile legal | Pass | live-order-machine.test.ts, live-order-service.ts | real mismatch taxonomy |
| 23 | Corrupted encrypted credential | tamper ciphertext → GCM auth tag fails | decrypt throws; no plaintext exposed | throws; no plaintext | Pass | trading-core.test.ts | — |
| 24 | User A accessing User B data | cross-user verify + list | 404 isolation; empty list for B | 404; B sees 0 credentials | Pass | trading-routes.test.ts | — |
| + | Server restart with open orders | reconcile-on-start rule (documented); reconcile logic tested | on boot, reconcile open orders from exchange | reconcile path tested (mock); boot hook documented | Documented / Not Executed (real) | PHASE3-05, live-order-service.ts | real boot reconciliation vs production |

## Summary
- **Pass (reproduced + verified):** 1,2,3,4,5,10,13,14,15,16,17,18,20,21,22,23,24 — plus unit portions of 6,7,8.
- **Documented / Not Executed (needs real credentials or distributed infra):** 9,11,12,19, server-restart; and the real-rejection portions of 6,7,8.
- No scenario is falsely marked Pass. Real-exchange rejections and live WS behavior are honestly **Not Executed** (no API key).
