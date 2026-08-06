# QuantumTrade AI — Phase 1 Final Report

Date: 2026-07-28 (Node-24 migration 2026-07-30) · Container runtime: **Node.js 24 LTS (v24.18.0)** on
Alpine 3.24.1 · toolchain pnpm 9.15 · Linux

## Release status — Phase 6 Closure (RC v0.6.3 — Node.js 24 LTS migration)

| Field | Value |
|---|---|
| Phase 6 | RC **phase-6-rc-v0.6.3** (branch `phase-6-production-hardening`; base `6ce4fd3` = `phase-5-approved-v0.5.0`) |
| Prior tags | `phase-6-rc-v0.6.2` / `v0.6.1` / `v0.6.0` + all earlier tags **unchanged** |
| Live trading | **disabled** (`LIVE=false`, `KILL_SWITCH=true`) |

### Node.js 20 EOL finding → Node.js 24 LTS transition (v0.6.3)
Node.js 20 reached **End-of-Life on 2026-03-24**. A container that scans 0/0 is still **not eligible as a
production runtime** on an EOL major. All three image stages (builder, proddeps, runtime) were migrated
from `node:20` to **`node:24-alpine`** (Node major + musl ABI aligned), pinned by base digest
`node@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd`. Verified runtime:
`node --version` = **v24.18.0** (Active LTS, EOL 2028-04-30), ABI modules 137, OpenSSL 3.5.7,
Alpine 3.24.1, image id `sha256:772911dabc36…d326f9ea` (69.8 MB), **0 EOL runtimes**. Native module
`better-sqlite3` recompiled for Node 24/musl and verified via real DB open/write/read/ALTER-migration
(sqlite 3.49.2). engines `>=24.0.0`, CI (ci.yml 24.18.0, phase6-ci.yml 24), tsup targets `node24`
aligned. Container validation **17/17** (PID-1 check updated: Node 24 names the main thread
`MainThread`, so PID 1 = node is verified via `/proc/1/exe` + cmdline; SIGTERM still delivered).
Trivy 0.72.0 SBOM + scan on the Node-24 image = **0 CRITICAL / 0 HIGH** (0 all severities).

The 5 mandatory closure fixes are complete (details in `docs/PHASE6-16-CLOSURE-PASS.md`):
1. **Dependency security** — production `pnpm audit` **0 critical / 0 high** (hono 4.12.32, @hono/node-server
   1.19.17, @remix-run/router ≥1.23.2, ws 8.21.0); CI gate `scripts/ci-audit-gate.sh` PASS; dev-only
   exceptions documented with prod-exclusion evidence (PHASE6-17).
2. **WebKit** — user E2E **Chromium 10 / Firefox 10 / WebKit 10** (root-caused grid-column collapse →
   order-confirmation modal; no test skipped) (PHASE6-08).
3. **Central Market Data Gateway server** — real `apps/market-gateway` (health/auth/origin/sub-limit/
   validation/dedup/cache/gap-fill/orderbook-resync/Redis-pubsub/back-pressure/circuit-breaker/metrics/
   graceful-shutdown; MOCK_REPLAY/BITMART_PUBLIC modes); **E2E 12**, WS load 100 + 1,000 conns (PHASE6-18).
4. **MFA full** — API + Account-Security UI + Login challenge; **API 16 + browser E2E 16 (18 scenarios)**;
   encrypted secret, hashed recovery, replay guard, lockout, session rotation, step-up (PHASE6-03/19).
5. **Docker (Node 24 LTS; SBOM + scan)** — image `quantumtrade-api:phase6-closure`
   (**node:24-alpine, v24.18.0, 69.8 MB**) built + run + validated (17/17): non-root uid 10001, PID 1 node,
   health/ready/live 200, graceful SIGTERM 0.12s, read-only rootfs + tmpfs, prod-deps-only, no bundled npm,
   no secrets, prod fail-closed, LIVE=false, KILL_SWITCH=true. **Trivy 0.72.0 SBOM (CycloneDX+SPDX) +
   OS/library vuln scan = 0 CRITICAL / 0 HIGH**; CI scan gate PASS (PHASE6-20).

Full regression (18 commands, all exit 0): test 390 · e2e 10 · postgres 12 · integration 33 · admin 30 ·
e2e:admin 31 · security 23 · gateway 13 · e2e:gateway 12 · mfa 36 · e2e:mfa 16 · chaos 11 · load (HTTP
baseline) · prod-audit gate PASS. **Not Executed** (unchanged): BitMart Stage A / Controlled Live Order /
Live OpenAI / 1,000 VU / 10,000 WS / managed PITR / multi-host rolling / real-device Safari / external
SAST·secret·OSV scanners (semgrep/gitleaks/osv-scanner) — none marked Passed. (Container SBOM +
vulnerability scan are now **Executed** — 0 C/0 H.)

## Release status — Phase 5 APPROVED (v0.5.0)

| Field | Value |
|---|---|
| Phase 5 | **PASS / Approved** (owner sign-off) |
| Approved version | **v0.5.0** |
| Approved commit | **6ce4fd3** (= `phase-5-rc-v0.5.2`; Secure Admin & Operations Dashboard + Admin UI Closure) |
| Approval tag | **phase-5-approved-v0.5.0** (annotated; points at 6ce4fd3) |
| Phase 5 RC tags | **phase-5-rc-v0.5.0 / v0.5.1 / v0.5.2** — unchanged (not moved) |
| Restore | `git checkout phase-5-approved-v0.5.0` |
| Approved source archive | `quantumtrade-ai-phase-5-approved-v0.5.0.zip` (+ `.sha256`) |

Scope of the approved commit `6ce4fd3`: full Phase 5 implementation (admin RBAC domain/schemas,
migration 0005, `/api/admin` routes, separate `apps/admin` bundle) plus the Admin UI Closure
(screens A–K, 13 common states, i18n ko/en, dark/light, a11y) with **30 required admin E2E scenarios**
(Chromium 31 incl. [21b]) and the full closure regression all exit 0 (test 277, User E2E 10, postgres
12 real PG17, integration 33, test:admin 30, e2e:admin 31).

### Route Shadowing defect (found + fixed during closure)
- **Cause:** both the Phase-2 auth router and the Phase-5 admin router were mounted at `/api`, and the
  auth router was registered **first** — so `GET /api/admin/audit` and `GET /api/admin/users/:id`
  resolved to the legacy Phase-2 support handlers (the auth-audit repo + a `{ok:true}` stub) instead of
  the Phase-5 admin handlers (append-only `admin_actions` + redacted user detail). The admin dashboard's
  audit list and user detail were reading the wrong data.
- **Fix (files):** `apps/api/src/index.ts` — the Phase-5 admin block (repo/seed/health/mount + dev seed)
  was relocated to mount **before** the auth router so `/api/admin/*` resolves to the Phase-5 handlers;
  the legacy endpoints remain in `apps/api/src/auth-routes.ts` for the auth router's own unit tests.
  Supporting closure edits: `tests/e2e-admin/playwright.config.ts` (admin origin CORS + rate budget),
  `apps/admin/src/screens/{Incidents,Audit}.tsx`, `apps/admin/src/{api,i18n}.ts`,
  `apps/api/src/{env.ts,admin/admin-routes.ts}`.
- **Regression:** `test:admin` 14 admin-api + 19 auth-api pass (legacy endpoints intact); `e2e:admin`
  31 passed on Chromium; audit-explorer E2E [15] now shows the recorded `user.revoke_sessions`
  admin_action, and user-detail E2E [6] shows the redacted admin detail — proving the correct handlers.

Production Release Gate **Not Executed** items are preserved unchanged (BitMart Stage A, Controlled Live
Order, Live OpenAI/eval/AI-E2E, Firefox/WebKit CI gate, 1k-user/10k-WS load, central market-data
gateway, managed backup/PITR, MFA). Live trading stays disabled. Phase 6 is a separate branch (not part
of this approval).

## Release status — Phase 2 APPROVED (v0.2.0)

| Field | Value |
|---|---|
| Phase 2 | **PASS / Approved** |
| Approved version | **v0.2.0** |
| Code commit | **3b1062b** (Phase 2 Closure implementation) |
| Final documentation commit | **9352f96** (contains 3b1062b) |
| New tag | **phase-2-approved-v0.2.0** (annotated; on this approval commit, which contains 9352f96 + 3b1062b) |
| Phase 1 baseline tag | **phase-1-approved-v0.1.0** (@ 1a43f8e, unchanged) |
| Restore | `git checkout phase-2-approved-v0.2.0` |

Test-count clarification (do not conflate):
- `pnpm test` (no `PG_TEST_URL`): **128 unit passed**, and the **11 PostgreSQL integration tests are
  SKIPPED** (require a real database).
- Real PostgreSQL 16 integration (`PG_TEST_URL` set, Docker): **11 passed, 0 skipped**
  (`artifacts/logs/pg-integration.log`).
- E2E: **10 Chromium passed**. Phase 1 baseline (99 unit / 9 Chromium E2E) remains **no-regression**.

Remaining operational verification for Phase 2 stays open in `docs/PRODUCTION-RELEASE-GATE.md`
(managed Postgres provisioning + pool sizing under load + backup/PITR, real email delivery, KMS
envelope encryption, 1k-user / 10k-WS load, WebKit E2E, central market-data gateway). These are
BETA/PROD gate items, not Phase-2 failures. Baseline is frozen; Phase 3 not started.

## 0. Phase 1 Closure Pass (2026-07-28) — executed evidence

Closure commit SHA: **1a43f8e** (`1a43f8efa2518e956b662668f3d78a3ef0b49487`).
Baseline (pre-closure): `0caa482`. All six commands re-run after fixes; RAW logs in `artifacts/logs/`.

### Execution evidence (all exit 0)
| Command | Start (UTC) | End (UTC) | Exit | Result | Log |
|---|---|---|---|---|---|
| `pnpm install --frozen-lockfile` | 21:06:35 | 21:06:36 | 0 | up to date | `artifacts/logs/install.log` |
| `pnpm lint` | 21:06:36 | 21:06:37 | 0 | 0 errors (ESLint 9) | `artifacts/logs/lint.log` |
| `pnpm typecheck` | 21:06:37 | 21:06:47 | 0 | 8/8 projects | `artifacts/logs/typecheck.log` |
| `pnpm test` | 21:06:47 | 21:06:51 | 0 | **99 passed / 0 failed** | `artifacts/logs/test.log` |
| `pnpm build` | 21:06:51 | 21:07:02 | 0 | ok; entry 284 kB min | `artifacts/logs/build.log` |
| `pnpm e2e` | 21:07:02 | 21:07:12 | 0 | **9 passed** (Chromium) | `artifacts/logs/e2e.log` |

Env for all: `Node v20.20.2 · pnpm 9.15.0 · Linux · git 1a43f8e`.
Unit test breakdown: schemas 14 · chart-adapter 5 · exchange-adapters 27 · domain 37 · api 7 · web 9.
Browser matrix (`PW_ALL_BROWSERS=1`): **Chromium 9/9 + Firefox 9/9 = 18 passed**
(`artifacts/logs/e2e-all-browsers.log`). WebKit = **Not Executed** locally (host libraries need
`sudo playwright install-deps`, no root) → runs in CI (`.github/workflows/ci.yml`, `PW_WEBKIT=1`).

### What was implemented in the closure pass (minimal-change)
- **Risk Check (real)** — `packages/domain/src/risk-gates.ts` (9 gates, Decimal-safe, 9 unit tests) +
  UI checklist in `OrderPreviewConfirm` that **disables the final submit when any gate fails** and
  shows reasons; shows side/type/entry/qty/leverage/margin/value/fee/liq/SL/TP/maxLoss/AI/SIM.
- **Chart overlays + interaction** — overlay store + `OverlayPanel` (select/edit-price/lock/hide/
  delete, AI badge, **user-edited** sync into the Signal Card); AI signal populates overlays; chart
  canvas renders them via `KLineChartAdapter.setOverlays` (klinecharts price lines).
- **Signal→Order flow** — approve→create draft→**Order Entry autofill**→preview→risk→final
  confirm→simulated submit→**success toast**→**mock position** in the Positions widget.
  Approve ≠ Submit is preserved (server 403 without confirmation token).
- **i18n ko-KR/en-US** — `apps/web/src/i18n/*` catalogs + `useT` + Intl number/price/percent/date
  formatters; wired across nav, sim stripe, widget states, settings, order entry, AI copilot, order
  preview/risk; `<html lang>` follows locale.
- **Real BitMart public WS** — `tests/integration/bitmart-ws-verify.mjs` executed 60s (log:
  `artifacts/logs/bitmart-ws-verify.log`).
- **Market-data architecture proof** — `docs/17-market-data-architecture.md`.
- **Failure scenarios** — `docs/16-failure-scenarios.md` (12/12 reproduced).

### Real BitMart WS verification result (`artifacts/logs/bitmart-ws-verify.log`)
`ok:true` · opens 2 (initial + reconnect after 1 forced disconnect) · **maxConcurrentSockets 1 ·
listenerCountFinal 1** (no leak across 3 symbol + 3 timeframe switches) · live messages: ticker 23,
kline 25, depth 120, trade 59 · reconnect with exponential backoff+jitter. **Honest note:** the
text `ping`→`pong` heartbeat was **not** echoed by the server (pongs 0); liveness was maintained by
the continuous data stream. The full-spec 10-min / 20-switch run is available via
`WS_DURATION_MS=600000 WS_SYMBOL_SWITCHES=20 WS_TF_SWITCHES=20` (Not Executed here — time-boxed).

### Load test — MEASURED (k6 v0.52, single-node BFF, MOCK_REPLAY)
| Profile | reqs | throughput | p50 | p95 | p99 | error rate |
|---|---|---|---|---|---|---|
| Smoke (10 VUs, 20s) | 1600 | 78.6/s | 0.61 ms | 4.34 ms | 11.4 ms | 0.00% |
| Baseline (100 VUs, 30s) | 23,716 | 777.5/s | 1.12 ms | 4.56 ms | 7.97 ms | 0.00% |

Logs: `artifacts/logs/loadtest-smoke.log`, `loadtest-baseline.log`. **Not measured / Not Executed**
(do not infer): 1,000-user profile, 10k-WS staged, CPU, memory, cache-hit ratio, dropped messages,
queue depth — no instrumentation/capacity in this sandbox; scripts provided in `tests/load/`.

