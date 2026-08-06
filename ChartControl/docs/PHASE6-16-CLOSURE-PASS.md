# PHASE 6-16 — Closure Pass (FIX REQUIRED → resolved)

Branch `phase-6-production-hardening` (from `6ce4fd3` = `phase-5-approved-v0.5.0`). RC target
`phase-6-rc-v0.6.1`. Prior tags (incl. `phase-6-rc-v0.6.0`) NOT moved. All 5 mandatory closure items
completed; environment-bound live gates remain honestly Not Executed.

## Baseline correction
`phase-5-approved-v0.5.0` now exists → `6ce4fd3` (annotated). Phase 6 started from the same `6ce4fd3`, so
the code baseline is shared/valid. PHASE6-00 updated; the Phase 5 approval record is integrated in
FINAL-REPORT alongside the Phase 6 content.

## Mandatory items
| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Dependency security | **Production audit 0 critical / 0 high** (was 2C/12H) | hono 4.6.3→4.12.32, @hono/node-server 1.13.1→1.19.17, override @remix-run/router ≥1.23.2, ws→8.21.0; CI gate `scripts/ci-audit-gate.sh` PASS; dev exceptions documented (PHASE6-17) |
| 2 | WebKit E2E | **Chromium 10 / Firefox 10 / WebKit 10** (was WebKit 8/10) | root cause = grid-column collapse clipping the submit button; fixed with order-confirmation modal overlay (PHASE6-08); no test skipped |
| 3 | Gateway server | Real `apps/market-gateway` server; **E2E 12**, WS load 100+1,000 conns | health/ready, auth, origin, sub-limit, symbol/tf validation, dedup+refcount, cache, gap-fill, orderbook resync, Redis pub/sub, back-pressure, circuit breaker, metrics, graceful shutdown; modes MOCK_REPLAY/BITMART_PUBLIC/INTERNAL_GATEWAY (PHASE6-01, PHASE6-18) |
| 4 | MFA full | **API 16 + UI + E2E 16 (18 scenarios)** | setup/verify/challenge/recovery/disable/regenerate/status/step-up; encrypted secret, hashed recovery, replay guard, lockout, session rotation, isolation (PHASE6-03, PHASE6-19) |
| 5 | Docker | **Node 24 LTS; built + run + validated + SBOM + scanned (0 C/0 H)** | `quantumtrade-api:phase6-closure` (**node:24-alpine, v24.18.0, 69.8 MB**); non-root uid 10001, PID 1 node, health/ready/live 200, graceful SIGTERM (0.12s), read-only rootfs + tmpfs, prod-deps-only, no bundled npm, no secrets, prod fail-closed, LIVE=false, KILL_SWITCH=true; **Trivy 0.72.0 SBOM (CycloneDX+SPDX) + vuln scan = 0 CRITICAL / 0 HIGH**; 17/17 validation; better-sqlite3 recompiled + DB-tested on Node24/musl (PHASE6-20) |

## Full regression (18 commands, `scripts/phase6-verify.sh` → `artifacts/logs/phase6-*.log`)
All exit 0: install · lint · typecheck · test (390) · build · e2e (10) · test:postgres (12 real PG17) ·
test:integration (33) · test:admin (30) · e2e:admin (31) · test:security (23) · test:gateway (13) ·
e2e:gateway (12) · test:mfa (36 = lib 20 + api 16) · e2e:mfa (16/18) · test:chaos (11) · test:load
(HTTP baseline p95 ≈ 6.7ms) · `pnpm audit --prod` + CI gate (0 critical / 0 high).

## Honestly Not Executed (unchanged live/infra gates)
BitMart Private Stage A, Controlled Live Order, Live OpenAI / model-eval / Live AI E2E, real-device
Safari, managed PostgreSQL PITR, real PagerDuty/Slack, real multi-host rolling deploy, 10,000 WS,
1,000 VU HTTP, external SAST/secret/OSV scanners (semgrep/gitleaks/osv-scanner), BitMart Public WS 30-min soak.
None are marked Passed. (Container SBOM + vulnerability scan are now EXECUTED via Trivy 0.72.0 = 0 C/0 H — see PHASE6-20.)

## Closure update (RC v0.6.2) — Docker SBOM + Container Vulnerability Scan

