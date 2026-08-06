# Production Release Gate

These items are **NOT Phase 1 failures**. Phase 1 is approved (`v0.1.0` @ `1a43f8e`). The following
are **mandatory verifications before Commercial Beta / Production** and are carried forward here as
open gate items (owned, tracked, not closed and not faked).

Legend: **BETA** = required before commercial beta · **PROD** = required before production.

| # | Gate item | Current state (Phase 1) | Required for | Exit criteria | How to run / plan |
|---|---|---|---|---|---|
| 1 | **Firefox E2E clarified** | Executed locally: **Firefox 9/9 pass** (`artifacts/logs/e2e-all-browsers.log`). Clarification: it ran here. | BETA | Firefox E2E green in CI on every PR | `PW_ALL_BROWSERS=1 pnpm e2e`; wired in `.github/workflows/ci.yml` |
| 2 | **WebKit E2E** | **Not Executed** — host libs missing, `sudo playwright install-deps` unavailable in sandbox. | BETA | WebKit 9/9 green in CI | CI job installs `--with-deps` + `PW_WEBKIT=1 pnpm e2e` (workflow present) |
| 3 | **BitMart WS ping/pong** | Connection verified; **text `ping`→`pong` not echoed** (pongs=0); liveness via data stream. Known issue. | BETA | Correct heartbeat per BitMart WS spec (or documented keepalive) confirmed | Adjust `bitmart-ws-verify.mjs` heartbeat frame to BitMart's documented format; assert pong/keepalive |
| 4 | **BitMart WS long soak** | 60s run only. **10-min+ soak Not Executed** (time-boxed). | BETA | ≥10 min stable; no leak; reconnect under churn | `WS_DURATION_MS=600000 WS_SYMBOL_SWITCHES=20 WS_TF_SWITCHES=20 node tests/integration/bitmart-ws-verify.mjs` |
| 5 | **1,000-user load test** | smoke(10)+baseline(100) measured. **1,000 VUs Not Executed** (sandbox capacity). | PROD | p95 within SLO at 1,000 VUs; error rate < 1% | `BASE_URL=… VUS=1000 DURATION=2m k6 run tests/load/00-smoke.js` on sized infra |
| 6 | **10,000 WS staged test** | **Not Executed** (sandbox capacity). | PROD | 10k concurrent WS/SSE; connection success ≥ target; bounded drop rate | `tests/load/03-ws-10k.js` staged on sized infra |
| 7 | **CPU/mem/cache/dropped-message metrics** | **Not Measured** — no instrumentation/observability backend. | PROD | Metrics exported + dashboards; capture under load | Wire observability backend (metrics/traces); measure during #5/#6 |
| 8 | **Central Market Data Gateway + scalability** | **Documented only** — Phase 1 is single-node BFF (browsers never hit BitMart directly, but no Redis fan-out / horizontal scale). | PROD | Dedicated ingestion + Redis pub/sub + stateless fan-out; scale verified | Implement per `docs/17-market-data-architecture.md` transition plan; verify with #5/#6 |

## Ownership
- BETA gate (1–4): before public beta.
- PROD gate (5–8): before production trading and/or large-scale rollout.
- None of these block Phase 2 (Auth/User/DB/Security), which is additive and does not depend on them.

## Phase 2 Closure updates (2026-07-29)
- **PostgreSQL**: real integration now **EXECUTED** against Docker `postgres:16` (migrate up/down,
  tx rollback, unique/FK/index, concurrent sessions, pooling, repo parity, reconnect, restart,
  empty bootstrap) — see `docs/PHASE2-07` + `artifacts/logs/pg-integration.log`. Remaining for
  PROD: managed Postgres provisioning, connection-pool sizing under load (ties to gate #5/#7),
  backup/restore + PITR runbook, and running the app's default store on Postgres (dev default
  remains SQLite). These are **PROD** gate items, not Phase-2 failures.
- **Real email sending**: MailProvider interface implemented; dev uses MailSink (Mock). A real
  SMTP/SES provider + deliverability is a **BETA** gate item.
- **KMS envelope encryption** for exchange credentials remains interface-only (future gated phase).