### Bundle analysis — MEASURED (`artifacts/logs/bundle-analysis.log`)
Initial route entry `index-*.js` = **minified 278–284 kB · gzip 85–87 kB · brotli 74 kB**
(the "279 kB" figure is **minified**, not gzipped). Sourcemaps: **disabled** (no `.map` emitted).
Per-chunk: `ChartWidget`(klinecharts, lazy) 233 kB min / 61 kB gz / 52 kB br · CSS 78/13/11 ·
`WidgetHost`(widgets, lazy) 65/24/20 · route chunks 0.7–3.7 kB each. **ECharts: not bundled**
(analytics/admin only; absent from the web app). Largest dep = klinecharts (isolated, on-demand).
Route- and widget-level lazy loading applied; chart/trade functionality intact (e2e green).

### Closure classification (per requested categories)
- **Fully implemented and executed:** 6-command pipeline; 99 unit tests; E2E flows A–J on
  Chromium+Firefox; Risk Check gates (logic+UI+block); chart overlay interaction (panel);
  signal→order incl. toast + mock position; i18n ko/en + locale formatting; BitMart public **REST**
  (candles/ticker/symbols) live; **BitMart public WS** connect/parse/reconnect/no-leak (60s run);
  k6 smoke + baseline; bundle analysis; code-splitting.
- **Implemented and unit-tested only:** order/signal state machines, rate limiter/circuit breaker,
  candle/orderbook/trade normalization, layout migration/recovery, ChartCommand allowlist.
- **Implemented but live integration not executed:** BitMart WS heartbeat pong (server didn't echo
  text ping); chart **canvas** overlay pixel-drag (klinecharts-native; interaction verified via the
  overlay panel, not via canvas mouse-drag).
- **Documented only:** central Market Data Service / Redis fan-out / horizontal scaling (`docs/17`);
  auth/DB/KMS; BitMart Demo trading adapter.
- **Not executed:** WebKit E2E locally (host deps; CI-ready); k6 1,000-user & 10k-WS; CPU/mem/cache
  metrics; full 10-min WS soak.
- **Failed:** none.
- **Known issue:** WS text-ping heartbeat unanswered (documented); single-node market data (not
  production-scale); order book/trades are mock in BITMART_PUBLIC mode (WS ingestion is Phase 2).

## 0b. Phase 2 — Authentication, User Account, DB Persistence & Security Foundation (post-baseline, additive)

Built on the frozen baseline (`phase-1-approved-v0.1.0` @ `1a43f8e`) as **new code only**; the
approved Phase-1 surface is unchanged. Planning docs: `docs/PHASE2-00..06`.

### Regression check (Phase 1 preserved)
- **Unit: 116 passed** (Phase-1 99 intact + Phase-2 17 new = auth 10, api-auth 7).
- **E2E: 10 passed** (Phase-1 9 intact + 1 new auth round-trip); all six commands exit 0.
- No edits to `packages/{schemas,domain,exchange-adapters,chart-adapter,design-tokens,config}` logic;
  BFF existing routes unchanged; auth mounted under NEW `/api/auth|account|admin/*`.

### Implemented & tested (this phase)
- **DB persistence:** `better-sqlite3` (dev) behind repository interfaces; transactional forward
  migration runner (`apps/api/src/db`); Postgres-portable DDL (`infrastructure/postgres/`).
  Tables: users/sessions/roles/user_preferences/layouts/audit_logs/schema_migrations.
- **Auth (`packages/auth`):** scrypt hashing (timing-safe), opaque server sessions with idle+
  absolute expiry, CSRF double-submit, RBAC (user/admin), login rate limiter, audit logging,
  generic errors (no user enumeration). 10 unit tests.
- **BFF routes:** `/api/auth/{csrf,register,login,logout,me}`, `/api/account/me`, `/api/admin/audit`
  with HttpOnly session + readable CSRF cookies (Secure default; `AUTH_COOKIE_INSECURE` for http
  dev). 7 API integration tests (cookie/CSRF/rate-limit/RBAC/duplicate). Graceful: DB failure
  disables auth only, market/sim/ai keep working (`AUTH_ENABLED` flag).
- **Web:** login/signup wired to the API (session + logout); `/trade` stays public (no gating);
  1 auth e2e.

### Interface-only / future (unchanged from gates)
Exchange credential vault (`ICredentialVault` seam, no secret stored), KMS envelope encryption,
MFA (structure reserved), OAuth/IdP, admin app. Central Market Data Gateway remains in the
Production Release Gate.

## 0j. Phase 5 — Secure Admin & Operations Dashboard (branch `phase-5-admin-dashboard`)

From Phase 4 RC `phase-4-rc-v0.4.0` (@`c80bd2b`); Phase 1/2 approval tags + Phase 3/4 RC tags NOT moved.
Pending live gates (BitMart Stage A, Private WS soak, Controlled Live Order, Live OpenAI, Live-model
eval, Live AI E2E, Firefox/WebKit, load, central gateway, backup/restore, MFA) remain **Not Executed**
(never auto-Passed). New RC tag: **`phase-5-rc-v0.5.0`**. No Phase 6 started.

### Built
- **`packages/admin-domain`** (16 unit tests): admin permission set (20) + role map (SUPPORT/ANALYST/
  ADMIN/SUPER_ADMIN; **USER/PRO_USER denied**), default-deny `hasAdminPermission`; RBAC invariants
  (no self-role-change, privilege-escalation prevention, ADMIN can't touch ADMIN/SUPER_ADMIN,
  last-SUPER_ADMIN guard); state machines (incident, release-gate **no-fake-pass** + **WAIVED**
  SUPER_ADMIN+reason+future-expiry+30-day prod cap, kill-switch **fail-closed** live scopes,
  prompt-change); redaction (secrets/CSV/HTML/mask).
- **`packages/admin-schemas`**: Zod `.strict()` input schemas + length limits + optimistic-lock version.
- **Migration 0005** admin_* (SQLite + PostgreSQL + down): admin_actions (append-only), feature_flags
  (+history), kill_switches (+history), incidents (+events), release_gates (+evidence),
  admin_sessions_metadata, admin_saved_filters, admin_notifications, prompt_change_requests,
  prompt_approvals; optimistic `version`.
- **`apps/api/src/admin`**: repos + routes mounted at `/api/admin` (overview, users incl.
  disable/enable/revoke-sessions/role, exchange-connections, orders, positions, ai usage/errors, system
  health, audit + export, incidents, feature-flags, kill-switches, release-gates). Every route:
  auth + admin-role gate + rate-limit + permission (default-deny) + (mutations) CSRF + Zod validation +
  append-only audit + redaction + `Cache-Control: no-store`. Startup seeds kill switches (live scopes
  ACTIVE), feature flags, and release gates (pending = NOT_EXECUTED).
- **`apps/admin`**: SEPARATE Vite React app/bundle (port 5174, own entry, NOT in `/trade`) — login +
  overview + users with permission/error/unavailable states; MFA shown as `Not Implemented / Release Gate`.

### Security guarantees (verified)
Default-deny server-side RBAC; USER/PRO_USER blocked; privilege escalation, self-role-change, and
last-SUPER_ADMIN removal blocked; disabled-admin sessions revoked immediately; kill switch requires
step-up + optimistic version (409 on concurrent edit) and is fail-closed for live trading; release
gate cannot be PASSED without evidence and ADMIN cannot WAIVE; audit is append-only + redacted; CSV/
SQLi/secret-exposure defended. No admin order submission, no secret exposure, no live-trading enable.

### Execution evidence (all exit 0; `artifacts/logs/phase5-*.log`)
lint 0 · typecheck 14/14 · `pnpm test` **276 passed** (offline) · build ok (apps/admin separate
bundle) · e2e **10** (Chromium) · `pnpm test:postgres` **12** (real PG17, incl. migration 0005 + admin
tables) · `pnpm test:integration` **33** · `pnpm test:admin` **29** (admin-domain 16 + admin-api 13).

### Not Executed (honest)
Full admin-UI screen set beyond login/overview/users (backed by tested APIs) = documented follow-up;
admin-app Playwright E2E, MFA/step-up real provider, multi-node kill-switch/flag propagation,
distributed rate limit = gates. Pending Phase 3/4 live gates unchanged (Not Executed). See PHASE5-11/12.

### Phase 6 — Security, Scale, Reliability & Production Ops (branch `phase-6-production-hardening`) — RC `phase-6-rc-v0.6.0`

Branched from the actual final Phase 5 SHA `6ce4fd3` (= `phase-5-rc-v0.5.2`). **Baseline note:** the
requested tag `phase-5-approved-v0.5.0` does NOT exist — Phase 5 carries only RC tags (a CONDITIONAL
PASS); no approval tag was fabricated and no existing tag was moved (recorded in PHASE6-00).

New verified workspace packages (all typecheck + lint clean): `@quantumtrade/mfa` (20 — RFC6238 TOTP,
one-time hashed recovery codes, AES-256-GCM secret cipher, lockout, step-up policy + last-SUPER_ADMIN
guard), `@quantumtrade/observability` (10 — structured logger with required fields + redaction + log-
injection sanitize, OTel tracer adapter, metrics p50/95/99, alert rule engine), `@quantumtrade/cluster`
(10 incl. REAL Redis — versioned CAS + pub/sub invalidation, ~1ms propagation, fail-closed live scopes),
`@quantumtrade/market-gateway` (13 — dedup/refcount, candle cache, orderbook snapshot+delta+resync,
seq dup/out-of-order/gap/stale, backoff+jitter, circuit breaker, slow-consumer isolation, per-user rate
limit), `@quantumtrade/security` (9 — CSP/HSTS headers, open-redirect/SSRF/host/CORS/proto-pollution/
mass-assignment guards, WS auth+origin, idempotency), `@quantumtrade/chaos` (11 — mock/proxy fault
injection). Scripts added: test:mfa/gateway/cluster/observability/security/chaos/load.

Real executions: Redis multinode (16379, ~1ms), PostgreSQL 17 backup/restore drill (integrity PASS,
RTO=136ms, encrypted, migration up/down/re-up; managed PITR Not Executed), k6 HTTP baseline (100 VUs,
325,307 reqs, 0 fail, p95≈8.15ms), 3-browser E2E (User: Chromium 10/Firefox 10/WebKit 8[2 fail]; Admin:
31/31/31 = 93), `pnpm audit` (59 findings, mostly dev-tooling). Deployment: non-root Dockerfile +
liveness/readiness + graceful shutdown (validated locally; production deployed = No).

Full regression — all 15 commands + audit exit 0 (`artifacts/logs/phase6-*.log`): install · lint ·
typecheck · test **362** · build · e2e **10** · postgres **12** · integration **33** · test:admin **30** ·
e2e:admin **31** · test:security **23** · test:gateway **13** · test:mfa **20** · test:chaos **11** ·
test:load (baseline). Docs PHASE6-00..15 + this section + Production Release Gate P6 rows.

**Not Executed (honest):** live BitMart Stage A / Controlled Live Order, Live OpenAI/eval/AI-E2E,
1,000-user load, 10k WebSocket, WS gateway server wiring, MFA live UI/API, external scanners
(trivy/semgrep/gitleaks/syft/osv), managed PITR, real PagerDuty/Slack, multi-host rolling deploy,
container build/publish. Live trading stays disabled (`LIVE=false`, `KILL_SWITCH=true`). Phase 7 not
started. Prior tags (v0.1.0/v0.2.0 approved; v0.3.x/0.4.0/0.5.x RC) NOT moved.

---

### Admin UI Closure Pass (2026-07-29) — new RC `phase-5-rc-v0.5.2`
The Admin dashboard UI is REAL: `apps/admin` (separate Vite bundle, port 5174, route code-split via
`React.lazy`) implements screens A–K (Login/Access-Denied, Overview, Users incl. disable/enable/revoke/
role with confirm+reason+step-up, Exchange masked, Orders&Positions read-only, AI Ops, Audit +search
+CSV/JSON export, Incidents create/transition, Feature Flags 409, Kill Switches step-up + live-blocked,
Release Gates no-fake-pass) with 13 common states, i18n (ko/en), dark/light, and a11y (PHASE5-14).
Verified the `/trade` (apps/web) bundle contains **0** admin-code references. Admin initial JS 156.9 kB
raw / 51.3 kB gzip; route chunks code-split (PHASE5-16). Playwright admin project + `pnpm e2e:admin`
(PHASE5-15). This RC (v0.5.2) closes the E2E gap from v0.5.1 (which had only 7 admin flows): the admin
E2E now covers **all 30 required scenarios** on Chromium (+[21b]). It also fixes a real route-ordering
defect — the Phase-5 admin router is now mounted **before** the Phase-2 auth router so `/api/admin/audit`
and `/api/admin/users/:id` resolve to the admin dashboard handlers (append-only `admin_actions` +
redacted detail) instead of the legacy support endpoints; and adds a minimal incident status-transition
control + audit action filter (dev-only role seed + e2e CORS/rate-limit config; no live-trading enable).
Closure regression (all exit 0, `phase5-closure-*.log`): lint 0 · typecheck 15 · test **277** · build ok
· **User App E2E 10** (Chromium) · postgres **12** (real PG17) · integration **33** · test:admin **30**
(admin-domain 16 + admin-api 14 incl. rate-limit) · **Admin App E2E 31** (Chromium — 30 required + [21b]).
**Firefox/WebKit Admin E2E = Not Executed** (Firefox opt-in `PW_ALL_BROWSERS=1`; WebKit not in matrix).
Security scenarios executed end-to-end in the browser now include priv-esc/IDOR/CSRF/session-expiry/
secret-masking/CSV-injection/409-conflict/fake-gate/500/429/offline; XSS/SQLi + multi-node/prompt/audit-
immutability/session-hijack remain Documented / Production Release Gate (PHASE5-09). No admin order
submission, no secret exposure, no live-trading enable. Prior tags (v0.5.0 `cf99631`, v0.5.1 `79f97eb`)
NOT moved; pending live gates unchanged (Not Executed).

---

## 0i. Phase 4 — Production AI Copilot Integration (branch `phase-4-production-ai`)

From Phase 3 RC `phase-3-rc-v0.3.1` (@`d008719`); Phase 1/2/3 preserved, their tags NOT moved. BitMart
Stage A / Private WS soak / Controlled Live Order remain **Not Executed** Production Release Gate items
(NOT changed to Passed). New RC tag: **`phase-4-rc-v0.4.0`**.