The last remaining closure sub-item (container SBOM + vulnerability scan) is now **executed** end-to-end:

- Scanner **Trivy 0.72.0** installed; image `quantumtrade-api:phase6-closure` built reproducibly from
  `infrastructure/docker/Dockerfile.api`.
- SBOM generated in **CycloneDX + SPDX JSON** (OS apk packages + application node packages) →
  `artifacts/security/phase6-container-sbom.{cdx,spdx}.json`.
- Container vulnerability scan (OS + library) → raw JSON `artifacts/security/phase6-container-scan.json`
  + human log `artifacts/logs/phase6-container-scan.log`; CI gate `--severity CRITICAL,HIGH --exit-code 1`
  → **PASS**.
- Initial bookworm-slim build scanned at **8 CRITICAL / 36 HIGH**; remediated by base-image change to
  `node:20-alpine` + `apk upgrade` + removal of the bundled npm/npx/corepack + musl-matched proddeps →
  **0 CRITICAL / 0 HIGH (0 across all severities)**. No exception required.
- Docker hardening re-verified: `scripts/phase6-container-validate.sh` → **17/17 pass**
  (non-root 10001, PID 1 node, read-only rootfs + tmpfs, health/ready/live 200, graceful SIGTERM 0.12s,
  prod-deps-only, no npm, no secrets, LIVE=false, KILL_SWITCH=true, fail-closed).
- Only the Dockerfile, the new validation script, and docs changed — no application source or
  dependencies — but the full 18-command regression was re-run at the closure tree: **all exit 0**.

Details in **PHASE6-20**. Still Not Executed (unchanged): SAST/secret/OSV scanners, and all live/infra
gates (BitMart Stage A, Controlled Live Order, Live OpenAI, 1,000 VU, 10,000 WS, managed PITR, multi-host
rolling deploy). Live trading stays disabled.

## Closure update (RC v0.6.3) — Node.js 20 EOL → Node.js 24 LTS migration

Node.js 20 reached **End-of-Life on 2026-03-24**. A container that scans 0/0 is still not eligible as a
production runtime on an EOL major, so the runtime was migrated to Node.js 24 LTS.

- **Docker**: all three stages (builder, proddeps, runtime) → `node:24-alpine`, pinned by base digest
  `node@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd`. Node major + musl ABI
  aligned across stages. Image id `sha256:772911dabc36…d326f9ea` (69.8 MB).
- **Verified runtime**: `node --version` = **v24.18.0** (Active LTS, EOL 2028-04-30), ABI modules 137,
  OpenSSL 3.5.7, Alpine 3.24.1, `NODE_VERSION=24.18.0` baked, **0 EOL runtimes**.
- **Native module**: `better-sqlite3` recompiled for Node 24/musl; real DB open/write/read/ALTER-migration
  + `user_version` test passes (sqlite 3.49.2).
- **Toolchain aligned**: `package.json` engines `>=24.0.0`; CI `.github/workflows/ci.yml` node 24.18.0,
  `phase6-ci.yml` node 24; `apps/api/tsup.config.ts` + `apps/market-gateway` build target `node24`;
  `scripts/phase6-container-validate.sh` base ref `node:24-alpine`.
- **Docker validation 17/17** (PID-1 check updated: Node 24 names the main thread `MainThread`, so PID 1 =
  node is verified via `/proc/1/exe` = `/usr/local/bin/node` + cmdline; SIGTERM still delivered, exit 0).
- **SBOM + scan on the Node-24 image**: CycloneDX SHA-256 `249a4f58…08ed`, SPDX SHA-256 `ed4bfa30…d0ca`,
  scan JSON SHA-256 `967054f3…69ec9` → **0 CRITICAL / 0 HIGH (0 all severities)**, CI gate PASS.
- **Full regression** re-run on Node 24: all 18 commands exit 0.
- Prior tags (`phase-6-rc-v0.6.2`/`v0.6.1`/`v0.6.0` and earlier) NOT moved. Live trading stays disabled.

## Closure update (RC v0.6.4) — Final UI/Chart Hotfix

This pass exists because the closure recorded above declared the UI and chart PASS while the running
application showed a collapsed layout and an empty chart. The earlier results are not deleted; the
limits of what they measured are now stated (PHASE6-08, PHASE6-12, PHASE6-13).