## Phase 3 Closure updates (2026-07-29) — BitMart live trading gate
Phase 3 code is implemented + tested (mock/PG); live trading is **NOT approved / NOT executed**. Gate items:
| # | Item | State | Required for |
|---|---|---|---|
| P3-1 | BitMart Production Read-Only real connection | **Not Executed / fail-closed** — Stage A attempt (`phase3-stageA.log`): managed credential source not connected (no `BITMART_SECRET_ARN`/`AWS_REGION`, `@aws-sdk` absent). Env verified credential-free: egress 15.164.47.4, prod REST HTTP200+TLS, drift ≈−22ms, redaction Pass | BETA |
| P3-2 | Private WebSocket live auth/heartbeat/reconnect + 30-min/2-h soak | Not Executed (needs credential). WS URL now wired + production allowlist + demo-reject fail-closed (tested); mock + dedup + backoff tested | BETA |
| P3-3 | Controlled Live Order (real order) | **Not Executed** — owner authorization + safe creds not provided | PROD (explicit approval) |
| P3-4 | KMS-backed credential vault (prod) | interface only (dev KEK used) | PROD |
| P3-5 | Managed Postgres as app default store | SQLite dev default; PG verified via harness | PROD |
| P3-6 | Rate-limit token bucket + circuit breaker (coded+tested); distributed priority queue / Redis fan-out | token bucket/breaker **implemented + tested**; Redis/distributed queue **documented only** | PROD (distributed part) |
| P3-7 | Order/position full DB repos wired end-to-end | schema+constraints verified; service uses in-memory in tests | BETA |

Live activation requires: real safe credentials (Read-Only + Future-Trade only), IP whitelist, all
server gates green, and explicit owner authorization. Until then trading stays READ_ONLY/SHADOW.

## Phase 4 Closure updates (2026-07-29) — AI copilot gate
Phase 4 AI is implemented + tested (mock/fake/PG); the **live OpenAI provider is NOT executed** (no key).
| # | Item | State | Required for |
|---|---|---|---|
| P4-1 | Live OpenAI Responses API (streaming/tool-calling/latency/cost) | **Not Executed** (no key); fake-transport unit-tested | BETA |
| P4-2 | Live-model evaluation (quality/hallucination vs real model) | Not Executed; deterministic eval passes | BETA |
| P4-3 | AI Workspace full in-browser E2E (real browser, mock server) | Partial (Chromium); expand | BETA |
| P4-4 | Persistence-failure / duplicate-request fault-injection tests | Documented (route-level); automate | BETA |
| P4-5 | Client hardened markdown renderer wired to sanitized output | server sanitizes; wire client | BETA |
| P4-6 | Provider auto primary→fallback switch on live failure | surfacing implemented; live switch NE | BETA |

AI cannot place/modify/cancel orders, change leverage/position mode, or move funds under any config; it
only proposes drafts for explicit user approval. Enabling the live provider requires an OpenAI key in
AWS Secrets Manager + IAM permission; fail-closed until then. Phase 3 BitMart Stage A / Private WS soak
/ Controlled Live Order gate items are unchanged (still Not Executed / not approved).

## Phase 5 Closure updates (2026-07-29) — Admin dashboard gate
These gate items are now STRUCTURED in the `release_gates` table and queryable via
`/api/admin/release-gates`. The admin dashboard does NOT change any pending item to Passed — it only
displays status. Gate guards: PASSED requires evidence (no fake pass); WAIVED requires SUPER_ADMIN +
reason + future expiry (production-required ≤ 30 days).
| # | Item | State | Required for |
|---|---|---|---|
| P5-1 | Full admin UI screen set (beyond login/overview/users) | **Done** (screens A–K real UI, separate bundle, route code-split) — Admin UI Closure Pass | — |
| P5-2 | Admin-app Playwright E2E (real browser) | **Chromium 31 passed** (30 required scenarios + [21b]); Firefox/WebKit **Not Executed** | BETA (Firefox/WebKit) |
| P5-3 | Admin MFA / real step-up provider | Not Implemented (labeled) | BETA |
| P5-4 | Multi-node kill-switch/flag propagation + distributed rate limit | Documented (single-node) | PROD |
| P5-5 | Emergency Cancel / Reduce-only for operators | Documented / Disabled (needs security approval) | PROD |

### Phase 6 — Security, Scale, Reliability & Production Ops (branch `phase-6-production-hardening`)
Base = `phase-5-rc-v0.5.2` (`6ce4fd3`). `phase-5-approved-v0.5.0` does not exist (no approval tag
fabricated/moved). Only measured results below; un-run items stay Not Executed.

