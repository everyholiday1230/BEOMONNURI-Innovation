# PHASE 6-17 — Dependency Audit & Remediation

Tool: `pnpm audit` (`npm audit` needs a package-lock, absent in this pnpm workspace → ENOLOCK).
Raw JSON: `artifacts/logs/phase6-audit-{prod,all}.json` (before) and `-after.json` (after).

## Result
| Scope | Before | After |
|---|---|---|
| **Production** (`pnpm audit --prod`) | 2 critical / **7 high** / … | **0 critical / 0 high** / 5 moderate |
| All (incl. dev) | 2 critical / 12 high | 2 critical / 5 high / 11 moderate / 1 low (dev-only) |

CI gate `scripts/ci-audit-gate.sh` fails the build if production critical>0 or high>0. Log:
`artifacts/logs/phase6-ci-audit-gate.log` → **PASS**.

## Production high/critical — remediated (each analyzed)
| Package | Installed | Patched→now | Path | Prod/Dev | In runtime bundle? | GHSA | Remediation | Status |
|---|---|---|---|---|---|---|---|---|
| hono | 4.6.3 | **4.12.32** | apps/api → hono | Prod | Yes (API server) | m732-5p4w-x69g (Improper Authorization) + 3vhc-576x-3qv4, f67f-6cw9-8mq4, q5qw-h33p-qvwr, 88fw-hqm2-52qc | **Direct upgrade** | **Fixed** |
| @hono/node-server | 1.13.1 | **1.19.17** | apps/api → @hono/node-server | Prod | Yes | wc8c-qw6v-h7f6 | **Direct upgrade** (stayed on 1.x) | **Fixed** |
| @remix-run/router | 1.19.2 | **≥1.23.2** (1.23.3) | apps/web → react-router-dom → @remix-run/router | Prod | Yes (web bundle) | 2w69-qvjg-hvjx (XSS via open redirect) | **pnpm override** `@remix-run/router: ">=1.23.2"` | **Fixed** |

Remaining **production moderate** (below the High gate; accepted): react-router (4×, needs a react-router v7
major — out of closure scope) + @hono/node-server (1×, fixed in 2.x major). Tracked as follow-up.

## Dev-only exceptions (allowed with evidence)
None of these ship in the production image or runtime bundle: the Docker runtime installs
`--prod` deps only (PHASE6-20), the web/admin production builds are static assets (Vite/vitest/playwright
are build/test tools, not shipped), and `ws`/`brace-expansion` here are pulled by test/lint tooling.

| Package | Severity | Why dev-only | In prod image/runtime/bundle? | CI-input exploitability | Mitigation | Owner | Expiry | Follow-up |
|---|---|---|---|---|---|---|---|---|
| vitest | **critical** ×2 (9crc-q9x8-hgqq, 5xrq-8626-4rwp) | unit-test runner | No | Only runs trusted repo tests in CI | pinned; CI runs trusted code only | oncall-backend | 2026-10-31 | bump to vitest ≥3.2.6 (major; test-config migration) |
| playwright | high | E2E runner | No | trusted specs only | pinned | oncall-frontend | 2026-10-31 | bump @playwright/test |
| vite | high | dev server / bundler | No (output is static assets) | build-time only | pinned | oncall-frontend | 2026-10-31 | bump vite ≥ patched |
| ws | high | test/tooling dep (not yet a runtime dep) | No | n/a | pinned | oncall-backend | 2026-10-31 | pin ≥ patched when gateway server ships ws at runtime |
| brace-expansion | high | transitive via eslint | No | lint-time only | override on bump | oncall-backend | 2026-10-31 | eslint dep bump |

> When the market-gateway server (PHASE6-01) ships `ws` at runtime, `ws` moves to a production dependency
> and MUST be on a patched version before release (added to the prod gate).

## Commands
`pnpm audit --json`, `pnpm audit --prod --json`, `pnpm why hono`, `pnpm why @remix-run/router`,
`bash scripts/ci-audit-gate.sh`.
