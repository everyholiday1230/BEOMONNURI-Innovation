# PHASE 7-18 — Test Report (Production Security Gate pass)

Branch `phase-7-production-launch`. Baseline `phase-6-approved-v0.6.0` → `d63ee29`.
Recorded 2026-07-30. **Stage 0 remains BLOCKED** — this pass closes the Production Security Gate's
dependency and scanner items only.

## 1. Dependency remediation — the five accepted moderates are gone

Target from the instruction: `pnpm audit --prod` **Critical 0 / High 0 / Moderate 0**. Achieved.

### Advisories, re-confirmed before changing anything

| # | Advisory | Package | Installed | Fixed in | Dependency path | Mode at the time |
|---|---|---|---|---|---|---|
| M-1 | GHSA-9jcx-v3wj-wh4m | `react-router` | 6.26.2 | ≥ 6.30.2 | `apps/web > react-router-dom@6.26.2 > react-router@6.26.2` | Declarative (`BrowserRouter`), client-only SPA |
| M-2 | GHSA-2j2x-hqr9-3h42 | `react-router` | 6.26.2 | ≥ 6.30.4 | same | same |
| M-3 | GHSA-wrjc-x8rr-h8h6 | `react-router` | 6.26.2 | ≥ 7.18.0 | same | same |
| M-4 | GHSA-337j-9hxr-rhxg | `react-router` | 6.26.2 | ≥ 7.18.0 | same | same |
| M-5 | GHSA-frvp-7c67-39w9 | `@hono/node-server` | 1.19.17 | ≥ 2.0.5 | `apps/api > @hono/node-server@1.19.17` | `serve()` only; `serveStatic` never imported; Linux/Alpine runtime |

### What the upgrade path actually looked like

Direct package upgrade was chosen for both (priority 1 in the instruction). The React Router route was
not a single step, and the intermediate state is recorded because it changes the conclusion:

1. `react-router-dom` 6.26.2 → **7.18.2** cleared all four moderates but surfaced a **new HIGH**,
   `GHSA-qwww-vcr4-c8h2` ("RSC Mode CSRF Bypass", vulnerable `>=7.12.0 <8.3.0`, patched `>=8.3.0`).
   `react-router-dom`'s latest published version is 7.18.2 — there is no 7.x fix and no 8.x of that
   package.
2. The fix exists only in **`react-router` 8.3.0**, which requires **react ≥ 19.2.7**.
3. So the accepted path was React 19 + `react-router` 8.3.0, replacing `react-router-dom` (in v7+ the
   `react-router` package is the one that exports the DOM router).

Stopping at 7.18.2 would have traded four moderates for one high and **failed** the
`0 critical / 0 high` release gate. That is why the React major was taken rather than deferred.

### Dependency diff

| Package | Before | After | Reason |
|---|---|---|---|
| `react-router-dom` | 6.26.2 | **removed** | superseded by `react-router` in v7+ |
| `react-router` | 6.26.2 (transitive) | **8.3.0** (direct) | clears M-1…M-4 **and** GHSA-qwww-vcr4-c8h2 |
| `react` | 18.3.1 | **19.2.8** | `react-router@8` peer `react >= 19.2.7` |
| `react-dom` | 18.3.1 | **19.2.8** | same |
| `@types/react` | 18.3.5 | **19.2.17** | React 19 types |
| `@types/react-dom` | 18.3.0 | **19.2.3** | React 19 types |
| `@testing-library/react` | 16.0.1 | **16.3.2** | 16.0.1 peer is `react ^18` only |
| `zustand` | 4.5.5 | **5.0.14** | 4.5.5 pulls `use-sync-external-store@1.2.2`, whose peer caps at React 18 |
| `@hono/node-server` | 1.19.17 | **2.0.12** | clears M-5 (peer `hono ^4` satisfied by 4.12.32, `node >= 20` by 24.18.0) |
| `vitest` | 2.0.5 | **2.1.9** (22 manifests) | clears OSV `GHSA-9crc-q9x8-hgqq` within the same major |
| pnpm override `@remix-run/router` | `>=1.23.2` | **removed** | `react-router@8` does not depend on it (`pnpm why` finds it nowhere) |
| pnpm override `use-sync-external-store` | — | **`>=1.6.0`** added | forces a React-19-compatible version under zustand 5 |