| # | Item | State | Required for |
|---|---|---|---|
| P6-1 | Central market-data gateway (core logic) | **Done** (market-gateway 13 tests) | — |
| P6-2 | WS gateway server (live BitMart upstream + fan-out) + 10k connections | **Not Executed** | PROD |
| P6-3 | Multinode shared state (Redis CAS + pub/sub, fail-closed) | **Done** (real Redis, ~1ms) | — |
| P6-4 | Multi-host cluster + rolling-deploy consistency | **Documented / Not Executed** | PROD |
| P6-5 | MFA / step-up (algorithms + policy) | **Done** (mfa 20 tests) | — |
| P6-6 | MFA live enrol/challenge UI+API | **Not Executed** | PROD |
| P6-7 | Security headers + app-level OWASP guards | **Done** (security 9 + admin-api 14) | — |
| P6-8 | External scanners: container SBOM+vuln (Trivy) **Done (0 C/0 H)**; SAST/secret/OSV | **Partial** — container scan Done; semgrep/gitleaks/osv **Not Executed** (absent) | PROD |
| P6-9 | Dependency audit remediation (2 critical / 12 high, dev-tooling) | **Open** | PROD |
| P6-10 | Observability (logger/tracer/metrics/alerts) | **Done** (obs 10 tests) | — |
| P6-11 | Live OTel collector + alert delivery (PagerDuty/Slack) | **Not Executed** (adapter+mock only) | PROD |
| P6-12 | PostgreSQL backup/restore drill (integrity + RTO) | **Done** (local PG17, RTO 136ms) | — |
| P6-13 | Managed PostgreSQL PITR | **Not Executed** | PROD |
| P6-14 | Browser E2E Chromium/Firefox | **Passed** (user + admin) | — |
| P6-15 | Browser E2E WebKit | **Admin Passed; User 8/10** (2 order-confirm fail) | BETA |
| P6-16 | 1,000-user load / 10,000 WebSocket | **Not Executed** | PROD |
| P6-17 | Chaos (mock/proxy faults) | **Done** (chaos 11 tests) | — |
| P6-18 | Real-infra chaos (DNS/KMS/disk/partition, managed restart) | **Not Executed** | PROD |
| P6-19 | Deployment Dockerfile + health + graceful shutdown | **Documented / Validated locally** | — |
| P6-20 | Container build/publish + orchestrator deploy + rollback drill | **Not Executed** (Production deployed = No) | PROD |

### Phase 6 Closure Pass (RC v0.6.1) — measured updates
| # | Item | State |
|---|---|---|
| P6-1 | Central market-data gateway **server** (health/auth/origin/dedup/cache/gap-fill/resync/pubsub/backpressure/breaker/metrics/shutdown) | **Done** (apps/market-gateway; E2E 12; WS load 100+1,000) |
| P6-2 | 10,000 WebSocket | **Not Executed** (bounded env; 1,000 sustained) |
| P6-5 | MFA / step-up (API + UI + E2E) | **Done** (API 16 + E2E 18 scenarios) |
| P6-6 | MFA live enrol/challenge UI | **Done** (was Not Executed) |
| P6-7 | Security headers + OWASP guards | **Done** |
| P6-8 | Production dependency Critical/High | **0 / 0** (CI gate) — container SBOM+vuln scan **Done** (Trivy 0.72.0, 0 C/0 H); SAST/secret/OSV **Not Executed** (absent) |
| P6-14/15 | Browser E2E Chromium/Firefox/WebKit | **User 10/10/10 · Admin 31/31/31** (WebKit fixed) |
| P6-16 | 1,000-user HTTP load | HTTP baseline executed; 1,000 VU **Not Executed** |
| P6-19 | Deployment Docker image | **Built + run + validated** (**node:24-alpine, Node v24.18.0, 69.8 MB**; non-root 10001, PID 1 node, health/ready/live 200, SIGTERM 0.12s, read-only rootfs + tmpfs, prod-only, no npm, no secrets, LIVE=false, KILL_SWITCH=true; Node 20 EOL 2026-03-24 → Node 24 LTS, 0 EOL runtimes) |
| P6-20 | Container SBOM + vulnerability scan | **Done** — Trivy 0.72.0 SBOM (CycloneDX+SPDX) + OS/library scan = **0 CRITICAL / 0 HIGH**; CI gate PASS. Orchestrator deploy/rollback still **Not Executed** (no cluster) |

All prior pending gates (BitMart Stage A, Private WS soak, Controlled Live Order, Live OpenAI,
Live-model eval, Live AI E2E, Firefox/WebKit, 1k/10k load, central market-data gateway, backup/restore,
MFA) remain **Not Executed** — owned by the AWS admin/operator, verified in a separate Live Validation
pass. Phase 5 does not enable live trading (`LIVE_TRADING_ENABLED=false`, `EMERGENCY_KILL_SWITCH=true`).

