# PHASE 7-08 — Security Final Gate

**Overall state: IN_PROGRESS.** One real defect in the approved Phase 6 artifact was found and fixed
with verification. Every gate that needs live infrastructure or an external scanner binary remains
`NOT_EXECUTED` / `BLOCKED`.

## 1. Development seed separated from the production artifact

### The defect

The approved image `quantumtrade-api:phase6-closure` shipped the development fixture credentials
inside `/app/dist/index.js` — one occurrence each of:

```
admin@qt.local  adminpass1234  supportpass1234  analystpass1234
userpass1234    disablepass1234  rolepass1234    dev-insecure-csrf-key
```

The seed's **execution** path was correctly gated
(`ADMIN_SEED === 'true' && NODE_ENV !== 'production'`, and `NODE_ENV=production` is baked into the
image), so exploitability was low. The requirement, however, is that the strings are **absent from the
artifact**. They were not.

Why Phase 6 missed it: `scripts/phase6-container-validate.sh:84` scanned only the image `ENV` and
`docker history`, matching `AKIA…|PRIVATE KEY|SECRET_ACCESS_KEY=|password=|BITMART_API_SECRET=`. The
bundle contents were never read.

### The fix

| Change | File |
|---|---|
| Fixtures moved to a dev-only module holding the sole copy | `apps/api/src/dev/seed.ts` |
| Explicit dev/test command; refuses when `NODE_ENV=production` (exit 2, before opening the database) | `apps/api/src/dev/seed-cli.ts`, script `seed:dev` |
| Production entry no longer contains the fixtures. The dev module is loaded through a specifier **assembled at runtime**, so esbuild cannot resolve it and cannot inline it | `apps/api/src/index.ts` |
| Hard-coded development CSRF key removed. Non-production generates an ephemeral `randomBytes(32)` key; production **requires** `AUTH_CSRF_KEY` (≥32 chars) and fails closed without it | `apps/api/src/env.ts` (`ephemeralDevKey`, `assertProductionSigningKeys`) |

The requirement "do not merely hide it behind a dynamic import — verify the bundler does not emit the
dev module as a chunk" is satisfied by inspecting the real artifact, not by reasoning:

- `apps/api/tsup.config.ts` bundles only `src/index.ts`, `noSplitting: true`, `sourcemap: false`.
- Built output is a **single** file, `dist/index.js` (505.90 KB) plus `dist/migrations/`. No chunk, no
  `dist/dev/`, no `.map`.
- The runtime image copies `apps/api/dist` + production `node_modules` only
  (`infrastructure/docker/Dockerfile.api`), so neither `src/dev` nor `src/__tests__` is present.

### Verified result

All eight strings are **0 occurrences** in both `apps/api/dist/index.js` and the container filesystem
of the rebuilt image `quantumtrade-api:phase7-preflight`.

`git grep -nE 'admin@qt\.local|adminpass1234|dev-insecure-csrf-key'` now matches only the dev-only seed
module and the tests that assert its isolation.

## 2. Production database dev-seed detection — fail closed

`apps/api/src/security/dev-fixture-guard.ts`, wired into start-up in `apps/api/src/index.ts`.

- The production bundle holds **only SHA-256 digests** of the normalized fixture identifiers — no
  development e-mail address and no password. A unit test asserts the digest list matches the fixture
  list exactly, so a new fixture cannot silently escape detection, and another test asserts the policy
  module contains no plaintext identifier.
- Detection normalizes each identifier read from the database (trim + lowercase) before hashing, so
  `  ADMIN@QT.LOCAL ` is caught.
- An explicit metadata marker is preferred where the schema carries one: the `e2e_seed` feature flag is
  checked in addition to identifier digests.
- On detection the process **exits 1** with code `DEV_SEED_ACCOUNT_DETECTED` and discloses only
  aggregate counts.

Measured against a real seeded database:

```
[api] FAIL-CLOSED startup: DEV_SEED_ACCOUNT_DETECTED: the production database contains
development/E2E fixture data (identifier matches=6, fixture marker=true). Refusing to start. …
```

Log-leak check on that exact output: `admin@qt.local` 0, `qt.local` 0, `adminpass1234` 0. The only `@`
characters come from the `@quantumtrade/api` package name in the runner's own output. Clean database:

```
[api] production fixture scan: OK (identifiers inspected=0, fixture matches=0)
```

No cross-user data and no real e-mail address is ever written to a log by this path.

## 3. Production artifact scanner

`scripts/phase7-artifact-scan.sh` (`pnpm test:artifact`). Targets and rules:

