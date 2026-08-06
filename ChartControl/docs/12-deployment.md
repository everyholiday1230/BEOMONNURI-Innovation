# 12 — Deployment Strategy & CI/CD

## Environments
- **local**: `pnpm dev:api` + `pnpm dev:web`, `DATA_MODE=MOCK_REPLAY`, `TRADING_MODE=MOCK`.
- **preview**: built web (`apps/web` → static) on Cloudflare Pages; BFF on Workers or a Node host;
  `DATA_MODE=BITMART_PUBLIC` allowed. Live orders remain disabled.
- **production (future)**: split services onto always-on compute (AWS ECS/Fargate/EKS) for
  market-data ingestion, trading, risk, AI orchestrator; Cloudflare for CDN/WAF/edge BFF;
  PostgreSQL + Redis + queue + object storage.

## Why not everything on one Worker
Stateful long-lived BitMart WS connections, the order engine, and AI jobs must **not** live in a
single edge Worker/Pages function. They are separated so they can run as persistent, independently
scalable services. Phase 1 keeps them as modules with clean interfaces to enable that split later.

## Scaling principles (design)
Stateless HTTP API, shared Redis, PG connection pooling, ingestion separated from fan-out,
partition by symbol/channel, no global in-memory source of truth, idempotent consumers, bounded
queues, backpressure, circuit breakers, bulkheads, graceful degradation + shutdown,
health/readiness probes, rolling deploys, retry budget, DLQ, load shedding.

## CI/CD quality gates (must pass before merge to main)
`format` → `lint` → `typecheck` → `unit test` → `integration test` → `build` → `E2E smoke`
→ `dependency audit` → `secret scan` → `license check`.
Main branch protection: no merge may bypass typecheck + tests. (Documented policy; wire to your
CI provider. A sample GitHub Actions matrix is described in `13-risks-assumptions.md` assumptions.)
