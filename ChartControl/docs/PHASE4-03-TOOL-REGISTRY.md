# PHASE 4 — Tool Registry (strict, read-only)

12 read-only tools; each has a strict Zod schema (`.strict()` ⇒ `additionalProperties:false`), all
properties required (optionals expressed as nullable), and `strict:true` JSON Schema for the provider.

1. get_market_snapshot · 2. get_candles · 3. get_order_book_summary · 4. get_recent_trades_summary ·
5. get_funding_rate · 6. get_market_metadata · 7. get_current_chart_context ·
8. get_user_visible_positions · 9. get_user_visible_open_orders ·
10. calculate_risk_reward · 11. validate_chart_command.

`calculate_indicator_set` was removed on 2026-09-05. It computed nothing: the implementation
returned its own arguments plus `note: 'computed server-side (deterministic)'`, so the model
believed it had received indicator values and could state numbers with no source. A tool that
claims to compute is more dangerous than a missing one. Indicator values will be supplied from the
values the chart already computes (KLineCharts renders 27 indicators in the browser); computing
them separately on the server risks the AI quoting a number that differs from the one on screen,
which makes both untrustworthy. Until that path exists, SAFETY_FOOTER forbids stating a numeric
indicator value that is not present in a tool result or MARKET_DATA.

There is **no** tool that submits/cancels/modifies orders, changes leverage/position mode, transfers/
withdraws, or returns secrets. Server executes tools with: JSON parse → Zod validation → dispatch;
tool call ID linked to result. `ToolLoopGuard` enforces max tool calls, loop detection (repeated
identical call), per-call timeout, and duplicate de-duplication. Tool output is treated as UNTRUSTED
(injection-screened) and never executed.