### Phase 6 Final UI/Chart Hotfix (RC v0.6.4) — gate corrections

Two gates previously reported as measured were **not** actually measured at the level they implied. The
rows below correct them rather than replacing history.

| # | Item | Previous state | Corrected state |
|---|---|---|---|
| P6-14/15 | Browser E2E Chromium/Firefox/WebKit | User 10/10/10 · Admin 31/31/31 | **User 78 (26×3) · Admin 102 (34×3)** — all PASS. Chromium 128.0.6613.18 / Firefox 128.0 / WebKit 18.0 all launch here, so no engine in this matrix is Not Executed. Real-device **Safari still Not Executed** → the Production General Availability gate stays closed on it. |
| P6-21 (new) | **Trading layout renders at production viewports** | *implicitly claimed by P6-14/15; in fact broken* — `.trade-body` measured 1384×56 and `.widget-grid` 138×40 at 1440×900 while all specs passed | **Done** — `tests/e2e/flow-l-layout-geometry.spec.ts` (8) asserts real bounding boxes at 1366×768 and 1920×1080, plus runtime resize, dark/light, ko/en, reduced motion, edit mode and non-grid routes; overlap = 0; no horizontal overflow. Thresholds are viewport fractions, not fixed pixels. |
| P6-22 (new) | **Chart renders real candle data** | *implicitly claimed; in fact blank* — klinecharts 10 removed `applyNewData` and the façade called it behind `?.`, a silent no-op | **Done** — `tests/e2e/flow-m-chart-render.spec.ts` (8) asserts feed status 200, adapter bar count > 50, **engine-held bar count equal to it**, valid ordered epoch-millis timestamps, canvas pixel sampling (> 20 distinct colours), symbol/timeframe reload, empty/error states, schema rejection, sort/de-duplication, zero console errors. |
| P6-23 (new) | **Admin console hygiene** | not measured (no spec read the console) | **Done** — `tests/e2e-admin/admin-console.spec.ts` `[31][32][33]` walk all 10 screens and fail on any React warning or console error; allowed-noise exceptions are enumerated with reasons in PHASE6-08. |
| P6-8 | Production dependency Critical/High | 0 / 0 (CI gate) | **Unchanged: 0 / 0, gate PASS.** Recorded alongside it: bare `pnpm audit --prod` exits **1** on **5 moderate** advisories (react-router ×4, @hono/node-server ×1) — the same set as the Phase 6 baseline artifacts. Remediation requires major upgrades (react-router ≥ 7.18.0, @hono/node-server ≥ 2.0.5) and is out of hotfix scope → PHASE6-13. |

**Release-gate policy applied to this pass:** no item is marked Done without an artifact under
`artifacts/logs/phase6-hotfix/`; the one non-zero exit code is recorded as FAIL with its cause rather
than downgraded to Not Executed; and each new Done row was validated by re-introducing the defect and
observing the guard fail before reverting.

**Approval status: NOT GRANTED.** `phase-6-approved-v0.6.0` does not exist and was not created.
`phase-6-rc-v0.6.4` is a release candidate. Phase 7 was not started, no Phase 7 branch was created, and
live trading remains disabled (`BITMART_LIVE_TRADING_ENABLED=false`,
`BITMART_EMERGENCY_KILL_SWITCH=true`). Controlled Live Order remains
**BLOCKED — Explicit owner authorization not provided**.

---

## Phase 6 — APPROVED / baseline frozen (2026-07-30)

| Field | Value |
|---|---|
| Phase 6 status | **APPROVED** |
| Implementation SHA | `d0be04f94c804ad1bbec0659f83034a6b50df3a8` |
| Final RC | `phase-6-rc-v0.6.4` |
| Approval tag | `phase-6-approved-v0.6.0` (annotated, on the approval-metadata commit; `d0be04f` is its ancestor) |
| Live trading | **DISABLED** (`BITMART_LIVE_TRADING_ENABLED=false`, `BITMART_EMERGENCY_KILL_SWITCH=true`) |
| Controlled Live Order | **BLOCKED — Explicit owner authorization not provided** |
| Phase 7 | **NOT STARTED** — no `phase-7-production-launch` branch |

Prior RC tags and `phase-5-approved-v0.5.0` are unchanged. No tag was moved, deleted or recreated.

### Gate state at approval

