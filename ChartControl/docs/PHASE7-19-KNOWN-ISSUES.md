# PHASE 7-19 — Known Issues

Baseline `phase-6-approved-v0.6.0` → `d63ee29c51ba00469b0f48bcf6c4f8848b8ddb4d`.
Branch `phase-7-production-launch`. Stage 0 **BLOCKED**.

## RESOLVED in this commit

### [RESOLVED] Development credentials present in the approved production artifact

The image approved as `quantumtrade-api:phase6-closure` contained the dev fixture identifiers and
passwords, plus the marker string `dev-insecure-csrf-key`, inside `/app/dist/index.js` — one occurrence
each of `admin@qt.local`, `adminpass1234`, `supportpass1234`, `analystpass1234`, `userpass1234`,
`disablepass1234`, `rolepass1234`, `dev-insecure-csrf-key`.

Severity was limited: the seed's execution path was gated on
`ADMIN_SEED === 'true' && NODE_ENV !== 'production'` and the image bakes `NODE_ENV=production`, so the
credentials were unreachable at runtime and were only ever valid against a local SQLite database.
Nevertheless the Phase 7 requirement is absence from the artifact, and that was not met.

Root cause of the miss: `scripts/phase6-container-validate.sh:84` scanned the image `ENV` and
`docker history` only — never the bundle contents.

Fixed by moving the fixtures into `apps/api/src/dev/` (outside the production import graph), loading
that module through a runtime-assembled specifier so esbuild cannot inline it, removing the hard-coded
CSRF key in favour of an ephemeral dev key plus a production requirement, and adding a scanner that
reads the real artifact. All eight strings are now 0 occurrences in `dist` and in the rebuilt image.
Details: PHASE7-08 §1.

### [RESOLVED] No production guard against a seeded database

There was no check that a production runtime was not pointed at a database still holding E2E fixtures.
Added a fail-closed start-up guard using SHA-256 digests only, so no development identifier is present
in the production bundle, and no identifier is logged on failure. Details: PHASE7-08 §2.

### [RESOLVED] Artifact scanner blind spot

The Phase 6 container check could not see bundle contents. Replaced by
`scripts/phase7-artifact-scan.sh`, which inspects `dist`, bundles, source maps, config, package
metadata, the container filesystem export, image layers/history and image ENV under 13 rules, and was
negative-control tested against the pre-fix image (16 findings, exit 1).

## BLOCKED — infrastructure absent or permission denied

### [BLOCKED] Every Stage 0 AWS gate

The runtime IAM role `EC2-SessionManager-Seoul` is `AccessDenied` on `secretsmanager`, `kms`, `rds`,
`elasticache`, `ecr`, `acm`, `route53`, `logs`, `cloudwatch` and `sns`. This is an **authorization**
result, not a runtime fault: the instance is healthy, credentials are valid, the clock is synchronized
(+21 ms vs the exchange) and egress works from the correct fixed IP `15.164.47.4`.

Consequences to keep straight:

- `GetSecretValue` → **BLOCKED — AccessDenied**. Existence of the secrets cannot be confirmed *or*
  denied.
- `KMS Decrypt` → **NOT_EXECUTED / BLOCKED**. The `kms:ViaService = secretsmanager…` path is only
  reachable *through* a secret read, so it was never exercised.
- RDS / ElastiCache / ECR / DNS / TLS / Observability / Alerting → **NOT_EXECUTED / BLOCKED**: denied
  **and** no production resource or endpoint was provided.

**No broad `List*` permission will be added to the runtime role to make a preflight probe pass.** The
application resolves secrets by ARN and never enumerates; `secretsmanager:ListSecrets` is on the
explicit `Deny` list. Existence checks will use `DescribeSecret` on the named ARNs, which the target
policy already allows.

### [BLOCKED] Local dev services are not evidence for production gates

A dev PostgreSQL 16.14 (127.0.0.1:5432/15432) and a dev Redis (127.0.0.1:6379/16379, `PONG`) exist on
this host. They are **not** managed services: the Redis reports `tls-port = 0` (TLS disabled) and has no
AUTH. Neither may be recorded as evidence for the managed-data-layer gates.

### [BLOCKED] No production domain

Repository-wide search finds no production domain configured anywhere. TLS certificate expiry, DNS and
the live security-header/TLS checks cannot be verified. Outbound TLS from the runtime is separately
confirmed working.

## OPEN — carried forward, must be closed before the Phase 7 Production Security Gate

### [OPEN] Five moderate dependency advisories

Accepted for the **Phase 6 source baseline only**; the acceptance expires at the Phase 7 Production
Security Gate or first production deployment, whichever comes first. Current state:
`pnpm audit --prod` exits 1 with 5 moderate / 0 high / 0 critical; `scripts/ci-audit-gate.sh` passes.