| Target | Covered |
|---|---|
| `apps/api/dist` | yes |
| JavaScript bundles (`*.js`, `*.mjs`, `*.cjs`) | yes |
| Source maps (`*.map`) | yes — presence is itself a finding (`QT-SEC-012`) |
| Config files (`*.json`, `*.yml`, `*.yaml`, `.env*`, `*.sql`) | yes |
| Package metadata inside the artifact | yes |
| Container filesystem (`docker export`) | yes |
| Image layers / `docker history` | yes |
| Image `Config.Env` | yes |

| Rule | Detects |
|---|---|
| `QT-SEC-001` | Dev fixture tokens, matched by **SHA-256 digest** — the literals are not present in the scanner either |
| `QT-SEC-002` | Dev fixture e-mail domain (`@qt.local`) |
| `QT-SEC-003` | BitMart key/secret/memo assignment |
| `QT-SEC-004` | OpenAI API key shape (`sk-…`) |
| `QT-SEC-005` | AWS access key id shape (`AKIA`/`ASIA`) |
| `QT-SEC-006` | PEM private key block |
| `QT-SEC-007` | `Authorization: Bearer/Basic …` value |
| `QT-SEC-008` | `Set-Cookie` with a session/token value |
| `QT-SEC-009` | Session / CSRF signing key assignment |
| `QT-SEC-010` | Generic `password`/`secret`/`token`/`apiKey` assignment with an inline literal |
| `QT-SEC-011` | Hard-coded insecure development key marker |
| `QT-SEC-012` | Source map present in a production build |
| `QT-SEC-013` | Dev/test/fixture directory emitted into the artifact |

Output policy: the report records **path + rule id + count only**
(`artifacts/security/phase7-artifact-scan.json`). No matched text is printed, and no real secret value
appears in a pattern.

### Results

| Scan target | Findings |
|---|---|
| `apps/api/dist` (current build) | **0** |
| `quantumtrade-api:phase7-preflight` (dist + container fs + layers + env, 217 files) | **0** |

### Negative control — the scanner actually detects

Run against the pre-fix approved image `quantumtrade-api:phase6-closure`:

```
FINDING  QT-SEC-002  count=7  /app/dist/index.js      (dev fixture e-mail domain)
FINDING  QT-SEC-011  count=1  /app/dist/index.js      (insecure dev key marker)
FINDING  QT-SEC-001  count=6  /app/dist/index.js      (fixture tokens by digest)
FINDING  QT-SEC-013  count=1  container:/app          (dev/test directory)
total findings: 16 → RESULT: FAIL (exit 1)
```

A false positive was found and corrected during that run: `QT-SEC-013` matched
`node_modules/tar-fs/test/fixtures`, a third-party package's own test directory. The rule is now scoped
to `/app/dist` — our emitted artifact — because vendor test directories are dependency hygiene covered
by the Trivy/SBOM gate, not application credential leakage.

## 4. Regression coverage

### Unit / logic level — `apps/api/src/__tests__/production-artifact.test.ts` (31 tests, all pass)

Production source graph carries no dev credential (token-digest comparison across `index.ts`,
`env.ts`, `auth-routes.ts`, `trading-routes.ts`, `ai-routes.ts`); `index.ts` has no static **or type**
import of the dev module; `env.ts` ships no hard-coded signing key; tsup entry is limited to
`src/index.ts` with `sourcemap: false`; the digest policy matches the fixture list; the policy module
holds no plaintext; normalization catches case/whitespace variants; ordinary production identifiers are
not flagged; the fail-closed guard throws on identifier match **and** on marker-only; a clean database
passes; non-production is never blocked; the failure message contains no `@`, no e-mail, no password;
`runDevSeed` rejects in production and processes every fixture in dev; `adminSeedEnabled` is false in
production even with `ADMIN_SEED=true`; production requires a ≥32-char `AUTH_CSRF_KEY`; the dev key is
distinct per load; the built artifact has no source map and no fixture credential.

### Process / artifact level — `scripts/phase7-seed-isolation-regression.sh` (16 checks, all pass)

| ID | Scenario | Result |
|---|---|---|
| R1 | Forbidden tokens in `dist/index.js` | PASS (0) |
| R1b | No dev/test directory in `dist` | PASS |
| R2 | Container filesystem + dist artifact scan | PASS (0 findings) |
| R3 | No source map emitted | PASS |
| R4 | `NODE_ENV=production` + `ADMIN_SEED=true` → seed does not run | PASS (0 log lines) |
| R4b | No fixture rows written | PASS (`users=0`) |
| R5 | `seed:dev` refused in production | PASS (exit 2) |
| R5b | The refused command created no database | PASS |
| R6 | `seed:dev` works in dev | PASS (6 fixtures) |
| R6b | `seed:dev` is idempotent | PASS (still 6) |
| R7 | Test fixture marker recorded | PASS |
| R7b | Admin roles granted to fixtures | PASS |
| R8 | Production start-up on a seeded DB is blocked | PASS (`DEV_SEED_ACCOUNT_DETECTED`) |
| R9 | Block log leaks no identifier/password | PASS (0 hits) |
| R9b | Block log reports aggregate counts only | PASS |
| R10 | Clean production DB passes the fixture scan | PASS |

