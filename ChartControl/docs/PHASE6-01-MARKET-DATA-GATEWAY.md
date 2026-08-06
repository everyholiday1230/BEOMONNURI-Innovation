# PHASE 6-01 — Central Market Data Gateway

Package: `@quantumtrade/market-gateway` (13 tests, `pnpm test:gateway`). Replaces browser-direct-to-BitMart
with a fan-in/fan-out pipeline so upstream connections stay bounded regardless of user count.

## Pipeline
`BitMart Public REST/WS → Ingestion → Parser/Schema validation → Sequence/Dup/Stale →
Candle/OrderBook reconciliation → Shared cache (Redis) → Internal Pub/Sub → WS Gateway → browsers`

## Implemented + verified (core logic, unit-tested)
| Requirement | Module | Test |
|---|---|---|
| Upstream subscription dedup + refcount | `SubscriptionManager` | ONE upstream for N consumers; last unsubscribe cleans up |
| Unsubscribe cleanup / consumer drop | `SubscriptionManager.dropConsumer` | closes only now-empty upstreams |
| REST request coalescing | `RequestCoalescer` | 3 concurrent → 1 upstream call |
| Candle cache + gap ranges (REST gap-fill) | `CandleCache` | upsert/bound/missingRanges |
| OrderBook snapshot + delta + resync | `OrderBook` | applies deltas; resync_required on seq gap |
| Duplicate / out-of-order / gap / stale | `SequenceTracker` | classified deterministically |
| Exponential backoff + jitter | `backoffDelay` | bounded + growing (full jitter) |
| Circuit breaker | `CircuitBreaker` | open→cooldown→half-open→closed |
| Backpressure + slow-consumer isolation | `BoundedQueue` / `Fanout` | slow consumer drops only its own |
| Per-user rate limit | `TokenBucket` / `PerUserRateLimiter` | per-user isolation + refill |
| Dropped-message metrics | queue `droppedCount` | counted per consumer |
| Multi-instance shared state | `@quantumtrade/cluster` (PHASE6-02) | Redis + pub/sub |

## Not Executed (recorded honestly)
- Live BitMart Public REST/WS upstream connection (needs a running gateway process + network to BitMart;
  BitMart rate limits must not be load-tested) → **Not Executed**.
- 10,000-WebSocket internal-gateway fan-out at scale → **Not Executed** (PHASE6-09); core fan-out logic
  is unit-tested but the socket server was not wired/booted in this pass.
- Graceful shutdown of the WS gateway process is designed (API graceful shutdown implemented, PHASE6-11);
  gateway-process drain under load → **Not Executed**.

## Closure update (RC v0.6.1)
The runnable gateway SERVER now exists: `apps/market-gateway` (`@quantumtrade/market-gateway-server`) —
HTTP health/ready + WS `/ws` with auth + Origin + per-user sub-limit + symbol/timeframe validation,
wiring the library (dedup/refcount, cache, gap-fill, orderbook resync, sequence, back-pressure, circuit
breaker, Redis pub/sub, metrics, graceful shutdown). Gateway E2E 12; WS load 100 + 1,000 conns (PHASE6-18).
BitMart Public REST reachable; live public-WS soak Not Executed.
