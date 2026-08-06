# PHASE 7-20 — Production Readiness

**Verdict: NOT READY. Stage 0 BLOCKED.**

Baseline `phase-6-approved-v0.6.0` → `d63ee29c51ba00469b0f48bcf6c4f8848b8ddb4d`.
Branch `phase-7-production-launch`. Recorded 2026-07-30.

Stage 0 remains BLOCKED and is **not** marked PASS. Live trading is disabled, and Controlled Live Order
is **BLOCKED — Explicit owner authorization not provided**.

## 1. Readiness by area

| Area | State | Basis |
|---|---|---|
| Application code baseline | **Ready** (approved Phase 6 + this hotfix) | Full regression re-run on this branch, §2 |
| Production artifact free of dev credentials | **Ready** | 0 findings in `dist` and in the container filesystem; scanner negative-control verified (PHASE7-08 §1, §3) |
| Dev seed isolated from production | **Ready** | Single-file bundle with no dev chunk; not present in the image; command refuses in production (PHASE7-08 §1) |
| Production DB dev-seed detection | **Ready in code**, unverified against the real DB | Fail-closed guard measured on a real process; production database does not exist yet |
| Production signing-key requirement | **Ready** | `AUTH_CSRF_KEY` required in production, ephemeral key in dev, no literal in the bundle |
| Infrastructure as code | **Authored + statically validated, never applied** | terraform/tflint/checkov/tfsec all pass; `plan` and `apply` NOT_EXECUTED (PHASE7-02 §6) |
| AWS runtime identity / region / egress IP / clock | **Verified** | EC2 `i-0483d903c0925f690`, ap-northeast-2, `15.164.47.4`, NTP active, +21 ms vs exchange |
| Secrets (7 separate) | **BLOCKED** | `AccessDeniedException`; existence unknown either way |
| KMS Decrypt via `ViaService` | **NOT_EXECUTED / BLOCKED** | Only reachable through a secret read, which is denied |
| Managed PostgreSQL + PITR | **NOT_EXECUTED / BLOCKED** | Denied and not provisioned; the local dev PG is not evidence |
| Managed Redis (TLS + AUTH) | **NOT_EXECUTED / BLOCKED** | Denied and not provisioned; the local dev Redis has `tls-port = 0` and no AUTH |
| Container registry (digest deploy, signing) | **NOT_EXECUTED / BLOCKED** | Denied and not provisioned |
| Production domain / DNS / TLS certificate | **NOT_EXECUTED / BLOCKED** | Denied; no domain configured anywhere in the repository |
| Observability collector / log store / metric store | **NOT_EXECUTED / BLOCKED** | Denied; no collector endpoint |
| Alert delivery + dashboard + runbook links | **NOT_EXECUTED / BLOCKED** | Denied; no channel configured |
| Production administrator account (separate, MFA-forced) | **NOT_EXECUTED** | Requires the production database |
| BitMart Stage A (read-only, authenticated) | **NOT_EXECUTED** | Requires credentials + allowlist |
| Private WS soak (≥2 h) | **NOT_EXECUTED** | Requires credentials |
| Live OpenAI / live model eval / live AI E2E | **NOT_EXECUTED** | Requires credentials |
| 1,000 VU HTTP · 10,000 WS · long soak | **NOT_EXECUTED** | Requires an approved load environment |
| PITR restore drill + failure drills | **NOT_EXECUTED** | Requires managed PostgreSQL |
| Incident drill (SEV1/SEV2) | **NOT_EXECUTED** | Requires alert delivery |
| Real-device Safari + mobile | **NOT_EXECUTED** | No Apple hardware |
| Controlled Live Order | **BLOCKED** | No owner authorization |
| Dependency moderates (5) | **OPEN** | Accepted for the Phase 6 baseline only; expire at this gate (PHASE7-19) |
| WAF on the public entry point | **OPEN** | Not implemented; public entry disabled by default |
| SAST / history secret scan / OSV | **NOT_EXECUTED** | Binaries absent |
| Trivy CVE re-scan of the Phase 7 image | **OPEN** | Phase 6 image was 0 C/0 H; the rebuilt image has not been CVE-rescanned this pass |

## 2. Regression on this branch (executed 2026-07-30T05:22–05:26Z, Node v24.18.0)

Summary: `artifacts/logs/phase7/regression-summary.tsv`. **23 PASS / 1 audit raw-command FAIL.**

