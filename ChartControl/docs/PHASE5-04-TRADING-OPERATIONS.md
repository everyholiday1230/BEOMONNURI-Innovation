# PHASE 5 — Trading Operations Monitoring (READ-ONLY)

Operators can view (read-only): order status + state history, client/exchange order IDs, correlation
ID, idempotency status, risk-check results, fills/partial fills, positions, REST/WS consistency,
reconciliation status, SUBMIT_UNKNOWN, INCONSISTENT, stale status, exchange error codes.

**Not provided (by design):** admin submitting a new order for a user, changing order price/quantity,
changing leverage, changing position mode, withdrawal/transfer, or closing a position without user
consent. Endpoints `/api/admin/orders` and `/api/admin/positions` are strictly read-only.

Emergency Cancel / Reduce-only is **Documented / Disabled** in Phase 5 — not implemented without a
separate security approval (per spec §6). `LIVE_TRADING_ENABLED=false` and `EMERGENCY_KILL_SWITCH=true`
defaults are preserved; Phase 5 does not enable live trading.
