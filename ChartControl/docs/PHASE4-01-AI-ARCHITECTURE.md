# PHASE 4 — AI Architecture

## Package layout
- `packages/ai` (framework-agnostic, provider-agnostic, fully unit-tested):
  `interfaces.ts` (the 10 interfaces), `providers.ts`, `streaming.ts`, `tools.ts`, `prompts.ts`,
  `safety.ts`, `cost.ts`, `orchestrator.ts`, `evaluation.ts`, `schemas.ts`.
- `apps/api`: `ai-routes.ts` (SSE + conversation CRUD), `ai/production-ai.ts` (secret + provider
  factory), `db/ai-repos.ts` (conversation/usage), migration `0004_phase4_ai`.

## The 10 interfaces
IAIProvider, IAIStreamingProvider, IAIOrchestrator, IAIToolRegistry, IAIPromptRegistry,
IAIConversationRepository, IAIUsageRepository, IAIEvaluationService, IAISafetyPolicy, IAICostController.
The application depends only on these; concrete providers are swappable.

## Data pipeline (docs PHASE4-03)
```
User Message
 → Auth / RBAC (signal.write.self) / CSRF / Quota (CostController)
 → AI Conversation Service (user-isolated persistence)
 → Context Builder + Prompt Registry (versioned, delimited untrusted data)
 → Provider (OpenAI Responses API | Mock | Fake) — typed streaming events
 → Tool Call Validation (allowlist + strict Zod) → Read-only Tool Execution (loop/limit/timeout)
 → Structured ChartCommand/SignalObject → Zod/JSON-Schema + Domain Safety Validation
 → UI Preview → User Approval → Chart Adapter / Order DRAFT (never a submission)
```
LLM output is NEVER executed directly. Every structured output passes: JSON Schema → Zod → tool
allowlist → ownership → symbol/timeframe → price/qty format → market metadata → stale check → coord/
range → risk policy → command version → idempotency → approval-required.

## Orchestrator
`Orchestrator.run()` yields typed `OrchestratorEvent`s (state/text/tool/command/signal/usage/error/
done). It screens user input (injection), checks cost/quota + circuit breaker, assembles the versioned
prompt with fenced untrusted data, streams the provider, executes read-only tools under a
`ToolLoopGuard`, screens model output (profit-guarantee/unsourced-price/auto-trade/stale), and records
usage. Symbol/timeframe mismatches are surfaced for confirmation, never auto-applied.