| # | Command | Exit | Result | Note |
|---|---|---|---|---|
| 00 | `pnpm install --frozen-lockfile` | 0 | PASS | lockfile unchanged |
| 01 | `pnpm lint` | 0 | PASS | 0 errors |
| 02 | `pnpm typecheck` | 0 | PASS | all projects |
| 03 | `pnpm test` | 0 | PASS | **457 tests / 41 files** (was 426/40; +31 new production-artifact tests) |
| 04 | `pnpm build` | 0 | PASS | `dist/index.js` single bundle, no source map |
| 05 | `pnpm e2e` | 0 | PASS | 26 |
| 06 | `pnpm e2e:admin` | 0 | PASS | 34 |
| 07 | `pnpm test:postgres` | 0 | PASS | real PostgreSQL |
| 08 | `pnpm test:integration` | 0 | PASS | |
| 09 | `pnpm test:admin` | 0 | PASS | |
| 10 | `pnpm test:security` | 0 | PASS | |
| 11 | `pnpm test:gateway` | 0 | PASS | 13 |
| 12 | `pnpm e2e:gateway` | 0 | PASS | 12 |
| 13 | `pnpm test:mfa` | 0 | PASS | |
| 14 | `pnpm e2e:mfa` | 0 | PASS | 16 |
| 15 | `pnpm test:chaos` | 0 | PASS | |
| 16 | `pnpm test:ai` | 0 | PASS | |
| 17 | `pnpm eval:ai` | 0 | PASS | mock/fake provider; live model eval NOT_EXECUTED |
| 18 | `pnpm audit --prod` | **1** | **FAIL as recorded** | 5 moderate / 0 high / 0 critical — same set as the Phase 6 baseline |
| 19 | `scripts/ci-audit-gate.sh` | 0 | PASS | production threshold 0 critical / 0 high |
| 20 | `scripts/phase7-artifact-scan.sh` (dist) | 0 | PASS | 0 findings |
| 21 | `scripts/phase7-seed-isolation-regression.sh` | 0 | PASS | 16/16 checks |
| 22 | `scripts/phase7-iac-validate.sh` | 0 | PASS | 6 static steps pass; plan/apply NOT_EXECUTED |
| 23 | artifact scan incl. container (`phase7-preflight`) | 0 | PASS | 217 files, 0 findings |

Not recorded as 24/24. The `pnpm audit --prod` exit 1 is kept on its own line; the release gate result
is separate and neither is used to obscure the other.

### One environment-caused failure, diagnosed and resolved

The first run of this set reported `pnpm e2e:admin` FAIL with
`strict mode violation: locator('tbody tr').filter({hasText:'ai_order_draft'})… resolved to 14 elements`.
Cause: long-running **manually started** dev servers were still bound to ports 5173/5174/8787 from an
earlier interactive session. `tests/e2e-admin/playwright.config.ts` sets
`reuseExistingServer: !process.env.CI`, so Playwright adopted the manual admin app on 5174 — which had
been started with `VITE_API_BASE_URL=http://127.0.0.1:8787`, pointing at a **persistent** SQLite
database with kill-switch rows accumulated across earlier runs, instead of the `:memory:` API on 8788
the config provisions. After stopping those servers, `pnpm e2e:admin` passed 34/34 and the full set was
re-run clean. This was environment contamination, not a code regression — worth noting because
`reuseExistingServer` will silently do this again to anyone with a dev server running.

## 3. What must be true before Stage 0 can be marked PASS

1. Dedicated runtime IAM role in place (policy: `infrastructure/terraform/phase7/iam-runtime.tf`), with
   the service running under it. **No `List*` permission is to be added for preflight convenience.**
2. Seven secrets exist with schema-valid JSON, populated out-of-band by the owner. Verification reports
   `secretLoaded` / `schemaValid` / `kmsDecrypt` / `iamRole` / `region` / `secretArnHash` only.
3. `kms:Decrypt` demonstrated through the `ViaService = secretsmanager` path.
4. Managed PostgreSQL: reachable, encrypted, Multi-AZ, automated backup + PITR, retention recorded.
5. Managed Redis: reachable with TLS + AUTH, network-restricted.
6. ECR: repositories with immutable tags; runtime pulls by digest, deployment role pushes.
7. Domain + DNS + TLS certificate with a recorded expiry date.
8. OTel collector, log store, metric store, alert channel, dashboard and runbook links reachable.
9. Egress IP `15.164.47.4` registered in the BitMart allowlist, confirmed by an authenticated read-only
   call.
