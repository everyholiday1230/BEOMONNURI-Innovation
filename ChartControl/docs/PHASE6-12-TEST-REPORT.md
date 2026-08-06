# PHASE 6-12 — Test Report

Runner: `scripts/phase6-verify.sh`. All logs in `artifacts/logs/phase6-*.log` (each with
command/env/git-SHA/start/end/exit header). **All 15 commands + dependency audit: exit 0.**

| # | Command | Environment | Result | Exit | Log |
|---|---|---|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | Node 24.18.0/pnpm9 | up to date | 0 | phase6-install.log |
| 2 | `pnpm lint` | eslint 9 | 0 errors | 0 | phase6-lint.log |
| 3 | `pnpm typecheck` | tsc 5.5 | all projects | 0 | phase6-typecheck.log |
| 4 | `pnpm test` | vitest | **362 passed** (incl. real-Redis integration) | 0 | phase6-test.log |
| 5 | `pnpm build` | tsup/vite/tsc | all packages + apps | 0 | phase6-build.log |
| 6 | `pnpm e2e` | Playwright Chromium | **10 passed** (User App) | 0 | phase6-e2e.log |
| 7 | `pnpm test:postgres` | real PG17 | **12 passed** | 0 | phase6-test-postgres.log |
| 8 | `pnpm test:integration` | — | **33 passed** | 0 | phase6-test-integration.log |
| 9 | `pnpm test:admin` | — | **30 passed** (domain 16 + api 14) | 0 | phase6-test-admin.log |
| 10 | `pnpm e2e:admin` | Playwright Chromium | **31 passed** | 0 | phase6-e2e-admin.log |
| 11 | `pnpm test:security` | — | **23 passed** (security 9 + admin-api 14) | 0 | phase6-test-security.log |
| 12 | `pnpm test:gateway` | — | **13 passed** | 0 | phase6-test-gateway.log |
| 13 | `pnpm test:mfa` | — | **20 passed** | 0 | phase6-test-mfa.log |
| 14 | `pnpm test:chaos` | — | **11 passed** | 0 | phase6-test-chaos.log |
| 15 | `pnpm test:load` | k6 | baseline 100 VUs, 325k reqs, p95≈8.4ms, 0 fail | 0 | phase6-test-load.log |
| + | `pnpm audit` | pnpm | 59 findings (3L/42M/12H/2C, dev-tooling) | 0 | phase6-dep-audit.log |

## Browser matrix (separate runs)
- User App E2E: **Chromium 10 / Firefox 10 / WebKit 8 (2 failed)** — `phase6-e2e-user-allbrowsers.log`.
- Admin App E2E: **Chromium 31 / Firefox 31 / WebKit 31** (93) — `phase6-e2e-admin-allbrowsers.log`.

## Real-infra executions
- Redis (`127.0.0.1:16379`): cross-node CAS + pub/sub, propagation ≈ 1 ms.
- PostgreSQL 17 (`127.0.0.1:15432`): migrations + backup/restore drill (integrity PASS, RTO 136 ms).

## Not Executed (summary; see PHASE6-15)
1,000-user load, 10k WebSocket, live BitMart Stage A / Controlled Live Order, Live OpenAI/eval/AI-E2E,
external SAST/secret/OSV scanners (semgrep/gitleaks/osv-scanner), managed PITR, real PagerDuty/Slack, multi-host
rolling deploy, image registry publish, real-device Safari. (Container SBOM + vulnerability scan now Executed — 0 C/0 H, PHASE6-20.)

## Closure regression (RC v0.6.1) — all 18 commands exit 0 (artifacts/logs/phase6-*.log)
install · lint · typecheck · **test 390** · build · **e2e 10** · **test:postgres 12** (real PG17) ·
**test:integration 33** · **test:admin 30** · **e2e:admin 31** · **test:security 23** · **test:gateway 13** ·
**e2e:gateway 12** · **test:mfa 36** (lib 20 + api 16) · **e2e:mfa 16** (18 scenarios) · **test:chaos 11** ·
**test:load** (HTTP baseline p95≈6.7ms) · **pnpm audit --prod + ci-audit-gate** (0 critical / 0 high).
Browser matrix: User 10/10/10 (Chromium/Firefox/WebKit); Admin 31/31/31. Gateway WS load: 100 + 1,000
conns 100% handshake, 0 dropped; 10,000 Not Executed.

## Hotfix closure (RC v0.6.4) — UI/Chart defects and the verification gap that hid them

### Correction to the records above
The RC v0.6.1 line "**e2e 10**" and the browser matrix are factually correct about *how many specs
passed*; they are **not** evidence that the trading screen rendered. Those specs asserted DOM
presence, CSS classes and Playwright visibility only. They did **not** measure element geometry and
did **not** verify that the chart engine received data. Two user-visible defects passed every run
recorded above. Nothing in this section removes an earlier result — it states what those results did
and did not cover.

