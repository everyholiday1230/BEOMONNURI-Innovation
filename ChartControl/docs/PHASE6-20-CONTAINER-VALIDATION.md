# PHASE 6-20 — Container Validation + SBOM + Vulnerability Scan (Closure Pass)

Real build + run + inspection + **executed SBOM and container vulnerability scan** (not "Dockerfile
exists"). Closure image: `quantumtrade-api:phase6-closure`.
- Validation log: `artifacts/logs/phase6-container-validation.log` (17/17 checks pass)
- Scan (human): `artifacts/logs/phase6-container-scan.log`
- Scan (raw JSON): `artifacts/security/phase6-container-scan.json`
- SBOM (CycloneDX): `artifacts/security/phase6-container-sbom.cdx.json`
- SBOM (SPDX): `artifacts/security/phase6-container-sbom.spdx.json`
- Validation/gate script: `scripts/phase6-container-validate.sh`

## Node.js 20 EOL finding → Node.js 24 LTS (v0.6.3)
Node.js 20 reached **End-of-Life on 2026-03-24**. Even a 0/0 vulnerability scan does not make an EOL
major eligible as a production runtime, so all three image stages were migrated to **`node:24-alpine`**
(Node major + musl ABI aligned across builder/proddeps/runtime), pinned by base digest.

## Image / base
| Field | Value |
|---|---|
| Image | `quantumtrade-api:phase6-closure` |
| Image ID | `sha256:772911dabc36ee2216ba1eec7f880f762a48d9092f55d4853b60d274d326f9ea` |
| Size | **69.8 MB** |
| Base image | `node:24-alpine` |
| Base digest | `node@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd` |
| Node runtime | **v24.18.0** (Active LTS, EOL 2028-04-30) · ABI modules 137 · OpenSSL 3.5.7 |
| OS | Alpine 3.24.1 |
| EOL runtimes | **0** (only Node 24 present) |

## Build (reproducible)
`docker build -f infrastructure/docker/Dockerfile.api -t quantumtrade-api:phase6-closure .` → **SUCCESS**.
Multi-stage on a shared `node:24-alpine` base: builder bundles the API with tsup (workspace + pure-JS deps
inlined → `dist/index.js`); proddeps compiles ONLY the native/SDK production deps (better-sqlite3, pg,
openai, @aws-sdk/client-secrets-manager) **against the Node 24 / musl runtime ABI**, with compilers
discarded; the runtime carries no build tools and no bundled npm/npx/corepack.

## Native module (better-sqlite3) on Node 24 + musl
Recompiled for Node 24 (ABI 137) and verified with a real DB test inside the image: open, CREATE TABLE,
INSERT, SELECT, `ALTER TABLE ADD COLUMN` migration + `user_version` bump — all pass (sqlite 3.49.2).

## Run + inspect (17/17 verified — `phase6-container-validate.sh`)
| Check | Result |
|---|---|
| Non-root UID 10001 | `id` → uid=10001(qt) gid=10001(qt) |
| PID 1 | `/proc/1/exe` → `/usr/local/bin/node`, cmdline `node dist/index.js` (Node 24 names the main thread `MainThread`, so `/proc/1/comm` is no longer used; SIGTERM is delivered to the app) |
| Health / Liveness / Readiness | `/health`, `/health/live`, `/health/ready` → **200**; `liveTradingEnabled=false` |
| Production fail-closed | NODE_ENV=production **without** BITMART_SECRET_ARN → exit 1 (refuses to start) |
| Graceful SIGTERM | `docker stop` returned in **0.12 s**, exit code 0 (drained, not force-killed) |
| Read-only root filesystem | `--read-only` → write to `/` denied; container healthy |
| Writable tmpfs (limited) | `--tmpfs /tmp:rw,noexec,nosuid,size=16m` → `/tmp` writable, rest read-only |
| Production dependencies only | vitest / tsx / eslint / typescript / @playwright / tsup **absent** |
| No bundled npm | `npm` / `npx` / `corepack` removed from the runtime |
| Secrets | no `.env` baked; no secret markers in image env/history; secrets via runtime env / Secret ARN only |
| LIVE flag | `BITMART_LIVE_TRADING_ENABLED=false` baked in image |
| Kill switch | `BITMART_EMERGENCY_KILL_SWITCH=true` baked in image |
| Hardening runtime | `--cap-drop ALL --security-opt no-new-privileges` applied during validation |

## SBOM (executed)
Generated with Trivy 0.72.0, covering **OS packages (apk) + application language packages (node-pkg)**:
- CycloneDX: `artifacts/security/phase6-container-sbom.cdx.json`. SHA-256
  `249a4f58c23444e42a985f7ba0ac4e41a3ced7e8bcb076534f1ec43cdd7e08ed`.
- SPDX JSON: `artifacts/security/phase6-container-sbom.spdx.json`. SHA-256
  `ed4bfa3082400a26ff7cef43520205f59fa079639328444ad5853e2153f5d0ca`.

## Container vulnerability scan (executed)
| Field | Value |
|---|---|
| Scanner | **Trivy 0.72.0** (`trivy image --scanners vuln`) |
| Classes | OS packages (apk) + application language packages (node-pkg) |
| CRITICAL | **0** |
| HIGH | **0** |
| MEDIUM | 0 |
| LOW | 0 |
| UNKNOWN | 0 |
| CI gate | `trivy image --severity CRITICAL,HIGH --exit-code 1` → **PASS (rc=0)** |

Raw JSON `artifacts/security/phase6-container-scan.json`
(SHA-256 `967054f3b14a223df81a6143342d09cebcdd8bdf17f6b27d64a265c269369ec9`); human-readable
`artifacts/logs/phase6-container-scan.log`.

## Remediation record (Critical/High → 0)
The initial build on `node:20-bookworm-slim` scanned at **8 CRITICAL / 36 HIGH**:
- Unfixed Debian criticals: `perl-base` (CVE-2026-13221/42496/57433/8376), `zlib1g` (CVE-2023-45853);
  Debian highs across `util-linux`/`libmount1`/`libuuid1`/`ncurses`/`libtinfo6` (no fix in bookworm).
- Fixable Debian: `libgnutls30` (2C/3H → 3.7.9-2+deb12u7), `libcap2` (→ 1:2.66-4+deb12u3).
- node-pkg CVEs from the base image's **bundled npm**: `tar`/node-tar (CVE-2026-59873 CRITICAL) + glob,
  minimatch, cross-spawn, brace-expansion, sigstore (HIGH).

Applied remediations (in the sanctioned order):
1. **Base image change** `node:20-bookworm-slim` → `node:20-alpine` (Alpine 3.23.4) — removes perl,
   util-linux, tar, and the Debian unfixed-CVE surface entirely.
2. **OS package upgrade** `apk upgrade --no-cache` in the runtime stage — patches openssl
   `libcrypto3`/`libssl3` (the only two Alpine highs) to the fixed release.
3. **Remove unneeded packages** `rm -rf` the bundled `npm`/`npx`/`corepack` from the runtime — the app
   only runs `node dist/index.js`, eliminating the node-tar CRITICAL and all other npm-shipped CVEs.
4. **Multi-stage** proddeps moved onto the same Alpine/musl base so the compiled `better-sqlite3` addon
   is ABI-compatible while compilers stay out of the runtime.

**v0.6.3 Node-24 migration:** the base was moved again from `node:20-alpine` (EOL major) to
`node:24-alpine` (v24.18.0, Alpine 3.24.1). The base's bundled npm carried a fresh set of node-pkg CVEs
(node-tar CVE-2026-59873 CRITICAL + brace-expansion/undici HIGH); the same `apk upgrade` + npm/npx/
corepack removal drives the Node-24 image to **0 CRITICAL / 0 HIGH (0 across all severities)**.

Rebuilt + rescanned → **0 CRITICAL / 0 HIGH / 0 across all severities**. No exceptions were required.

## Scanners still Not Executed (unchanged)
SAST (semgrep), secret scan (gitleaks), and OSV (osv-scanner) remain **Not Executed** (binaries absent) —
these are separate Production Release Gate items and are not marked Passed.
