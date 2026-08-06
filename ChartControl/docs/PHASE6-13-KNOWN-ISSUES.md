# PHASE 6-13 — Known Issues

- **[RESOLVED v0.6.3] Node.js 20 EOL runtime**: the production image ran on Node.js 20, which reached
  **End-of-Life on 2026-03-24**. An EOL major is not an acceptable production runtime even at a 0/0
  vulnerability scan. **Fixed**: migrated all image stages to `node:24-alpine` (v24.18.0 Active LTS,
  EOL 2028-04-30), pinned by base digest; native module recompiled for Node 24/musl; 0 EOL runtimes;
  container scan still 0 C/0 H; full regression re-run green (PHASE6-20 / PHASE6-16 v0.6.3).
- **[Node 24 note] PID-1 introspection**: Node 24 names the main thread `MainThread`, so `/proc/1/comm`
  no longer reads `node`; PID-1 verification uses `/proc/1/exe` (`/usr/local/bin/node`) + cmdline instead.
- **WebKit user-app order confirmation** (`flow-c-order`, `flow-h-order-full`): the final-confirmation
  click times out on WebKit (Chromium/Firefox pass). Likely a WebKit event/hit-testing quirk on the
  confirm control. Admin E2E passes on all three engines. → follow-up (WebKit interaction fix).
- **WS Gateway server not wired**: the market-data gateway CORE logic is unit-verified, but a running
  WebSocket gateway process (upstream BitMart connection + client fan-out server) is not booted → the
  10k-connection and gateway-rolling-restart load/chaos scenarios are **Not Executed**.
- **MFA UI/API wiring**: the MFA algorithms/policies are complete + unit-verified, but the enrol/challenge/
  step-up screens and API endpoints are not yet wired into the running app → live pairing **Not Executed**
  (Production Release Gate: MFA).
- **Dependency vulnerabilities**: `pnpm audit` reports 59 findings (2 critical / 12 high), predominantly
  transitive **dev-tooling** (eslint → brace-expansion). Runtime-only re-audit + overrides are a follow-up.
- **External security scanners (partial)**: container SBOM + vulnerability scan are now **Executed**
  (Trivy 0.72.0 → 0 Critical / 0 High; PHASE6-20). SAST (semgrep), secret scan (gitleaks), and OSV
  (osv-scanner) remain **Not Executed** (binaries absent).
- **Managed infra Not Executed**: managed PostgreSQL PITR, multi-host cluster/rolling deploy, real
  PagerDuty/Slack delivery, container build/publish → **Not Executed** (single-host dev environment).
- **Live external gates unchanged**: BitMart Stage A, Controlled Live Order, Live OpenAI / model-eval /
  AI-E2E remain **Not Executed** (no AWS credentials / owner authorization); live trading stays disabled.

## Closure update (RC v0.6.1) — resolved / remaining
RESOLVED: WebKit user E2E (10/10 all browsers); production dependency Critical/High (0/0); gateway server
implemented; MFA API+UI+E2E; Docker built+run+validated.
REMAINING (tracked): admin step-up modal → live `/api/auth/mfa/step-up` wiring; BitMart Public WS
full-protocol + 30-min soak; 10,000 WS + 1,000 VU; external SAST/secret/OSV scanners (semgrep/gitleaks/
osv-scanner); managed PITR; real PagerDuty/Slack; multi-host rolling deploy; real-device Safari;
live BitMart Stage A / Controlled Live Order / Live OpenAI. Residual production `pnpm audit` moderates
(react-router / @hono/node-server) — below the High gate; follow-up upgrades planned.

## Hotfix closure (RC v0.6.4)

### RESOLVED this pass
- **[RESOLVED v0.6.4] Trading layout collapse (user-visible, shipped through RC v0.6.3).** The whole
  trading screen rendered as a narrow strip in the top-left. Cause: the verbatim handoff stylesheet in
  `@quantumtrade/design-tokens` assumes a `.app-shell > .app-sidebar + .app-main > .trade-body` DOM
  (`grid-template-columns: 56px 1fr`, `.trade-body` = the 24-column grid), while this app renders a
  sidebar-less shell and puts the 24-column track on `.widget-grid` inside `.trade-body`. `app.css`
  only re-declared `grid-template-rows`, so the phantom column and the handoff `.trade-body` grid
  survived and squeezed `.widget-grid` into one 1/24 cell (measured 1440×900: `.trade-body` 1384×56,
  `.widget-grid` 138×40, panels 18–66 px). **Fixed** in `apps/web/src/app.css` with explicit
  `grid-template-columns: 1fr` on `.app-shell` and `display: block; grid-template-columns: none` on
  `.trade-body`; handoff stylesheet untouched. Guarded by `apps/web/src/__tests__/layout-css.test.ts`
  (9) and `tests/e2e/flow-l-layout-geometry.spec.ts` (8, real bounding boxes at 1366×768 + 1920×1080).
