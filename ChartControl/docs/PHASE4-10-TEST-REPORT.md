# PHASE 4 — Test Report

Raw logs: `artifacts/logs/phase4-*.log` (each has command/env/git SHA/start/end/exit headers). All exit 0.

## Commands (fresh)
| Command | Result | Exit | Log |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | up to date | 0 | phase4-install.log |
| `pnpm lint` | 0 errors | 0 | phase4-lint.log |
| `pnpm typecheck` | 11/11 projects | 0 | phase4-typecheck.log |
| `pnpm test` | **247 passed** (offline; PG suite skipIf) | 0 | phase4-test.log |
| `pnpm build` | all packages + apps | 0 | phase4-build.log |
| `pnpm e2e` | **10 passed** (Chromium) | 0 | phase4-e2e.log |
| `pnpm test:postgres` | **12 passed** (real PG17, incl. 0004) | 0 | phase4-postgres.log |
| `pnpm test:integration` | **33 passed** | 0 | phase4-integration.log |
| `pnpm test:ai` | **41 passed** (packages/ai 31 + apps/api ai 10) | 0 | phase4-ai.log |
| `pnpm eval:ai` | 10/10 cases pass; safety rates 1.0; hallucination 0 | 0 | phase4-eval.log |

## AI unit/integration coverage
- packages/ai (31): schemas + arg validation, signal state machine, streaming parser + tool-call
  accumulator + SSE parse, tool registry (12 strict read-only, JSON-schema, loop guard), prompt
  registry + delimited untrusted input, safety (injection/profit/unsourced/auto-trade/stale + XSS
  sanitize), cost controller (rate/token/cost/breaker/estimate), providers (fake/mock/openai-with-fake
  -transport + dedup + abort), orchestrator pipeline (injection block, tool exec, unsourced-price
  reject, breaker block), validateProposedChartCommand, evaluation service.
- apps/api (10): migration 0004 ai_* tables, AI status, AI-unavailable 503 (fail-closed), SSE copilot
  via mock (text+usage+persistence, reasoning_summary null), cross-user isolation 404, auth/CSRF;
  production-ai fail-closed (secret ARN/region required, injected SM raw+JSON, redaction-safe error,
  resolver openai-without-secret → unavailable not mock).

## Live (Not Executed — honest)
- OpenAI Responses API live calls (no key): streaming/tool-calling/latency/cost against the real model
  = **Not Executed**. Mock/Fake fully exercised. No Live result is marked Passed.
- E2E is Chromium (Phase 1/2/3 flows preserved, no regression).