Source changes required by the upgrade: six `apps/web/src` files switched
`from 'react-router-dom'` → `from 'react-router'`; React 19's `@types/react` removed the **global**
`JSX` namespace, so `apps/admin/src/App.tsx` uses `React.JSX.Element` and
`apps/web/src/__tests__/widgets.test.tsx` imports `type { JSX } from 'react'`. `apps/admin` was moved
to React 19 as well so the repository holds one React version.

### Result

```
pnpm audit --prod   →  exit 0
                       critical 0 / high 0 / moderate 0 / low 0 / info 0
scripts/ci-audit-gate.sh → PASS (0 critical / 0 high)
```

No severity threshold was lowered and no audit output was suppressed. Raw JSON:
`artifacts/logs/phase7/18-audit-prod.log`, `artifacts/logs/ci-audit-prod.json`.

Development-only advisories still exist and are reported separately by OSV (§3) — `pnpm audit --prod`
correctly excludes them, and the production image contains no dev dependency (verified by the
container check, "no dev dependencies in node_modules").

## 2. Post-upgrade verification

### React Router — Declarative mode preserved, SSR/Framework mode not activated

`apps/web/src/__tests__/router-mode.test.ts` (**9 tests**) asserts:

- installed `react-router` ≥ 8.3.0, and the declarative API surface (`BrowserRouter`, `Routes`,
  `Route`, `Navigate`, `NavLink`, `Link`, `useNavigate`, `useLocation`) is still exported;
- `<BrowserRouter>` is the only router mounted; no `RouterProvider` / `StaticRouter` / `ServerRouter`;
- the **only** names imported from `react-router` anywhere are the eight declarative ones;
- none of 25 Data-Mode / Framework-Mode / SSR / RSC APIs appears in any source file
  (`createBrowserRouter`, `createStaticHandler`, `useLoaderData`, `useFetcher`,
  `unstable_RSCStaticRouter`, `createRequestHandler`, …);
- no route `loader:` or `action:` is declared;
- no `hydrateRoot`, no `renderToString`/`renderToPipeableStream`, no `react-dom/server` import;
  `createRoot` is used;
- every navigation target is a static literal — the class of flaw M-1…M-4 belong to requires a
  user-controlled target;
- the built bundle contains no `unstable_RSCStaticRouter`, `routeRSCServerRequest`,
  `matchRSCServerRequest`, `StaticRouterProvider`, `createStaticHandler` or `react-dom/server`.

Login / signup / account / trade navigation regression: `pnpm e2e` **30 passed** (includes
`flow-k-auth` register→login→session→logout and the header/nav flows), and 90 passed across three
browsers.

### Hono — `serve()` compatible, `serveStatic` absent, traversal path unreachable

`apps/api/src/__tests__/server-adapter.test.ts` (**9 tests**) asserts:

- installed `@hono/node-server` ≥ 2.0.5;
- `serve()` is callable and accepts the exact `{ fetch, hostname, port }` shape the BFF uses, reports
  the bound port, serves a real end-to-end request, and exposes the `close()` the graceful-shutdown
  handler calls — all against a really-bound socket, not a mock;
- `serveStatic` / `serve-static` appears **nowhere** in the API sources;
- the built `dist/index.js` contains neither `serveStatic` nor `getFilePath`;
- four encoded-traversal shapes (`/..%5C..%5C..%5Cetc%5Cpasswd`, `/%5C..%5C..%5Cwindows%5Cwin.ini`,
  `/static/..%5C..%5Cpackage.json`, `/..%2F..%2Fetc%2Fpasswd`) all return the application's own 404
  and never a filesystem payload (`root:x:`, `[extensions]`, the package manifest);
- the platform is recorded as `linux` — the advisory needs Windows path semantics, so a literal
  Windows reproduction is **NOT_EXECUTED** here and the structural checks above are the control.

Route regression: Health/Auth/Admin/AI/Gateway all green — `test:integration`, `test:admin`,
`e2e:admin` 34, `test:security`, `test:gateway` 13, `e2e:gateway` 12, `test:mfa`, `e2e:mfa` 18.