Evidence: `artifacts/logs/phase7/seed-isolation-regression.log`,
`artifacts/logs/phase7/r8-production-blocked.log`, `artifacts/logs/phase7/r10-clean-db.log`.

### Existing suites — no regression

`pnpm test` · `pnpm e2e` · `pnpm e2e:admin` · `pnpm test:security` · `pnpm test:mfa` · `pnpm e2e:mfa`
re-run on this branch; counts recorded in PHASE7-20 and `FINAL-REPORT.md`.

## 5. IaC security scanning

| Tool | Version | Result |
|---|---|---|
| checkov | 3.3.8 | **297 passed / 0 failed / 27 skipped** — every skip justified inline |
| tfsec | 1.28.13 | **0 critical / 0 high / 0 medium / 0 low** |
| tflint | 0.53.0 | 0 issues |
| `terraform validate` | 1.9.8 | valid |

Suppression inventory and justifications: PHASE7-02 §6.

## 6. Image signing and provenance

ECR has no native signing resource. The intended mechanism — **not yet executed**:

1. Build reproducibly from the digest-pinned base (`node:24-alpine@sha256:a0b9bf06…`).
2. Generate an SBOM (CycloneDX + SPDX) and scan with Trivy; gate on Critical/High.
3. Sign with **cosign** keyless (CI OIDC identity), pushing the signature as an OCI artifact into the
   same repository.
4. Attach a SLSA provenance attestation.
5. Verify the signature at deploy time and deploy **by digest**, never by tag.

ECR repositories are created with `IMMUTABLE` tags (enforced by a Terraform variable validation), which
makes the digest authoritative. Steps 3–5 are `NOT_EXECUTED`: no registry exists yet.

## 7. Gate status

| Gate | State | Note |
|---|---|---|
| Production artifact secret scan (dist) | **PASS** | 0 findings, scanner negative-control verified |
| Production container filesystem scan | **PASS** | 0 findings on `phase7-preflight` |
| Source map excluded from production | **PASS** | `sourcemap: false`, 0 `.map` files |
| Dev seed excluded from the production artifact | **PASS** | single-file bundle, no dev chunk, not in the image |
| Dev seed command refused in production | **PASS** | exit 2 before touching a database |
| Production DB dev-seed detection, fail-closed | **PASS** (code) / **NOT_EXECUTED** (against the real production DB) | Needs the production database |
| No PII in the blocking log path | **PASS** | 0 identifier/password hits |
| Container vulnerability scan (Trivy) | **PASS** (inherited, Phase 6: 0 Critical / 0 High) | Re-run required on the Phase 7 image before Stage 1 |
| IaC scan (checkov / tfsec / tflint) | **PASS** | 0 failed / 0 critical / 0 high |
| Dependency audit (production) | **PASS at the Critical/High threshold** | 5 moderate accepted for the Phase 6 baseline **only**; they must be remediated or individually re-dispositioned before this gate can pass — see PHASE7-19 |
| SAST (semgrep) | **NOT_EXECUTED** | binary absent |
| Secret scan over full Git history (gitleaks/trufflehog) | **NOT_EXECUTED** | binary absent. Note: the fixture strings **are** in Git history at the Phase 6 tags by design — they were committed as dev fixtures. History rewriting is not proposed; the fixtures are non-production credentials for a local SQLite database and were never valid anywhere else |
| OSV scan (osv-scanner) | **NOT_EXECUTED** | binary absent |
| TLS configuration check | **NOT_EXECUTED** | no production domain/endpoint |
| Security header check (live) | **NOT_EXECUTED** | no deployed endpoint. Header middleware is unit-verified from Phase 6 |
| CORS / CSRF / XSS / SQLi / SSRF / IDOR / open redirect / host header / session fixation / session expiry / MFA replay / recovery-code reuse / admin privilege escalation / audit tampering / release-gate false pass / WebSocket origin bypass / rate-limit bypass | **NOT_EXECUTED** against a production deployment | All are covered by Phase 6 unit + E2E suites against the local stack; the Stage 4 requirement is to repeat them against the deployed production environment |
| Image signing / attestation | **NOT_EXECUTED** | no registry |
| WAF on the public entry point | **NOT_IMPLEMENTED** | tracked in PHASE7-19 |


---

## 8. Production Security Gate pass (2026-07-30) — dependency + scanner closure