### What was built
- **`packages/ai`** (framework/provider-agnostic, 31 unit tests): 10 interfaces; providers Fake /
  MockReplay / OpenAIResponses (Responses API via injected transport, `store:false`, models from
  config); typed streaming normalization + tool-call accumulation + dedup + abort; strict read-only
  **tool registry (12 tools)** with `additionalProperties:false` + `ToolLoopGuard`; ChartCommand v2 +
  SignalObject v2 + state machine (approval ≠ submit); versioned+checksummed **prompt registry** with
  delimited untrusted input; **safety policy** (prompt-injection, profit-guarantee, unsourced-price,
  auto-trade, stale-data, markdown XSS sanitize); **cost controller** (rate/token/cost/system-budget/
  concurrency/circuit-breaker, integer micro-USD, config pricing, backoff+jitter); **orchestrator**
  validated pipeline; **evaluation** service + dataset.
- **`apps/api`**: migration **0004** ai_* tables (SQLite + PostgreSQL; EXTENDS the Phase 2
  ai_conversations/ai_messages/ai_signals and ADDs ai_runs/ai_tool_calls/ai_tool_outputs/chart_commands/
  chart_overlays/ai_usage_records/ai_prompt_versions/ai_evaluation_runs/ai_feedback); user-isolated
  conversation/usage repos (no chain-of-thought, only reasoning_summary); **OpenAI secret via AWS
  Secrets Manager** (fail-closed, separate from BitMart, never logged/returned); AI **SSE routes**
  (`/api/ai/copilot`, `/api/ai/status`, conversation CRUD) with auth/CSRF/RBAC(`signal.write.self`)/
  quota; production startup fail-closed guard; env wiring (safe defaults: AI disabled, provider mock,
  `store:false`).

### AI safety guarantees
AI may only read market data, analyze, explain, and PROPOSE ChartCommands/overlays/signals/order-drafts
for explicit user approval. It cannot submit/cancel/modify orders, change leverage/position mode,
withdraw/transfer, access secrets, bypass the Risk Engine, act without confirmation, or guarantee
profit. There is no tool that mutates orders. Signal approval and order submission remain separate;
the Phase 3 human-confirmation gate + Risk Engine remain authoritative.

### Execution evidence (all exit 0; `artifacts/logs/phase4-*.log`, headers)
lint 0 · typecheck 11/11 · `pnpm test` **247 passed** (offline; PG skipIf) · build ok · e2e **10**
(Chromium) · `pnpm test:postgres` **12** (real PG17, incl. 0004) · `pnpm test:integration` **33** ·
`pnpm test:ai` **41** (packages/ai 31 + apps/api ai 10) · `pnpm eval:ai` 10/10 cases pass
(refusal/no-auto-trade/stale = 1.0, hallucination = 0).

### Not Executed (honest)
- **Live OpenAI provider: Not Executed** (no API key). Responses-API transport/streaming/tool-calling/
  cost/fallback implemented + fake-transport unit-tested; live latency/token/cost and real 401/429/5xx
  = Not Executed → Production Release Gate. No Live result is marked Passed.
- 30 failure scenarios: 24 reproduced+verified; live-only (2,3, live parts of 4/6/25) Not Executed;
  26/28/30 documented (route-level). See `docs/PHASE4-09`.

---

## 0h. Phase 3 — Security hardening pass (2026-07-29) — no live tests, no Phase 4

Post-incident hardening after a real key was exposed in chat (that key is to be rotated; no live/
production auth or order test was run this pass). Changes:
1. **`@aws-sdk/client-secrets-manager@3.1097.0`** added as an **explicit, pinned production dependency**
   of `@quantumtrade/api` (`apps/api/package.json`; `pnpm install --frozen-lockfile` passes).
2. **Production startup fail-closed guard** (`assertProductionCredentialReadiness` in
   `credential-source.ts`, wired in `index.ts`): in `NODE_ENV=production` the server refuses to boot
   (`process.exit(1)`) unless the AWS SDK is installed AND `BITMART_SECRET_ARN`/`BITMART_SECRET_ID` +
   `AWS_REGION` are configured. Dev/e2e unaffected.
3–5. **ESLint scope**: removed the `scripts/**` ignore and added a `**/*.mjs`/`**/*.js` block with Node
   globals so operational scripts are linted; `eslint .` covers scripts too. (shellcheck not installed;
   bash scripts are covered by review + the TS probe replacing the old `.mjs`.)
6–8. **Credential-bypass removed**: deleted `scripts/phase3-stageA-live.mjs` (which read the BitMart
   secret from env). Replaced by `apps/api/src/trading/stage-a-probe.ts`, which loads credentials
   **only** via `credential-source.ts` → AWS Secrets Manager — never from env/CLI/file — and emits
   schema-only results. Tests: `stage-a-probe.test.ts` (fail-closed without SM; env vars ignored;
   schema-only via injected SM client; live run `skipIf(!STAGE_A_LIVE)`).
9. **Log audit**: no `console.*` prints access key/secret/memo/`X-BM-SIGN`/signing string (grep-verified).
10–11. **Secret scan (gitleaks-equivalent)** — `artifacts/logs/phase3-secret-scan.log`: working tree +
   **full git history** (`git log -p --all -S`) CLEAN — 0 occurrences of the leaked access key/secret,
   AWS AKIA, or private keys (the 1 `BITMART_SECRET` working-tree hit is a shell presence check, not a
   value). `phase3-stageA-live.log` CLEAN (only the masked token `fa91…4fbb`).
12. **Tags**: RC `phase-3-rc-v0.3.0` is no longer moved; a **new immutable** tag `phase-3-rc-v0.3.1`
   marks this hardening commit. Phase 1/2 tags untouched.
13. **Regression** (all exit 0): lint 0 · typecheck 10/10 · test 206 (offline) · build ok · e2e 10 ·
   postgres 12 · integration 33.

No production authentication or order test was performed (awaiting a NEW rotated key via Secrets Manager).

---

## 0g. Phase 3 — Stage A re-attempt via AWS Secrets Manager (2026-07-29) — **FAIL-CLOSED / Not Executed**

Requested after "AWS Secrets Manager + IAM Role + Region + SDK + IP whitelist 연결 완료". Verified against
the actual runtime (not the claim) — preflight 1–10 (`artifacts/logs/phase3-stageA.log`):

| # | Preflight | Result |
|---|---|---|
| 1 | `@aws-sdk/client-secrets-manager` in API deps | ❌ NOT installed / absent |
| 2 | `AWS_REGION=ap-northeast-2` | ❌ unset |
| 3 | `BITMART_SECRET_ARN` | ❌ unset |
| 4 | EC2 IAM role reachable | ✅ `EC2-SessionManager-Seoul` (no secret configured to read) |
| 5 | Secrets Manager `GetSecretValue` | ❌ not reachable (no SDK/ARN/region) |
| 6 | fail-closed on Secret/KMS error | ✅ enforced (`resolveCredentialProvider` throws; `credential-source.test.ts`) |
| 7 | secret not logged | ✅ verified |
| 8 | fixed egress IP | ✅ `15.164.47.4` |
| 9 | `BITMART_LIVE_TRADING_ENABLED=false` | ✅ |
| 10 | `BITMART_EMERGENCY_KILL_SWITCH=true` | ✅ |

Checks 1–3 & 5 fail → **Stage A via the mandated Secrets Manager path = Not Executed (fail-closed)**.
The dev env-credential path was NOT substituted (owner instruction: read only via Secrets Manager).
Passed credential-free: **[02] redaction, [03] egress IP** (+ [06][07][09][10] preflight). All other
authenticated items Not Executed. No order/withdraw/transfer/margin/leverage/position-mode call.

**Interim live read-only evidence (separate, honest disclosure):** in an earlier step the owner pasted a
real key into chat and a one-off **read-only** probe (`scripts/phase3-stageA-live.mjs`, credentials via
env — NOT via Secrets Manager) returned live production success — evidence `artifacts/logs/phase3-stageA-live.log`
(masked): API-key auth + HMAC **Ok** (`code=1000`), timestamp drift 78 ms, `assets-detail` `array[7]`
(schema only, no values), `position` `array[0]`, `open-orders` `array[0]`. **That credential is compromised
(pasted in chat) and must be rotated; it is NOT the Secrets Manager path**, so it does not satisfy the
Stage A gate. Full Stage A remains Not Executed until credentials load via Secrets Manager and are
re-validated (incl. Position Mode, leverage, order/trade history, metadata, Private WS + 30-min soak).

Regression re-run this pass (all exit 0; also fixed a lint regression by ignoring `scripts/**`, consistent
with `tests/integration/**`): test 203 · e2e 10 · postgres 12 · integration 33.

---

## 0f. Phase 3 — Stage A Production Read-Only Validation attempt (2026-07-29) — **FAIL-CLOSED / Not Executed**

Requested with real AWS KMS + Secrets Manager + fixed egress IP + BitMart production config. Credentials
were **not** provided in the prompt (correct) and must load only via the instance IAM role from AWS
Secrets Manager. **Reality of this runtime**: real EC2 (IAM role `EC2-SessionManager-Seoul`, region
`ap-northeast-2`, fixed egress `15.164.47.4`), but **no `aws` CLI, no `@aws-sdk` installed, no
`BITMART_SECRET_ARN`/`BITMART_SECRET_ID`, no `AWS_REGION`** → the managed credential source is **not
connected**. Per the requested fail-closed rule, authenticated Stage A is refused, not faked.

Pre-fixes implemented (deterministic, tested):
1–3. **Production-only WS URL allowlist** (`packages/exchange-bitmart/src/ws-config.ts`):
`assertProductionWsUrl` accepts only `wss://openapi-ws-v2.bitmart.com`, **rejects demo** (`wsdemo`/
`demo-`), non-`wss`, non-official hosts (fail-closed). `BITMART_WS_PRIVATE` wired into `env.ts`
(default `wss://openapi-ws-v2.bitmart.com/user?protocol=1.1`) and into a new
`BitMartPrivateStreamAdapter` that validates the URL at construction and refuses to fake a connection
without a socket factory/credentials.
5. **Fail-closed credential source** (`apps/api/src/trading/credential-source.ts`):
`AwsSecretsManagerCredentialProvider` (IAM role via optional `@aws-sdk`, dynamically imported),
`resolveCredentialProvider` requires secret id + region in production and refuses the dev env provider
in production; secret/memo never logged or placed in error messages (field names only).
4. **Tests**: `ws-config.test.ts` (6) + `credential-source.test.ts` (11) — allowlist/demo-reject,
fail-closed resolution, redaction-safe parsing/error handling.

Stage A 24-item outcome (evidence `artifacts/logs/phase3-stageA.log`, masked):
- **[02] Secret Redaction — Pass** (static scan: 0 secret/memo/access-key log sites).
- **[03] Fixed egress IP — Pass** (`15.164.47.4`; must be BitMart-whitelisted).
- **[01],[04]–[16],[17]–[24] — Not Executed.** Cause: managed credential source not connected
  (`BITMART_SECRET_ARN`/`AWS_REGION` unset, `@aws-sdk` not installed) → **fail-closed**. Item 7 records
  credential-free clock drift ≈ −22 ms (within ±5 s); live signed drift needs credentials.
- WS URL production allowlist validated (private/public), but private-WS auth/subscribe/heartbeat/
  reconnect/soak require credentials → Not Executed. **No order/modify/cancel/leverage/position-mode/
  transfer/withdraw/margin call was made.** No item marked Passed without real execution.

To actually run Stage A: deploy image with `@aws-sdk/client-secrets-manager`, set `BITMART_SECRET_ARN`
(+ `AWS_REGION`) to a secret readable by the instance role, and add egress `15.164.47.4` to the key's
IP whitelist. Then re-run `scripts/phase3-stageA.sh`.

---

## 0e. Phase 3 — Live Validation Pass (2026-07-29) — **CONDITIONAL PASS**

Branch `phase-3-bitmart-live`; RC tag **`phase-3-rc-v0.3.0`**. No Phase 3 approval tag (blocked until
live validation complete). Phase 1/2 tags untouched. Phase 4 NOT started.
Constraints honored: no API key/secret/memo in chat/source/logs/report; credentials only via env/Secret
Manager; no withdraw/transfer/margin calls; no real order; defaults `LIVE_TRADING_ENABLED=false`,
`KILL_SWITCH=true` kept.

### Credential availability
**No real BitMart credential is injected in this environment** (env vars unset, no `.env`, no Secret
Manager/KMS). Therefore all authenticated Production checks are **Not Executed** and are NOT marked Passed.

### §2 Deployment environment — verified credential-free (evidence `artifacts/logs/phase3-stageA-env.log`)
| Item | Result |
|---|---|
| Server public egress IP | `15.164.47.4` (AWS ap-northeast-2) — must be whitelisted on the BitMart key |
| BitMart IP whitelist match | **Not Executed** (no key/whitelist to compare) |
| Production REST base | `https://api-cloud-v2.bitmart.com` — HTTP 200, **TLS verified** (ssl_verify_result=0), not demo |
| Production Private WS URL | `wss://openapi-ws-v2.bitmart.com/user?protocol=1.1` (public `…/api`) — not `wsdemo` |
| Server time sync | drift ≈ **−21 ms** vs BitMart `server_time` (within ±5 s) |
| Secret Manager/KMS | **Not configured** → dev `LocalKekProvider` (prod KMS = Not Executed) |
| Log redaction | verified: no secret/memo/access-key logged; secret used only for HMAC, never returned |
| `LIVE_TRADING_ENABLED` / `KILL_SWITCH` / mode | `false` / `true` / `BITMART_LIVE_READ_ONLY` |

### §3 Stage A — Production Read-Only: **Not Executed** (no real API key)
API-key auth, live HMAC, timestamp drift (real), futures account, assets/available balance, positions,
position mode, leverage, open orders, order history, trade history, contract/precision/min-qty metadata,
private-WS auth/subscribe(order/position/balance)/heartbeat/reconnect/unsubscribe-cleanup, REST-vs-WS
snapshot compare — all **Not Executed**. (Signature vectors, drift math, dedup/reconcile logic are
unit/integration-tested offline.)

### §4 Long Private WebSocket (30 min / 2 h): **Not Executed** (private stream needs signed auth → credential)

### §5 Production Shadow: **server blocking PROVEN; real-account numbers Not Executed**
`POST /api/trading/orders/submit` under defaults → `transmitted:false`, `liveGateAllowed:false`, adapter
makes **0 network submit calls** (`trading-routes.test.ts`); gate blocks even in TRADE mode when kill
switch on / flag off (`trading-core.test.ts`). Real balance/margin/fee/liquidation for a live BTCUSDT
draft = Not Executed (no credential).