## 3. Security scanner suite

`scripts/phase7-security-scan.sh` (`pnpm test:security-scan`). Every scan records tool, tool version,
rule/DB version, start/end time, exit code and finding count into
`artifacts/security/phase7/scan-summary.tsv`. **No secret value is written to any report** — gitleaks
runs with `--redact`, and the dev-fixture rule matches by SHA-256 digest so the literals are not in
the scanner either.

| Scan | Tool | Version | Rule / DB | Exit | Findings | Result |
|---|---|---|---|---|---|---|
| SAST | semgrep | 1.172.0 | `p/default` | 0 | **3** | 27 → 3 (§4) |
| Secret scan (working tree) | gitleaks | 8.21.2 | builtin + `.gitleaks.toml` | 0 | **0** | PASS |
| Secret scan (full history, 35 commits) | gitleaks | 8.21.2 | builtin + `.gitleaks.toml` | 0 | **0** | PASS |
| Dependency vulns (all, incl. dev) | osv-scanner | 2.4.0 | osv.dev live | 1 | **11** | dev-only, OPEN |
| Filesystem | trivy | 0.72.0 | DB 2026-07-29T19:07:59Z | 0 | 1 (0 critical/high) | PASS |
| Container image | trivy | 0.72.0 | DB 2026-07-29T19:07:59Z | 0 | **0** | PASS |
| SBOM image (CycloneDX + SPDX) | syft | 1.18.1 | — | 0 | 98 components | PASS |
| SBOM source (CycloneDX + SPDX) | syft | 1.18.1 | — | 0 | 934 components | PASS |
| License scan | SBOM analyzer | 1.0 | AGPL/SSPL/BUSL/CC-BY-NC deny-list | 0 | **0 restricted** | PASS |
| IaC | checkov | 3.3.8 | builtin policies | 0 | **0 failed** (304 passed / 31 skipped) | PASS |
| IaC | tfsec | 1.28.13 | builtin checks | 0 | **0** (0 critical / 0 high) | PASS |

SBOM SHA-256:

```
64268cf9552ec3f1a564b39fff246c3f0a07c02144946bd8d8d45ac58a2fdb05  sbom-image.cdx.json
b848be85623523ed60ff08e7ff4f6d7a495bf1459e36be8a41208614e8e9cbe2  sbom-image.spdx.json
6e71ab5ddfc328b66e6389bc80cf9c449950251e6de0760b382a434cfddba927  sbom-source.cdx.json
125c55021beb9cc77190387004ac3eca5d3b5d5ca8f607cfd1461a3334595846  sbom-source.spdx.json
```

### OSV — 11 remaining, all development-only

| Package | Advisory | Fixed in | Reachability |
|---|---|---|---|
| `brace-expansion` 1.1.16 / 2.1.3 | GHSA-mh99-v99m-4gvg | 5.0.8 | transitive via the lint chain; ReDoS in a dev tool |
| `esbuild` 0.21.5 / 0.23.1 | GHSA-67mh-4wv8-2f99 | 0.25.0 | dev bundler (vite/tsup) |
| `playwright` 1.46.1 | GHSA-7mvr-c777-76hp | 1.55.1 | test runner |
| `tsup` 8.2.4 | GHSA-3mv9-4h5g-vhg3 | no fix published | build tool |
| `uuid` 8.3.2 | GHSA-w5hq-g745-h8pq | 11.1.1 | dev transitive |
| `vite` 5.4.21 | GHSA-4w7w-66w2-5vf9, GHSA-fx2h-pf6j-xcff, GHSA-v6wh-96g9-6wx3 | 6.4.3 / 7.3.5 | dev server |
| `vitest` 2.1.9 | GHSA-5xrq-8626-4rwp | 3.2.6 | test runner |

None is a production runtime dependency: `pnpm audit --prod` reports 0, and the production image
contains no dev dependencies. Every remaining fix needs a **major** upgrade of the build/test
toolchain (vite 5→6/7, vitest 2→3, playwright 1.46→1.55, esbuild 0.21→0.25), which is a separate,
higher-risk change and is tracked as OPEN in PHASE7-19.

