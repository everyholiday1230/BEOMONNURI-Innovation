# PHASE 3 — Private WebSocket & Reconciliation

- Private WS role: order/execution/position/balance events. `MockPrivateStreamAdapter` + real adapter
  interface (`IExchangePrivateStreamAdapter`). Real connection = Not Executed (needs credentials).
- `PrivateEventDedup`: dedup by event id + per-key sequence high-water mark → duplicates and
  out-of-order/stale events dropped (never overwrite newer state).
- REST role: initial snapshot, gap fill on reconnect, SUBMIT_UNKNOWN query, periodic reconciliation.
- `LiveOrderService.reconcile`: SUBMIT_UNKNOWN/INCONSISTENT → RECONCILING → `getOrderByClientId` →
  resolve to real state (FILLED/OPEN/…); if absent → REJECTED (safe); ambiguous → INCONSISTENT (surfaced).
- Reconciliation triggers: login, server start, WS reconnect, order timeout, periodic, manual admin,
  mismatch detected. `reconciliation_runs` table records outcomes.
- Tested (trading-integration.test.ts): timeout→unknown→reconcile→FILLED / not-found→REJECTED,
  partial fill + dedup + out-of-order, cancel/fill race.

## Live Validation (§4) — long-running Private WebSocket
- **30-minute Production Private WS soak: Not Executed.** Reason: no real BitMart credential injected
  (private WS requires `X-BM-KEY` + signed auth login). Cannot authenticate → cannot hold a live session.
- **2-hour soak: Not Executed** (same reason).
- Production private WS URL: `wss://openapi-ws-v2.bitmart.com/user?protocol=1.1`. **`BITMART_WS_PRIVATE`
  is now wired** into `env.ts` and into `BitMartPrivateStreamAdapter`, which validates the URL against
  the production allowlist at construction (`assertProductionWsUrl`): demo (`wsdemo`/`demo-`), non-`wss`,
  and non-official hosts are **rejected fail-closed** before any connect (tested: `ws-config.test.ts`).
- What IS verified offline (deterministic): dedup + out-of-order drop, reconnect/backoff+jitter policy
  (`rate-limit.ts`), REST gap-fill/reconcile logic, graceful-shutdown cleanup semantics (mock adapter),
  and that auth payloads are never logged (redaction). Live auth-hold / heartbeat / real reconnect /
  memory-leak-over-time / listener-growth checks require credentials → **Not Executed**.
