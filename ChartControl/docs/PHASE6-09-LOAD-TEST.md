# PHASE 6-09 — Load Test

Runner: `scripts/phase6-load.sh` (+ `tests/load/http.js`, k6 v0.52). Target is the INTERNAL app
(`/health`) on an isolated MOCK server — never BitMart, never production. Log:
`artifacts/logs/phase6-load.log` / `phase6-test-load.log`.

## A. HTTP — Executed
| Scenario | VUs | Result |
|---|---|---|
| Smoke | 10 | 200 OK, 0 failures |
| Baseline | 100 | **325,307 requests, 0 failures, ~21.7k req/s, p95 ≈ 8.15 ms, p99 < 100 ms** |
| High | 1,000 | **Not Executed** (bounded single-host environment) |

Thresholds (`p95<800ms`, `p99<1500ms`, `error<1%`) were met at baseline.

## B. Internal WebSocket Gateway — Not Executed
100 / 1,000 / 10,000 connections, reconnect storm, slow consumers, popular-symbol fan-out, multi-symbol
fan-out, symbol/timeframe switch, gateway rolling restart → **Not Executed** (the WS gateway server
process was not wired/booted in this pass). The underlying fan-out, backpressure, slow-consumer
isolation, and per-user rate-limit logic are unit-verified in `@quantumtrade/market-gateway` (PHASE6-01).

## C. AI load — Not Executed
Mock-provider burst / quota / rate-limit / streaming / cancel / circuit-breaker at load → **Not Executed**
(unit-level circuit-breaker + cost controls exist from Phase 4 + PHASE6-01).

## D. Admin load — Not Executed (functional coverage via E2E)
User/audit search, large tables, export limits are covered functionally by the admin E2E; dedicated load
→ **Not Executed**.

## Honesty
No unmeasured scale is reported as Passed; unrun scenarios are **Not Executed**.
