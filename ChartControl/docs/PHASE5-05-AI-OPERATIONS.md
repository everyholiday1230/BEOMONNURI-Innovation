# PHASE 5 — AI Operations

AI Operations views (read-only): provider status, primary/fallback model, Live/Mock/Fake mode,
requests/success/failure, streaming errors, tool calls, invalid schema, prompt-injection blocks,
timeouts, rate limits, circuit-breaker, token usage, cost (estimated/actual), per-user quota, prompt
version, evaluation version, feedback, safety violations. Live-model numbers are `Not Executed` until
a live OpenAI key is connected (Release Gate).

## Prompt change flow (no direct edit-to-production)
`DRAFT → REVIEW → APPROVED → STAGED → ACTIVE → ROLLED_BACK` (`prompt_change_requests` +
`prompt_approvals`, `canTransitionPromptChange`). Each change carries version, checksum, reason,
approver, and rollback. Admins cannot edit a prompt and push it straight to production. Raw
chain-of-thought is never stored or shown (only reasoning summaries, per Phase 4).