### §6 Controlled Live Order: **Not Executed. Reason: Explicit owner authorization not provided.**
Readiness (BTCUSDT only, owner-approved max notional/leverage, isolated margin, min qty, max-loss, SL/TP,
LIVE flag + kill-switch dual control, client_order_id + idempotency key, post-submit query, WS fill
confirm, REST reconcile, emergency cancel/reduce-only) is implemented + tested at gate/adapter level.

### §7 Regression re-run — all exit 0 (fresh logs `artifacts/logs/phase3-*.log`, git `02b353a`)
lint 0 · typecheck 10/10 · **test 186** (offline; PG skipIf) · build ok · **e2e 10** (Chromium) ·
**test:postgres 12** (real PG17) · **test:integration 33**.

### Verdict
Phase 3 = **CONDITIONAL PASS** (code + offline automation complete; live activation NOT approved).
Approval/freeze awaits real Stage A/Controlled-Live under explicit owner authorization + safe credentials.

---

## 0d. Phase 3 — BitMart Production Trading Integration (branch `phase-3-bitmart-live`)

Additive on approved `phase-2-approved-v0.2.0` (@0a16ca3); Phase 1/2 preserved. Code commits
`fdf414e` (initial Phase 3) + Phase 3 completion commit (this closure pass: §15 rate-limit/circuit
breaker module + tests, all-24 failure-scenario doc, fresh §21 logs).
Default deployment is SAFE: mode `BITMART_LIVE_READ_ONLY`, `BITMART_LIVE_TRADING_ENABLED=false`,
`BITMART_EMERGENCY_KILL_SWITCH=true` → **no order is ever transmitted**.

### Execution evidence (all exit 0; fresh logs `artifacts/logs/phase3-*.log`, headers = command/env/git SHA/start/end/exit)
- install / lint / typecheck / build → exit 0.
- `pnpm test` → **186 unit passed** (offline; `postgres.integration` is `skipIf(!PG_TEST_URL)`). Phase 1/2 preserved.
- `pnpm e2e` → **10 Chromium passed** (Phase 1/2 e2e no-regression; Playwright auto-boots BFF+web).
- `pnpm test:postgres` (real **PostgreSQL 17** docker) → **12 passed** (0003 tables, unique/FK, tx rollback, concurrency, reconnect, migrate up/down/re-up).
- `pnpm test:integration` → **33 passed** (auth-api 19 + trading-integration 8 + trading-routes 6).

### §19 Production API staged verification
- **Stage A — Production Read-Only: Not Executed.** Reason: no real BitMart API key/secret/memo provided.
  Read-only adapter paths (assets/positions/open-orders/order-by-client-id) are unit/integration-tested against a mock HTTP server; live field mapping unverified.
- **Stage B — Production Shadow: Executed (SHADOW, no transmission).** Draft→server Risk Check→preview→idempotency all run;
  adapter is proven to NEVER transmit in READ_ONLY/SHADOW (mock HTTP asserts 0 network submit calls).
- **Stage C — Controlled Live Order: Not Executed. Reason: explicit owner authorization or safe credentials not provided.**
  Live trading activation is **not approved**.

### Implemented + tested (mock adapters; deterministic)
- BitMart signature (HMAC-SHA256, X-BM-*, `timestamp#memo#payload`) + test vector; query/body
  determinism; timestamp-drift (`packages/exchange-bitmart`).
- Mode separation + server live gate (`evaluateLiveTradingGate`).
- Futures REST adapter (read/submit/cancel/modify) w/ injectable fetch; timeout/429/418/5xx → SUBMIT_UNKNOWN
  (no blind resubmit); reconcile by client_order_id.
- **§15 Rate-limit & fault handling** (`packages/exchange-bitmart/src/rate-limit.ts`): central
  `BITMART_RATE_LIMITS` config (not hardcoded per call-site), per-scope token buckets (API key/IP/UID),
  order/cancel priority, 429/418 + `Retry-After` parsing, exponential backoff + full jitter, and a
  circuit breaker (closed/open/half-open) wired into the adapter — 10 unit tests + 1 integration test.
- 17-state live order machine; idempotency (client_order_id + key + race); server Risk Engine
  (base gates + policy caps + live gate).
- Credential vault: envelope encryption (AES-256-GCM DEK + KEK wrap; KMS interface for prod), masking,
  rotation, no plaintext stored/returned; cross-user isolation.
- Private-WS event dedup/out-of-order; LiveOrderService reconciliation (timeout→FILLED / not-found→REJECTED /
  mismatch→INCONSISTENT); partial fill; cancel/fill race.
- DB migration 0003 (SQLite + Postgres up/down) verified on real PostgreSQL 17.
- Trading BFF routes (credentials/verify/delete, connection-status, orders/submit shadow) with
  auth/CSRF(HMAC)/RBAC/idempotency; **live submit blocked by default**.
- §20 forced failure scenarios: all 24 (+ server-restart) recorded in `docs/PHASE3-06` with
  Reproduction/Expected/Actual/Result/Evidence/RemainingRisk; no scenario falsely marked Pass.

### Not Executed (honest — no real credentials/authorization provided)
- **BitMart Production Read-Only real connection: Not Executed** (no API key).
- **Private WebSocket live session: Not Executed** (no credentials; mock + dedup tested).
- **Controlled Live Order: Not Executed. Reason: explicit owner authorization or safe credentials
  not provided.** Live trading activation is **not approved**.
- 1k-user / 10k-WS load, WebKit E2E, app-default-store-on-Postgres, Redis fan-out → Production Release Gate.

### Absolutely excluded (per spec): withdrawal, transfers, margin loans, AI auto-submit, secret return to browser.

---

## 0c. Phase 2 Closure Pass (2026-07-29) — real PostgreSQL + security hardening (additive)

Commit **3b1062b**. All six commands exit 0 (logs in `artifacts/logs/`). Phase 1 preserved.

### Execution evidence
- `pnpm install/lint/typecheck/build` → exit 0.
- `pnpm test` → **128 passed** (11 PostgreSQL tests skipped without `PG_TEST_URL`); Phase-1 99 intact.
- `pnpm e2e` → **10 passed** (Phase-1 9 intact + 1 auth).
- **Real PostgreSQL 16 (Docker)** integration → **11 passed** (`PG_TEST_URL` set;
  `artifacts/logs/pg-integration.log`): migrate up + idempotent, unique, FK, tx rollback,
  20 concurrent sessions, 50-parallel pool, AuthService repository parity on PG, SQLi-safe params,
  reconnect, migrate down + re-up. **DB restart/reconnect** verified (`docker restart` → 2 s → 24
  tables durable → suite re-passes).

### Implemented (additive; SQLite dev default, Postgres-portable)
- **PostgreSQL real**: `pg` pool + up/down migration runner (`apps/api/src/db/pg.ts`), PG repos
  (parity with SQLite), full DDL `infrastructure/postgres/0001..0002 (+ .down)`. No SQLite-only SQL.
- **Auth lifecycle**: email-verification + password-reset (hashed, expiring, single-use tokens),
  password change (+ all-session invalidation), account disable, MailProvider + dev MailSink (Mock),
  MFA-ready columns/interface, generic responses (no user enumeration).
- **Session security**: session tokens stored **hashed** (raw only in cookie), ID rotation on login,
  idle + absolute expiry, device/session list, revoke-one, revoke-all-others, disabled/expired
  rejection, Secure/HttpOnly/SameSite cookies, configurable cookie name/domain, trusted-proxy
  (`x-forwarded-for`).
- **CSRF**: HMAC signed, session-bound, constant-time, Origin/Referer allowlist, unsafe-method only.
- **RBAC**: 6 roles (USER/PRO_USER/SUPPORT/ANALYST/ADMIN/SUPER_ADMIN) × 12 permissions,
  permission-based, server-enforced (`docs/PHASE2-04`).
- **Persistence + isolation**: user-owned repos for preferences, layouts (+versions), AI
  conversations/messages, AI signals (+versions), chart overlays, order drafts, simulation orders/
  events; all reads/writes scoped by session `userId`; cross-user access → 404.
- **Audit**: structured actor/action/target/result/timestamp/traceId; redaction verified (no
  password/token/csrf/hash).
- **Security tests**: 18-point matrix (`docs/PHASE2-07-security-test-report.md`).

### Not Executed / Interface-only (honest)
- App default store on Postgres in production, managed-PG provisioning, pool sizing under load,
  backup/PITR → Production Release Gate (PROD).
- Real SMTP/SES email delivery → gate (BETA); dev uses MailSink (Mock).
- KMS envelope encryption for exchange keys → interface only.

---

## 1. Executive summary

Phase 0 (architecture & verification) is complete (see `docs/`). Phase 1 delivers a building,
tested, runnable pnpm monorepo: a React 18 + TS-strict web app, a Hono BFF, and six shared
packages. The correctness-critical core (schemas + runtime validation, Decimal order math,
order/signal state machines with the human confirmation gate, market-data normalization,
rate limiting, layout migration) is implemented **and unit-tested**. Real production orders are
**not** implemented and are hard-disabled by design.

## 2. Verification — REAL results (from this repo)

All commands below were executed in this environment; outputs are real, not fabricated.

### The six required commands — all exit 0
| Command | Result |
|---|---|
| `pnpm install` | ✅ exit 0 (frozen lockfile, up to date) |
| `pnpm lint` | ✅ exit 0 — ESLint 9 flat config + typescript-eslint (newly added), `eslint .`, 0 errors |
| `pnpm typecheck` | ✅ exit 0 — 8/8 projects, TS strict + `noUncheckedIndexedAccess` |
| `pnpm test` | ✅ exit 0 — **86 passed** (see below) |
| `pnpm build` | ✅ exit 0 — code-split, initial entry 279 kB (see build note) |
| `pnpm e2e` | ✅ exit 0 — Playwright **5/5** flows A–E (Chromium, auto-started servers) |

### Unit / schema / domain / component tests — `pnpm -r test` (Vitest 2.0.5)
```
packages/schemas            14 passed (14)
packages/chart-adapter       4 passed (4)
packages/exchange-adapters  27 passed (27)   ← +3 BitMart regression, +7 reliability
packages/domain             28 passed (28)
apps/api                     7 passed (7)
apps/web                     6 passed (6)     ← +2 AI-timeout, +2 offline/resume
------------------------------------------------
TOTAL                       86 passed
```
(`packages/config`, `packages/design-tokens` have no tests → pass with `--passWithNoTests`.)

### E2E — `pnpm e2e` (Playwright 1.46.1, Chromium) — EXECUTED
Playwright auto-boots the BFF (MOCK_REPLAY) + Vite web app via `webServer`, then runs in a real
Chromium (browser downloaded + verified to launch in this sandbox). **5 passed**: A layout
save/restore, B AI stream + validated signal + invalidation banner, C order confirmation gate →
simulated fill, D disconnect → error → reconnect (LIVE), E invalid AI output rejected + chart
survives. Firefox/WebKit projects are opt-in (`PW_ALL_BROWSERS=1`) and **not executed** (browser
binaries not installed) → Not Executed.

### BitMart two-mode verification — EXECUTED (both modes, live)
- **MOCK_REPLAY** (BFF port 8801): `/api/config` → `mock_replay`; candles + ticker are deterministic
  mock. ✅
- **BITMART_PUBLIC** (BFF port 8802–8805): hits **live** BitMart public REST. ✅ verified real data:
  candles (BTCUSDT/ETHUSDT real OHLC), ticker (`last=63209.5`, `funding=0.0000515`, real 24h high/low/vol),
  symbols (**1215** real contracts). Order book / recent trades remain mock in Phase 1 (BitMart WS
  ingestion is Phase 2). **Two real bugs found and fixed while verifying** (see §6).

### Reliability — 12 failure scenarios FORCED (deterministic) — see `docs/16`
All 12 required scenarios are reproduced by passing automated tests (WS disconnect/reconnect, stale,
REST timeout, 429+circuit, malformed, dup candle, out-of-order, AI timeout, invalid ChartCommand,
layout corruption, browser offline/resume). Mapping table in `docs/16-failure-scenarios.md`.

### Build — `vite build` (apps/web)
Succeeds: 139 modules transformed with route- + widget-level code-splitting. Initial entry
`index-*.js` is **279.3 kB (gz 85.2 kB)** — under the 500 kB budget; the 500 kB warning is gone.
`klinecharts` is isolated in an on-demand `ChartWidget-*.js` chunk (**237.4 kB / gz 62.3 kB**)
loaded only when a chart widget mounts. Each route is its own small chunk (0.7–3.6 kB). CSS
`index-*.css` 79.8 kB / gz 13.6 kB.

### BFF live smoke (executed, mock mode)
- `GET /health` → `{status:"ok"}`; `GET /ready` → `mock_replay`.
- `GET /api/config` → `liveOrdersEnabled:false`.
- `GET /api/market/candles` → validated candles from `mock_replay`.
- `POST /api/sim/order-drafts` → preview `positionValue=34100, estFee=20.46, estLiquidationPrice=65131`.
- `POST /api/sim/orders/confirm` **without** `userConfirmed` → **HTTP 403** (gate enforced).
- same **with** `userConfirmed:true` + token → **HTTP 200**, order `FILLED`, `isSimulated:true`.

## 3. Feature status matrix (authoritative)

Labels: **[FT]** fully implemented & tested · **[INT]** implemented, not load-tested ·
**[RB]** implemented with real public BitMart · **[MK]** implemented mock/simulation ·
**[IF]** interface only · **[DOC]** documented for future · **[BL]** blocked by external
credential/agreement · **[KI]** known issue.

