# QuantumTrade AI — Phase 0: Architecture & Verification

> Status legend used throughout this repo:
> - ✅ **Implemented & tested** — code exists and has passing automated tests in this repo
> - 🟡 **Implemented, not load-tested** — code exists, unit/integration tested, no perf/load verification
> - 🌐 **Implemented with real public BitMart data** — talks to live BitMart public endpoints
> - 🧪 **Implemented with mock/simulation** — deterministic mock, no external dependency
> - 🔌 **Interface only** — typed contract exists, no concrete production implementation
> - 📄 **Documented for future implementation** — spec/plan only, no code
> - ⛔ **Blocked** — needs external credential / agreement
> - 🐞 **Known issue**

This document is the entry point. See sibling docs:
`01-gap-analysis.md`, `02-requirement-matrix.md`, `03-mock-real-matrix.md`,
`04-data-model.md`, `05-api-contract.md`, `06-websocket-contract.md`,
`07-schemas.md`, `08-order-state-machine.md`, `09-threat-model.md`,
`10-performance-budget.md`, `11-test-strategy.md`, `12-deployment.md`,
`13-risks-assumptions.md`, `14-phase-plan.md`, and `adr/`.

---

## 1. Product summary

QuantumTrade AI is a desktop-first, AI-native crypto **derivatives (perpetual futures)** trading
terminal. The core differentiator is a safety-gated pipeline where a user converses with an AI,
the AI proposes chart overlays and a structured trading **Signal**, the user reviews/edits it, and
only after an explicit multi-step confirmation does a **simulated** order get submitted.

Non-negotiable safety invariants (enforced in code, see `packages/domain`):

1. **AI can never submit an order.** Approving an AI signal is *not* an order submission.
2. Every order requires an explicit final human confirmation gate.
3. Phase 1 supports **no production orders**. Only `MOCK` simulation is active; `BITMART_DEMO` is
   interface-only; `BITMART_PRODUCTION` is hard-disabled behind a feature flag + admin approval.
4. Exchange private credentials never reach the browser, logs, or error messages.

## 2. System architecture (target)

```
                         ┌──────────────────────────────────────────────────┐
   Browser (React SPA)   │  Cloudflare (CDN / WAF / static assets / edge)     │
   - widgets, layout     │                                                    │
   - KLineChartAdapter   └───────────────┬────────────────────────────────────┘
   - TanStack Query                      │ HTTPS + WSS/SSE
   - Zustand stores                      ▼
                          ┌──────────────────────────────┐
                          │  BFF / API  (Hono)            │  apps/api
                          │  - REST proxy (cached)        │
                          │  - SSE fan-out endpoint       │
                          │  - AI orchestrator boundary   │
                          │  - auth/session (iface)       │
                          └───┬───────────┬───────────┬───┘
             internal pub/sub │           │           │
        ┌───────────────┐     │   ┌───────▼──────┐  ┌─▼──────────────┐
        │ market-data   │◄────┘   │ trading svc  │  │ risk engine    │  (separate services;
        │ ingestion svc │         │ (recon,OMS)  │  │                │   Phase 1: logical
        └──────┬────────┘         └──────────────┘  └────────────────┘   modules, deploy-splittable)
               │ REST+WS                                   ▲
     ┌─────────▼──────────┐                      ┌─────────┴─────────┐
     │ BitMart REST / WS  │                      │ AI orchestrator   │
     │ (public in Phase1) │                      │ + provider adapter│
     └────────────────────┘                      └───────────────────┘

  Shared infra (interface-only in Phase 1): PostgreSQL (persistence),
  Redis (cache / rate-limit / pub-sub), Queue (async jobs / DLQ), Object storage (reports).
```

**Key rule (enforced by design):** the browser never opens a BitMart connection directly. All
market data flows: `BitMart → central ingestion → normalize → validate → sequence/gap check →
cache → internal pub/sub → SSE/WS fan-out → browser`. This deduplicates upstream connections,
protects rate limits, and keeps private credentials server-side.

### Service boundaries (why separated)