| Gate | State | Evidence |
|---|---|---|
| Runtime EOL (Node.js major) | **PASS** — Node 24 LTS v24.18.0, digest-pinned `node:24-alpine`, 0 EOL runtimes | PHASE6-20 |
| Container SBOM + vulnerability scan | **PASS** — Trivy 0.72.0, CycloneDX + SPDX, **0 Critical / 0 High**; container validation 17/17 | `artifacts/logs/phase6-hotfix/26-container-validation.log` |
| Market Data Gateway server | **PASS** — unit 13 · E2E 12 · WS load 100 + 1,000 (100 % handshake, 0 dropped). 10,000 WS **Not Executed** | PHASE6-01, PHASE6-18 |
| MFA (API + UI + E2E) | **PASS** — API 16 · lib 20 · E2E 16 (18 scenarios) | PHASE6-03, PHASE6-19 |
| Browser E2E Chromium / Firefox / WebKit | **PASS** — user **78 (26×3)**, admin **102 (34×3)**; Chromium 128.0.6613.18 / Firefox 128.0 / WebKit 18.0 | `23-e2e-user-3browsers.log`, `24-e2e-admin-3browsers.log` |
| P6-21 Trading layout renders at production viewports | **PASS** — bounding-box asserted at 1366×768 + 1920×1080, resize, dark/light, ko/en, reduced motion, edit mode | `flow-l-layout-geometry` (8) |
| P6-22 Chart renders real candle data (klinecharts v10 DataLoader) | **PASS** — engine-held bar count + canvas pixel sampling; v10-only façade with Fail-Fast; no v9 fallback | `flow-m-chart-render` (8) |
| P6-23 Admin console hygiene (React key warnings) | **PASS** — all 10 screens warning-free; allowed-noise exceptions enumerated in PHASE6-08 | `admin-console` (3) |
| Mutation / reproduction evidence for the new gates | **PASS** — defect re-introduced ⇒ `flow-l` 7/8 fail, `flow-m` 5/8 fail, `admin-console` 2/3 fail; files reverted byte-identically | PHASE6-08, PHASE6-12 |
| Production dependency security threshold | **PASS — Critical 0 / High 0** (`scripts/ci-audit-gate.sh`) | `25-audit-gate.log` |
| `pnpm audit --prod` raw command | **FAIL (exit 1)** — 5 moderate; recorded as a distinct line, not absorbed into the gate | `19-audit-prod.log` |
| Real-device Safari · 1,000 VU · 10,000 WS · managed PITR · SAST/secret/OSV · real alert delivery · multi-host rolling deploy · registry publish · BitMart Stage A · Controlled Live Order · Live OpenAI/eval/AI-E2E | **Not Executed** (unchanged) | PHASE6-13 |

### Regression record — exact wording

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

**Not** recorded as 26/26 PASS. Audit facts: `pnpm audit --prod` **exit 1** · Moderate **5** · High
**0** · Critical **0** · `ci-audit-gate.sh` **PASS** · Trivy production container **0 Critical / 0
High**.

### Accepted moderate advisories (5) — waiver summary

Full risk register with Advisory ID, CVE/GHSA, package, installed/fixed version, dependency path,
runtime reachability, exploitability, mitigation, owner, expiry and remediation plan is in
**FINAL-REPORT.md → "Moderate advisory risk register"**.

| # | Advisory | Package | Installed → Fixed | Reachability | Expiry |
|---|---|---|---|---|---|
| M-1 | GHSA-9jcx-v3wj-wh4m | `react-router` | 6.26.2 → ≥ 6.30.2 | Not reachable — all navigation targets hard-coded | Phase 7 Production Security Gate or production deploy |
| M-2 | GHSA-2j2x-hqr9-3h42 | `react-router` | 6.26.2 → ≥ 6.30.4 | Not reachable — no dynamic path reaches a router API | Same |
| M-3 | GHSA-frvp-7c67-39w9 | `@hono/node-server` | 1.19.17 → ≥ 2.0.5 | Not reachable — `serveStatic` never imported; runtime is Linux/Alpine, flaw is Windows-specific | Same |
| M-4 | GHSA-wrjc-x8rr-h8h6 | `react-router` | 6.26.2 → ≥ 7.18.0 (major) | Not reachable — no user input reaches `<Link>` / `useNavigate` | Same |
| M-5 | React Router `deserializeErrors()` SSR hydration | `react-router` | 6.26.2 → ≥ 7.18.0 (major) | Not reachable — client-only SPA, no SSR/hydration path | Same |

