# 17 — Market Data Architecture: Proof & Scaling Plan

## Question: does each browser connect to BitMart directly, or via a central service?

**Answer (current, verified): browsers NEVER connect to BitMart directly.** All browser market-data
requests go to the Hono BFF (`apps/api`), which owns the BitMart REST/WS connection. This is a
**single-node** central ingestion point (a BFF), not yet a horizontally-scaled Market Data Service.
It is therefore correct in ownership/isolation but **NOT production-ready for large scale** — see
limitations + gateway plan below.

## Relevant files

| Concern | File |
|---|---|
| BFF market-data routes (browser entry) | `apps/api/src/index.ts` (`/api/market/*`, `/api/stream/market`) |
| Provider selection by mode | `apps/api/src/providers.ts` |
| BitMart public REST/WS provider (owns upstream conn) | `packages/exchange-adapters/src/bitmart-public.ts` |
| Normalize / validate / dedup / OOO | `bitmart-public.ts` + `normalize.ts` + `orderbook.ts` |
| Rate limit / backoff / circuit breaker | `packages/exchange-adapters/src/rate-limiter.ts` |
| Mock deterministic provider | `packages/exchange-adapters/src/mock-replay.ts` |
| Browser client (talks ONLY to BFF) | `apps/web/src/lib/api.ts`, `apps/web/src/chart/ChartWidget.tsx` |
| Real WS verification (standalone) | `tests/integration/bitmart-ws-verify.mjs` |

## Current data flow (as built)

```
                         ┌──────────────────────── apps/api (Hono BFF, SINGLE node) ───────────────────────┐
Browser (N tabs)         │  selectProviders(mode)                                                          │
  │  fetch /api/market/* │   ├─ BITMART_PUBLIC → BitMartPublicMarketDataProvider ── REST ─▶ BitMart public │
  ├─ REST (TanStack Query)──▶ route handler ─┤                                    (candles/ticker/symbols) │
  │                      │                    └─ MOCK_REPLAY → MockReplayProvider (deterministic)          │
  │  SSE /api/stream/market (candles) ◀────── in-memory pub/sub (single node) ◀── provider.subscribeCandles│
  └──────────────────────┘                                                                                 
```
- **Connection ownership:** the BFF process owns the BitMart REST calls (and the WS subscription in
  `subscribeCandles`). Browsers hold only an HTTP/SSE connection to the BFF.
- **REST path is real & verified** (candles/ticker/symbols hit live BitMart — see FINAL-REPORT §2).
- **WS path is real** (verified by `bitmart-ws-verify.mjs`: single socket, reconnect+backoff, no
  listener leak) but is **not yet wired into a shared server-side fan-out**; the BFF's
  `/api/stream/market` currently drives candles from the provider in-memory on a single node.

## Deduplication / coalescing / cache — current state (honest)

| Mechanism | Current | Notes |
|---|---|---|
| Client subscription dedup | ✅ partial | TanStack Query dedupes identical `queryKey`s across widgets in one tab (many widgets on `['orderbook',symbol]` share one request). |
| Server subscription dedup (per symbol/channel) | 🟡 provider-level | one provider instance per BFF process; a single upstream WS socket per process (verified). Cross-instance dedup ⛔ (needs shared bus). |
| REST request coalescing | ⛔ not implemented | identical concurrent REST candle requests are not merged server-side yet (limitation). |
| Cache strategy | 🟡 client-only | TanStack Query staleTime (5s) + refetchInterval; **no server cache** (Redis) yet. |
| Per-user fan-out | 🟡 single-node | `/api/stream/market` SSE is in-memory; fine for a demo, not multi-node. |
| Disconnect/reconnect ownership | ✅ | owned by `BitMartPublicMarketDataProvider.subscribeCandles` (adapter tears down listeners+socket on unsub; reconnect+backoff verified in the WS script). |

## Limitations (why this is NOT production-ready at scale)

1. **Single-node BFF**: market-data ingestion, SSE fan-out, and app API share one process. No
   horizontal scaling, no shared state.
2. **No Redis/pub-sub**: cross-instance subscription dedup, cache, and fan-out are absent.
3. **No server-side REST coalescing/cache**: cache-miss storms hit BitMart directly (mitigated only
   by the token-bucket limiter + circuit breaker).
4. **WS ingestion not yet centralized into the fan-out**: the verified WS client exists in the
   adapter but the BFF stream endpoint uses provider candles in-memory.

## Target structure & gateway transition plan

```
BitMart REST/WS
  └─▶ Market Data Ingestion Service (dedicated, replicated by symbol/channel partition)
        └─▶ Normalize / Validate / Sequence-Gap check      (packages/exchange-adapters — reuse as-is)
              └─▶ Redis (cache + Streams/pub-sub)           (subscription dedup, coalescing, snapshots)
                    └─▶ WS/SSE Fan-out tier (stateless, N replicas)
                          └─▶ Browser clients               (unchanged BFF contract)
```

Transition steps (post-Phase-1, non-breaking to the browser contract):
1. Extract `market-data` into its own service process (the provider code moves unchanged).
2. Introduce Redis: publish normalized ticks to Streams; fan-out tier subscribes and pushes to
   browser SSE/WS. Add per-symbol/channel subscription registry for dedup.
3. Add a REST cache + single-flight coalescing in front of BitMart REST (keyed by symbol/tf/range).
4. Partition ingestion by symbol/channel; scale the fan-out tier statelessly behind the CDN/edge.
5. Keep the browser `/api/*` contract identical so the web app needs no change.

Until these are in place, the market-data layer is labeled **Implemented (single-node) — not
production-scale**, and must not be marked production-ready.
