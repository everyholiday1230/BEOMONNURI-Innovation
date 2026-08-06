# RELEASE — Phase 1 Approved · v0.1.0 (FROZEN BASELINE)

| Field | Value |
|---|---|
| Status | **Phase 1 Approved** |
| Version | **v0.1.0** |
| Git commit | **1a43f8e** (`1a43f8efa2518e956b662668f3d78a3ef0b49487`) |
| Git tag | **phase-1-approved-v0.1.0** (annotated, points at 1a43f8e) |
| Approved | 2026-07-29 |
| Docs-only follow-up commit | c67825f (FINAL-REPORT closure section; no source change) |

This baseline is **frozen**. Phase 2 work proceeds on new commits and must not rewrite or
refactor the approved baseline. To restore/inspect the exact approved state:
`git checkout phase-1-approved-v0.1.0`.

## Preserved Phase 1 approval artifacts
| Artifact | Location |
|---|---|
| Full source (monorepo) | repo @ tag `phase-1-approved-v0.1.0` |
| Distribution ZIP (versioned snapshot) | `/home/test1/quantumtrade-ai-phase-1-approved-v0.1.0.zip` |
| Distribution ZIP (rolling) | `/home/test1/quantumtrade-ai.zip` |
| Final report | `FINAL-REPORT.md` (§0 Closure) |
| Raw execution logs | `artifacts/logs/{install,lint,typecheck,test,build,e2e}.log` |
| Browser matrix log | `artifacts/logs/e2e-all-browsers.log` (Chromium 9 + Firefox 9) |
| Load test logs | `artifacts/logs/loadtest-smoke.log`, `loadtest-baseline.log` |
| BitMart WS verification log | `artifacts/logs/bitmart-ws-verify.log` |
| Bundle analysis | `artifacts/logs/bundle-analysis.log` |
| Mock/Real matrix | `docs/03-mock-real-matrix.md` |
| Design gap analysis | `docs/15-design-gap-analysis.md` |
| Failure scenarios | `docs/16-failure-scenarios.md` |
| Market Data architecture | `docs/17-market-data-architecture.md` |
| Production Release Gate | `docs/PRODUCTION-RELEASE-GATE.md` |

## Approved Phase 1 verification snapshot (executed)
- 6 commands (`install/lint/typecheck/test/build/e2e`) all exit 0.
- Unit: **99 passed** · E2E: **Chromium 9/9 + Firefox 9/9 = 18** (WebKit → gate).
- BitMart REST **live** (candles/ticker/symbols) + MOCK_REPLAY verified.
- BitMart public **WS** connect/parse/reconnect/no-leak (60s) verified.
- 12/12 failure scenarios reproduced by passing tests.

## Phase-1 protected surface (must not break in Phase 2)
KLineChart · BitMart public market data · Mock Replay · Layout system · AI Chart Overlay ·
Signal Card sync · Risk Check · Simulation order flow · ko-KR/en-US i18n · the 99 unit tests ·
the 9 Chromium E2E tests. See `docs/PHASE2-01-regression-risk.md`.