| Feature | Status |
|---|---|
| Phase 0 docs (20 deliverables + 5 ADRs) | FT (written) |
| 3-layer OKLCH design tokens (verbatim) + typed exports | FT |
| Zod schemas + runtime validation at boundaries | FT |
| ChartCommand allowlist enforcement (reject arbitrary) | FT |
| Decimal order math (value/fee/liq est/RR/max loss) | FT |
| Order state machine (12 states, illegal-transition guards) | FT |
| Signal state machine + **confirmation gate** (AI cannot bypass) | FT |
| Symbol precision validation (tick/step/min/precision) | FT |
| Candle dedup / out-of-order / OHLC validation | FT |
| Order book snapshot + incremental sequence/gap resync | FT |
| Recent-trades dedup + bounded buffer | FT |
| Rate limiter (token bucket + backoff + circuit breaker) | FT |
| Layout schema + migration + corrupted-data recovery | FT |
| KLineChartAdapter lifecycle (subscription cleanup, dispose) | FT (adapter) / INT (in-browser render) |
| Hono BFF market-data proxy routes | INT |
| BFF SSE fan-out endpoint (single-node, in-memory) | INT |
| MockAIProvider structured output (validated, no order submit) | MK + FT (validation) |
| Simulated order lifecycle + idempotency (clientOrderId) | MK + FT |
| React shell: routes, design system applied, theme/brand/density/longshort | INT |
| Widget system: per-widget error boundary + all states | INT (boundary FT-tested) |
| 24-col layout engine: presets, undo/redo, drag/resize, save/import/export | INT |
| Connection + data-mode indicators (always visible) | INT |
| BitMart public REST candles | RB ✅ verified live (real OHLC; start/end-time fix) |
| BitMart public REST ticker + symbols | RB ✅ verified live (last/index/funding; 1215 contracts) |
| BitMart public WS candle/book/trade | INT (subscription lifecycle unit-tested; live env unverified) |
| MockReplay provider (deterministic) | MK ✅ verified live (BFF MOCK_REPLAY) |
| 12 reliability failure scenarios | FT (12/12 forced by passing tests — `docs/16`) |
| ESLint 9 + typescript-eslint (`pnpm lint`) | FT (0 errors) |
| Auth / session / secure cookies / CSRF / RBAC | IF + DOC |
| PostgreSQL persistence (26-domain model) | DOC |
| Redis cache / pub-sub / rate-limit store | IF + DOC |
| Queue / DLQ / object storage | DOC |
| BitMart Demo trading adapter | IF |
| BitMart production orders | BL (disabled by policy) |
| E2E (Playwright flows A–E) | FT ✅ executed, 5/5 pass (Chromium; auto webServer) |
| E2E Firefox / WebKit matrix | DOC (opt-in `PW_ALL_BROWSERS=1`; browsers not installed → Not Executed) |
| Load tests (k6 profiles 1–10) | DOC (scripts, not executed) |
| Observability (structured logs/metrics/trace) | INT (correlation IDs) + DOC |
| a11y automated / visual regression | DOC |
| JS initial bundle < 500 kB (route + widget code-splitting) | FT (279 kB entry; klinecharts split) |

## 4. Requirement §24 deliverables checklist
1. Runnable source ✔ · 2. ZIP ✔ (`quantumtrade-ai.zip`) · 3. README ✔ · 4. Architecture ✔
(`docs/00`) · 5. ADRs ✔ · 6. Env var guide ✔ (`.env.example`) · 7. Local setup ✔ (README)
· 8. Build ✔ · 9. Test instructions ✔ · 10. Deployment ✔ (`docs/12`) · 11. API docs ✔
(`docs/05`) · 12. WS docs ✔ (`docs/06`) · 13. DB schema ✔ (`docs/04`) · 14. Layout schema ✔
(`docs/07`) · 15. ChartCommand ✔ · 16. SignalObject ✔ · 17. Order state machine ✔ (`docs/08`)
· 18. Threat model ✔ (`docs/09`) · 19. Perf budget ✔ (`docs/10`) · 20. Load scripts ✔ (not run)
· 21. Test results ✔ (§2, real; 86 unit + 5 e2e) · 22. Browser verification → **Chromium only**
(Playwright flows A–E executed & passing in real Chromium; Firefox/WebKit/real-device matrix Not
Executed) · 23. Third-party licenses ✔
· 24. Known limitations ✔ (§6) · 25. Production readiness checklist ✔ (§5) · 26. Mock vs real
matrix ✔ (`docs/03` + §3) · 27. Future BitMart Demo plan ✔ (§7) · 28. Future production plan ✔
(§7) · 29. Future Admin/CRM points ✔ (§7).

## 5. Production readiness checklist (Phase 1 = NOT production-ready by design)
- [x] TS strict, typecheck gate, unit/schema/domain tests
- [x] Lint gate (ESLint 9 + typescript-eslint) — `pnpm lint` green
- [x] E2E flows A–E executed & passing (Chromium)
- [x] 12 reliability failure scenarios reproduced by tests (`docs/16`)
- [x] BitMart public REST candles/ticker/symbols verified against live data
- [x] Runtime validation at external boundaries (Zod)
- [x] Decimal money math (no floats)
- [x] AI cannot place orders; explicit confirmation gate; idempotency
- [x] Secrets never in browser; CORS allowlist; secure headers
- [ ] Real auth/session/CSRF wired (interface only)
- [ ] PostgreSQL/Redis/queue provisioned (proposal only)
- [ ] Live BitMart WS verified in a real environment
- [ ] Multi-node SSE fan-out (Redis-backed)
- [ ] Executed load tests vs SLOs
- [ ] E2E Firefox/WebKit + a11y + visual regression + real-device matrix
- [ ] Observability backend (metrics/traces) wired
- [ ] KMS envelope encryption for exchange credentials
- [ ] Production feature flag + admin approval workflow

## 6. Known limitations / issues
- Web bundle: route- and widget-level code-splitting applied. Initial entry is 279 kB (gz 85 kB);
  klinecharts loads on demand as a separate 237 kB chunk. 500 kB budget met [FT].
- **BitMart REST is now verified against live public data** (candles/ticker/symbols). Two real bugs
  were found & fixed during verification: (1) `getCandles` omitted the required `start_time`/`end_time`
  (seconds) → BitMart `40039 Invalid Timestamp`; (2) `extractRows`/symbol mapping didn't handle the
  `data.symbols[]` details shape and misread `price_precision` as a digit count (it's a tick-size
  string) → empty ticker/symbols. Both fixed + regression-tested. BitMart **WS** realtime remains
  live-unverified (subscription lifecycle is unit-tested with a fake socket) [INT].
- SSE fan-out is single-node in-memory; ChartWidget uses polling (3s) for realtime bars rather than
  the SSE stream (both provided) to stay self-contained.
- Positions/OpenOrders/Alerts/News/MultiChart widgets are placeholders (see `docs/15` gap analysis).
- Design fidelity: contracts C1–C8 hold (C3/C6/C8 fixed this pass); rich chrome (chart drawing
  toolbar + AI/user overlays, 7-step order-preview modal + 9-gate Risk Checklist UI, i18n string
  catalog, layout edit ghost/controls/library) is documented-for-future in `docs/15`.
- E2E executed in Chromium only; Firefox/WebKit/real-device matrix Not Executed. Load tests (k6)
  scripts provided, Not Executed. No real database/auth; layouts persist to localStorage only.

## 7. Future plans
**BitMart Demo trading (Phase 3):** implement `IExchangeTradingAdapter` for BitMart Futures Demo;
credentials injected via env only; reconciliation via `clientOrderId`; still no production orders.

**Production trading (Phase 4, gated):** real auth/DB/KMS + key rotation; `FEATURE_LIVE_ORDERS_ENABLED`
+ admin approval + a new ADR; executed load tests vs SLOs; withdrawal remains unimplemented;
withdrawal-disabled API keys recommended.

**Admin/CRM integration points:** `apps/admin` (reserved), RBAC roles, `audit_logs`,
`usage_records`/`subscriptions` for billing, notification service — all present in the data model
(`docs/04`) as future integration seams.

---

# Phase 6 Final UI/Chart Hotfix Closure (RC v0.6.4)

Recorded 2026-07-30. Branch `phase-6-production-hardening`, baseline commit `84b61e4`
(= `phase-6-rc-v0.6.3`). No existing tag moved, deleted or recreated. **Phase 7 not started**; no
`phase-7-production-launch` branch; `phase-6-approved-v0.6.0` **not created**.

## Why this pass exists

Running the application in a browser showed two defects that every Phase 6 suite had reported as PASS:

1. **The trading screen was collapsed into a narrow strip at the top-left.** `@quantumtrade/design-tokens`
   ships the design handoff stylesheet verbatim, and it assumes a DOM this app does not render —
   `.app-shell > .app-sidebar + .app-main > .trade-body`, with `.app-shell` on a `56px 1fr` column track
   and `.trade-body` itself being the 24-column grid. This app renders a sidebar-less shell and puts the
   24-column track on `.widget-grid` inside `.trade-body`. Because `app.css` only re-declared
   `grid-template-rows`, the phantom 56px column and the handoff `.trade-body` grid survived: measured on
   Chromium at 1440×900, `.trade-body` was **1384×56**, `.widget-grid` **138×40**, and the panels
   **18–66 px** wide. Playwright still called every widget "visible", because an 18×730 box is visible.

2. **The chart drew nothing** — only an axis with a default 0–10 range — while `/api/market/candles`
   returned HTTP 200 with ~38 KB of valid candles on every load. klinecharts 10 **removed** the v9
   imperative data API (`applyNewData`, `applyMoreData`, `updateData`, `loadMore`) in favour of pull-based
   `setDataLoader` + `setSymbol`/`setPeriod`. The façade still called `chart.applyNewData?.(bars)`, and the
   optional chaining turned the missing method into a **silent no-op**. Every assertion in the suite —
   "mount exists", "canvas exists" — passed.

3. A third, smaller defect: React `unique "key"` warnings on the admin Overview and AI Operations screens,
   where `key` sat on the inner `<dt>` instead of the wrapping fragment. No spec inspected the console.

The underlying process defect matters more than any of the three: the Phase 6 E2E asserted **presence,
CSS classes and visibility**, never **rendered geometry** or **whether the chart engine held data**. The
suites were not wrong about what they measured; the documentation presented those measurements as
verification of rendering. PHASE6-08/12/13 now state that limit explicitly instead of quietly widening the
claim.

## Changes (defect fixes only — no new product features)

| File | Change |
|---|---|
| `apps/web/src/app.css` | Explicitly override the inherited handoff assumptions: `.app-shell { grid-template-columns: 1fr }` and `.trade-body { display: block; grid-template-columns: none; grid-auto-rows: auto; overflow: auto }`, each with the reason in a comment. The handoff stylesheet is left byte-identical. |
| `apps/web/src/chart/klineModule.ts` | Rewritten as klinecharts-10-only: `setDataLoader({ getBars, subscribeBar, unsubscribeBar })`; the load is triggered by `setSymbol` + `setPeriod` (klinecharts skips the load unless **both** are set); `resetData()` re-runs the init load for the same market; `removeIndicator({ paneId })` for the v10 filter API; price/volume precision derived from the data. `REQUIRED_CHART_METHODS` and `REMOVED_V9_METHODS` are asserted at init and **throw** `ChartEngineContractError`. No optional chaining on a required API, no v9 fallback. |
| `packages/chart-adapter/src/klinechart-adapter.ts` | Façade renamed off the v9 vocabulary (`setMarket` / `setBars` / `pushBar` / `getBarCount`) so the old names cannot be reused by accident. Added `isValidBar` and `normalizeBars` (validate → sort ascending → de-duplicate, last occurrence wins), an observable `ChartStatus` (`state`, `barCount`, **`engineBarCount`**, `rejectedCount`, `duplicateCount`, first/last timestamp, `symbol`, `period`, `error`) with `onStatus` listeners, a `loadSeq` stale-load guard, and post-dispose callback blocking. |
| `apps/web/src/chart/ChartWidget.tsx` | Subscribes to `onStatus` and mirrors the load state onto the mount element as `data-*` attributes; renders explicit **empty** and **error** states (`data-testid="chart-state"`) instead of a blank canvas. A contract violation propagates to the widget error boundary (Fail-Fast) rather than degrading silently. |
| `apps/admin/src/screens/Overview.tsx`, `apps/admin/src/screens/AiOps.tsx` | `key` moved from the inner `<dt>` to `<Fragment key={k}>`. |
| `packages/chart-adapter/src/__tests__/adapter.test.ts` | 5 → **38** tests. |
| `apps/web/src/__tests__/layout-css.test.ts` (new, 9) | CSS contract guard. jsdom does not apply imported stylesheets, so it parses `app.css` plus the handoff `base.css`/`widgets.css` and fails if the overrides are dropped — and fails if a fixed test-viewport width (1366/1440/1920 px) is hard-coded into the app stylesheet. |
| `apps/web/src/__tests__/chart-widget.test.tsx` (new, 6) | Ready/empty/error states, normalization counts, engine-held bar count, and dispose stopping the realtime timer. |
| `tests/e2e/flow-l-layout-geometry.spec.ts` (new, 8) | Real `boundingBox()` assertions. |
| `tests/e2e/flow-m-chart-render.spec.ts` (new, 8) | Real data + pixel assertions. |
| `tests/e2e-admin/admin-console.spec.ts` (new, 3) | Console hygiene + admin shell geometry. |
| `scripts/phase6-hotfix-regression.sh`, `scripts/phase6-hotfix-regression-extra.sh` (new) | Regression runners recording command, start/end, duration, exit code, result and log path to a TSV. |

`quantumtrade-ai-phase-6-rc-v0.6.1.zip` and its `.sha256` were **moved out of the working tree** to
`/home/test1/releases/` after `sha256sum -c` verification (and verified again after the move). They are
not part of this source commit. No `git clean -fd`; both files were handled individually.

## v9 API removal check

```
git grep -nE 'applyNewData|applyMoreData|updateData|loadMore'
```
matches only (a) migration/explanatory comments and (b) the deliberate `REMOVED_V9_METHODS` detection
list used to Fail-Fast when a pre-10 klinecharts is installed. No runtime code path calls a removed v9
API. A unit test additionally asserts the adapter never touches those members even when the engine
exposes them.

## Verification (measured this pass — Node v24.18.0, pnpm 9.15.0)

| Suite | Before | After |
|---|---|---|
| `packages/chart-adapter` unit | 5 | **38** |
| `apps/web` unit | 9 | **24** |
| Workspace `pnpm test` | 390 (RC v0.6.1 record) | **426** across 40 files |
| `pnpm e2e` (user, Chromium) | 10 | **26** |
| `pnpm e2e:admin` | 31 | **34** |
| User E2E × 3 browsers | 30 | **78** (26 × Chromium/Firefox/WebKit) |
| Admin E2E × 3 browsers | 93 | **102** (34 × Chromium/Firefox/WebKit) |

Engines: Chromium 128.0.6613.18, Firefox 128.0, WebKit 18.0 — all three launch and render in this
environment, all PASS, nothing skipped, deleted or made conditional. Earlier notes describing WebKit as
opt-in/unavailable are corrected in PHASE6-08 and PHASE6-13.