10. `scripts/phase7-seed-isolation-regression.sh` re-run against the real production database.
11. Trivy CVE re-scan of the Phase 7 image at 0 Critical / 0 High.

## 4. Verdict

**Production readiness: NOT READY.** Stage 0 is BLOCKED on operational infrastructure that does not yet
exist or is not reachable by the runtime role. The application-side work in this commit removes a real
security defect from the approved artifact and adds the detection that would have caught it, but no
amount of application work can move Stage 0 to PASS — that requires the AWS resources, the seven
secrets, and the exchange allowlist entry.

Live trading remains disabled (`BITMART_LIVE_TRADING_ENABLED=false`,
`BITMART_EMERGENCY_KILL_SWITCH=true`). Controlled Live Order remains **BLOCKED — Explicit owner
authorization not provided**. `phase-7-rc-v0.7.0` has **not** been created.


---

## Update — Production Security Gate pass (2026-07-30)

**Verdict unchanged: NOT READY. Stage 0 BLOCKED.** What changed is the dependency and scanner posture,
which was the one part of the Production Security Gate that did not need AWS access.

| Area | Before this pass | Now |
|---|---|---|
| `pnpm audit --prod` | exit 1 — 5 moderate / 0 high / 0 critical (accepted for the Phase 6 baseline only) | **exit 0 — 0 moderate / 0 high / 0 critical** |
| React Router advisories (4) | accepted, reachability-argued | **remediated** — `react-router` 8.3.0 (React 19.2.8) |
| @hono/node-server advisory (1) | accepted, reachability-argued | **remediated** — 2.0.12 |
| Declarative routing mode | asserted in prose | **asserted by test** — `router-mode.test.ts` (9), incl. no SSR/RSC API in source or bundle |
| Hono `serve()` / `serveStatic` | asserted in prose | **asserted by test** — `server-adapter.test.ts` (9), incl. traversal non-reachability |
| SAST (semgrep) | NOT_EXECUTED | **executed** — 27 → 3 findings (3 OPEN, pnpm-10-only) |
| Secret scan, tree + full history (gitleaks) | NOT_EXECUTED | **executed** — 0 / 0 |
| OSV-Scanner | NOT_EXECUTED | **executed** — 11, all development-only, OPEN |
| Trivy filesystem | inherited | **executed** — 0 critical / 0 high |
| Trivy container image | Phase 6 image | **re-executed on `phase7-secgate`** — 0 |
| SBOM (CycloneDX + SPDX) | Phase 6 image | **regenerated** — image 98 / source 934 components, SHA-256 recorded |
| License scan | NOT_EXECUTED | **executed** — 0 restricted |
| IaC scan | 0 failed / 0 high | **still 0** after the ALB log-bucket addition (304 passed / 31 skipped) |
| Production image | `phase7-preflight` | **`phase7-secgate`**, ImageID `sha256:ca6680e6f777…`, 17/17 validation |
| Playwright environment | `reuseExistingServer` adopted foreign servers | **isolated** — reuse off, port pre-check, temp DB, cleanup, base-URL + build-SHA identity |
| Unit tests | 457 / 41 files | **475 / 43 files** |
| Browser matrix | 258 not yet re-run on this branch | **258 PASS** (user 90, admin 114, MFA 54) |

### Readiness verdict

Still **NOT READY**, and the reason is unchanged: Stage 0 depends on AWS infrastructure that does not
exist or is unreachable by the runtime role. No amount of application or dependency work moves it.

What this pass does change is that the Production Security Gate's *code-side* criteria are now met with
evidence rather than with reachability arguments, and two latent defects in the dev/test environment
(silently ignored `--port`, client-inlined API base URL breaking session cookies) were found and fixed
before they could mislead a release verification.

Live trading remains disabled (`BITMART_LIVE_TRADING_ENABLED=false`,
`BITMART_EMERGENCY_KILL_SWITCH=true`, both verified baked into the image). **Controlled Live Order:
BLOCKED — Explicit owner authorization not provided.** No tag was created; `phase-7-rc-v0.7.0` does not
exist. Stage 0 is **not** marked PASS.
