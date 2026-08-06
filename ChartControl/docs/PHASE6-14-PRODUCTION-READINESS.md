# PHASE 6-14 — Production Readiness

Honest readiness assessment. **Not production-ready for LIVE trading** — live trading stays disabled and
several production gates are Not Executed. The software foundations for security/scale/reliability are
implemented and verified at the unit/integration/local level.

## Ready (implemented + verified here)
- Central market-data gateway CORE (dedup/refcount/cache/gap/stale/backoff/breaker/backpressure/rate-limit).
- Multinode shared state on REAL Redis (versioned CAS + pub/sub, ~1ms propagation, fail-closed live scopes).
- MFA/TOTP + recovery codes + step-up policy (encrypted secret, replay/lockout, last-SUPER_ADMIN guard).
- Security headers + app-level OWASP guards; admin RBAC/CSRF/IDOR/SQLi/no-fake-pass/append-only audit.
- Structured logging (redaction + required fields) + OTel adapter + metrics + alert rule engine.
- PostgreSQL backup/restore drill (integrity PASS, RTO 136 ms) on real local PG17.
- Deployment artifacts: non-root **Node.js 24 LTS (v24.18.0) Alpine** Dockerfile, liveness/readiness,
  graceful shutdown (validated locally); container runtime is on a supported LTS (Node 20 EOL 2026-03-24
  retired), **0 EOL runtimes**, better-sqlite3 recompiled + DB-tested on Node 24/musl.
- Browser E2E: Chromium/Firefox green (user + admin); WebKit admin green, user 8/10.
- Full regression: 15 commands + audit, all exit 0.

## Gating (Not Executed → must clear before production live trading)
| Gate | Status |
|---|---|
| BitMart Stage A / Private WS soak / Controlled Live Order | Not Executed (no AWS creds/authorization) |
| Live OpenAI / model-eval / AI-E2E | Not Executed |
| 1,000-user load / 10,000 WebSocket | Not Executed |
| WS gateway server (live upstream + fan-out) | Not wired |
| MFA enrol/challenge UI+API live | Not Executed |
| Multinode multi-host + rolling deploy | Documented / Not Executed |
| Managed PostgreSQL PITR | Not Executed |
| Container SBOM + vulnerability scan (Trivy) | **Done — 0 Critical / 0 High** (PHASE6-20) |
| Runtime EOL check (Node.js major) | **Done — Node 24 LTS (v24.18.0), 0 EOL runtimes** (Node 20 EOL 2026-03-24 retired) |
| External SAST/secret/OSV scanners (semgrep/gitleaks/osv-scanner) | Not Executed (absent) |
| Real alert delivery (PagerDuty/Slack) | Not Executed |
| Dependency vulns (2 critical/12 high) remediation | Open |
| Container build/publish + real deploy/rollback | Not Executed |

## Verdict
**Conditional / pre-production.** Core hardening is in place and verified; production sign-off requires
the gated items above (owner-operated, credentialed environment) and remediation of the audit findings.

## Closure update (RC v0.6.1)
Newly cleared: production dependency audit (0 critical/0 high + CI gate); WebKit browser parity (10/10);
Central Market Data Gateway **server** (E2E + 1,000-WS load); MFA API+UI+E2E; Docker image built/run/
validated (non-root, health, graceful SIGTERM, read-only, prod-only, prod fail-closed). Still gating for
LIVE trading (Not Executed): BitMart Stage A / Controlled Live Order / Live OpenAI, 10,000 WS, 1,000 VU,
managed PITR, external SAST/secret/OSV scanners, multi-host rolling deploy, real alert delivery, admin
step-up live wiring. (Container SBOM + vulnerability scan are now Done — 0 C/0 H, PHASE6-20.)
Verdict: **pre-production hardened; live trading still gated** (disabled by default).

## Hotfix closure (RC v0.6.4) — readiness impact

Two **user-visible** defects were present in RC v0.6.3, the tag this readiness assessment was written
against, and were not detected by the suites the assessment relied on: the trading screen collapsed
into a top-left strip, and the chart rendered no candles despite a healthy feed. Both are fixed and are
now guarded by geometry- and data-level assertions (PHASE6-08, PHASE6-12, PHASE6-13).

| Item | Before this hotfix | Now |
|---|---|---|
| Trading screen renders at production viewports | **Broken** (reported PASS) | **Done** — bounding-box asserted at 1366×768 + 1920×1080, resize, dark/light, ko/en, reduced motion, edit mode |
| Chart renders real candles | **Broken** (reported PASS) | **Done** — engine-held bar count + canvas pixel sampling, symbol/period reload, empty/error states |
| Chart engine on klinecharts 10 | v9 call silently no-oping | **Done** — v10 `setDataLoader` only; Fail-Fast on a missing v10 API or a present v9 API |
| Admin console hygiene | React key warnings | **Done** — all 10 screens asserted warning-free |
| Browser matrix | User 10/10/10 · Admin 31/31/31 | **User 78 (26×3) · Admin 102 (34×3)** on Chromium/Firefox/WebKit |
| Render-level test coverage | **Absent** (presence/visibility only) | **Done** — `flow-l` (8), `flow-m` (8), `admin-console` (3), `layout-css` (9), `chart-widget` (6), chart-adapter unit 5 → 38 |
| Production dependency audit | 0 critical / 0 high (gate PASS) | Unchanged — gate PASS; bare `pnpm audit --prod` still exits 1 on **5 moderate** (same set as baseline) |

### Verdict (unchanged in kind, corrected in substance)
Still **conditional / pre-production**, and live trading is still gated and disabled by default. What
changes is the basis for that verdict: the UI and chart are now verified by assertions that fail when
rendering breaks, instead of by assertions that pass either way. Every gate previously listed as Not
Executed remains Not Executed — real-device Safari, 1,000-VU HTTP, 10,000 WS, managed PostgreSQL PITR,
external SAST/secret/OSV scanners, real PagerDuty/Slack, multi-host rolling deploy, image registry
publish, BitMart Stage A / Controlled Live Order / Live OpenAI.

**No approval tag was created.** `phase-6-approved-v0.6.0` does not exist and must not be produced
automatically; `phase-6-rc-v0.6.4` is a release candidate only.
