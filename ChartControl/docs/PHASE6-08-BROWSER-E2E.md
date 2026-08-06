# PHASE 6-08 — Browser E2E (Chromium / Firefox / WebKit)

Playwright browser binaries for all three engines are installed; a launch probe
(`scripts/phase6-browser-probe.mjs`) confirmed **chromium + firefox + webkit all launch and render**.
Both E2E suites were run across all three engines (`PW_ALL_BROWSERS=1 PW_WEBKIT=1`).

## User Trading App E2E — `artifacts/logs/phase6-e2e-user-allbrowsers.log`
| Browser | Result |
|---|---|
| Chromium | **10 Passed** |
| Firefox | **10 Passed** |
| WebKit | **8 Passed / 2 Failed** |

WebKit failures: `flow-c-order` and `flow-h-order-full` — the order **final-confirmation** click times out
on WebKit (30s) while passing on Chromium/Firefox. This is a WebKit-specific interaction quirk with the
confirm control (not a data/logic failure — the same flow passes elsewhere). Tracked as a Known Issue
(PHASE6-13); **WebKit ≠ Safari-on-device** (no real-Safari substitution claimed).

## Admin Dashboard E2E — `artifacts/logs/phase6-e2e-admin-allbrowsers.log`
| Browser | Result |
|---|---|
| Chromium | **31 Passed** |
| Firefox | **31 Passed** |
| WebKit | **31 Passed** |
Total **93 passed** (30 required scenarios + [21b] × 3 engines).

## Coverage (per Phase 5/6 scope)
Auth/session, RBAC/permission, read-only trading, AI workspace, audit + export, incident FSM,
feature-flag 409, kill-switch step-up + live-blocked, release-gate no-fake-pass, layout/chart persistence,
theme, i18n, offline/resume, WebSocket reconnect, session-expiry, CSRF, API 500/429.

## Not Executed
Real Safari on macOS/iOS hardware, and real mobile browsers → **Not Executed** (WebKit engine is the
closest proxy and is reported separately).

## Closure update (RC v0.6.1)
WebKit user-app failures RESOLVED — root cause was the AI-copilot `grid-column: 16 / span 9` collapsing
to ~48px on WebKit, clipping the order submit button. Fixed by rendering the order confirmation as a
centered modal overlay (escapes the panel clip); no test skipped. **User E2E now Chromium 10 / Firefox 10
/ WebKit 10; Admin E2E 31/31/31.** Real-device Safari stays Not Executed (WebKit engine proxy).

## Hotfix closure (RC v0.6.4) — what the earlier PASS records did NOT verify

The results above are accurate **as far as they went**, and that limit was not stated. Both suites
asserted element **presence and Playwright "visibility"**; neither asserted the **rendered geometry**
of the shell nor whether the chart engine actually held any data. Two defects were therefore reported
as PASS by every run listed above while the running app was visibly broken:

1. **Trading layout collapse.** `.app-shell` inherited `grid-template-columns: 56px 1fr` from the
   verbatim handoff stylesheet (which assumes an `.app-sidebar` + `.app-main` DOM this app does not
   render), and `.trade-body` inherited the handoff's 24-column grid, so the app's own
   `.widget-grid` was placed inside a single 1/24 cell. Measured on Chromium at 1440×900 before the
   fix: `.trade-body` **1384×56**, `.widget-grid` **138×40**, panels **18–66 px** wide. Playwright
   still considered every widget "visible" because a 18×730 box is visible.
2. **Blank chart.** The klinecharts façade called the **v9** `applyNewData` through optional
   chaining. klinecharts 10 removed it, so the call was a **silent no-op**: `/api/market/candles`
   returned HTTP 200 with ~38 KB of valid candles on every load, a canvas of the right size existed,
   and nothing was ever drawn. No assertion looked past "a canvas element exists".
3. **Admin React key warnings** on Overview / AI Operations. No spec inspected the console.