**Framework-mode evidence.** React Router runs in **Declarative (`BrowserRouter`) mode** — not Data
Mode, not Framework/SSR mode: `main.tsx` imports `BrowserRouter` only; the workspace contains no
`createBrowserRouter` / `createHashRouter` / `createMemoryRouter` / `RouterProvider` /
`StaticRouter(Provider)` / route `loader:`/`action:` / `useLoaderData` / `useFetcher` / `defer` /
router `json()`/`redirect()` / `renderToString` / `hydrateRoot`; `apps/web` is a client-only Vite SPA;
all 9 navigation targets are hard-coded literals; `apps/admin` does not use react-router at all.
**Hono**: `apps/api` imports only `serve` from `@hono/node-server@1.19.17`; `serveStatic`/`serve-static`
appears nowhere in the workspace; the runtime is Linux **Alpine** (`node:24-alpine`, digest-pinned), so
the Windows encoded-backslash (`%5C`) vector does not apply.

**Waiver policy applied:** accepted for the **Phase 6 source baseline only**; not waived for Phase 7
and not waived for production. Security-critical gates are never waived indefinitely — each exception
must be remediated or individually re-dispositioned with fresh evidence before the **Phase 7
Production Security Gate** can pass. Expiry: Phase 7 Production Security Gate **or** first production
deployment, whichever comes first.

### Approval constraints

Approving Phase 6 does **not** enable live trading, does **not** authorize a Controlled Live Order,
and does **not** start Phase 7. Controlled Live Order remains **BLOCKED — Explicit owner authorization
not provided**. A Phase 7 branch may only be created from this frozen approval baseline after the
approval archive has been verified.

---

## Phase 7 — Stage 0 gate register (BLOCKED, 2026-07-30)

Branch `phase-7-production-launch` from `phase-6-approved-v0.6.0`
(`d63ee29c51ba00469b0f48bcf6c4f8848b8ddb4d`). Phase 6 approval baseline unchanged.
**`phase-7-rc-v0.7.0` NOT created. Stage 0 NOT marked PASS.**

### Stage 0

| # | Gate | State | Evidence / reason |
|---|---|---|---|
| P7-0.1 | Runtime host / service | **PASS** | EC2 `i-0483d903c0925f690` (`c8i.xlarge`, Ubuntu 24.04.4), IMDSv2. Not ECS/EKS |
| P7-0.2 | Region | **PASS** | ap-northeast-2 (IMDSv2 `placement/region`) |
| P7-0.3 | IAM role identity | **PASS** | `EC2-SessionManager-Seoul`; STS assumed-role resolved. **Not** the intended application runtime role |
| P7-0.4 | Fixed egress IP | **PASS** | `15.164.47.4` |
| P7-0.5 | System time sync | **PASS** | NTP active; +21 ms vs BitMart server time |
| P7-0.6 | BitMart `GetSecretValue` | **BLOCKED — AccessDenied** | Existence cannot be confirmed or denied |
| P7-0.7 | OpenAI `GetSecretValue` | **BLOCKED — AccessDenied** | Same |
| P7-0.8 | KMS Decrypt (`kms:ViaService = secretsmanager`) | **NOT_EXECUTED / BLOCKED** | Reachable only through a secret read, which is denied — the real ViaService path was never exercised |
| P7-0.9 | Seven separate secrets | **BLOCKED** | Cannot enumerate or describe |
| P7-0.10 | Managed PostgreSQL + PITR + encryption + retention | **NOT_EXECUTED / BLOCKED** | Denied and not provisioned; local dev PG is not evidence |
| P7-0.11 | Managed Redis (TLS + AUTH + network ACL) | **NOT_EXECUTED / BLOCKED** | Denied and not provisioned; local dev Redis has `tls-port = 0`, no AUTH |
| P7-0.12 | ECR push/pull + digest deploy + signing/attestation | **NOT_EXECUTED / BLOCKED** | Denied and not provisioned |
| P7-0.13 | DNS / TLS / certificate expiry | **NOT_EXECUTED / BLOCKED** | Denied; no production domain configured anywhere in the repo. Outbound TLS from the runtime separately confirmed |
| P7-0.14 | Observability collector / log store / metric store | **NOT_EXECUTED / BLOCKED** | Denied; no collector endpoint |
| P7-0.15 | Alert delivery + dashboard + runbook | **NOT_EXECUTED / BLOCKED** | Denied; no channel configured |
| P7-0.16 | Production dev-seed blocked | **PASS (code)** / **NOT_EXECUTED (real DB)** | Fail-closed guard measured on a real process; production DB does not exist |
| P7-0.17 | Production artifact free of dev credentials | **PASS** | 0 findings in `dist` and container (217 files); scanner negative-control gives 16 findings on the pre-fix image |
| P7-0.18 | Production signing key required, never defaulted | **PASS** | `AUTH_CSRF_KEY` ≥32 chars required in production; ephemeral in dev; no literal in the bundle |
| P7-0.19 | IaC authored + statically validated | **PASS** | terraform 1.9.8 fmt/init/validate, tflint 0.53.0, checkov 3.3.8 (297/0/27), tfsec 1.28.13 (0 C/0 H) |
| P7-0.20 | IaC `plan` / `apply` | **NOT_EXECUTED** | No credentials for plan; apply out of scope. No AWS resource created, modified or deleted |