### Defects (found by running the app in a browser, not by the suite)
| # | Defect | Root cause | Fix |
|---|---|---|---|
| 1 | Trading screen collapsed into a narrow strip at the top-left | `@quantumtrade/design-tokens` ships the handoff stylesheet verbatim; it assumes `.app-shell > .app-sidebar + .app-main > .trade-body` with `grid-template-columns: 56px 1fr` and makes `.trade-body` itself the 24-column grid. This app renders a sidebar-less shell and puts the 24-column track on `.widget-grid` inside `.trade-body`, but `app.css` only re-declared `grid-template-rows`, so the phantom column and the handoff `.trade-body` grid survived. Measured pre-fix at 1440×900: `.trade-body` 1384×56, `.widget-grid` 138×40, panels 18–66 px. | `apps/web/src/app.css`: explicitly declare `.app-shell { grid-template-columns: 1fr }` and `.trade-body { display: block; grid-template-columns: none; grid-auto-rows: auto; overflow: auto }`, with the reason in a comment. The handoff stylesheet is left untouched. |
| 2 | Chart drew nothing (axis only, 0–10 range) while the feed was healthy | klinecharts 10 **removed** `applyNewData` / `applyMoreData` / `updateData` / `loadMore` in favour of pull-based `setDataLoader` + `setSymbol`/`setPeriod`. The façade called `chart.applyNewData?.(bars)` — optional chaining turned the missing method into a **silent no-op**. `/api/market/candles` returned 200 with ~38 KB of valid candles on every load. | `apps/web/src/chart/klineModule.ts` rewritten as v10-only: `setDataLoader({ getBars, subscribeBar, unsubscribeBar })`, load triggered by `setSymbol` + `setPeriod` (both required), `resetData()` for a same-market reload, `removeIndicator({ paneId })`, precision derived from the data. Required APIs are asserted up-front and **throw** `ChartEngineContractError`; the presence of any v9 method also throws. No optional chaining on a required API, no v9 fallback. |
| 3 | React "unique key" warnings on admin Overview / AI Operations | `key` was placed on the inner `<dt>` instead of the wrapping fragment inside `.map()`. | `<Fragment key={k}>` in both screens. |

### Hardening added alongside the fixes
`packages/chart-adapter` now validates and normalizes bars before they reach any engine
(`isValidBar`, `normalizeBars`): non-finite/negative/impossible-OHLC bars are dropped and counted,
bars are sorted ascending and de-duplicated (last occurrence wins). Load state is observable via
`ChartStatus` — `state`, `barCount`, **`engineBarCount`**, `rejectedCount`, `duplicateCount`,
first/last timestamp, `symbol`, `period`, `error` — mirrored onto the chart mount as `data-*`
attributes, and `empty` / `error` states are rendered instead of a blank canvas. A stale-load guard
(`loadSeq`) and post-dispose callback blocking prevent a superseded or late response from writing
into a disposed engine.

### Test counts (measured this pass)
| Suite | Before | After |
|---|---|---|
| `packages/chart-adapter` unit | 5 | **38** |
| `apps/web` unit | 9 | **24** (new `layout-css.test.ts` 9 + `chart-widget.test.tsx` 6) |
| Workspace unit total (`pnpm test`) | 390 (RC v0.6.1 record) | **426** across 40 files |
| `pnpm e2e` (user, Chromium) | 10 | **26** (+ `flow-l` 8, `flow-m` 8) |
| `pnpm e2e:admin` | 31 | **34** (+ `[31][32][33]`) |

`layout-css.test.ts` is a text-level CSS contract guard: jsdom does not apply imported stylesheets,
so it parses `app.css` plus the handoff `base.css`/`widgets.css` and fails if the explicit overrides
are dropped again. It also fails if a fixed test-viewport width (1366/1440/1920 px) is hard-coded into
the app stylesheet. Rendered geometry is asserted separately in a real browser by `flow-l`.

### Full regression (RC v0.6.4) — Node v24.18.0, 26 commands
Machine-readable summary: `artifacts/logs/phase6-hotfix/regression-summary.tsv` (command, start, end,
duration, exit code, result, log path). Runners: `scripts/phase6-hotfix-regression.sh` (the 19
baseline commands) and `scripts/phase6-hotfix-regression-extra.sh` (hotfix + gate commands).

| # | Command | Exit | Result |
|---|---|---|---|
| 01–18 | install · lint · typecheck · test (426) · build · e2e (26) · test:postgres · test:integration · test:admin · e2e:admin (34) · test:security · test:gateway (13) · e2e:gateway (12) · test:mfa · e2e:mfa · test:chaos · test:ai · eval:ai | 0 | **PASS** |
| 19 | `pnpm audit --prod` | **1** | **FAIL as recorded** — 5 **moderate** (react-router ×4, @hono/node-server ×1), **0 critical / 0 high**. Byte-for-byte the same advisory set as the Phase 6 baseline (`artifacts/logs/phase6-audit-prod-after.json`, `artifacts/logs/ci-audit-prod.json`). Not a regression from this hotfix; not remediable inside its scope (see PHASE6-13). |
| 20 | `flow-l-layout-geometry` | 0 | **PASS** (8) |
| 21 | `flow-m-chart-render` | 0 | **PASS** (8) |
| 22 | `admin-console` | 0 | **PASS** (3) |
| 23 | User E2E × Chromium/Firefox/WebKit | 0 | **PASS** (78) |
| 24 | Admin E2E × Chromium/Firefox/WebKit | 0 | **PASS** (102) |
| 25 | `scripts/ci-audit-gate.sh` (production gate: 0 critical AND 0 high) | 0 | **PASS** |
| 26 | `scripts/phase6-container-validate.sh` | 0 | **PASS** — 17 passed / 0 failed; Trivy 0.72.0 **0 CRITICAL / 0 HIGH** |

Bare `pnpm audit --prod` exits non-zero on **any** severity, which is why it is recorded separately
from the Phase 6 release gate (#25). Both numbers are reported; the failure is not hidden behind the
gate, and the gate is not presented as if the bare command had passed.

### Not Executed (unchanged by this hotfix)
Real-device Safari and mobile browsers; 1,000-VU HTTP and 10,000-WS load; managed PostgreSQL PITR;
external SAST/secret/OSV scanners (semgrep/gitleaks/osv-scanner); real PagerDuty/Slack delivery;
multi-host rolling deploy; image registry publish; BitMart Stage A / Controlled Live Order / Live
OpenAI + live model-eval + live AI E2E.
