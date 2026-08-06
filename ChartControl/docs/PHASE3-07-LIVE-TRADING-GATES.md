# PHASE 3 — Live Trading Gates

Real orders require ALL (server-enforced, `evaluateLiveTradingGate`):
`BITMART_LIVE_TRADING_ENABLED=true`, `BITMART_EMERGENCY_KILL_SWITCH=false`, credential VERIFIED,
Future-Trade permission verified, user ACTIVE, server risk PASS, preview not expired, confirmation
token valid, idempotency key valid, market data fresh, connectivity healthy, symbol allowed
(BTCUSDT initially). Per-policy caps: notional, leverage, open positions, daily order/loss, price
deviation — from policy table/config, not hardcoded.

Default deployment: mode READ_ONLY, `BITMART_LIVE_TRADING_ENABLED=false`, kill switch ON → NO order
is ever transmitted. Admin kill switch (`trading_kill_switches`): block all/new orders, per user,
per credential, per symbol; allow cancel/reduce-only; all actions audited.

**Controlled Live Order: Not Executed. Reason: explicit owner authorization and real safe
credentials not provided.** Live trading activation is NOT approved.

## Live Validation (§5/§6) — server-side blocking proof (no real order sent)
- **Shadow (default deployment) proven to never transmit**: with `BITMART_MODE=BITMART_LIVE_READ_ONLY`,
  `LIVE_TRADING_ENABLED=false`, `KILL_SWITCH=true`, `POST /api/trading/orders/submit` returns
  `transmitted:false`, `liveGateAllowed:false` and the adapter makes **0 network submit calls**
  (`trading-routes.test.ts`, `trading-integration.test.ts` shadow case).
- **Gate blocks even in TRADE mode** when kill switch on or flag off, even if risk PASSes
  (`trading-core.test.ts`: "kill switch / flag-off blocks live gate even when risk passes").
- Real-account Shadow numbers (live balance/margin/fee/liquidation/metadata for a real BTCUSDT draft):
  **Not Executed** (no credential). The draft→risk→preview→idempotency pipeline is exercised with
  deterministic symbol metadata instead.
- **§6 Controlled Live Order: Not Executed. Reason: Explicit owner authorization not provided.**
  Readiness checklist (allowed symbol BTCUSDT, owner-approved max notional/leverage, isolated margin,
  min qty, max-loss display, SL/TP, LIVE flag + kill-switch dual control, client_order_id + idempotency
  key, post-submit order query, private-WS fill confirm, REST reconcile, emergency cancel/reduce-only)
  is implemented + tested at the gate/adapter level; execution awaits explicit owner authorization
  AND real safe credentials.
