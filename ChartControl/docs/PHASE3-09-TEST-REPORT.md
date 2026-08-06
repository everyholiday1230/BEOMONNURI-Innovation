# PHASE 3 — Test Report

Raw logs: `artifacts/logs/phase3-*.log` (each has a header: command / env / git SHA + tree / start /
end / exit code). Eight §21 commands + real PostgreSQL run. All exit 0.

## §21 command results (fresh, this closure pass)
| Command | Result | Exit | Log |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | up to date | 0 | phase3-install.log |
| `pnpm lint` | 0 errors (ESLint 9) | 0 | phase3-lint.log |
| `pnpm typecheck` | 10/10 projects | 0 | phase3-typecheck.log |
| `pnpm test` | **203 passed** (offline; PG suite `skipIf` when `PG_TEST_URL` unset) | 0 | phase3-test.log |
| `pnpm build` | all packages + apps built | 0 | phase3-build.log |
| `pnpm e2e` | **10 passed** (Chromium; Playwright auto-boots BFF+web) | 0 | phase3-e2e.log |
| `pnpm test:postgres` | **12 passed** (real PostgreSQL 17, `PG_TEST_URL`) | 0 | phase3-postgres.log |
| `pnpm test:integration` | **33 passed** (auth-api 19 + trading-integration 8 + trading-routes 6) | 0 | phase3-integration.log |

## Unit / integration suites (deterministic, mock adapters)
| Suite | Tests | Area |
|---|---|---|
| packages/exchange-bitmart bitmart.test.ts | 15 | signature vectors, mode gate, normalize, adapter timeout/429/reject, dedup |
| packages/exchange-bitmart rate-limit.test.ts | 10 | central config priority, token bucket, per-scope isolation, backoff+jitter, Retry-After, circuit breaker |
| packages/domain live-order-machine.test.ts | 6 | 17-state transitions incl SUBMIT_UNKNOWN / RECONCILING / INCONSISTENT |
| apps/api trading-core.test.ts | 13 | credential vault (envelope/rotate/mask), idempotency, risk engine |
| apps/api trading-integration.test.ts | 8 | timeout→reconcile, dup submit, shadow, partial fill, cancel/fill race, §15 circuit breaker fail-fast |
| apps/api trading-routes.test.ts | 6 | credentials/verify/isolation/connection-status/shadow submit/idempotency |
| apps/api postgres.integration.test.ts | 12 (real PG) | migrate up/down/re-up, unique/FK/index, tx rollback, concurrency, reconnect, 0003 tables |
| packages/exchange-bitmart ws-config.test.ts | 6 | production WS allowlist, demo-URL reject (fail-closed), private adapter construction |
| apps/api credential-source.test.ts | 11 | fail-closed resolve (prod requires ARN+region; env refused in prod), AWS SM via injected client, redaction-safe parse/errors |

Totals: **`pnpm test` = 203 passed** (offline), **e2e = 10 passed** (Chromium), **PostgreSQL = 12
passed** (real, `PG_TEST_URL`), **`pnpm test:integration` = 33 passed**.
Phase 1 (99 unit / 9 e2e) + Phase 2 preserved — no regression.

## §19 stages
- **Stage A — Production Read-Only: Not Executed** (no API key). Adapter + normalization unit/IT-tested vs mock HTTP.
- **Stage B — Production Shadow: Executed** (SHADOW; adapter proven to never transmit; risk/idempotency run).
- **Stage C — Controlled Live Order: Not Executed. Reason: explicit owner authorization or safe credentials not provided.**

## Not Executed (honest)
- BitMart Production Read-Only real connection (no API key).
- Private WS live session (no credentials); mock + dedup tested.
- Controlled Live Order (owner authorization + safe credentials not provided).
- 1k-user / 10k-WS load, WebKit E2E, app-default-store-on-Postgres, Redis fan-out — Production Release Gate.

