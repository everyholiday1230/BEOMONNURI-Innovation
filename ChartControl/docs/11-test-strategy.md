# 11 — Test Strategy

Principle: **no result is reported as passing unless it comes from a real, reproducible run.**
Executed-in-this-repo tests are Vitest unit/schema/domain/normalization. E2E (Playwright) and load
(k6) scripts are **provided but not executed** here and are labelled accordingly.

## Test pyramid
| Layer | Tool | Scope | Status |
|---|---|---|---|
| Unit | Vitest | decimal math, state machines, layout ops, rate-limit | ✅ executed |
| Schema | Vitest + Zod | Widget/Layout/ChartCommand/Signal/Order valid+invalid | ✅ executed |
| Normalization | Vitest | candle dedup/OOO/OHLC, orderbook seq/gap, trade dedup | ✅ executed |
| Component | RTL | widget states, error boundary | 🟡 planned/partial |
| Integration | Vitest | BFF routes with mock provider | 🟡 planned |
| E2E | Playwright | flows A–E | 📄 scripts only, not executed |
| Load | k6 | profiles 1–10 | 📄 scripts only, not executed |
| a11y | axe/Playwright | WCAG 2.2 AA | 📄 planned |
| Visual regression | Playwright/Storybook | — | 📄 planned |

## Core E2E flows (tests/e2e)
- **A** Layout: edit → move → resize → save → refresh → restore.
- **B** AI: prompt → streaming → chart overlay → user edit → signal proposal.
- **C** Order: approve signal → order draft → risk check → confirmation → simulated submit.
- **D** Reliability: WS disconnect → stale → reconnect → gap fill → live.
- **E** AI safety: invalid AI output → schema rejection → safe error UI → chart still works.

## Must-have unit/integration coverage (executed)
WebSocket reconnect logic, market-data normalization, duplicate/out-of-order handling,
order-state-machine legal/illegal transitions, AI ChartCommand validation (accept allowlisted /
reject arbitrary), layout schema migration + corrupted-data recovery, decimal order math.

## How to run
`pnpm -r test:run` (all package unit/schema tests). E2E/load: see `tests/e2e/README` and
`tests/load/README` — require a running app / infra and are intentionally not run in this handoff.