## 4. Semgrep — 27 → 3, with what was fixed vs. justified

**Fixed in code (real hardening):**

| Finding | Count | Fix |
|---|---|---|
| `gcm-no-tag-length` (ERROR) | 2 | `authTagLength` pinned to 16 bytes in `createCipheriv`/`createDecipheriv` — `apps/api/src/trading/credential-vault.ts` and `packages/mfa/src/cipher.ts`. Without it Node accepts a truncated auth tag, weakening AES-GCM integrity. |
| `github-actions-mutable-action-tag` | 13 | All 13 action references pinned to a **commit SHA** with the tag kept as a trailing comment (`actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `actions/upload-artifact`, `aquasecurity/trivy-action`). Supply-chain: a moved tag can no longer change CI behaviour. |
| `missing-integrity` | 1 | SRI added to the version-pinned CDN stylesheet in `apps/web/index.html` (`sha384-GIdEBa…`), computed from the served bytes and verified stable across two fetches, plus `crossorigin="anonymous"` and `referrerpolicy="no-referrer"`. Safe because the URL is immutable (`@v1.3.9`). |
| `aws-elb-access-logs-not-enabled` | 1 | ALB access logging enabled, with a dedicated S3 bucket: SSE-S3 (the only algorithm ELB log delivery supports), versioning, full public-access block, 400-day lifecycle, a delivery-scoped bucket policy and an explicit deny on non-TLS access. |
| `detect-non-literal-regexp` (production code) | 1 | `readCookie` in `apps/web/src/lib/authApi.ts` rewritten to parse cookies by string scan — no `RegExp` built from an argument at all. |

**Justified in place** (reason written at the suppression point, scoped to the exact line):
`aws-ecr-mutable-image-tags` ×2 (the value is `var.ecr_image_tag_mutability`, whose validation block
rejects anything but `IMMUTABLE`; semgrep cannot resolve the variable), `detect-non-literal-regexp` ×2
(test-only helper, input is a hard-coded selector, regex-escaped first), `unsafe-formatstring` ×1
(`console.error` receives an already-interpolated template plus the error object; the label is
internal), `detect-insecure-websocket` ×1 (the test asserts the guard **rejects** a plaintext URL — the
insecure scheme is the input).

**Remaining 3 — OPEN, not suppressed:** `pnpm-block-exotic-sub-dependencies`,
`pnpm-missing-minimum-release-age`, `pnpm-trust-policy`. These are supply-chain policy keys that only
exist in **pnpm 10** (`pnpm-workspace.yaml`); this repo pins `pnpm@9.15.0`. Writing pnpm-10 keys under
pnpm 9 would satisfy the scanner while enforcing nothing, so they are left failing and tracked in
PHASE7-19. Remediation is a pnpm 9 → 10 upgrade, which rewrites the lockfile format.

## 5. Gitleaks — 6 → 0, per-finding disposition

All six original findings were reviewed with redacted output and are non-functional:

| Finding | Disposition |
|---|---|
| `accessKey: 'AKIA1234567890'` ×3 (credential-masking / redaction tests) | Fake: 10 digits after the prefix where a real AWS key id is 16 alphanumerics. Allowlisted by exact literal. |
| test password in the password-reset test ×2 | Only ever exists in an in-memory SQLite database created and destroyed by the test. Allowlisted by exact literal. |
| `artifacts/logs/phase3-stageA.log` | The match is log prose (`credential-free: drift_ms=-21 within_5s=true`), not a secret. Allowlisted by path. |
| `sk-x` (redaction test) | Fake OpenAI-shaped value asserting the key is stripped. Allowlisted by exact literal. |

`.gitleaks.toml` **extends** the bundled ruleset (`useDefault = true`) so new rules are still picked
up, and states the policy for adding an entry: provably non-functional, narrowly scoped, reason
inline. Working tree **0**, full history (35 commits) **0**.

## 6. Production image rebuild

`quantumtrade-api:phase7-secgate`, ImageID
`sha256:ca6680e6f777e9af062b5faf6de1c305a2a8c2b97b33ad78dec80af341ae51ab`, 313 MB.

`scripts/phase6-container-validate.sh` → **17 passed / 0 failed**:

| Check | Result |
|---|---|
| Node.js 24 LTS | v24.18.0 |
| Base image digest pinned | `node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd` |
| non-root | uid/gid 10001 (`qt`) |
| read-only root filesystem | write denied; tmpfs `/tmp` writable |
| `/health`, `/health/live`, `/health/ready` | 200 |
| graceful SIGTERM | drained, exit 0, < 10 s |
| dev fixture / fixed dev credentials absent | artifact scan 0 findings (dist + container fs + layers + env) |
| source map absent | `sourcemap: false`, 0 `.map` files |
| Trivy image | **0 CRITICAL / 0 HIGH** |
| `BITMART_LIVE_TRADING_ENABLED=false` | baked in |
| `BITMART_EMERGENCY_KILL_SWITCH=true` | baked in |
| Fail-closed without a Secret ARN | `[api] FAIL-CLOSED startup: BITMART_SECRET_ARN/BITMART_SECRET_ID required in production`, exit 1 |

`.dockerignore` gained `**/.terraform` — the 692 MB provider cache was being copied into the build
context and filled the disk on the first rebuild attempt.

## 7. Seed / artifact security regression

`scripts/phase7-seed-isolation-regression.sh` → **16 checks, all PASS** (unchanged from the previous
pass, re-verified against the rebuilt image): forbidden strings 0 in `dist` and in the container
filesystem, image history/env findings 0, no source map, production + `ADMIN_SEED=true` does not seed,
`seed:dev` refused in production (exit 2 before opening a database), dev seed works and is idempotent,
fixture marker and roles present, production start-up blocked on a seeded database with
`DEV_SEED_ACCOUNT_DETECTED`, no identifier or password in the blocking log, clean database passes.

`apps/api/src/__tests__/production-artifact.test.ts` (31 tests) additionally asserts the production
import graph contains no dev seed reference — static, type-only or dynamic.

## 8. Playwright environment isolation

The previous pass produced a **false** `e2e:admin` failure: `reuseExistingServer: !process.env.CI`
adopted a manually started dev server bound to the same port and wired to a persistent database.
Closed by `tests/support/env-guard.ts` + three configs + `scripts/phase7-e2e-isolated.sh`:

| Requirement | Implementation |
|---|---|
| `reuseExistingServer=false` | Default off. Reuse is opt-in only via `PW_ALLOW_REUSE=1`, which the runner explicitly `unset`s. |
| Unique port / pre-occupancy check | Every port is overridable per suite, and the runner asserts each is **free before Playwright starts** — an occupied port is a hard failure with a message naming the port. (The check cannot live in `globalSetup`: Playwright starts `webServer` first, so by then the run owns the port itself.) |
| Temporary DB | User suite: `mkdtemp` file. Admin/MFA: `:memory:`. The guard spec asserts the path is never under `.data/`. |
| Process cleanup | `trap cleanup EXIT INT TERM` kills anything still bound to the run's ports and removes the temp database directory, including on failure. |
| Base URL validation | The guard spec fetches the base URL and requires the expected mount element — `#root` for the web app, `#admin-root` for admin — so a foreign server answering that port fails the run. |
| Server build SHA | `GIT_SHA` is injected into the API and reported by `/health/ready`; the guard spec asserts it equals this run's commit. |
| Another server answering ⇒ immediate fail | Both mechanisms above fail before any scenario runs, and the identity check additionally refuses to run against a server reporting `liveTradingEnabled=true`. |

Two genuine defects were found while building this, both previously invisible:

1. **`pnpm --filter X dev -- --port N` never reached Vite.** pnpm forwards the literal `--` and Vite
   stops parsing, silently falling back to the config port. It went unnoticed because the requested
   port happened to equal the default. Fixed by reading `VITE_DEV_PORT` in
   `apps/web/vite.config.ts` / `apps/admin/vite.config.ts`, with `strictPort: true`.
2. **`VITE_API_BASE_URL` was doing double duty.** It is a `VITE_`-prefixed variable, so it is inlined
   into the **client** bundle; using it as the dev-proxy target made the browser call the API
   cross-origin, so the `SameSite` session cookie was dropped and every authenticated request returned
   401. Fixed by introducing the server-only `DEV_API_PROXY_TARGET` for the proxy and leaving the
   client same-origin. The MFA spec's hard-coded `origin: 'http://localhost:5173'` was also replaced
   with the config's `BASE_URL`.

One Firefox-only flake was also fixed: admin `[28] offline → resume` cut the network before the lazily
imported Users chunk had finished loading, so the search input never rendered. The test now waits for
the screen to be interactive before going offline — the subject of the test is the offline state of a
**search request**, not chunk loading.

## 9. Full regression — 24 commands, all PASS

Node v24.18.0. Summary: `artifacts/logs/phase7/regression-summary.tsv`.

| # | Command | Exit | Result |
|---|---|---|---|
| 00 | `pnpm install --frozen-lockfile` | 0 | PASS |
| 01 | `pnpm lint` | 0 | PASS (0 errors, 6 pre-existing `any` warnings in the documented ADR-0002 file) |
| 02 | `pnpm typecheck` | 0 | PASS |
| 03 | `pnpm test` | 0 | PASS — **475 tests / 43 files** (was 457/41; +9 router-mode, +9 server-adapter) |
| 04 | `pnpm build` | 0 | PASS |
| 05 | `pnpm e2e` | 0 | PASS — 30 (26 + 4 env guard) |
| 06 | `pnpm test:postgres` | 0 | PASS |
| 07 | `pnpm test:integration` | 0 | PASS |
| 08 | `pnpm test:admin` | 0 | PASS |
| 09 | `pnpm e2e:admin` | 0 | PASS — 38 (34 + 4 env guard) |
| 10 | `pnpm test:security` | 0 | PASS |
| 11 | `pnpm test:gateway` | 0 | PASS — 13 |
| 12 | `pnpm e2e:gateway` | 0 | PASS — 12 |
| 13 | `pnpm test:mfa` | 0 | PASS |
| 14 | `pnpm e2e:mfa` | 0 | PASS — 18 (16 + 2 env guard) |
| 15 | `pnpm test:chaos` | 0 | PASS |
| 16 | `pnpm test:ai` | 0 | PASS |
| 17 | `pnpm eval:ai` | 0 | PASS (mock/fake provider; live-model eval NOT_EXECUTED) |
| 18 | **`pnpm audit --prod`** | **0** | **PASS — 0 critical / 0 high / 0 moderate** |
| 19 | `scripts/ci-audit-gate.sh` | 0 | PASS |
| 20 | `scripts/phase7-artifact-scan.sh` | 0 | PASS — 0 findings |
| 21 | `scripts/phase7-seed-isolation-regression.sh` | 0 | PASS — 16/16 |
| 22 | `scripts/phase7-iac-validate.sh` | 0 | PASS — fmt/init/validate/tflint/checkov/tfsec |
| 23 | container validation (`phase7-secgate`) | 0 | PASS — 17/17, Trivy 0 C / 0 H |

Isolated 3-browser matrix (`PW_ALL_BROWSERS=1 PW_WEBKIT=1 scripts/phase7-e2e-isolated.sh`), Chromium
128.0.6613.18 / Firefox 128.0 / WebKit 18.0:

| Suite | Passed |
|---|---|
| user | **90** (30 × 3) |
| admin | **114** (38 × 3) |
| MFA | **54** (18 × 3) |
| **total** | **258** |

Per-suite log and timing: `artifacts/logs/phase7/e2e-isolated-summary.tsv`.

## 10. Not Executed / Blocked (unchanged)

Stage 0 AWS gates (secrets, KMS decrypt, RDS, ElastiCache, ECR, DNS/TLS, observability, alerting) —
**BLOCKED**; `terraform plan` / `apply` — **NOT_EXECUTED**; real-device Safari and mobile browsers;
1,000-VU HTTP; 10,000 WS; managed PostgreSQL PITR drill; real PagerDuty/Slack delivery; multi-host
rolling deploy; image registry publish; BitMart Stage A; Live OpenAI + live model evaluation + live AI
E2E; Controlled Live Order — **BLOCKED, no owner authorization**. Live trading remains disabled.