### Scope (defect fixes only — no new features)
| File | Change |
|---|---|
| `apps/web/src/app.css` | Explicit `.app-shell { grid-template-columns: 1fr }` and `.trade-body { display: block; grid-template-columns: none; grid-auto-rows: auto; overflow: auto }`, neutralizing the verbatim handoff stylesheet's sidebar-shell assumptions. Handoff CSS untouched. |
| `apps/web/src/chart/klineModule.ts` | Rewritten v10-only: `setDataLoader({ getBars, subscribeBar, unsubscribeBar })`, load via `setSymbol` + `setPeriod`, `resetData()` for same-market reload, `removeIndicator({ paneId })`, precision derived from data, `toPeriod`/`decimalsOf` exported. Contract assertion throws `ChartEngineContractError` on a missing v10 API or a present v9 API. |
| `packages/chart-adapter/src/klinechart-adapter.ts` | Façade renamed off the v9 vocabulary (`setMarket`/`setBars`/`pushBar`/`getBarCount`); `isValidBar` + `normalizeBars` (validate, sort, de-duplicate); observable `ChartStatus` incl. `engineBarCount`; `onStatus` listeners; `loadSeq` stale-load guard; post-dispose callback blocking. |
| `apps/web/src/chart/ChartWidget.tsx` | Subscribes to `onStatus`; mirrors load state onto the mount as `data-chart-state` / `data-bar-count` / `data-engine-bar-count` / `data-rejected-count` / `data-duplicate-count` / `data-first-timestamp` / `data-last-timestamp` / `data-symbol` / `data-period`; renders empty and error states. |
| `apps/admin/src/screens/Overview.tsx`, `AiOps.tsx` | `key` moved from the inner `<dt>` to `<Fragment key={k}>`. |
| `packages/chart-adapter/src/__tests__/adapter.test.ts` | 5 → **38** tests. |
| `apps/web/src/__tests__/layout-css.test.ts`, `chart-widget.test.tsx` | New (9 + 6). |
| `tests/e2e/flow-l-layout-geometry.spec.ts`, `flow-m-chart-render.spec.ts`, `tests/e2e-admin/admin-console.spec.ts` | New (8 + 8 + 3). |
| `scripts/phase6-hotfix-regression.sh`, `scripts/phase6-hotfix-regression-extra.sh` | Regression runners recording command / timestamps / duration / exit code / result / log path. |

`quantumtrade-ai-phase-6-rc-v0.6.1.zip{,.sha256}` were **moved out of the working tree** to
`/home/test1/releases/` after `sha256sum -c` verification (verified again after the move). No
`git clean -fd` was used; the two files were handled individually.

### Verification (all measured this pass, Node v24.18.0)
- Unit: workspace **426** tests / 40 files; chart-adapter **38**; apps/web **24**.
- E2E: `pnpm e2e` **26**, `pnpm e2e:admin` **34**.
- Browser matrix: **User 78 (26×3)**, **Admin 102 (34×3)** — Chromium 128.0.6613.18 / Firefox 128.0 /
  WebKit 18.0, all PASS, nothing skipped.
- Regression: 26 commands, **25 PASS**; `pnpm audit --prod` recorded **FAIL (exit 1)** for 5 moderate
  advisories identical to the Phase 6 baseline, while the release gate `scripts/ci-audit-gate.sh`
  (0 critical AND 0 high) **PASSES**. Container validation 17/17, Trivy 0 CRITICAL / 0 HIGH.
  Summary: `artifacts/logs/phase6-hotfix/regression-summary.tsv`.
- Each new guard was proven to catch its defect by re-introducing the defect (`flow-l` 7/8 fail,
  `flow-m` 5/8 fail, `admin-console` 2/3 fail) and then reverting the file byte-identically.

### Explicitly NOT done
- `phase-6-approved-v0.6.0` **not created** — approval is the owner's decision.
- `phase-7-production-launch` **not created**; Phase 7 **not started**.
- Live trading **not enabled** (`BITMART_LIVE_TRADING_ENABLED=false`,
  `BITMART_EMERGENCY_KILL_SWITCH=true`).
- No existing tag moved, deleted or recreated.
- Dependency major upgrades (react-router 7.x, @hono/node-server 2.x) not performed — out of scope,
  tracked in PHASE6-13.
