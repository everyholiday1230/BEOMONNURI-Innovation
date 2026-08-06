# PHASE 6-11 — Deployment & Rollback

Status: **Documented / Validated-locally** · **Production deployed = No**.

## Container image
`infrastructure/docker/Dockerfile.api` — multi-stage, **non-root** (`uid/gid 10001`), read-only-rootfs
friendly, `STOPSIGNAL SIGTERM`, `HEALTHCHECK` against `/health/ready`. Secrets are **runtime env / Secret
ARN references** (never baked in). Defaults keep `BITMART_LIVE_TRADING_ENABLED=false`,
`BITMART_EMERGENCY_KILL_SWITCH=true`.

## Health endpoints (implemented + validated locally)
- `GET /health` — basic liveness/uptime.
- `GET /health/live` — **liveness** (process up; touches no dependency).
- `GET /health/ready` — **readiness** (version + dataMode/tradingMode + liveTradingEnabled=false).
- `GET /ready` — legacy readiness (retained).
Validated locally (all return `ok`; `liveTradingEnabled=false`).

## Graceful shutdown (implemented)
`SIGTERM`/`SIGINT` → stop accepting connections, drain in-flight (10s cap), then exit — supports
rolling/blue-green deploys. Kill switch stays fail-closed for live trading throughout.

## Operational controls (documented)
Environment validation (`loadEnv` safe-defaults + production fail-closed credential guard),
migration job (existing `0001..0005` up/down; PHASE6-07 replay), Blue/Green or Rolling with the readiness
gate, rollback = redeploy previous immutable image + backward-compatible DB schema, feature flags for
progressive enablement, Version/Git SHA surfaced in `/health/ready` + logs, artifact checksum (release
ZIP SHA-256), **SBOM executed** (Trivy 0.72.0 CycloneDX + SPDX; `artifacts/security/`), IaC (documented; no live provisioning), secret ARN
references, logs/metrics/traces (PHASE6-05).

## Not Executed
Image publish to a registry, real orchestrator deploy (k8s/ECS), blue-green cutover, and live rollback
drill → **Not Executed** (no container registry/orchestrator in this environment). The Dockerfile +
health/shutdown are built, run and validated locally (see PHASE6-20); orchestrator wiring is documented only.

## Closure update (RC v0.6.2)
The image is now actually BUILT, RUN, SBOM'd and SCANNED (not documented-only):
`quantumtrade-api:phase6-closure` (**node:24-alpine, Node v24.18.0, 69.8 MB**, non-root uid 10001, PID 1 = node,
health/ready/live 200, graceful SIGTERM 0.12s, read-only rootfs + tmpfs, prod-deps-only, no bundled npm,
prod fail-closed, LIVE=false, KILL_SWITCH=true). **Container vulnerability scan EXECUTED** (Trivy 0.72.0
→ **0 CRITICAL / 0 HIGH**, 0 across all severities) + SBOM (CycloneDX + SPDX). A CI workflow
(`.github/workflows/phase6-ci.yml`) runs build + prod-audit gate + Trivy. See PHASE6-20. Orchestrator
deploy/rollback stays Not Executed (no cluster).