## Live Validation Pass (2026-07-29) — CONDITIONAL PASS
RC tag `phase-3-rc-v0.3.0`. Re-ran §7 regression at this commit (fresh logs, headers, all exit 0):
| Command | Result | Exit | Log |
|---|---|---|---|
| `pnpm lint` | 0 errors | 0 | phase3-lint.log |
| `pnpm typecheck` | 10/10 projects | 0 | phase3-typecheck.log |
| `pnpm test` | **203 passed** (offline; PG suite skipIf) | 0 | phase3-test.log |
| `pnpm build` | ok | 0 | phase3-build.log |
| `pnpm e2e` | **10 passed** (Chromium) | 0 | phase3-e2e.log |
| `pnpm test:postgres` | **12 passed** (real PG17) | 0 | phase3-postgres.log |
| `pnpm test:integration` | **33 passed** | 0 | phase3-integration.log |

Deployment env (§2, credential-free, `artifacts/logs/phase3-stageA-env.log`): egress IP `15.164.47.4`,
prod REST `api-cloud-v2` HTTP 200 + TLS verified, server-time drift ≈ −21 ms (±5 s), prod WS URLs,
defaults live=false/kill=true, KMS not configured (dev KEK), redaction verified.

Stage results:
- **Stage A Production Read-Only: Not Executed** (no real API key). Env/URL/TLS/time verified credential-free; all authenticated items Not Executed.
- **§4 Long Private WS (30 min / 2 h): Not Executed** (needs credential to auth the private stream).
- **§5 Production Shadow: server blocking PROVEN** (transmitted=false, liveGateAllowed=false, 0 submit calls); real-account numbers Not Executed (no credential).
- **§6 Controlled Live Order: Not Executed. Reason: Explicit owner authorization not provided.**

No authenticated Stage A item is marked Passed.

## Stage A Production Read-Only attempt (2026-07-29) — FAIL-CLOSED (evidence `artifacts/logs/phase3-stageA.log`)
Runner `scripts/phase3-stageA.sh` on the real EC2 (IAM role `EC2-SessionManager-Seoul`, region
`ap-northeast-2`, egress `15.164.47.4`). Managed credential source (AWS Secrets Manager) **not connected**
in this runtime (no `BITMART_SECRET_ARN`/`AWS_REGION`, `@aws-sdk` not installed).
- **[02] Secret Redaction — Pass** (0 secret/memo/access-key log sites).
- **[03] Fixed egress IP — Pass** (`15.164.47.4`).
- **[01],[04]–[16],[17]–[24] — Not Executed** (fail-closed; managed credential source not connected).
  Item 7 records credential-free drift ≈ −22 ms (±5 s); WS URL production allowlist validated.
- No order/modify/cancel/leverage/position-mode/transfer/withdraw/margin call was made.
Regression re-run this pass (all exit 0): **test 203** (offline) · e2e 10 · postgres 12 · integration 33.

## Stage A re-attempt via Secrets Manager (2026-07-29) — FAIL-CLOSED (preflight 1–10 in `phase3-stageA.log`)
Preflight: `@aws-sdk` NOT installed, `AWS_REGION` unset, `BITMART_SECRET_ARN` unset → GetSecretValue not
reachable → **Stage A via Secrets Manager Not Executed (fail-closed)**. IAM role present
(`EC2-SessionManager-Seoul`), egress `15.164.47.4`, defaults live=false/kill=true, redaction enforced.
- **Interim live read-only** (`phase3-stageA-live.log`, masked; owner-provided key via env, NOT Secrets
  Manager, credential now compromised/pending rotation): API-key auth + HMAC **Ok** (`code=1000`), drift
  78 ms, `assets-detail array[7]` (schema only), `position array[0]`, `open-orders array[0]`. This proves
  the read-only signing path works against production, but does NOT satisfy the Stage A gate (wrong
  credential source + compromised key). Position Mode / leverage / order+trade history / metadata /
  Private WS + 30-min soak: Not Executed.