- **[RESOLVED v0.6.4] Chart rendered nothing — klinecharts v10 breaking change hidden by optional
  chaining.** klinecharts 10 **removed** `applyNewData`, `applyMoreData`, `updateData` and `loadMore`;
  data now arrives through `setDataLoader({ getBars, subscribeBar, unsubscribeBar })` with the load
  triggered by `setSymbol` + `setPeriod` (both required, or klinecharts skips the load entirely). The
  façade still called `chart.applyNewData?.(bars)`, so on v10 the call was a **silent no-op**: the BFF
  answered 200 with ~38 KB of valid candles on every load, a correctly sized canvas existed, and
  nothing was drawn. **Fixed** by rewriting `apps/web/src/chart/klineModule.ts` as v10-only with an
  up-front contract assertion that **throws** (`ChartEngineContractError`) when a required v10 method
  is missing **or** when a removed v9 method is present. **No optional chaining on required APIs and
  no v9 fallback path** — `git grep -nE 'applyNewData|applyMoreData|updateData|loadMore'` now matches
  only migration comments and the deliberate `REMOVED_V9_METHODS` detection list.
- **[RESOLVED v0.6.4] Admin React key warnings** (Overview, AI Operations): `key` sat on the inner
  `<dt>` instead of the wrapping fragment inside `.map()`. Fixed with `<Fragment key={k}>`; guarded by
  `tests/e2e-admin/admin-console.spec.ts` `[31]`/`[32]`, which fail on **any** React warning across
  all 10 admin screens.

### Process defect: what the Phase 6 test suite could not see
This is the more important finding. Every suite listed as PASS in PHASE6-08/12 for RC v0.6.1–v0.6.3
asserted **element presence, CSS classes and Playwright visibility**. None asserted:
- the **rendered geometry** of a region (an 18 × 730 panel is "visible"), or
- whether the chart **engine** actually held bars (a canvas element existing is not a drawn chart).

So two user-visible defects were reported as PASS. The suites were not wrong about what they measured;
the documentation did not state the limit. Closed by `flow-l` (bounding boxes, viewport-relative
thresholds, overlap and overflow checks), `flow-m` (engine-held bar count + canvas pixel sampling) and
the admin console spec. Each was verified to actually catch its defect by re-introducing the defect and
confirming failures (7/8, 5/8 and 2/3 respectively) before reverting.

A second-order lesson from that exercise: the first version of `flow-m` failed only **1 of 8** against
the reproduced defect, because the adapter's `barCount` reports what the **loader returned**, not what
the **engine stored**. `ChartStatus.engineBarCount` (`data-engine-bar-count`) was added to separate the
two, after which the same reproduction fails 5 of 8. A status field that cannot distinguish "received"
from "rendered" is not evidence of rendering.

### Corrected record: WebKit availability
Earlier notes describe WebKit as opt-in/absent because host libraries needed `sudo playwright
install-deps`. **In this environment all three engines launch and render** (Chromium 128.0.6613.18,
Firefox 128.0, WebKit 18.0), and both suites run green on all three: **User 78 (26×3), Admin 102
(34×3)**. Real **Safari on Apple hardware** remains **Not Executed** — WebKit is reported as WebKit, not
as Safari.

### REMAINING / open
- **Production dependency moderates (open, out of hotfix scope).** `pnpm audit --prod` exits 1 with
  **5 moderate / 0 high / 0 critical** — identical to the Phase 6 baseline artifacts, so this hotfix
  introduced nothing. Remediation needs **major** upgrades and is a deliberate decision, not a hotfix:
  - `react-router` GHSA-9jcx-v3wj-wh4m (< 6.30.2) and GHSA-2j2x-hqr9-3h42 (< 6.30.4) — reachable by a
    6.30.x patch upgrade from the pinned 6.26.2.
  - `react-router` GHSA-wrjc-x8rr-h8h6 and the `deserializeErrors()` advisory — both require
    **>= 7.18.0**, a major upgrade of `react-router-dom` (routing API changes).
  - `@hono/node-server` GHSA-frvp-7c67-39w9 — requires **>= 2.0.5** (major, from 1.19.17); the flaw is
    a **Windows-only** `serve-static` path-traversal via encoded backslash, and this service runs on
    Linux and does not serve static files through that adapter.
  The Phase 6 release gate (0 critical AND 0 high, `scripts/ci-audit-gate.sh`) **passes**. Both the bare
  command's exit 1 and the gate's PASS are recorded; neither is used to hide the other.
- **`apps/admin` has no unit-test harness** (no jsdom/testing-library wiring). Admin key stability and
  console hygiene are covered by browser E2E instead. Adding a unit harness would change
  `apps/admin/package.json` and the lockfile, which is outside this hotfix's scope → documented gap.
- All previously listed environment-bound gates are unchanged: real-device Safari, 1,000-VU HTTP,
  10,000 WS, managed PostgreSQL PITR, external SAST/secret/OSV scanners, real PagerDuty/Slack,
  multi-host rolling deploy, image registry publish, BitMart Stage A / Controlled Live Order / Live
  OpenAI + live model-eval + live AI E2E. Live trading remains disabled
  (`BITMART_LIVE_TRADING_ENABLED=false`, `BITMART_EMERGENCY_KILL_SWITCH=true`).
