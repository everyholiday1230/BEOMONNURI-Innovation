# PHASE 6-18 — Gateway E2E & WS Load

Server: `apps/market-gateway` (`@quantumtrade/market-gateway-server`). E2E: `pnpm e2e:gateway`
(in-process server + real `ws` client). Load: `scripts/phase6-gateway-load.sh` (k6 `ws`).

## Gateway E2E — 12 passed (`artifacts/logs/phase6-e2e-gateway.log`)
1 auth (missing token → 401) · 2 disallowed Origin → 403 · 3 welcome · 4 subscribe→sequenced data ·
5 invalid symbol + channel rejected · 6 duplicate subscription deduped · 7 two users share ONE upstream
(refCount 2, newUpstream false) · 8 unsubscribe · 9 subscribe-flood rate limit · 10 health/ready +
/metrics · 11 per-user subscription limit (SUB_LIMIT) · 12 graceful restart.

## WS load — `artifacts/logs/phase6-gateway-load.log`
| Stage | Connections | Result |
|---|---|---|
| smoke | 100 | 800 checks 100% pass, ws_connecting p95 ≈ 33 ms, fan-out received |
| baseline | 1,000 | 10,000 checks 100% pass, ws_connecting p95 ≈ 142 ms, **0 dropped**, 215,962 msgs out |
| target | 10,000 | **Not Executed** (bounded single-host env — not estimated) |

Upstream dedup: one upstream per (symbol,channel) key regardless of client count (`gw_upstream_connections`).

## BitMart Public
REST reachable (HTTP 200, ~75 ms) — `BITMART_PUBLIC` mode connects public WS/REST with no secret.
Full public-WS protocol relay across all channels + 30-min soak + reconnect/symbol/timeframe-switch soak
= **Not Executed** (bounded run; the mock-replay upstream fully exercises the pipeline logic).

## Metrics exposed (`/metrics`)
`gw_active_connections`, `gw_upstream_connections`, `gw_messages_out`, `gw_dropped_messages`,
`gw_gaps_detected`, `gw_fanout_ms` (p50/95/99).
