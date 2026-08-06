# PHASE 3 — Server Risk Engine

`apps/api/src/trading/risk-engine.ts`. Re-validates ALL client checks server-side and adds live policy.
- Base gates (Phase 1 `evaluateRiskGates`, Decimal-safe): metadata, price/qty, tick/step, minQty,
  SL/TP direction, R:R, max loss, market-data freshness.
- Policy: allowed symbols, max leverage, max notional, daily order limit, daily loss limit, max open
  positions, price deviation limit. Values from policy table/config (not hardcoded).
- Live gate (`evaluateLiveTradingGate`): flag+kill-switch+credential+permission+user+risk+preview+
  token+idempotency+fresh+connectivity+symbol — all required for TRADE.
- Fail → no transmit, reason codes, audit (sanitized), submit disabled.
- Tested: clean pass, leverage/deviation/daily-limit fails, stale data, kill-switch (trading-core.test.ts).
