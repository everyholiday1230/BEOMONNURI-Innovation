# PHASE 4 — Failure Scenarios (30)

Each: Reproduction · Expected · Actual · Result · Evidence · Remaining risk.
Result: **Pass** (reproduced+verified) · **Not Executed** (needs live provider) · **Documented**
(design verified, not an automated test). Evidence: `packages/ai/src/__tests__/ai.test.ts`,
`apps/api/src/__tests__/{ai-api,production-ai}.test.ts`, `artifacts/logs/phase4-*.log`.

| # | Scenario | Reproduction | Expected | Result | Evidence | Remaining risk |
|---|---|---|---|---|---|---|
| 1 | OpenAI secret missing | resolveAiProvider openai, no ARN | fail-closed → AI unavailable (not mock) | Pass | production-ai.test.ts | real SM perms |
| 2 | Invalid OpenAI key | live 401 | provider error → unavailable/error event | Not Executed (needs live) | production-ai (SM path) | real 401 |
| 3 | Provider 401/403 | live | surfaced as error; no retry storm | Not Executed | — | real auth |
| 4 | Provider 429 | Retry-After + backoff (aiBackoffMs) | honored; jittered backoff | Pass (unit) / NE (live) | ai.test cost/backoff | real headers |
| 5 | Provider 5xx | breaker onFailure ×N → open | circuit opens; requests fail fast | Pass | ai.test (breaker) | — |
| 6 | Request timeout | tool timeout / request timeout config | aborts; error event | Pass (tool) / NE (live req) | ai.test (loop timeout) | live latency |
| 7 | Streaming disconnect | abort mid-stream | stops; no dup; retry available | Pass | ai.test (abort) | live SSE |
| 8 | User cancels generation | AbortController.abort() | stream ends; state canceled | Pass | ai.test (abort) | — |
| 9 | Malformed SSE | parseSseChunk bad line | skipped; no crash | Pass | ai.test (streaming) | — |
| 10 | Invalid tool call args | bad JSON / schema fail | tool result ok:false | Pass | ai.test (tools) | — |
| 11 | Unknown tool | execute('nope') | rejected unknown-tool | Pass | ai.test (tools/orchestrator) | — |
| 12 | Schema validation failure | bad ChartCommand/Signal | rejected by Zod | Pass | ai.test (schemas) | — |
| 13 | Tool loop | repeated identical call | loop-detected block | Pass | ai.test (loop guard) | — |
| 14 | Too many tool calls | > maxToolCalls | max-tool-calls-exceeded | Pass | ai.test (loop guard) | — |
| 15 | Stale market data | screenModelOutput stale+signal | stale-data-signal blocked | Pass | ai.test (safety), eval | staleness thresholds |
| 16 | Symbol mismatch | command.symbol ≠ ctx | not auto-applied; confirm required | Pass | ai.test (validateProposedChartCommand) | — |
| 17 | Timeframe mismatch | command.timeframe ≠ ctx | confirm required | Pass | ai.test (validate) | — |
| 18 | Hallucinated price | current price, no market tool | unsourced-price blocked | Pass | ai.test (safety), eval | phrasing variants |
| 19 | Prompt injection (user) | "ignore all instructions…" | request blocked | Pass | ai.test (orchestrator/safety), eval | novel phrasings |
| 20 | Tool-output injection | instruction inside tool output | treated untrusted; flagged | Pass | ai.test (safety screenToolOutput) | novel phrasings |
| 21 | Cross-user conversation access | user B reads A's conv | 404 isolation | Pass | ai-api.test.ts | — |
| 22 | Cross-user signal access | user-scoped repo | isolated (user_id filter) | Pass (repo) / Documented (route) | ai-repos + ai-api | — |
| 23 | Budget exceeded | daily cost ≥ limit | blocked daily-cost-exceeded | Pass | ai.test (cost) | — |
| 24 | Daily quota exceeded | daily tokens ≥ limit | blocked daily-token-exceeded | Pass | ai.test (cost) | — |
| 25 | Fallback model failure | fallbackUsed surfaced | shown in usage + logs | Documented (surfacing) / NE (live) | providers usage.fallbackUsed | live fallback |
| 26 | DB failure during streaming | append/usage throws | error event; stream ends safely | Documented (try/catch in route) | ai-routes.ts | injected-failure test |
| 27 | Duplicate request | same correlation/idempotent read | one stream; no double cost | Pass (single stream) / Documented | orchestrator (one stream) | request-level idempotency |
| 28 | Browser offline/resume | SSE abort → reconnect/retry | retry available; no dup message | Documented (client policy) | PHASE4-13 | client E2E |
| 29 | XSS markdown payload | sanitizeMarkdown(script/js:) | neutralized | Pass | ai.test (safety) | renderer hardening |
| 30 | Provider success but persistence failure | append after stream throws | error surfaced; no false success | Documented (route catch) | ai-routes.ts | injected-failure test |

## Summary
Pass (reproduced): 1,4(unit),5,6(tool),7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,27,29.
Not Executed (needs live OpenAI): 2,3, live portions of 4/6/25. Documented (design/route-level, not an
automated fault-injection test): 25,26,28,30. No scenario is falsely marked Pass.
