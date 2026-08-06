# 14 — Phase-by-Phase Implementation Plan

## Phase 0 — Architecture & Verification  ✅ (this docs set + ADRs)
Gap analysis, requirement matrix, mock/real matrix, architecture, data model, API/WS contracts,
schemas, state machines, threat model, perf budget, test strategy, deployment, risks, ADRs.

## Phase 1 — Production-grade Frontend MVP  (this repo)
Order of work (as delivered):
1. Monorepo scaffold + tooling (pnpm, TS strict, Vitest, Prettier).
2. `packages/design-tokens` — tokens.css (verbatim) + typed TS exports.
3. `packages/schemas` — Zod Widget/Layout/ChartCommand/Signal/Order + tests.
4. `packages/domain` — Decimal order math + order/signal state machines + layout ops + tests.
5. `packages/exchange-adapters` — provider interfaces + BitMart public normalization + MockReplay
   + rate-limit config + normalization/dedup/orderbook tests.
6. `packages/chart-adapter` — IChartRenderer + KLineChartAdapter.
7. `apps/api` — Hono BFF: config/health/ready, market-data proxy, SSE interface, mock AI provider
   with allowlisted ChartCommand validation + permission check.
8. `apps/web` — React shell, routes, design system, widget system + error boundaries + states,
   layout engine, chart widget, connection/data-mode indicators.
9. Install, build, run tests; fix; record real output.
10. Provide (non-executed) Playwright + k6 scripts; final status report; ZIP.

## Phase 2 — Real data hardening (future)
Live BitMart WS verification, central ingestion service extraction, Redis-backed fan-out,
component/integration/E2E execution, a11y + visual regression, observability wiring.

## Phase 3 — BitMart Demo trading (future)
Implement `IExchangeTradingAdapter` for BitMart Futures **Demo**; env-injected credentials;
reconciliation; still no production orders. See `docs` future plans.

## Phase 4 — Production readiness (future, gated)
Real auth/DB/KMS, key rotation, load-test execution vs SLOs, admin/CRM, production feature flag +
approval workflow. Production orders remain disabled until all gates pass.