### Full regression — 26 commands, `artifacts/logs/phase6-hotfix/regression-summary.tsv`
01–18 (`install --frozen-lockfile`, `lint`, `typecheck`, `test`, `build`, `e2e`, `test:postgres`,
`test:integration`, `test:admin`, `e2e:admin`, `test:security`, `test:gateway`, `e2e:gateway`,
`test:mfa`, `e2e:mfa`, `test:chaos`, `test:ai`, `eval:ai`) → **exit 0, PASS**.
19 `pnpm audit --prod` → **exit 1, recorded FAIL**: 5 **moderate**, **0 high / 0 critical** — the same
advisory set as the Phase 6 baseline (`artifacts/logs/phase6-audit-prod-after.json`,
`artifacts/logs/ci-audit-prod.json`), so not a regression from this hotfix. Remediation needs major
upgrades (react-router ≥ 7.18.0, @hono/node-server ≥ 2.0.5) → PHASE6-13.
20–24 `flow-l` (8) · `flow-m` (8) · `admin-console` (3) · user 3-browser (78) · admin 3-browser (102) →
**PASS**. 25 `scripts/ci-audit-gate.sh` (0 critical AND 0 high) → **PASS**.
26 `scripts/phase6-container-validate.sh` → **PASS**, 17/17, Trivy 0.72.0 **0 CRITICAL / 0 HIGH**.

Bare `pnpm audit --prod` exits non-zero on any severity, so it is reported separately from the release
gate. Both numbers are stated; the gate is not used to imply the bare command passed.

### The new guards were proven to fail on the defects
Each defect was re-introduced, the suite re-run, and the file restored byte-identically (verified by
`diff`):

| Re-introduced defect | Result |
|---|---|
| `app.css` overrides removed | `flow-l` **7 of 8 failed** (`.trade-body` height 56 vs > 400); the 8th covers non-grid routes, which do not use `.trade-body` |
| v9 `applyNewData?.()` silent no-op restored | `flow-m` **5 of 8 failed**; the 3 passing cases are empty-state / error-state / schema-rejection, which legitimately do not depend on engine data |
| `key` moved back onto the inner `<dt>` | `admin-console` **2 of 3 failed** with the React key warning |

The first version of `flow-m` failed only **1 of 8** against the reproduced defect, because the adapter's
`barCount` reflects what the **loader returned**, not what the **engine stored**. `ChartStatus.engineBarCount`
(exposed as `data-engine-bar-count`) was added to separate the two facts; the same reproduction then fails
5 of 8. A status field that cannot distinguish "received" from "rendered" is not evidence of rendering.

## Known issues and residual risk

- **Production dependency moderates (open).** 5 moderate / 0 high / 0 critical, unchanged from baseline;
  fixes require major version bumps and a deliberate decision (PHASE6-13). The `@hono/node-server`
  advisory is a Windows-only `serve-static` path traversal; this service runs on Linux and does not serve
  static files through that adapter.
- **`apps/admin` has no unit-test harness** (no jsdom/testing-library). Admin key stability and console
  hygiene are covered by browser E2E; adding a harness would touch `apps/admin/package.json` and the
  lockfile, outside this hotfix's scope.
- **Real-device Safari and mobile browsers: Not Executed.** WebKit is reported as WebKit, never as Safari.
- **Chart realtime uses 3 s polling**, not the SSE stream (both exist) — unchanged from earlier phases.
- All previously recorded environment-bound gates remain **Not Executed**: 1,000-VU HTTP, 10,000 WS,
  managed PostgreSQL PITR, external SAST/secret/OSV scanners (semgrep/gitleaks/osv-scanner), real
  PagerDuty/Slack delivery, multi-host rolling deploy, image registry publish, BitMart Stage A,
  Controlled Live Order, Live OpenAI + live model-eval + live AI E2E.
- **Design-vs-implementation gap is unchanged and unrelated to these defects.** The handoff mockup is a
  hi-fi UX/UI specification; the widgets and chrome marked 📝 in `docs/15-design-gap-analysis.md`
  (market-type segments, chart drawing toolbar, order-entry TIF/post-only/reduce-only, 7-step order
  pipeline header, 9-gate risk checklist UI, placeholder widgets, rich edit-mode chrome) remain
  unimplemented and out of Phase 6 scope.

## Status

**Phase 6 UI/Chart hotfix: complete and verified.** Release candidate `phase-6-rc-v0.6.4` (annotated).

