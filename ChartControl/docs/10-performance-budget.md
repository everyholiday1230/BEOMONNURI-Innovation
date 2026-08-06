# 10 — Performance Budget (SLO targets — NOT measured results)

> These are **targets**. Nothing here is claimed as measured. Actual results, when produced, will
> be reported separately and only from real test runs. See `11-test-strategy.md` and `tests/load`.

## Frontend budgets
| Metric | Target | Approach |
|---|---|---|
| Route initial JS (trade) | minimized; lazy non-critical widgets | route + widget code-splitting |
| LCP (p75) | ≤ 2.5s (defined test env) | critical CSS, font-display swap, lazy chart |
| CLS | ≤ 0.1 | reserved grid cells, skeletons |
| INP | ≤ 200ms where practical | offload heavy calc to Web Worker |
| Chart interaction | 60fps target | imperative KLineChart updates, no React rerender |
| Market-data buffers | bounded | ring buffers, capped candle/trade history |

## Backend budgets
| Metric | Target |
|---|---|
| Cached API p95 | ≤ 200ms |
| Internal market-data fan-out p95 | ≤ 250ms |
| Availability (initial) | 99.9% |
| Observed signals | error rate, latency, connection count, queue depth |

## Anti-rerender rules (enforced in code)
- Chart resize/data/crosshair handled inside adapter; never lifted to React state.
- Zustand selector subscriptions so only affected widgets re-render.
- Market-data ticks batched 50–100ms (account/order events are NOT delayed).
