# PHASE 2 — Phase 1 Regression-Risk Analysis

Goal: guarantee Phase 2 changes are **additive** and cannot break the approved Phase-1 surface.

## Protected features & why they are low-risk

| Phase-1 feature | Touched by Phase 2? | Risk | Mitigation |
|---|---|---|---|
| KLineChart / chart-adapter | No | none | Phase 2 adds no chart code |
| BitMart public market data | No | none | `/api/market/*` handlers unchanged |
| Mock Replay | No | none | provider selection unchanged |
| Layout system | Only via **new optional** server persistence iface | low | localStorage remains default; server sync is opt-in, off by default |
| AI Chart Overlay / Signal Card sync | No | none | web AI/overlay code untouched |
| Risk Check | No | none | `packages/domain/risk-gates` untouched |
| Simulation order flow | No | none | `/api/sim/*` + SimOrderEngine unchanged |
| ko-KR/en-US i18n | Additive keys only | low | new auth strings appended; existing keys unchanged |
| 99 unit tests | No edits to tested modules | none | Phase 2 adds new test files only |
| 9 Chromium E2E | No gating of `/trade`; login optional | low | keep `/trade` public; add separate auth e2e |

## Hard rules for Phase 2 commits
1. **Do not edit** `packages/{schemas,domain,exchange-adapters,chart-adapter,design-tokens,config}`
   source except purely additive exports (no signature changes).
2. **Do not edit** existing BFF routes; mount auth under NEW `/api/auth/*`, `/api/account/*`.
3. **Do not gate** existing web routes behind auth in Phase 2 (login is optional/opt-in).
4. i18n: only **append** keys; never rename/remove existing keys (parity test enforces ko==en).
5. New native dep (`better-sqlite3`) lives in `apps/api` only; shared packages stay dep-light.
6. Every step re-runs the full Phase-1 suite; a regression blocks the step.

## Blast-radius controls
- `apps/api/src/index.ts`: single additive line to mount the auth router (no handler edits).
- CSRF/cookie middleware scoped to `/api/auth/*` + `/api/account/*` only — never applied to
  `/api/market/*` (avoids breaking existing CORS/GET behavior + e2e).
- DB init is lazy + isolated; if the DB is unavailable, auth endpoints fail gracefully (503) while
  the rest of the app (market/sim/ai) is unaffected.

## Regression test protocol (run at every Phase 2 step)
```
pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```
Baseline to preserve: **99 unit passed**, **9 Chromium e2e passed**, build entry < 500 kB.
Rollback: `git checkout phase-1-approved-v0.1.0` restores the approved state exactly.
