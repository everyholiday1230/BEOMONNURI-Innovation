# PHASE 6-00 — Implementation Plan (Security, Scale, Reliability & Production Ops)

Branch: `phase-6-production-hardening`. Target RC: `phase-6-rc-v0.6.0` (immutable; prior tags never moved).

## Baseline (updated — Phase 6 Closure Pass)
The Phase 5 approval tag **now exists**: `phase-5-approved-v0.5.0` → **`6ce4fd3`** (annotated, owner
sign-off). Phase 6 branched from the **same** `6ce4fd3` (= `phase-5-rc-v0.5.2`), so the code baseline is
valid and shared. No approval/RC tag was moved. The Phase 5 approval metadata (originally commit
`273b6ef`) is integrated into the current `FINAL-REPORT.md` while preserving the Phase 6 content.
(Historical note: at Phase 6's first implementation the approval tag did not yet exist — it was created
during the Phase 5 approval step and is now the authoritative Phase 5 baseline.)

## Non-negotiable safety defaults (unchanged)
`BITMART_LIVE_TRADING_ENABLED=false` · `BITMART_EMERGENCY_KILL_SWITCH=true`. No live order auto-enable.
BitMart Stage A / Controlled Live Order / Live OpenAI run only with real AWS credentials → otherwise
**Not Executed**.

## Environment capability probe (2026-07-29)
| Capability | Status | Use |
|---|---|---|
| Redis | Available `127.0.0.1:16379` | multinode shared state + pub/sub (real integration tests) |
| PostgreSQL 17 | Available `127.0.0.1:15432` | migrations, backup/restore (real), integrity check |
| k6 v0.52 | Installed | HTTP + internal WS load (bounded scale) |
| Playwright browsers | chromium + firefox + webkit binaries present | browser E2E (launch attempted per browser) |
| npm audit | Available | dependency vuln scan (executed) |
| trivy (0.72.0) | **Installed (Closure v0.6.2)** | container **SBOM (CycloneDX+SPDX) + OS/library vuln scan → Executed**, 0 C/0 H (PHASE6-20) |
| semgrep / gitleaks / osv-scanner | **Absent** | SAST/secret/OSV scans → **Not Executed** |
| Managed PG / PITR, PagerDuty/Slack, multi-host cluster, real MFA authenticator device | Not present | → **Not Executed** (adapters + local/mock validation only) |

## Execution matrix (what will be Executed vs Not Executed)
| # | Area | Plan | Expected status |
|---|---|---|---|
| 1 | Central Market Data Gateway | core logic (dedup/refcount/cache/gap/stale/backoff/circuit-breaker/backpressure) + unit tests + internal k6 | **Executed** (core); live BitMart upstream + 10k conns **Not Executed** |
| 2 | MFA / Step-up | TOTP + recovery codes + step-up levels, encrypted-secret interface, replay/lockout | **Executed** (pure + unit tests) |
| 3 | Security | headers middleware, WS auth+origin, app-level OWASP tests, `npm audit` | **Executed** (app-level); external scanners **Not Executed** |
| 4 | Multinode state | Redis shared store + pub/sub invalidation + versioned + fail-closed + propagation latency | **Executed** (real Redis integration); multi-host rolling **Documented** |
| 5 | Observability | structured logger (required fields + redaction) + OTel adapter iface + metrics registry | **Executed** (unit); live collector **Not Executed** |
| 6 | Alerting / Incident | rule engine + severity/dedup/silence/recovery + adapter + Mock sink | **Executed** (mock); PagerDuty/Slack **Not Executed** |
| 7 | PG backup/restore | pg_dump/pg_restore + integrity + RTO/RPO measure on local PG | **Executed** (local); managed PITR **Not Executed** |
| 8 | Browser E2E | Chromium/Firefox/WebKit launch attempt across apps | per-browser Passed/Failed/**Not Executed** (recorded) |
| 9 | Load test | k6 HTTP smoke/baseline/high + internal WS | **Executed** (bounded); 10k WS **Not Executed** |
| 10 | Chaos | mock/proxy faults (PG/Redis/BitMart/OpenAI), kill-switch propagation, offline/resume | **Executed** (mock/proxy); real prod faults **Not Executed** |
| 11 | Deployment/Rollback | Dockerfile (non-root), health/readiness/liveness, graceful shutdown, env-validate, migration job | **Documented / Validated locally**; **Production deployed = No** |
| 12 | Release Gate | update measured results only; never flip un-run items to Passed | **Executed** (doc) |

## Test commands (scripts added where missing)
`pnpm install --frozen-lockfile · lint · typecheck · test · build · e2e · test:postgres ·
test:integration · test:admin · e2e:admin · test:security · test:gateway · test:mfa · test:chaos ·
test:load`. Each captured with command/env/start/end/exit/git-SHA header to `artifacts/logs/phase6-*.log`.

## Method
Vertical slices, each verified before moving on. New pure packages under `packages/*` follow the
existing convention (`main`/`types`→`src/index.ts`, `tsc --noEmit`, `vitest`). No API/domain rewrite of
approved phases; additive only. No live-trading enablement anywhere.