Full detail and evidence: `docs/PHASE7-18-TEST-REPORT.md`. Stage 0 remains **BLOCKED**; this section
closes the gate's dependency and scanner items only.

### Dependency threshold — now met

```
pnpm audit --prod  →  exit 0
                      Critical 0 / High 0 / Moderate 0 / Low 0
ci-audit-gate.sh   →  PASS
```

The five moderates accepted for the Phase 6 baseline are **remediated by upgrade**, not waived:

| Advisory | Package | 6.x/1.x → | Now |
|---|---|---|---|
| GHSA-9jcx-v3wj-wh4m | react-router | 6.26.2 | **8.3.0** |
| GHSA-2j2x-hqr9-3h42 | react-router | 6.26.2 | **8.3.0** |
| GHSA-wrjc-x8rr-h8h6 | react-router | 6.26.2 | **8.3.0** |
| GHSA-337j-9hxr-rhxg | react-router | 6.26.2 | **8.3.0** |
| GHSA-frvp-7c67-39w9 | @hono/node-server | 1.19.17 | **2.0.12** |

An intermediate step is recorded because it changes the conclusion: `react-router-dom@7.18.2` cleared
all four React Router moderates but introduced a **new HIGH** (`GHSA-qwww-vcr4-c8h2`, RSC CSRF,
patched only in `>= 8.3.0`). `react-router-dom` has no 8.x, so the fix required `react-router@8.3.0`,
which requires React ≥ 19.2.7 — hence the React 18 → 19 upgrade. Stopping at 7.18.2 would have failed
the `0 critical / 0 high` gate.

Post-upgrade contract tests: `apps/web/src/__tests__/router-mode.test.ts` (9) proves Declarative
`BrowserRouter` mode is preserved and that no Data-Mode / Framework-Mode / SSR / RSC API is used or
bundled; `apps/api/src/__tests__/server-adapter.test.ts` (9) proves `serve()` compatibility on a real
socket, that `serveStatic` exists nowhere in source or `dist`, and that encoded-backslash traversal
requests reach only the application's 404 with no filesystem payload.

### Scanner suite — executed

| Gate | State | Evidence |
|---|---|---|
| SAST (semgrep 1.172.0, `p/default`) | **27 → 3 findings** | 5 classes fixed in code, 4 justified in place, 3 OPEN (pnpm-10-only policy keys) |
| Secret scan, working tree (gitleaks 8.21.2) | **PASS — 0** | 6 reviewed false positives dispositioned in `.gitleaks.toml` with reasons |
| Secret scan, full history (35 commits) | **PASS — 0** | same config; `--redact` |
| OSV-Scanner 2.4.0 | **11 findings, all dev-only** | OPEN — every fix needs a build/test toolchain major |
| Trivy 0.72.0 filesystem | **PASS** — 0 critical / 0 high | |
| Trivy 0.72.0 container image | **PASS — 0** | `quantumtrade-api:phase7-secgate` |
| SBOM CycloneDX + SPDX (syft 1.18.1) | **PASS** | image 98 components, source 934; SHA-256 in PHASE7-18 §3 |
| License scan | **PASS — 0 restricted** | AGPL/SSPL/BUSL/CC-BY-NC deny-list |
| IaC checkov 3.3.8 | **PASS — 0 failed** | 304 passed / 31 skipped, every skip justified inline |
| IaC tfsec 1.28.13 | **PASS — 0** | 0 critical / 0 high |

Reporting policy honoured: no real secret value appears in any report or in this document. Gitleaks
runs with `--redact`; the dev-fixture scanner rule matches by SHA-256 digest so the literals are absent
from the scanner itself; scan records carry path, rule id and count only.

### Hardening applied while closing SAST findings

AES-GCM `authTagLength` pinned to 16 bytes in both cipher paths (a truncated auth tag was previously
acceptable to Node); all 13 GitHub Actions references pinned to commit SHAs; SRI added to the
version-pinned CDN stylesheet; ALB access logging enabled with a hardened, delivery-scoped log bucket;
`readCookie` rewritten without a dynamically constructed `RegExp`.

### Still open at this gate

- **pnpm supply-chain policy (3 semgrep findings)** — `blockExoticSubdependencies`,
  `minimumReleaseAge`, `trustPolicy` exist only in pnpm 10; this repo pins pnpm 9.15.0. Writing the
  keys under pnpm 9 would satisfy the scanner while enforcing nothing, so they stay failing.
- **11 dev-only OSV advisories** — not in the production artifact (`audit --prod` 0; the image carries
  no dev dependency), each requiring a major toolchain upgrade.
- Everything infrastructure-bound remains **NOT_EXECUTED / BLOCKED** (Stage 0), including image
  signing/attestation, live TLS/header checks and the live injection/IDOR/session suite against a
  deployed environment.