### New specs that close the gap
| Spec | Asserts |
|---|---|
| `tests/e2e/flow-l-layout-geometry.spec.ts` (8) | `boundingBox()` of `.app-shell` / `.app-header` / `.symbol-header` / `.trade-body` / `.widget-grid` / chart mount / every grid child; band overlap = 0; no horizontal overflow; widest panel ≥ 25 % of viewport. Run at 1366×768 **and** 1920×1080, across runtime resize, dark+light, ko+en, reduced motion, layout-edit mode and the non-grid routes. Thresholds are viewport **fractions**, so the CSS cannot be tuned to one test resolution. |
| `tests/e2e/flow-m-chart-render.spec.ts` (8) | candle request status 200; adapter-reported `data-bar-count` > 50; **`data-engine-bar-count` equal to it** (the engine's own count — this is what a data-dropping façade fails); first/last timestamps finite, ordered, plausible epoch-millis; canvas pixel sampling (distinct colours > 20, non-background ratio > 2 %); symbol and timeframe change reload; empty-feed → empty state; failing feed → error state; impossible OHLC rejected by the wire schema; out-of-order/duplicate bars sorted and de-duplicated; zero console errors and no `is not a function`. |
| `tests/e2e-admin/admin-console.spec.ts` ([31][32][33]) | Walks all 10 admin screens and fails on **any** React warning or console error; `<dt>` labels unique and `dt`/`dd` paired; admin sidebar/main geometry and overlap at both viewports. |

### Regression proof (each defect re-introduced, then reverted; file restored byte-identical)
| Defect re-introduced | Result |
|---|---|
| `app.css` overrides removed (pre-hotfix CSS) | `flow-l` **7 of 8 failed** (`.trade-body` height 56 vs > 400). The 8th covers non-grid routes, which do not use `.trade-body`. |
| v9 `applyNewData?.()` silent no-op restored | `flow-m` **5 of 8 failed**. The 3 passing cases are empty-state / error-state / schema-rejection, which legitimately do not depend on engine data. |
| `key` moved back onto the inner `<dt>` | `admin-console` **2 of 3 failed** with `Each child in a list should have a unique "key" prop`. |

The first attempt at `flow-m` failed only **1 of 8** against the reproduced defect, because the
adapter's bar count reflects what the **loader** returned, not what the **engine** stored.
`ChartStatus.engineBarCount` (exposed as `data-engine-bar-count`) was added specifically to separate
those two facts, after which the same reproduction fails 5 of 8.

### Browser matrix (RC v0.6.4, `PW_ALL_BROWSERS=1 PW_WEBKIT=1`)
| Suite | Chromium | Firefox | WebKit | Total |
|---|---|---|---|---|
| User Trading App | **26 passed** | **26 passed** | **26 passed** | **78** |
| Admin Dashboard | **34 passed** | **34 passed** | **34 passed** | **102** |

Engine versions probed in this environment: Chromium 128.0.6613.18, Firefox 128.0, WebKit 18.0 — all
three launch and render here, so nothing in this matrix is Not Executed. Logs:
`artifacts/logs/phase6-hotfix/23-e2e-user-3browsers.log`,
`artifacts/logs/phase6-hotfix/24-e2e-admin-3browsers.log` (plus the standalone
`e2e-user-all-browsers.log` / `e2e-admin-all-browsers.log`). No test was skipped, deleted or made
conditional. Per-browser coverage includes trading layout geometry, candle rendering, resize, theme,
i18n, console errors and admin React key warnings.

### Still Not Executed
Real **Safari on macOS/iOS hardware** and real mobile browsers. The WebKit engine is the closest
available proxy and is reported as WebKit — **not** as Safari. The Production General Availability
gate stays closed on this item.

### Allowed console noise (admin spec, with reasons)
Only these are ignored, and nothing React-related is ever ignored:
- `Failed to load resource … 401/403` — the admin shell probes `/api/admin/overview` **before** login
  to choose between the login form and the dashboard. The 401 is the designed answer and the browser
  logs it independently of application code.
- `net::ERR_ABORTED` / `NS_BINDING_ABORTED` — request cancellation on navigation (browser-level).