**Management-plane denials are not runtime faults.** The instance is healthy, credentials are valid, the
clock is synchronized and egress works from the correct fixed IP. An `AccessDenied` on
`ListSecrets`/`DescribeSecret` cannot distinguish "absent" from "present but invisible", which is why
those gates are **BLOCKED** rather than FAILED.

**No broad `List*` permission will be granted to the runtime role to satisfy a preflight probe.** The
application resolves secrets by ARN and has no enumeration code path; `secretsmanager:ListSecrets` is on
the explicit `Deny` list. Existence verification will use `DescribeSecret` on the named ARNs only.

### Security gates advanced this pass

| # | Gate | State |
|---|---|---|
| P7-4.1 | Dev seed separated from the production entry / import graph | **PASS** — single-file bundle, no dev chunk, absent from the image |
| P7-4.2 | Dev seed command refused in production | **PASS** — exit 2 before opening a database |
| P7-4.3 | Production source map excluded | **PASS** — `sourcemap: false`, 0 `.map` files |
| P7-4.4 | Production DB dev-seed detection, fail-closed, no PII in logs | **PASS (code)** — `DEV_SEED_ACCOUNT_DETECTED`, digests only, 0 identifier/password hits in the block log |
| P7-4.5 | Production artifact scanner (dist / bundle / source map / config / package metadata / container fs / image layers / env) | **PASS** — 13 rules, path + rule id + count only, no matched text recorded |
| P7-4.6 | IaC security scan | **PASS** — checkov 0 failed, tfsec 0 critical / 0 high |
| P7-4.7 | SAST (semgrep) | **NOT_EXECUTED** — binary absent |
| P7-4.8 | Full-history secret scan (gitleaks/trufflehog) | **NOT_EXECUTED** — binary absent |
| P7-4.9 | OSV scan | **NOT_EXECUTED** — binary absent |
| P7-4.10 | Trivy CVE re-scan of the Phase 7 image | **OPEN** — Phase 6 image was 0 C/0 H; the rebuilt image has not been CVE-rescanned |
| P7-4.11 | WAF on the public entry point | **NOT_IMPLEMENTED** — public entry disabled by default; tracked in PHASE7-19 |
| P7-4.12 | Live TLS / security-header / injection / IDOR / session / MFA-replay checks against a deployed production endpoint | **NOT_EXECUTED** — no deployment. All are covered by Phase 6 suites against the local stack |

### Dependency moderates — acceptance is expiring

The five moderate advisories were accepted **for the Phase 6 source baseline only**. Their expiry
condition is *the Phase 7 Production Security Gate or first production deployment, whichever comes
first*. They are therefore now **OPEN against this gate** and must be remediated or individually
re-dispositioned with fresh evidence before P7-4 can pass. Current measurement is unchanged:
`pnpm audit --prod` exit 1, 5 moderate / 0 high / 0 critical, `ci-audit-gate.sh` PASS. Register:
`docs/PHASE7-19-KNOWN-ISSUES.md`.

### Release ladder

```
Internal Staging → Closed Beta → Production Read-Only → Production Shadow
→ Controlled Live Order → Limited Live Trading → General Production
```

Every step is **NOT_STARTED**. Stage 0 gates the whole ladder.

**Controlled Live Order: BLOCKED — Explicit owner authorization not provided.**
Live trading disabled: `BITMART_LIVE_TRADING_ENABLED=false`, `BITMART_EMERGENCY_KILL_SWITCH=true`
(verified baked into the image). General Production must not be approved while Controlled Live Order is
unexecuted.


---

## Phase 7 — Production Security Gate: dependency + scanner items CLOSED (2026-07-30)

Stage 0 remains **BLOCKED**; no tag created; live trading disabled.

