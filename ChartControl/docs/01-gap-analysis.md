# 01 — Design Implementation Gap Analysis

Source of truth: the extracted prototype at
`BeomOnNuri_Hompage/design_handoff_quantumtrade_ai` (README.md spec, `index.html`,
`src/*.jsx|css|js`). The prototype is a **single-page React+Babel-over-CDN mockup** with
deterministic mock data. This analysis maps prototype → production-grade requirements.

## Prototype: what exists

| Area | Prototype reality |
|---|---|
| Tech | React 18 + Babel standalone (in-browser transpile) via CDN, no build, no types |
| Data | 100% deterministic mock (`mock-data.js`, `mock-stream.js`), seeded RNG |
| Chart | Hand-drawn Canvas 2D (`chart-canvas.jsx`), **not** KLineChart |
| Layout | Custom 24-col engine in `layout-engine.jsx` (drag/resize/undo/redo, 7 presets) |
| Widgets | ~9 widget types rendered; localStorage persistence (`qt.layout`) |
| AI | Scripted/simulated streaming (`ai-copilot.jsx`), hard-coded signal object |
| Tokens | Full 3-layer OKLCH token system (`tokens.css`) — production-ready values |
| State | Local React state only; no server, no auth, no DB, no validation |

## Gaps to close for production-grade Phase 1

| # | Gap | Prototype | Phase 1 target | Status |
|---|---|---|---|---|
| G1 | No build/types | Babel CDN | Vite + TS strict monorepo | ✅ scaffold done |
| G2 | Chart is Canvas mock | custom canvas | KLineChart via `IChartRenderer` adapter | 🔌/🟡 adapter |
| G3 | No runtime validation | raw objects | Zod schemas at every boundary | ✅ schemas pkg |
| G4 | number math for money | JS `number` | `Decimal` order math | ✅ domain pkg |
| G5 | No order state machine | ad-hoc | explicit 12-state machine | ✅ domain pkg |
| G6 | AI signal → order coupling risk | mixed | strict separation + confirm gate | ✅ domain pkg |
| G7 | No real market data | mock only | BitMart public REST/WS + normalization | 🌐/🟡 |
| G8 | Per-client data | n/a | central ingestion + fan-out design | 📄 design, 🔌 iface |
| G9 | No auth/session/DB | none | interface + schema proposal | 🔌/📄 |
| G10 | AI executes arbitrary UI | scripted | allowlisted ChartCommand + Zod | ✅ schemas |
| G11 | No error/reconnect/stale states | happy path | full widget state set | 🟡 |
| G12 | No tests | none | Vitest unit/schema/domain + E2E/k6 scripts | 🟡 / 📄 |
| G13 | Tokens not typed/consumable | CSS only | CSS + typed TS exports | ✅ |
| G14 | No rate limiting / backoff | n/a | token-bucket config + circuit breaker design | 🟡/📄 |

## Explicit design-fidelity commitments

Preserved exactly (no redesign): OKLCH brand/semantic/component token values, 24-col grid
(40px row, 6px gap), the 7 presets and their widget geometry, widget min sizes, the Simulation
stripe, header structure, connection cluster, Long=Teal / Short=Magenta, IBM Plex Sans/Mono +
Pretendard, dark default + light theme, KO/EN switch. These come **verbatim** from the prototype
(`tokens.css`, `mock-data.js LAYOUT_PRESETS`) into `packages/design-tokens` and the layout engine.
