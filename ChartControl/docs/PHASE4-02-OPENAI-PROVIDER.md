# PHASE 4 — OpenAI Provider

## SDK
`openai@7.1.0` (exact, pinned) is an explicit production dependency of `@quantumtrade/api`. New code
uses the **Responses API** (`client.responses.stream`), not Chat Completions. Model names are
config-driven (`OPENAI_MODEL_PRIMARY`/`OPENAI_MODEL_FALLBACK`) — never single-hardcoded.

## Provider-adapter
`packages/ai` stays SDK-free: `OpenAIResponsesProvider` takes an injected `OpenAiResponsesTransport`
(so it is unit-testable with a fake transport). `apps/api/src/ai/production-ai.ts#createOpenAiTransport`
wires the real OpenAI SDK. Providers: `FakeProvider` (scripted, tests), `MockReplayProvider`
(deterministic dev/e2e), `OpenAIResponsesProvider` (live).

## Streaming events handled (normalized → `AiStreamEvent`)
`response.created`, `response.output_text.delta`, `response.function_call_arguments.delta`,
`response.function_call_arguments.done`, `response.completed`, `response.failed`, `error`.
Disconnect/cancel: `AbortController` support; tool-arg deltas accumulated + deduped per callId;
correlation ID per request; partial-response policy; retry surfaced as an error event (no duplicate
cost — one stream per request).

## store:false
Default `store:false` (no provider-side retention of financial/account data). Conversation context is
owned by QuantumTrade PostgreSQL per user. `previous_response_id` (if used) is still validated for
ownership + expiry; upstream instructions are not assumed to carry over.

## Secret management (docs PHASE4-06 / §2)
OpenAI API key loads ONLY from AWS Secrets Manager via the instance IAM role
(`loadOpenAiApiKey`, separate from the BitMart secret). Never returned to the browser, stored in
LocalStorage/.env/git, or logged; never in error messages (only the AWS error class name).
**Fail-closed**: in production, missing SDK/Secret ARN/region ⇒ startup refuses; at request time,
provider `openai` without a loadable key ⇒ AI **unavailable** (UI shows unavailable), NOT a silent
mock swap. Key rotation = rotate the secret in Secrets Manager (no code/redeploy of the key).

## Live status
No OpenAI key in this runtime → **Live provider = Not Executed**. The live transport code compiles and
is wired, but has not been exercised against the real API.
