# PHASE 4 — Cost, Quota & Performance

`CostController` (integer micro-USD; no float money; pricing config-driven per model):
- per-user requests/minute (fixed window)
- per-user daily token budget
- per-user daily cost budget
- system-wide daily cost budget
- max concurrent AI requests
- circuit breaker (open after N consecutive provider failures; half-open after reset)
- `estimateCostMicros(model, in, out)` from config pricing.

Additional controls: max output tokens, max tool calls (`ToolLoopGuard`), context trimming + old-candle
downsampling (bounded tool limits), snapshot caching (dataSnapshotId), 429 + Retry-After +
exponential backoff with full jitter (`aiBackoffMs`), timeout, user cancel (AbortController), and
usage/cost metrics persisted in `ai_usage_records` (est. + actual columns).

Provider fallback: primary → fallback model; when the fallback is used it is surfaced in the usage
event (`fallbackUsed`) and logged — primary failure is never hidden.

Env: `AI_MAX_OUTPUT_TOKENS`, `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_TOOL_CALLS`, `AI_MAX_COST_PER_REQUEST`,
`AI_DAILY_USER_BUDGET` (all configurable; safe defaults; AI disabled by default).
