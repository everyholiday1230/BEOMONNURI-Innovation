# PHASE 6-15 — Mock / Real / Not-Executed Matrix

| Capability | Mode | Evidence |
|---|---|---|
| Market-data gateway core logic | **Real (unit)** | market-gateway 13 tests |
| BitMart live upstream REST/WS | **Not Executed** | no live connection (rate-limit safety) |
| Multinode shared state / pub-sub | **Real (Redis 16379)** | cluster 10 tests, ~1ms propagation |
| Multi-host cluster / rolling deploy | **Not Executed / Documented** | single-host env |
| MFA TOTP / recovery / step-up | **Real (unit)** | mfa 20 tests |
| MFA live enrol/challenge via UI/API | **Not Executed** | not wired (gate) |
| Security headers + OWASP guards | **Real (unit)** | security 9 + admin-api 14 |
| Dependency audit | **Real** (`pnpm audit`) | 59 findings; phase6-dep-audit.log |
| Container SBOM + vulnerability scan (Trivy) | **Real / Executed** | Trivy 0.72.0 → 0 C/0 H (PHASE6-20) |
| SAST/secret/OSV scanners (semgrep/gitleaks/osv-scanner) | **Not Executed** | binaries absent |
| Observability logger/tracer/metrics/alerts | **Real (unit)** | observability 10 tests |
| Live OTel collector / Prometheus / Grafana | **Not Executed** | no collector |
| Alert delivery (PagerDuty/Slack) | **Mock only** | MockNotifier; adapter ready |
| PostgreSQL migrations | **Real PG17** | test:postgres 12 |
| Backup/restore drill (integrity + RTO) | **Real (local PG17)** | phase6-backup-restore.log (PASS, 136ms) |
| Managed PITR | **Not Executed** | no managed PG |
| Browser E2E Chromium | **Real** | user 10 / admin 31 |
| Browser E2E Firefox | **Real** | user 10 / admin 31 |
| Browser E2E WebKit | **Real (partial)** | admin 31 / user 8 (2 fail) |
| Real-device Safari | **Not Executed** | WebKit engine proxy only |
| HTTP load (smoke/baseline) | **Real (k6)** | 100 VUs, 325k reqs, p95≈8.4ms |
| HTTP high (1,000) / 10k WebSocket | **Not Executed** | bounded env / gateway not wired |
| Chaos (mock/proxy faults) | **Real (unit)** | chaos 11 tests |
| Real infra chaos (DNS/KMS/disk/partition) | **Not Executed** | no prod-like harness |
| Deployment Dockerfile + health + shutdown | **Real (validated locally)** | health probes + graceful shutdown |
| Container build/publish + orchestrator deploy | **Not Executed** | no registry/orchestrator |
| BitMart Stage A / Controlled Live Order | **Not Executed** | no AWS creds/authorization |
| Live OpenAI / model-eval / AI-E2E | **Not Executed** | no OpenAI key |
| Live trading enablement | **Disabled by default** | LIVE=false, KILL_SWITCH=true (never enabled) |

## Closure update (RC v0.6.1)
| Capability | Mode |
|---|---|
| Gateway server (health/auth/dedup/cache/resync/pubsub/backpressure/breaker/metrics/shutdown) | **Real** (apps/market-gateway; E2E 12) |
| Internal WS load 100 / 1,000 conns | **Real (k6 ws)** — 10,000 Not Executed |
| MFA API + UI + E2E | **Real** (API 16 + browser 18 scenarios) |
| Browser E2E WebKit (user) | **Real 10/10** (was 8/10) |
| Production dependency audit | **Real** — 0 critical / 0 high + CI gate |
| Docker image build + run | **Real** — built, non-root, health, SIGTERM, read-only, prod-only |
| Container vulnerability scan (Trivy 0.72.0) | **Real / Executed** — 0 Critical / 0 High (PHASE6-20) |
| BitMart Public REST | **Real** (HTTP 200); public WS soak Not Executed |
