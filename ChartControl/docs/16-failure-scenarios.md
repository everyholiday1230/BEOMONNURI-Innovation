# 16 — Failure Scenario Reproduction Report

Each of the 12 required failure scenarios is **forced deterministically** by an automated test in
this repo (no reliance on real network flakiness). Run: `pnpm test` (unit/integration) + `pnpm e2e`.

| # | Scenario | How it is forced | Test (file) | Result |
|---|---|---|---|---|
| 1 | WebSocket disconnect | fake WebSocket; `unsubscribe()` must close socket + remove listeners; post-teardown messages ignored | `exchange-adapters/__tests__/reliability.test.ts` (#1/#2) | ✅ pass |
| 2 | Reconnect | re-subscribe creates a fresh socket and resumes delivery; also UI disconnect→error→reconnect | `reliability.test.ts` (#1/#2) + e2e `flow-d-reconnect` | ✅ pass |
| 3 | Stale data | `StaleState` renders a STALE badge; widgets show a STALE marker when `connection` is OFFLINE/STALE/RECONNECTING or a poll `error` persists over cached data | `apps/web/__tests__/widgets.test.tsx` (STALE renders) + `DataWidgets` | ✅ pass |
| 4 | REST timeout | injected `fetch` throws (timeout); provider propagates, records breaker failure, no hang | `reliability.test.ts` (#4) | ✅ pass |
| 5 | 429 rate limit | injected `fetch` returns 429 → `rate_limited_429`; repeated failures open the circuit breaker → `circuit_open` (no infinite retry) | `reliability.test.ts` (#5) | ✅ pass |
| 5b | Upstream 5xx | injected `fetch` returns 503 → `upstream_503`, contained | `reliability.test.ts` (#5b) | ✅ pass |
| 6 | Malformed message | garbage payload → `normalizeBitmartKline` returns [] (no throw); `CandleSchema` rejects NaN/OHLC-invalid | `reliability.test.ts` (#6) + `adapters.test.ts` + `schemas.test.ts` | ✅ pass |
| 7 | Duplicated candle | same-timestamp candle → `CandleBuffer` replaces (latest wins), size stays 1 | `reliability.test.ts` (#7) + `adapters.test.ts` | ✅ pass |
| 8 | Out-of-order event | older timestamp arrives after newer → buffer stores + keeps ascending order | `reliability.test.ts` (#8) + `adapters.test.ts` | ✅ pass |
| 9 | AI timeout | `fetch` rejects → `analyzeStream` surfaces `onError` (never throws); `abort()` cancels with AbortError swallowed | `apps/web/__tests__/ai-client.test.ts` (#9) | ✅ pass |
| 10 | Invalid ChartCommand / AI output | non-allowlisted command (`executeJavaScript`) rejected by Zod; invalid SSE signal rejected client-side, contained error, chart survives | `schemas.test.ts` + e2e `flow-e-ai-safety` | ✅ pass |
| 11 | Layout storage corruption | `loadLayoutSafe` returns fallback for garbage/null/unparseable (never throws); legacy data migrated | `domain/__tests__/layout-ops.test.ts` | ✅ pass |
| 12 | Browser offline / resume | `window` offline/online events → `useBrowserConnectivity` flips connectivity → app maps to OFFLINE/LIVE; listeners cleaned on unmount | `apps/web/__tests__/connectivity.test.ts` (#12) | ✅ pass |

## Notes on approach
- WS realtime and browser-offline were first attempted as Playwright e2e, but `context.setOffline`
  does not fire the DOM `offline` event deterministically in this sandbox (measured ~1/3 flaky).
  They were therefore reproduced as **deterministic unit tests** (fake WebSocket; dispatched
  `offline`/`online` events), which is stronger and repeatable. The UI-level reconnect path remains
  covered deterministically by e2e `flow-d` (config request abort → error state → restore → LIVE).
- The 429/timeout/5xx path exercises the real `BitMartPublicMarketDataProvider` with an injected
  `fetch`, so the production code path (breaker + limiter) is what's tested, not a stub.
