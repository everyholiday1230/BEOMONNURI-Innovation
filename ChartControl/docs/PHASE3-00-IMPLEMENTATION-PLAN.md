# PHASE 3 — Implementation Plan (BitMart Production Trading)

Additive on `phase-2-approved-v0.2.0` (@0a16ca3), branch `phase-3-bitmart-live`. No rewrite; Phase 1/2
features + tests preserved. Real BitMart Production API is targeted, but **Controlled Live Order is
Not Executed** (no owner-provided real credentials/authorization — see PHASE3-07).

## Modes (strict separation, server-enforced)
- `BITMART_LIVE_READ_ONLY` (default) — connect/verify, assets/positions/orders read; NO mutation.
- `BITMART_LIVE_SHADOW` — build/validate/sign-ready orders + risk check; NEVER transmit.
- `BITMART_LIVE_TRADE` — real orders; DISABLED by default; gated by `evaluateLiveTradingGate` (all of:
  `BITMART_LIVE_TRADING_ENABLED=true`, kill switch off, credential VERIFIED, Future-Trade verified,
  user active, risk pass, preview not expired, confirmation token, idempotency, fresh data, healthy
  connectivity, allowed symbol). A UI toggle can never bypass the server gate.

## Components (files)
- `packages/exchange-bitmart` — signature (HMAC-SHA256 + X-BM-*), modes/gate, normalize, Futures REST
  adapter (injectable fetch; timeout→SUBMIT_UNKNOWN), private-WS mock + event dedup, interfaces.
- `packages/domain/live-order-machine.ts` — 17-state machine (incl SUBMIT_UNKNOWN/RECONCILING/INCONSISTENT).
- `apps/api/src/trading/*` — credential-vault (envelope enc), risk-engine (server), idempotency,
  live-order-service (orchestration + reconcile).
- `apps/api/src/db/*` — migration 0003 (+PG), trading repos.
- `apps/api/src/trading-routes.ts` — credentials/connection-status/orders submit(shadow) with
  auth/CSRF/RBAC/idempotency; mounted additively (live disabled + kill switch on by default).

## Verification
Unit + integration (mock BitMart HTTP + WS) + real PostgreSQL migration/constraints. Six commands +
postgres run. Real Production Read-Only and Controlled Live Order = Not Executed (no credentials).
