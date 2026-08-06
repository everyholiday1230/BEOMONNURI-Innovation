# 13 — Known Risks & Assumptions

## Assumptions (safe defaults applied where the spec was ambiguous)
1. **BitMart API shapes** — Phase 1 targets BitMart's public v2 REST/WS surface. Because the exact
   field names/limits can change and cannot be verified offline in this handoff environment, the
   BitMart adapter isolates parsing in a single normalization layer with Zod, so a schema drift is
   a one-file fix. Endpoint bases + rate limits are **config**, never hardcoded across the codebase.
2. **klinecharts version** — pinned to a specific published version; the adapter (`IChartRenderer`)
   isolates it so a future official BitMart Chart SDK or a klinecharts major upgrade is swappable.
3. **React version** — React 18 (as requested) even though 19 is available; recorded in ADR-0003.
4. **Persistence** — Phase 1 uses localStorage for layouts with a server-sync interface. PostgreSQL
   /Redis/queue are proposals/interfaces, not wired, to avoid shipping unused infra.
5. **Auth** — cookie/session/CSRF policy is defined; a concrete auth store is interface-only. The
   app runs locally without login for evaluation; login/signup routes exist as UI.
6. **Data/trading modes** — default `MOCK_REPLAY` + `MOCK` so the whole app is reviewable with zero
   external dependency; `BITMART_PUBLIC` can be enabled via env.
7. **Single-node fan-out** — SSE fan-out is in-memory (single process) in Phase 1; the pub/sub
   interface allows a Redis-backed multi-node implementation later.

## Risks
| Risk | Impact | Mitigation |
|---|---|---|
| BitMart API drift/undocumented limits | market-data breakage | isolated normalization + config limits + Zod |
| Live-data verification not possible in handoff env | WS paths unproven | code paths are unit-tested with fixtures; marked 🟡, not ✅ |
| LLM output unsafe | wrong/dangerous actions | allowlist + Zod + permission + human gate |
| Scope vs. single-session delivery | breadth incomplete | prioritized correctness-critical, testable core; honest status matrix |
| Money precision bugs | financial error | Decimal everywhere, no float for money; tested |
| Order double-submit | duplicate orders | clientOrderId idempotency + UNKNOWN_RECONCILING |

## Explicitly NOT done (by policy)
Production orders, withdrawals, real API-key storage, executed load tests, executed E2E,
multi-node WS fan-out, real database.