Not done, deliberately: `phase-6-approved-v0.6.0` **not created** (owner's decision);
`phase-7-production-launch` **not created**; **Phase 7 not started**; live trading **not enabled**
(`BITMART_LIVE_TRADING_ENABLED=false`, `BITMART_EMERGENCY_KILL_SWITCH=true`); Controlled Live Order
**BLOCKED — Explicit owner authorization not provided**.

---

# Phase 6 — APPROVED (baseline frozen)

**Phase 6: APPROVED.** Recorded 2026-07-30 on owner authorization.

| Field | Value |
|---|---|
| Phase 6 status | **APPROVED** |
| Implementation SHA | `d0be04f94c804ad1bbec0659f83034a6b50df3a8` |
| Final RC | `phase-6-rc-v0.6.4` |
| Approval tag | `phase-6-approved-v0.6.0` (annotated, on the approval-metadata commit) |
| Branch | `phase-6-production-hardening` |
| Prior baseline | `phase-5-approved-v0.5.0` = `6ce4fd3` |
| Live trading | **DISABLED** (`BITMART_LIVE_TRADING_ENABLED=false`, `BITMART_EMERGENCY_KILL_SWITCH=true`) |
| Controlled Live Order | **BLOCKED — Explicit owner authorization not provided** |
| Phase 7 | **NOT STARTED** — no `phase-7-production-launch` branch |

The approval tag is placed on the approval-metadata commit, which is a descendant of the approved
implementation SHA; `git merge-base --is-ancestor d0be04f … phase-6-approved-v0.6.0^{commit}` exits 0.
No RC tag and no earlier approval tag was moved, deleted or recreated.

## Approved scope — what is in this baseline

| Area | State at approval | Evidence |
|---|---|---|
| **Node.js 24 LTS migration** | Done. All image stages on `node:24-alpine` pinned by digest `sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd`; runtime **v24.18.0** (Active LTS, EOL 2028-04-30). Node 20 (EOL 2026-03-24) retired; 0 EOL runtimes. `better-sqlite3` recompiled and DB-tested on Node 24/musl. | PHASE6-20, PHASE6-13 |
| **Container SBOM + vulnerability scan** | Done. Trivy 0.72.0; SBOM in CycloneDX + SPDX JSON; OS + library scan **0 CRITICAL / 0 HIGH**; CI gate `--severity CRITICAL,HIGH --exit-code 1` PASS. Image `quantumtrade-api:phase6-closure`, 69.8 MB, non-root uid 10001, PID 1 = node, read-only rootfs + tmpfs, prod-deps only, no bundled npm/npx/corepack, no secrets in env/history/filesystem, graceful SIGTERM. Container validation **17 passed / 0 failed**. | `artifacts/security/phase6-container-sbom.{cdx,spdx}.json`, `phase6-container-scan.json`, `artifacts/logs/phase6-hotfix/26-container-validation.log` |
| **Market Data Gateway server + E2E** | Done. Real `apps/market-gateway` process: health/ready, auth, origin allowlist, subscription limits, symbol/timeframe validation, dedup + refcount, cache, gap-fill, orderbook resync, Redis pub/sub, back-pressure, circuit breaker, metrics, graceful shutdown. Modes MOCK_REPLAY / BITMART_PUBLIC / INTERNAL_GATEWAY. **unit 13 · E2E 12**; WS load 100 + 1,000 connections, 100 % handshake, 0 dropped. **10,000 WS remains Not Executed.** | PHASE6-01, PHASE6-18 |
| **MFA API + UI + E2E** | Done. setup/verify/challenge/recovery/disable/regenerate/status/step-up; encrypted secret at rest, hashed recovery codes, replay guard, lockout, session rotation, cross-user isolation. **API 16 · lib 20 · E2E 16 (18 scenarios)**. | PHASE6-03, PHASE6-19 |
| **Browser matrix** | Done, all PASS. **User app 78 (26 × 3)**, **Admin app 102 (34 × 3)** on **Chromium 128.0.6613.18 / Firefox 128.0 / WebKit 18.0**. No test skipped, deleted or made conditional. | `artifacts/logs/phase6-hotfix/23-e2e-user-3browsers.log`, `24-e2e-admin-3browsers.log`, PHASE6-08 |
| **Trading Layout defect + fix** | Fixed. The verbatim handoff stylesheet assumes `.app-shell > .app-sidebar + .app-main > .trade-body` (`56px 1fr` columns, `.trade-body` = the 24-column grid); this app renders a sidebar-less shell with the 24-column track on `.widget-grid` inside `.trade-body`, and `app.css` only re-declared `grid-template-rows`. Measured pre-fix at 1440×900: `.trade-body` **1384×56**, `.widget-grid` **138×40**, panels **18–66 px**. Fixed with explicit `grid-template-columns: 1fr` on `.app-shell` and `display: block; grid-template-columns: none` on `.trade-body`; handoff CSS untouched. | PHASE6-12, PHASE6-13 |
| **KLineCharts v10 DataLoader migration** | Done. klinecharts 10 removed `applyNewData` / `applyMoreData` / `updateData` / `loadMore`; data now flows through `setDataLoader({ getBars, subscribeBar, unsubscribeBar })` with the load triggered by `setSymbol` + `setPeriod` (both required) and `resetData()` for a same-market reload. The old façade called `chart.applyNewData?.(bars)`, so optional chaining made the breaking change a **silent no-op** while the BFF returned HTTP 200 with ~38 KB of valid candles. Now v10-only with Fail-Fast `ChartEngineContractError` on a missing v10 API **or** a present v9 API; no v9 fallback. `git grep -nE 'applyNewData\|applyMoreData\|updateData\|loadMore'` matches only migration comments and the deliberate `REMOVED_V9_METHODS` detection list. | PHASE6-12, PHASE6-13 |
| **React key warning fix** | Fixed. Admin `Overview.tsx` / `AiOps.tsx` had `key` on the inner `<dt>` instead of the wrapping fragment inside `.map()`; now `<Fragment key={k}>`. | PHASE6-13 |
| **Prior E2E verification gap + new assertions** | Closed. The Phase 6 E2E asserted element presence, CSS classes and Playwright visibility only — never rendered geometry, never whether the chart engine held data (an 18 × 730 panel is "visible"; a canvas element existing is not a drawn chart), so two user-visible defects passed every run. New: `flow-l-layout-geometry` (8) asserts real `boundingBox()` of every shell region at 1366×768 **and** 1920×1080 plus runtime resize, dark/light, ko/en, reduced motion, edit mode and non-grid routes, with viewport-fraction thresholds and zero band overlap/overflow; `flow-m-chart-render` (8) asserts feed status 200, adapter bar count > 50, **engine-held bar count equal to it**, ordered plausible epoch-millis timestamps, canvas pixel sampling (> 20 distinct colours), symbol/timeframe reload, empty/error states, schema rejection and sort/de-duplication; `admin-console` (3) fails on any React warning across all 10 admin screens. Plus unit `layout-css` (9) and `chart-widget` (6). | PHASE6-08, PHASE6-12 |
| **Mutation / reproduction evidence** | Each new guard was proven to fail on its defect by re-introducing the defect and reverting the file byte-identically (`diff` verified): `app.css` overrides removed → **flow-l 7 of 8 failed** (`.trade-body` height 56 vs > 400; the 8th covers non-grid routes, which do not use `.trade-body`); v9 `applyNewData?.()` no-op restored → **flow-m 5 of 8 failed** (the 3 passing cases are empty-state / error-state / schema-rejection, which legitimately do not depend on engine data); `key` moved back onto `<dt>` → **admin-console 2 of 3 failed** with the React key warning. A second-order finding: the first `flow-m` failed only **1 of 8**, because the adapter's `barCount` reports what the **loader returned**, not what the **engine stored** — `ChartStatus.engineBarCount` (`data-engine-bar-count`) was added to separate those facts, after which the same reproduction fails 5 of 8. | PHASE6-08, PHASE6-12, PHASE6-13 |
| **Live trading** | **Continues DISABLED.** No approval in this record enables it. Controlled Live Order stays BLOCKED pending separate explicit owner authorization. | PRODUCTION-RELEASE-GATE |
| **Phase 7** | **Not started.** No Phase 7 branch exists; starting it requires the Phase 6 approval baseline (now frozen) plus a separate instruction. | — |

## Regression at approval — exact wording

```
Regression commands:
25 PASS / 1 audit raw-command FAIL

Production security threshold:
PASS — Critical 0 / High 0

Moderate advisories:
Temporarily accepted for the Phase 6 source baseline only.
Must be remediated or individually dispositioned before the
Phase 7 Production Security Gate passes.
```

This is **not** recorded as 26/26 PASS. Detail:

| Item | Result |
|---|---|
| `pnpm audit --prod` | **exit 1** |
| Moderate | **5** |
| High | **0** |
| Critical | **0** |
| `scripts/ci-audit-gate.sh` | **PASS** |
| Trivy production container | **0 Critical / 0 High** |

`pnpm audit --prod` exits non-zero on **any** severity, so the raw command's exit 1 is recorded as a
FAIL on its own line and is not absorbed into the gate result. The advisory set is byte-for-byte the
same as the Phase 6 baseline artifacts (`artifacts/logs/phase6-audit-prod-after.json`,
`artifacts/logs/ci-audit-prod.json`), so it is not a regression introduced by the hotfix.
Machine-readable summary: `artifacts/logs/phase6-hotfix/regression-summary.tsv`.

## Moderate advisory risk register (5 accepted exceptions)

### Framework-mode evidence (basis for reachability below)

**React Router runs in Declarative (BrowserRouter) mode — not Data Mode, not Framework/SSR mode.**
Verified in source at the approved SHA:
- `apps/web/src/main.tsx` imports **`BrowserRouter`** only.
- `apps/web/src/App.tsx` uses `Routes` / `Route` / `Navigate` / `useLocation` / `useNavigate`.
- Other call sites use `NavLink` / `Link` / `useNavigate` only.
- **Absent from the entire workspace:** `createBrowserRouter`, `createHashRouter`,
  `createMemoryRouter`, `RouterProvider`, `StaticRouter`, `StaticRouterProvider`, route `loader:` /
  `action:`, `useLoaderData`, `useFetcher`, `defer`, react-router `json()` / `redirect()`,
  `renderToString`, `hydrateRoot`. The app is a **client-only SPA** (`apps/web` builds to static
  assets via Vite); there is no server-side render and no hydration payload.
- **Every navigation target is a hard-coded literal.** The complete set: `/trade`, `/trade/ai`,
  `/trade/layout`, `/design-system`, `/status`, `/settings`, `/login`, `/signup`,
  `/account/security`. No URL parameter, query string, API response, `postMessage`, `localStorage`
  value or other user-controlled input is passed to `Link` / `NavLink` / `Navigate` / `useNavigate`.
- `apps/admin` does not depend on react-router at all (hash routing via `window.location.hash`).

**Hono runs on Linux/Alpine and the vulnerable `serve-static` path is not used.** Verified:
- `apps/api/src/index.ts` imports **only `serve`** from `@hono/node-server`
  (`serve({ fetch: app.fetch, hostname, port })`).
- `grep -rn "serveStatic\|serve-static" --include=*.ts apps packages` → **no usage anywhere**. The
  BFF serves no static files; the web and admin bundles are served separately as static assets.
- Runtime is **linux/amd64 Alpine** (`node:24-alpine`, digest-pinned), i.e. not Windows. The
  advisory's exploit vector is an encoded backslash (`%5C`) interpreted as a path separator, which is
  Windows-specific behaviour.
- Version actually linked into `apps/api`: **1.19.17** (confirmed from
  `apps/api/node_modules/@hono/node-server/package.json`).

### Exceptions

| # | Advisory ID | CVE / GHSA | Package | Installed | Fixed in | Dependency path | Runtime reachability | Exploitability | Mitigation | Owner | Expiry | Remediation plan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M-1 | GHSA-9jcx-v3wj-wh4m | GHSA-9jcx-v3wj-wh4m — "React Router has unexpected external redirect via untrusted paths" | `react-router` | 6.26.2 | ≥ 6.30.2 | `apps/web > react-router-dom@6.26.2 > react-router@6.26.2` | **Not reachable as configured.** Requires a redirect target derived from untrusted input; all 9 navigation targets are hard-coded literals and no user input reaches a router API. | **Low.** No untrusted path flows into routing; client-only SPA, no SSR. | Hard-coded route table; CSP `frame-ancestors` + security headers package; no open-redirect surface in the BFF. | Frontend owner (`apps/web`) | Phase 7 Production Security Gate **or** first production deployment, whichever comes first | Patch upgrade `react-router-dom` 6.26.2 → **6.30.4** (minor, same v6 API) — clears M-1 and M-2. Schedule at the start of Phase 7 Stage 4; re-run `pnpm e2e` + 3-browser matrix. |
| M-2 | GHSA-2j2x-hqr9-3h42 | GHSA-2j2x-hqr9-3h42 — "same-origin redirect with path starting `//` causes open redirect via protocol-relative URL reinterpretation" | `react-router` | 6.26.2 | ≥ 6.30.4 | `apps/web > react-router-dom@6.26.2 > react-router@6.26.2` | **Not reachable as configured.** Needs an attacker-supplied path beginning `//`; no dynamic path is ever passed to a router API. | **Low.** Same reasoning as M-1. | As M-1. | Frontend owner (`apps/web`) | Phase 7 Production Security Gate **or** first production deployment | Same 6.30.4 upgrade as M-1. |
| M-3 | GHSA-frvp-7c67-39w9 | GHSA-frvp-7c67-39w9 — "Node.js Adapter for Hono: path traversal in `serve-static` on Windows via encoded backslash (`%5C`)" | `@hono/node-server` | 1.19.17 | ≥ 2.0.5 | `apps/api > @hono/node-server@1.19.17` | **Not reachable.** Two independent reasons: (a) `serveStatic` is never imported or mounted anywhere in the workspace — only `serve()`; (b) the runtime is Linux/Alpine (`node:24-alpine`, digest-pinned), and the flaw is Windows-path-separator specific. | **Very low.** Vulnerable code path is not present in the request pipeline and the OS precondition does not hold. | BFF serves no static files; container runs non-root (uid 10001) on a read-only root filesystem; frontends served as separate static assets. | API/Platform owner (`apps/api`) | Phase 7 Production Security Gate **or** first production deployment | Evaluate `@hono/node-server` **2.x** (major; `serve()` signature and Hono peer range must be re-verified) during Phase 7 Stage 1, gated on the container validation suite + gateway/API E2E. If 2.x is deferred, re-disposition with fresh evidence rather than silently extending. |
| M-4 | GHSA-wrjc-x8rr-h8h6 | GHSA-wrjc-x8rr-h8h6 — "React Router: open redirect via backslash in `<Link>` and `useNavigate` (CVE-2025-68470 bypass)" | `react-router` | 6.26.2 | ≥ 7.18.0 | `apps/web > react-router-dom@6.26.2 > react-router@6.26.2` | **Not reachable as configured.** The vector is a backslash-containing target passed to `<Link>` / `useNavigate`; every target in the app is one of 9 hard-coded literals with no dynamic component. | **Low.** Would require a code change that introduces user-controlled navigation targets. | Hard-coded route table; a lint/review rule against dynamic navigation targets is added to the Phase 7 remediation plan. | Frontend owner (`apps/web`) | Phase 7 Production Security Gate **or** first production deployment | Requires **react-router-dom ≥ 7.18.0** — a **major** upgrade with routing API changes. Plan: assess v7 migration in Phase 7 Stage 4 (v7 declarative mode is largely v6-compatible; `RouterProvider`/data-mode adoption is explicitly out of scope), or accept with a re-dated disposition backed by a static check proving no dynamic navigation targets exist. |
| M-5 | GHSA (React Router `deserializeErrors`) | "Arbitrary constructor injection via `deserializeErrors()` in React Router SSR hydration" | `react-router` | 6.26.2 | ≥ 7.18.0 | `apps/web > react-router-dom@6.26.2 > react-router@6.26.2` | **Not reachable.** `deserializeErrors()` runs only in the **SSR hydration** path. This app is a client-only SPA: no `RouterProvider`/data mode, no `StaticRouterProvider`, no `renderToString`, no `hydrateRoot`, no server-injected hydration payload. | **Not exploitable in this configuration** — the code path is never executed. | Client-only SPA build (Vite static output); no SSR server exists to inject a hydration payload. | Frontend owner (`apps/web`) | Phase 7 Production Security Gate **or** first production deployment | Cleared by the same v7 upgrade assessment as M-4. If the SPA-only architecture is retained, re-disposition as structurally unreachable with the evidence above. |

**Expiry condition (all five):** the Phase 7 Production Security Gate **or** production deployment,
whichever comes first. These are accepted for the **Phase 6 source baseline only**. They are **not**
waived for Phase 7 and **not** waived for production. Per the release-gate policy, security-critical
gates may not be waived indefinitely; each exception must be remediated or individually
re-dispositioned with fresh evidence before the Phase 7 Production Security Gate can pass.

## Still Not Executed at approval (unchanged)

Real-device Safari (macOS/iOS hardware) and real mobile browsers · 1,000-VU HTTP load · 10,000
WebSocket connections · managed PostgreSQL PITR · external SAST / secret / OSV scanners (semgrep,
gitleaks, osv-scanner) · real PagerDuty/Slack alert delivery · multi-host rolling deploy · image
registry publish · BitMart Stage A · Controlled Live Order · Live OpenAI + live model evaluation +
live AI E2E. None is marked Passed. `apps/admin` still has no unit-test harness (covered by browser
E2E instead).

---

## Phase 7 — Stage 0 BLOCKED / first Phase 7 commit (2026-07-30)

Branch `phase-7-production-launch`, created from `phase-6-approved-v0.6.0`
(`d63ee29c51ba00469b0f48bcf6c4f8848b8ddb4d`). The Phase 6 approval baseline is unchanged; no tag was
moved, deleted or recreated. **`phase-7-rc-v0.7.0` has NOT been created.**

### Stage 0 — corrected gate states

Management-plane `List`/`Describe` denials are **authorization** results, not runtime faults. The
instance is healthy, its credentials are valid, its clock is synchronized and its egress works.

| # | Gate | State |
|---|---|---|
| P7-0.1 | Runtime host/service | **PASS** — EC2 `i-0483d903c0925f690` (`c8i.xlarge`), verified via IMDSv2. Not ECS/EKS |
| P7-0.2 | Region | **PASS** — ap-northeast-2 |
| P7-0.3 | IAM role identity resolvable | **PASS** — `EC2-SessionManager-Seoul` (a Session Manager role, **not** the intended application runtime role) |
| P7-0.4 | Fixed egress IP | **PASS** — `15.164.47.4` |
| P7-0.5 | System time synchronization | **PASS** — NTP active; **+21 ms** vs the BitMart production server clock |
| P7-0.6 | BitMart **GetSecretValue** | **BLOCKED — AccessDenied** |
| P7-0.7 | OpenAI **GetSecretValue** | **BLOCKED — AccessDenied** |
| P7-0.8 | **KMS Decrypt** | **NOT_EXECUTED / BLOCKED** — the `kms:ViaService = secretsmanager` decrypt path is reachable only *through* a secret read; because the read is denied, the real path was never exercised |
| P7-0.9 | Secret separation (7 distinct secrets) | **BLOCKED** — cannot enumerate or describe |
| P7-0.10 | Managed PostgreSQL / PITR / encryption / retention | **NOT_EXECUTED / BLOCKED** — denied **and** not provisioned. The local dev PostgreSQL is **not** evidence |
| P7-0.11 | Managed Redis (TLS + AUTH) | **NOT_EXECUTED / BLOCKED** — denied **and** not provisioned. The local dev Redis reports `tls-port = 0` and has no AUTH |
| P7-0.12 | ECR registry push/pull, digest deploy, signing | **NOT_EXECUTED / BLOCKED** — denied and not provisioned |
| P7-0.13 | DNS / TLS (domain, certificate expiry) | **NOT_EXECUTED / BLOCKED** — denied; **no production domain configured anywhere in the repository**. Outbound TLS from the runtime is separately confirmed (BitMart REST 200, `ssl_verify_result=0`) |
| P7-0.14 | Observability collector / log store / metric store | **NOT_EXECUTED / BLOCKED** — denied; no collector endpoint |
| P7-0.15 | Alert delivery + dashboard + runbook | **NOT_EXECUTED / BLOCKED** — denied; no channel configured |
| P7-0.16 | Production seed blocked | **PASS (code-enforced)** / **NOT_EXECUTED against the real production DB** |

**No broad `List*` permission will be added to the runtime role to make a preflight probe succeed.** The
application resolves secrets by ARN and never enumerates them; `secretsmanager:ListSecrets` is on the
explicit `Deny` list in the Phase 7 runtime policy. Existence verification will use `DescribeSecret` on
the named ARNs only.

Stage 0 stays **BLOCKED** and is not marked PASS. Stages 1–9 have not started.

### Defect found in the APPROVED Phase 6 artifact — and fixed

The image approved as `quantumtrade-api:phase6-closure` shipped the development fixture credentials
inside `/app/dist/index.js`: one occurrence each of `admin@qt.local`, `adminpass1234`,
`supportpass1234`, `analystpass1234`, `userpass1234`, `disablepass1234`, `rolepass1234` and
`dev-insecure-csrf-key`.

Exploitability was low — the seed's execution path was gated on
`ADMIN_SEED === 'true' && NODE_ENV !== 'production'`, the image bakes `NODE_ENV=production`, and the
credentials were only ever valid against a local SQLite database. But the requirement is **absence from
the artifact**, not unreachability, and that was not met. Phase 6 missed it because
`scripts/phase6-container-validate.sh:84` scanned only the image `ENV` and `docker history`, never the
bundle contents.

Fixes in this commit:

| Change | Files |
|---|---|
| Fixtures moved to a dev-only module — the sole copy | `apps/api/src/dev/seed.ts` |
| Explicit dev/test command that refuses in production (exit 2, before opening any database) | `apps/api/src/dev/seed-cli.ts`, script `seed:dev` |
| Production entry loads the dev module through a **runtime-assembled specifier**, so esbuild cannot resolve or inline it; the type shape is declared locally so even a *type* reference to the path is absent | `apps/api/src/index.ts` |
| Hard-coded dev CSRF key removed → ephemeral `randomBytes(32)` in dev, **required** `AUTH_CSRF_KEY` (≥32 chars) in production with fail-closed start-up | `apps/api/src/env.ts` |
| Production DB dev-seed detection, fail-closed, using **SHA-256 digests only** | `apps/api/src/security/dev-fixture-guard.ts` + start-up wiring in `index.ts` |
| Artifact scanner reading the real artifact (13 rules) | `scripts/phase7-artifact-scan.sh` |
| Regression: 31 unit tests + 16 process-level checks | `apps/api/src/__tests__/production-artifact.test.ts`, `scripts/phase7-seed-isolation-regression.sh` |

Verified result: all eight strings are **0 occurrences** in `apps/api/dist/index.js` and in the container
filesystem of the rebuilt `quantumtrade-api:phase7-preflight` (217 files scanned, 0 findings). The build
is a single 505.90 KB bundle with no chunk, no `dist/dev/`, no source map — so the dynamic import is not
merely hiding the module, the bundler genuinely does not emit it.

**Scanner negative control.** Run against the pre-fix approved image, the scanner reports 16 findings and
exits 1 (`QT-SEC-002` ×7 fixture e-mail domain, `QT-SEC-001` ×6 fixture tokens by digest, `QT-SEC-011`
×1 insecure dev key marker, `QT-SEC-013` ×1 dev/test directory). A false positive was found and fixed
during that run: `QT-SEC-013` had matched `node_modules/tar-fs/test/fixtures`, a third-party package's
own test directory; the rule is now scoped to our emitted `/app/dist`.

**Fail-closed detection, measured.** Against a real seeded database:

```
[api] FAIL-CLOSED startup: DEV_SEED_ACCOUNT_DETECTED: the production database contains
development/E2E fixture data (identifier matches=6, fixture marker=true). Refusing to start. …
```

Leak check on that output: `admin@qt.local` 0, `qt.local` 0, `adminpass1234` 0. Against a clean
database: `production fixture scan: OK (identifiers inspected=0, fixture matches=0)`. No e-mail, user id
or password is ever written to a log by this path, and no development identifier exists in the
production bundle — only digests.

### Terraform IaC (authored, statically validated, never applied)

`infrastructure/terraform/phase7` — 18 files covering VPC/subnets/security groups (single NAT for one
fixed egress IP), immutable ECR repositories, Multi-AZ PostgreSQL with PITR and KMS storage encryption,
ElastiCache with TLS + at-rest encryption, **seven separate Secrets Manager containers**, four
customer-managed KMS keys, separate **runtime** and **deployment** IAM roles, CloudWatch log
groups/dashboard, an SNS alert topic with 21 alarms carrying runbook anchors, an optional ECS Fargate
target with secrets injected **by reference**, and an optional ACM/Route53 module.

No `aws_secretsmanager_secret_version` exists anywhere, so **no secret value passes through Terraform,
a plan file, or state**. The ElastiCache auth token and the RDS master password are likewise owned
outside Terraform.

Prohibitions honoured: no `Resource "*"` on a restrictable action (the only `"*"` resources are
namespace-conditioned `cloudwatch:PutMetricData`, `ecr:GetAuthorizationToken` which has no ARN, and the
`Deny` statements); no `secretsmanager:ListSecrets`; no `secretsmanager:PutSecretValue`; no `kms:*`
(runtime holds only `kms:Decrypt` conditioned on `kms:ViaService`); no RDS/ElastiCache/Route53/ACM
management; no ECR push for the runtime role; no `terraform apply`; no AWS resource created, modified or
deleted.

| Step | Tool | Version | Result |
|---|---|---|---|
| `terraform fmt -check -recursive` | terraform | 1.9.8 | **PASS** |
| `terraform init -backend=false` | terraform | 1.9.8 | **PASS** |
| `terraform validate` | terraform | 1.9.8 | **PASS** |
| `tflint --recursive` | tflint | 0.53.0 | **PASS** (0 issues) |
| `checkov --framework terraform` | checkov | 3.3.8 | **PASS** — 297 passed / 0 failed / 27 skipped, every skip justified inline |
| `tfsec` | tfsec | 1.28.13 | **PASS** — 0 critical / 0 high / 0 medium / 0 low |
| `terraform plan` | terraform | 1.9.8 | **NOT_EXECUTED** — needs credentials with read access; the runtime role is denied on every service in the configuration |
| `terraform apply` | terraform | 1.9.8 | **NOT_EXECUTED** — out of scope by instruction |

Tooling: none of terraform/tflint/tfsec/checkov was installed. terraform 1.9.8, tflint 0.53.0 and tfsec
1.28.13 were installed from official releases; `pip3 install --user checkov` **failed** under Ubuntu
24.04's PEP 668 externally-managed-environment policy and was worked around with a virtualenv, giving
checkov 3.3.8.

### Regression on this branch (2026-07-30T05:22–05:26Z, Node v24.18.0)

**23 PASS / 1 audit raw-command FAIL.** Full table in `docs/PHASE7-20-PRODUCTION-READINESS.md` §2;
machine-readable summary at `artifacts/logs/phase7/regression-summary.tsv`.

- `pnpm test` → **457 tests / 41 files** (was 426/40 at the Phase 6 baseline; +31 new
  production-artifact tests)
- `pnpm e2e` 26 · `pnpm e2e:admin` 34 · `pnpm e2e:mfa` 16 · `pnpm e2e:gateway` 12 · `test:gateway` 13
- `pnpm audit --prod` → **exit 1**, 5 moderate / 0 high / 0 critical (same advisory set as the Phase 6
  baseline); `scripts/ci-audit-gate.sh` → **PASS**
- `scripts/phase7-artifact-scan.sh` → 0 findings on `dist`; 0 findings on the container (217 files)
- `scripts/phase7-seed-isolation-regression.sh` → 16/16
- `scripts/phase7-iac-validate.sh` → 6 static steps pass, plan/apply NOT_EXECUTED

One failure in the first run was traced to **environment contamination, not code**: manually started dev
servers were still bound to 5173/5174/8787, and `reuseExistingServer: !process.env.CI` caused Playwright
to adopt the manual admin app on 5174 — which pointed at a persistent SQLite database with accumulated
kill-switch rows instead of the `:memory:` API the config provisions. After stopping those servers,
`pnpm e2e:admin` passed 34/34 and the whole set was re-run clean.

### Not done, deliberately

- Stage 0 **not** marked PASS; Stages 1–9 not started.
- `phase-7-rc-v0.7.0` **not** created.
- No AWS resource created, modified or deleted; no `terraform plan`, no `terraform apply`.
- No secret value handled, stored, printed or transmitted. No `List*` permission added to the runtime
  role.
- Live trading **not** enabled (`BITMART_LIVE_TRADING_ENABLED=false`,
  `BITMART_EMERGENCY_KILL_SWITCH=true`).
- **Controlled Live Order: BLOCKED — Explicit owner authorization not provided.**
- Phase 6 approval baseline untouched; all 15 pre-existing tags unchanged.


---

## Phase 7 — Production Security Gate pass (2026-07-30)

Branch `phase-7-production-launch`, on top of `6d4f910`. Baseline `phase-6-approved-v0.6.0`
(`d63ee29`) untouched. **No tag created. Stage 0 still BLOCKED. Live trading still disabled.**

Detail: `docs/PHASE7-18-TEST-REPORT.md`. Gate state: `docs/PHASE7-08-SECURITY-FINAL-GATE.md`.

### The five accepted moderates are remediated, not waived

```
pnpm audit --prod   →  exit 0   Critical 0 / High 0 / Moderate 0
ci-audit-gate.sh    →  PASS
```

| Advisory | Package | Was | Now |
|---|---|---|---|
| GHSA-9jcx-v3wj-wh4m / GHSA-2j2x-hqr9-3h42 / GHSA-wrjc-x8rr-h8h6 / GHSA-337j-9hxr-rhxg | `react-router` | 6.26.2 | **8.3.0** |
| GHSA-frvp-7c67-39w9 | `@hono/node-server` | 1.19.17 | **2.0.12** |

The path mattered. `react-router-dom@7.18.2` cleared all four React Router moderates but introduced a
**new HIGH** — `GHSA-qwww-vcr4-c8h2` (RSC Mode CSRF bypass, vulnerable `>=7.12.0 <8.3.0`, patched
`>=8.3.0`). `react-router-dom` has no 8.x, so the fix required `react-router@8.3.0`, whose peer is
**react ≥ 19.2.7** — hence React 18.3.1 → **19.2.8** across `apps/web` and `apps/admin`, plus
`@types/react` 19.2.17, `@types/react-dom` 19.2.3, `@testing-library/react` 16.3.2 and `zustand` 5.0.14
(4.5.5 pulls a `use-sync-external-store` whose peer caps at React 18). Stopping at 7.18.2 would have
traded four moderates for one high and failed the `0 critical / 0 high` gate.

Also: `vitest` 2.0.5 → 2.1.9 (same-major, clears one OSV advisory); the obsolete
`@remix-run/router` override removed; `use-sync-external-store >= 1.6.0` override added.

Compatibility work required by the majors: six `apps/web/src` files import from `react-router` instead
of `react-router-dom`; React 19's types dropped the **global** `JSX` namespace, so `apps/admin`'s route
map uses `React.JSX.Element` and one web test imports `type { JSX } from 'react'`.

### Post-upgrade contracts are asserted, not argued

`apps/web/src/__tests__/router-mode.test.ts` (9 tests) — `react-router` ≥ 8.3.0; `<BrowserRouter>` is
the only router mounted; the only names imported from the package are the eight declarative ones; none
of 25 Data-Mode / Framework-Mode / SSR / RSC APIs appears anywhere; no route `loader:`/`action:`; no
`hydrateRoot` / `renderToString` / `react-dom/server`; every navigation target is a static literal; and
the built bundle contains no RSC or server-router entry.

`apps/api/src/__tests__/server-adapter.test.ts` (9 tests) — `@hono/node-server` ≥ 2.0.5; `serve()`
accepts the exact `{ fetch, hostname, port }` shape, binds a real socket, serves a real request and
exposes the `close()` used by graceful shutdown; `serveStatic` appears nowhere in source or in
`dist/index.js`; four encoded-backslash/percent traversal shapes all return the application's own 404
with no filesystem payload; the platform is recorded as `linux`, so a literal Windows reproduction is
NOT_EXECUTED and the structural checks are the control.

### Scanner suite — all eight categories executed

| Scan | Tool / version | Rule / DB | Findings |
|---|---|---|---|
| SAST | semgrep 1.172.0 | `p/default` | **27 → 3** |
| Secret scan (working tree) | gitleaks 8.21.2 | builtin + `.gitleaks.toml` | **0** |
| Secret scan (full history, 35 commits) | gitleaks 8.21.2 | builtin + `.gitleaks.toml` | **0** |
| Dependency vulns (incl. dev) | osv-scanner 2.4.0 | osv.dev live | **11**, all dev-only |
| Filesystem | trivy 0.72.0 | DB 2026-07-29T19:07:59Z | 0 critical / 0 high |
| Container image | trivy 0.72.0 | same | **0** |
| SBOM CycloneDX + SPDX | syft 1.18.1 | — | image 98, source 934 components |
| License scan | SBOM analyzer | AGPL/SSPL/BUSL/CC-BY-NC deny-list | **0 restricted** |
| IaC | checkov 3.3.8 | builtin | **0 failed** (304 passed / 31 skipped) |
| IaC | tfsec 1.28.13 | builtin | **0** |

Every record carries tool, version, rule/DB version, timestamps, exit code and count
(`artifacts/security/phase7/scan-summary.tsv`). No secret value appears in any report: gitleaks runs
with `--redact` and the dev-fixture rule matches by SHA-256 digest, so the literals are absent from the
scanner itself.

SBOM SHA-256 — `sbom-image.cdx.json` `64268cf9552ec3f1…`, `sbom-image.spdx.json` `b848be8562352…`,
`sbom-source.cdx.json` `6e71ab5ddfc328b6…`, `sbom-source.spdx.json` `125c55021beb9cc7…`.

### Hardening applied while closing SAST findings

AES-GCM `authTagLength` pinned to 16 bytes in both cipher paths (Node previously accepted a truncated
auth tag); **all 13** GitHub Actions references pinned to commit SHAs; SRI (`sha384-GIdEBa…`, computed
from the served bytes and verified stable) added to the version-pinned CDN stylesheet; ALB access
logging enabled with a hardened, delivery-scoped S3 bucket (SSE-S3, versioned, public access blocked,
400-day lifecycle, TLS-only policy); `readCookie` rewritten without a dynamically built `RegExp`.

Four findings are justified in place with the reason at the suppression point (ECR mutability is
variable-validated to `IMMUTABLE`; two test-only regex helpers; a `console.error` template; a test that
asserts a plaintext socket URL is **rejected**). Three remain **OPEN and unsuppressed**: the pnpm
supply-chain policy keys exist only in pnpm 10 and this repo pins pnpm 9.15.0 — writing them would
satisfy the scanner while enforcing nothing.

### Production image rebuilt

`quantumtrade-api:phase7-secgate`, ImageID
`sha256:ca6680e6f777e9af062b5faf6de1c305a2a8c2b97b33ad78dec80af341ae51ab`, 313 MB.
Container validation **17/17**: Node v24.18.0, base digest `sha256:a0b9bf06…` pinned, non-root uid
10001, read-only rootfs + tmpfs, `/health` `/health/live` `/health/ready` 200, graceful SIGTERM,
no dev fixture, no fixed dev credential, no source map, Trivy 0 CRITICAL / 0 HIGH, `LIVE=false`,
`KILL_SWITCH=true`, and fail-closed without a Secret ARN.

`.dockerignore` gained `**/.terraform`: the 692 MB provider cache was entering the build context and
filled the disk on the first rebuild attempt.

### Playwright environment isolated — and two latent defects found doing it

Reuse is off by default (`PW_ALLOW_REUSE=1` is the only opt-in and the runner unsets it); every port is
asserted free **before** Playwright starts (it cannot be done in `globalSetup` — Playwright launches
`webServer` first); databases are `mkdtemp`/`:memory:`; a trap cleans up processes and temp databases
even on failure; and a guard spec per suite verifies the base URL serves the expected shell
(`#root` vs `#admin-root`), that the API reports **this run's `GIT_SHA`**, and that
`liveTradingEnabled` is false.

Two real defects surfaced, both previously invisible:

1. **`pnpm --filter X dev -- --port N` never reached Vite** — pnpm forwards the literal `--`, Vite stops
   parsing, and the server silently uses the config port. Unnoticed because the requested port equalled
   the default. Fixed with `VITE_DEV_PORT` + `strictPort: true`.
2. **`VITE_API_BASE_URL` was doing double duty** — a `VITE_`-prefixed variable is inlined into the
   **client** bundle, so using it as the dev-proxy target made the browser call the API cross-origin;
   the `SameSite` session cookie was dropped and every authenticated request returned 401. Fixed with a
   server-only `DEV_API_PROXY_TARGET`. The MFA spec's hard-coded origin now comes from the config.

A Firefox-only flake was also fixed: admin `[28] offline → resume` cut the network before the lazily
imported Users chunk loaded, so the search input never rendered.

### Regression — 24 commands, all PASS

Node v24.18.0. `artifacts/logs/phase7/regression-summary.tsv`.

install · lint (0 errors) · typecheck · **test 475/43 files** · build · **e2e 30** · postgres ·
integration · admin · **e2e:admin 38** · security · **gateway 13** · **e2e:gateway 12** · mfa ·
**e2e:mfa 18** · chaos · ai · eval:ai · **audit --prod exit 0** · audit gate · artifact scan (0
findings) · seed isolation (16/16) · IaC validate · container validation (17/17).

Isolated 3-browser matrix — Chromium 128.0.6613.18 / Firefox 128.0 / WebKit 18.0:
**user 90, admin 114, MFA 54 = 258 passed.**

### Still Not Executed / Blocked

Stage 0 AWS gates (secrets, KMS decrypt, RDS, ElastiCache, ECR, DNS/TLS, observability, alerting) —
**BLOCKED**. `terraform plan` / `apply` — **NOT_EXECUTED**, no AWS resource created, modified or
deleted. pnpm-10 supply-chain policy and 11 dev-only OSV advisories — **OPEN**. WAF, image
signing/attestation, real-device Safari, 1,000-VU HTTP, 10,000 WS, managed PITR drill, real
PagerDuty/Slack, multi-host rolling deploy, registry publish, BitMart Stage A, Live OpenAI + live
model evaluation + live AI E2E — **NOT_EXECUTED**.

**Controlled Live Order: BLOCKED — Explicit owner authorization not provided.**
Stage 0 is **not** marked PASS. `phase-7-rc-v0.7.0` was **not** created.
