# PHASE 4 — Tool Registry (strict, read-only)

12 read-only tools; each has a strict Zod schema (`.strict()` ⇒ `additionalProperties:false`), all
properties required (optionals expressed as nullable), and `strict:true` JSON Schema for the provider.

1. get_market_snapshot · 2. get_candles · 3. get_order_book_summary · 4. get_recent_trades_summary ·
5. get_funding_rate · 6. get_market_metadata · 7. get_current_chart_context ·
8. get_user_visible_positions · 9. get_user_visible_open_orders · 10. calculate_indicator_set ·
11. calculate_risk_reward · 12. validate_chart_command.

There is **no** tool that submits/cancels/modifies orders, changes leverage/position mode, transfers/
withdraws, or returns secrets. Server executes tools with: JSON parse → Zod validation → dispatch;
tool call ID linked to result. `ToolLoopGuard` enforces max tool calls, loop detection (repeated
identical call), per-call timeout, and duplicate de-duplication. Tool output is treated as UNTRUSTED
(injection-screened) and never executed.