| # | Gate | Previous | Now |
|---|---|---|---|
| P7-4.0 | Production dependency threshold | 5 moderate accepted **for the Phase 6 baseline only**, expiring at this gate | **PASS — `pnpm audit --prod` exit 0, Critical 0 / High 0 / Moderate 0.** All five remediated by upgrade (`react-router` 8.3.0 via React 19.2.8; `@hono/node-server` 2.0.12). No threshold lowered, no output suppressed. |
| P7-4.0a | New HIGH surfaced mid-upgrade | — | `react-router-dom@7.18.2` introduced GHSA-qwww-vcr4-c8h2 (patched only in ≥ 8.3.0). Recorded, then cleared by moving to `react-router@8.3.0`. Stopping at 7.18.2 would have **failed** this gate. |
| P7-4.0b | Declarative routing preserved, SSR/RSC not activated | asserted in prose | **PASS by test** — `router-mode.test.ts` (9) |
| P7-4.0c | Hono `serve()` compatible, `serveStatic` absent, traversal unreachable | asserted in prose | **PASS by test** — `server-adapter.test.ts` (9) |
| P7-4.7 | SAST (semgrep) | NOT_EXECUTED | **EXECUTED** — 1.172.0 / `p/default`, 27 → 3 findings; 3 OPEN (pnpm-10-only policy keys) |
| P7-4.8 | Secret scan, working tree + full Git history | NOT_EXECUTED | **PASS** — gitleaks 8.21.2, **0 / 0** (6 reviewed false positives dispositioned with reasons in `.gitleaks.toml`) |
| P7-4.9 | OSV scan | NOT_EXECUTED | **EXECUTED** — osv-scanner 2.4.0, 11 findings, **all development-only**, OPEN |
| P7-4.10 | Trivy CVE re-scan of the Phase 7 image | OPEN | **PASS** — 0 CRITICAL / 0 HIGH on `quantumtrade-api:phase7-secgate` |
| P7-4.13 | SBOM (CycloneDX + SPDX) | Phase 6 artefact | **PASS** — regenerated; image 98 / source 934 components; SHA-256 recorded |
| P7-4.14 | License scan | NOT_EXECUTED | **PASS** — 0 restricted (AGPL/SSPL/BUSL/CC-BY-NC deny-list) |
| P7-4.6 | IaC scan | 0 failed / 0 high | **PASS retained** after the ALB log-bucket addition — checkov 304 passed / 0 failed / 31 skipped, tfsec 0 |
| P7-4.15 | Production artifact credential scan | PASS | **PASS retained** on the rebuilt image — 0 findings across dist, container filesystem, layers and env |
| P7-5.1 | Release-verification environment isolation | `reuseExistingServer` adopted foreign servers (caused a false failure) | **PASS** — reuse off by default, port pre-check before Playwright, temp DB, process cleanup, base-URL shell check, **server build-SHA equality**, and refusal to run against a `liveTradingEnabled=true` server |
| P7-4.11 | WAF on the public entry point | NOT_IMPLEMENTED | unchanged — public entry disabled by default; tracked in PHASE7-19 |
| P7-4.12 | Live TLS / header / injection / IDOR / session checks against a deployed endpoint | NOT_EXECUTED | unchanged — no deployment |
| P7-4.16 | Image signing / attestation | NOT_EXECUTED | unchanged — no registry |

### Waiver ledger

The Phase 6 moderate-advisory acceptance **expired at this gate and has been discharged by
remediation** — it is not renewed and not extended. Two OPEN items replace it, both with named
remediation and both outside the production artifact:

| Item | Why open | Owner | Expiry |
|---|---|---|---|
| pnpm supply-chain policy (3 semgrep findings) | Keys exist only in pnpm 10; repo pins pnpm 9.15.0. Writing them under 9 would satisfy the scanner while enforcing nothing. | Platform | Before production deployment (pnpm 9 → 10, lockfile format change) |
| 11 development-only OSV advisories | Each fix needs a major build/test toolchain upgrade. Not in the production artifact: `audit --prod` 0 and the image carries no dev dependency. | Platform | Before production deployment, or earlier if any becomes runtime-reachable |

Security-critical gates are still never waived indefinitely, and no item is marked PASS without an
artifact under `artifacts/security/phase7/` or `artifacts/logs/phase7/`.

### Unchanged constraints

Stage 0 is **not** PASS. Stages 1–9 not started. `phase-7-rc-v0.7.0` **not** created. No AWS resource
created, modified or deleted; `terraform plan`/`apply` NOT_EXECUTED. Live trading disabled
(`BITMART_LIVE_TRADING_ENABLED=false`, `BITMART_EMERGENCY_KILL_SWITCH=true`, verified baked into the
image). **Controlled Live Order: BLOCKED — Explicit owner authorization not provided.**
