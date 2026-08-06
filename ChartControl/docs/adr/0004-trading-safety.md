# ADR-0004 — Safety: AI cannot trade; mandatory human confirmation; production disabled

Status: Accepted · Date: 2026-07-28

## Context
This is a trading system. The single largest risk is an automated or accidental order. The brief
mandates: AI approval ≠ order submission; explicit final user confirmation; no production orders in
Phase 1; credentials never exposed.

## Decision
1. The AI surface is an **allowlist** of `ChartCommand`s validated by Zod + permission check. It
   cannot emit arbitrary code, cannot submit orders, change leverage, alter permissions, withdraw,
   or read keys.
2. The signal→order pipeline enforces a state machine with a **`CONFIRMATION_REQUIRED` gate** that
   only advances with a user-issued `confirmationToken`.
3. `TRADING_MODE` defaults to `MOCK`; `BITMART_DEMO` is interface-only; production requires
   `FEATURE_LIVE_ORDERS_ENABLED=true` **and** admin approval **and** a future ADR. Default: disabled.
4. Order submission is idempotent (`clientOrderId`) and never blindly retried
   (`UNKNOWN_RECONCILING`).

## Consequences
+ Structurally impossible for AI to place an order; defense in depth.
− Extra steps in the UX flow — intended and required.