| # | Advisory | Package | Installed → Fixed | Reachability | Plan |
|---|---|---|---|---|---|
| M-1 | GHSA-9jcx-v3wj-wh4m | `react-router` | 6.26.2 → ≥6.30.2 | Not reachable — all 9 navigation targets are hard-coded literals | Patch upgrade to 6.30.4 |
| M-2 | GHSA-2j2x-hqr9-3h42 | `react-router` | 6.26.2 → ≥6.30.4 | Not reachable — same | Same upgrade |
| M-3 | GHSA-frvp-7c67-39w9 | `@hono/node-server` | 1.19.17 → ≥2.0.5 | Not reachable — `serveStatic` is never imported; runtime is Linux/Alpine and the flaw is Windows-path specific | Evaluate 2.x (major) in Stage 1 |
| M-4 | GHSA-wrjc-x8rr-h8h6 | `react-router` | 6.26.2 → ≥7.18.0 (major) | Not reachable — no user input reaches `<Link>`/`useNavigate` | Assess v7 in Stage 4, or re-disposition with a static check proving no dynamic navigation targets |
| M-5 | React Router `deserializeErrors()` SSR hydration | `react-router` | 6.26.2 → ≥7.18.0 (major) | **Structurally** unreachable — client-only SPA, no SSR/hydration path | Cleared by the same v7 assessment |

Framework-mode evidence is recorded in `FINAL-REPORT.md` and `docs/PRODUCTION-RELEASE-GATE.md`.

### [OPEN] WAF not attached to the public entry point

`dns.tf` provisions the ALB without a WAF web ACL. The public entry point is disabled by default
(`enable_dns = false`), so nothing is exposed today. Attaching a WAF with managed rule groups plus
rate-based rules tuned against the Stage 5 load test is a Stage 4 item. Not silently marked done.

### [OPEN] External scanners unavailable in this environment

`semgrep` (SAST), `gitleaks`/`trufflehog` (history secret scan) and `osv-scanner` are not installed and
were not run → `NOT_EXECUTED`. Terraform tooling **was** installed successfully this pass (terraform
1.9.8, tflint 0.53.0, tfsec 1.28.13, checkov 3.3.8 in a venv after `pip --user` was blocked by PEP 668).

Note on a history scan when it runs: the dev fixture strings **are** present in Git history at the
Phase 1–6 tags, because they were committed as development fixtures. They were only ever valid against
a local SQLite database. History rewriting is not proposed; a scanner run must be configured to
distinguish these known non-production fixtures from real credential leakage.

### [OPEN] Terraform never planned or applied

`terraform fmt`/`init -backend=false`/`validate`/`tflint`/`checkov`/`tfsec` all pass. `plan` is
`NOT_EXECUTED` (needs credentials with read access; the runtime role is denied on every service in the
configuration) and `apply` is `NOT_EXECUTED` (out of scope). No AWS resource was created, modified or
deleted. There is also no state backend yet — `-backend=false` was used.

### [OPEN] Container vulnerability scan not re-run on the Phase 7 image

Phase 6 recorded 0 Critical / 0 High for `quantumtrade-api:phase6-closure` (Trivy 0.72.0). The rebuilt
`quantumtrade-api:phase7-preflight` has passed the **artifact credential** scan but a Trivy CVE re-scan
has not been run on it in this pass. Required before Stage 1.

### [OPEN] `apps/admin` has no unit-test harness

Carried over from Phase 6. Admin console hygiene and key stability are covered by browser E2E instead.

## Unchanged Phase 6 carry-overs

Real-device Safari and mobile browsers; 1,000-VU HTTP load; 10,000 WebSocket connections; managed
PostgreSQL PITR drill; real PagerDuty/Slack delivery; multi-host rolling deploy; image registry publish;
BitMart Stage A; Live OpenAI + live model evaluation + live AI E2E. All **NOT_EXECUTED**.

## Live trading

`BITMART_LIVE_TRADING_ENABLED=false` and `BITMART_EMERGENCY_KILL_SWITCH=true`, verified baked into the
image. **Controlled Live Order: BLOCKED — Explicit owner authorization not provided.**


---

## Production Security Gate pass (2026-07-30)

### [RESOLVED] The five moderate dependency advisories

M-1…M-5 are **remediated by upgrade**, not waived. `pnpm audit --prod` now exits 0 with
**Critical 0 / High 0 / Moderate 0**. `react-router` 6.26.2 → **8.3.0** (via React 18 → **19.2.8**,
because `react-router@8` requires react ≥ 19.2.7) and `@hono/node-server` 1.19.17 → **2.0.12**.

Recorded because it changes the conclusion: the intermediate `react-router-dom@7.18.2` cleared all four
React Router moderates but introduced a **new HIGH** — `GHSA-qwww-vcr4-c8h2` (RSC Mode CSRF bypass,
vulnerable `>=7.12.0 <8.3.0`, patched `>=8.3.0`). `react-router-dom` publishes no 8.x, so the only fix
was `react-router@8.3.0`. Stopping at 7.18.2 would have traded four moderates for one high and failed
the `0 critical / 0 high` release gate.

