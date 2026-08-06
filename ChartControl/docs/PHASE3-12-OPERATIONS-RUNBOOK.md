# PHASE 3 — Operations Runbook

## Enabling modes (safe order)
1. Deploy with `BITMART_MODE=BITMART_LIVE_READ_ONLY`, `BITMART_LIVE_TRADING_ENABLED=false`,
   `BITMART_EMERGENCY_KILL_SWITCH=true` (defaults). Verify credentials + read-only data.
2. Move to `BITMART_LIVE_SHADOW` to validate order build + risk + preview (no transmit).
3. Controlled Live (owner-authorized only): set `BITMART_LIVE_TRADING_ENABLED=true`, kill switch
   off, BTCUSDT only, min qty, min leverage, isolated margin, explicit user confirmation. Immediately
   query order status + reconcile after each order.

## Credentials
- API key perms: Read-Only + Future-Trade only; NO Withdraw/Margin/Finance. Set BitMart IP whitelist +
  fixed egress IP. Store `BITMART_DEV_KEK` (dev) / managed KMS (prod). Rotate via `CredentialVault.rotate`.

## Kill switch
- Env `BITMART_EMERGENCY_KILL_SWITCH=true` blocks all live orders immediately. Admin table
  `trading_kill_switches` supports scope: global/user/credential/symbol; allow cancel+reduce-only.

## Reconciliation
- Runs on login, server start, WS reconnect, order timeout, periodic, manual. Inspect
  `reconciliation_runs`; INCONSISTENT orders require manual review.

## Health
- `GET /api/trading/connection-status` → mode, live flag, kill switch, credential statuses.
