# PHASE 4 — Mock / Real Matrix

Labels: FI=Fully implemented · UT=Unit-tested · IT=Integration-tested · MK=Mock/Fake exercised ·
NE=Not Executed (needs live OpenAI key) · DOC=Documented · PB=Production-blocked.

| Capability | Status |
|---|---|
| Provider-adapter interfaces (10) | FI, UT |
| FakeProvider / MockReplayProvider | FI, UT, MK |
| OpenAIResponsesProvider (Responses API, transport-injected) | FI, UT (fake transport); **live NE** |
| Typed streaming events (created/delta/function_call/completed/failed/error) | FI, UT |
| SSE parse + tool-call accumulation + dedup + abort | FI, UT |
| Strict read-only tool registry (12) + JSON schema + loop guard | FI, UT |
| ChartCommand v2 + per-command strict args + validation pipeline | FI, UT |
| SignalObject v2 + state machine (approval ≠ submit) | FI, UT |
| Prompt registry (versioned, checksum, delimited untrusted input) | FI, UT |
| Safety policy (injection/profit/unsourced/auto-trade/stale + XSS sanitize) | FI, UT |
| Cost controller (rate/token/cost/system budget/concurrency/breaker/estimate) | FI, UT |
| Provider fallback surfacing (fallbackUsed) | FI; live switch NE |
| Orchestrator validated pipeline | FI, UT |
| OpenAI secret via AWS Secrets Manager (fail-closed, separate from BitMart) | FI, UT (injected client); **live SM NE** |
| Production startup fail-closed (SDK+ARN+region) | FI, UT |
| AI SSE routes (auth/CSRF/RBAC/quota, conversation CRUD) | FI, IT (mock) |
| Migration 0004 ai_* tables (SQLite + PG) | FI; PG IT (real, incl. extend Phase2) |
| Conversation/usage repos (user isolation, no chain-of-thought) | FI, IT |
| Cross-user isolation (conversation/signal) | FI, IT (404) |
| Evaluation dataset + eval:ai | FI, UT (deterministic); **live-model eval NE** |
| Real OpenAI streaming / tool-calling / latency / cost | **NE** (no key) — Production Release Gate |
| AI Workspace in-browser E2E (real browser) | DOC + partial (Chromium suite) |
| Real order submission by AI | intentionally ABSENT (forbidden) |