Full dependency diff, the mode-preservation proof (Declarative `BrowserRouter`, no Data/Framework/SSR/
RSC APIs), and the Hono `serve()`/`serveStatic` evidence are in `docs/PHASE7-18-TEST-REPORT.md`.

### [RESOLVED] Latent defects found while isolating the E2E environment

1. **`pnpm --filter X dev -- --port N` never reached Vite.** pnpm forwards the literal `--`, Vite stops
   parsing, and the server silently falls back to the config port. Invisible until now because the
   requested port equalled the default. Fixed by reading `VITE_DEV_PORT` in the two Vite configs with
   `strictPort: true`.
2. **`VITE_API_BASE_URL` was doing double duty.** `VITE_`-prefixed variables are inlined into the
   **client** bundle, so using it as the dev-proxy target made the browser call the API cross-origin;
   the `SameSite` session cookie was dropped and every authenticated request returned 401. Fixed with a
   server-only `DEV_API_PROXY_TARGET`; the client stays same-origin. The MFA spec's hard-coded
   `origin: 'http://localhost:5173'` now comes from the config's `BASE_URL`.
3. **Firefox-only flake in admin `[28] offline → resume`.** The test cut the network before the lazily
   imported Users chunk finished loading, so the search input never rendered. It now waits for the
   screen to be interactive first — the subject is the offline state of a **search request**.

### [RESOLVED] Secret-scan findings

Gitleaks reported 6 (working tree and history). All six were reviewed with redacted output and are
non-functional — a fake `AKIA…` literal used by masking tests, two unit-test passwords, a fake
`sk-` value in a redaction test, and log prose in a committed Phase 3 evidence file. Dispositioned
individually in `.gitleaks.toml`, which **extends** the bundled ruleset so new rules still apply and
states the policy for adding an entry. Working tree 0, full history (35 commits) 0.

### [OPEN] pnpm supply-chain policy requires pnpm 10

Three semgrep findings remain and are deliberately **not** suppressed:
`pnpm-block-exotic-sub-dependencies`, `pnpm-missing-minimum-release-age`, `pnpm-trust-policy`. These
keys (`blockExoticSubdependencies`, `minimumReleaseAge`, `trustPolicy` in `pnpm-workspace.yaml`) exist
only in **pnpm 10**; this repository pins `pnpm@9.15.0`. Writing them under pnpm 9 would silence the
scanner while enforcing nothing.

Remediation: upgrade pnpm 9 → 10, which rewrites the lockfile format (v9 → v10) and requires a full
reinstall plus a regression pass. Owner: platform. Expiry: before production deployment.

### [OPEN] 11 development-only dependency advisories (OSV)

`brace-expansion` (GHSA-mh99-v99m-4gvg, fixed 5.0.8), `esbuild` ×2 (GHSA-67mh-4wv8-2f99, 0.25.0),
`playwright` (GHSA-7mvr-c777-76hp, 1.55.1), `tsup` (GHSA-3mv9-4h5g-vhg3, **no fix published**),
`uuid` (GHSA-w5hq-g745-h8pq, 11.1.1), `vite` ×3 (GHSA-4w7w-66w2-5vf9, GHSA-fx2h-pf6j-xcff,
GHSA-v6wh-96g9-6wx3 — 6.4.3 / 7.3.5), `vitest` (GHSA-5xrq-8626-4rwp, 3.2.6).

`vitest` 2.0.5 → **2.1.9** was taken this pass because it is same-major and cleared
`GHSA-9crc-q9x8-hgqq`. Every remaining fix needs a **major** toolchain upgrade (vite 5→6/7,
vitest 2→3, playwright 1.46→1.55, esbuild 0.21→0.25), each carrying real regression risk across the
build and test stack.

Reachability: none is a production runtime dependency. `pnpm audit --prod` reports 0, and the
production image contains no dev dependencies (verified by the container check). Owner: platform.
Expiry: before production deployment, or earlier if any advisory becomes reachable from the runtime.

### [RESOLVED] `.terraform` provider cache entered the Docker build context

The first image rebuild failed with `no space left on device`: the 692 MB Terraform provider cache was
being copied into the build context. `.dockerignore` now excludes `**/.terraform`, `*.tfstate*` and the
lock file.

### Unchanged

Stage 0 stays **BLOCKED** on AWS infrastructure (secrets/KMS/RDS/ElastiCache/ECR/DNS/TLS/observability/
alerting), `terraform plan`/`apply` **NOT_EXECUTED**, WAF not attached, image signing/attestation
NOT_EXECUTED, real-device Safari, 1,000-VU HTTP, 10,000 WS, managed PITR drill, real PagerDuty/Slack,
multi-host rolling deploy, registry publish, BitMart Stage A, Live OpenAI + eval + AI E2E.
**Controlled Live Order: BLOCKED — Explicit owner authorization not provided.** Live trading disabled.