| Concern | Boundary | Rationale |
|---|---|---|
| Static frontend + edge | Cloudflare | CDN, WAF, cheap global delivery |
| Stateless request/response API + AI orchestration boundary | Hono BFF | Horizontally scalable, edge-friendly |
| Long-lived upstream market-data connections | market-data ingestion svc | Stateful, must be a persistent process (not per-request/edge) |
| Order submission + reconciliation | trading svc | Idempotency, audit, isolation from read path |
| Risk checks | risk engine | Pure, testable, must gate every order |
| LLM calls | ai-orchestrator | Provider-swappable, backpressure, cost control |

Phase 1 implements the BFF + market-data adapter + AI orchestrator boundary as code in this repo.
The trading/risk/ingestion services exist as **modules with clean interfaces** so they can be
lifted into separate always-on processes (AWS ECS/Fargate/EKS) without rewriting callers.

## 3. Frontend component architecture

```
apps/web/src
├─ app/            route components: /trade, /trade/ai, /trade/layout,
│                  /settings, /design-system, /status, /login, /signup
├─ shell/          Simulation stripe, AppHeader, SymbolHeader, ConnectionCluster
├─ widgets/        WidgetHost + per-widget error boundary + state machine (loading/
│                  empty/error/reconnecting/stale/permission-denied); widget registry
├─ layout/         24-col layout engine (ported from prototype to typed React) —
│                  collision, snap, undo/redo, presets, migration
├─ chart/          React wrapper around @quantumtrade/chart-adapter (KLineChart)
├─ ai/             AI copilot panel, signal proposal card, streaming client, failure boundary
├─ stores/         Zustand: layoutStore, connectionStore, dataModeStore, aiStore
├─ data/           TanStack Query hooks; SSE client; runtime Zod validation of responses
└─ theme/          data-theme/brand/density/longshort attribute controller
```

State-management split:
- **Server state** → TanStack Query (candles, symbols, order book snapshots).
- **Streaming state** → dedicated SSE client → Zustand slices (bounded buffers).
- **UI/local state** → Zustand (layout edit mode, selected widget, theme).

Re-render isolation: chart data updates, crosshair moves, and resizes are handled **inside** the
chart adapter (imperative KLineChart API) and never lifted into React render state, so they do not
re-render the widget tree. Market-data ticks update Zustand slices with selector subscriptions so
only subscribed widgets re-render.

## 4. Repository layout (this repo)

```
quantumtrade-ai/
├─ apps/web            React 18 + TS strict + Vite SPA
├─ apps/api            Hono BFF (market-data proxy, SSE, AI orchestrator, health)
├─ packages/schemas    Zod schemas + runtime validation (Widget/Layout/ChartCommand/Signal/Order)
├─ packages/domain     Decimal order math + Order & Signal state machines + layout ops
├─ packages/exchange-adapters  provider interfaces + BitMart public + MockReplay + rate-limit cfg
├─ packages/chart-adapter      IChartRenderer + KLineChartAdapter (pinned klinecharts)
├─ packages/design-tokens      tokens.css + typed TS token exports + base/component css
├─ packages/config     shared env parsing + constants (rate limits, timeframes)
├─ docs/               this Phase 0 set + ADRs
├─ tests/e2e           Playwright specs (flows A–E) — provided, not executed here
├─ tests/load          k6 profiles (1–10) — provided, not executed here
└─ third-party-licenses/
```

## 5. Data mode & trading mode (always visible in UI)

- `DATA_MODE = MOCK_REPLAY | BITMART_PUBLIC` — chooses the market-data provider. Shown in a
  persistent header chip + the SIMULATION stripe.
- `TRADING_MODE = MOCK | BITMART_DEMO | BITMART_PRODUCTION_DISABLED` — chooses the trading adapter.
  Phase 1 forces `MOCK`. `BITMART_DEMO` is interface-only; production requires
  `FEATURE_LIVE_ORDERS_ENABLED=true` **and** admin approval **and** an ADR — none present.

## 6. What Phase 1 delivers vs. defers

Delivered as working, tested code: schemas + runtime validation, decimal order math, order/signal
state machines, layout engine + migration, BitMart public REST normalization, mock market-data
replay, rate-limit config, chart adapter interface, Hono BFF proxy + SSE interface + mock AI
provider with allowlisted ChartCommand validation, React shell with design system and widget system.

Deferred (interface/documented): PostgreSQL/Redis persistence, real auth/session store, BitMart
private trading adapter, production orders, multi-node WS fan-out, load-test execution. See
`03-mock-real-matrix.md` for the authoritative per-feature status.
