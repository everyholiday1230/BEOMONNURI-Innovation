# PHASE 4 — Operations Runbook (AI Copilot)

## Enable AI in production
1. Store the OpenAI API key in AWS Secrets Manager (separate secret from BitMart).
2. Grant the instance IAM role `secretsmanager:GetSecretValue` on that secret ARN.
3. Set env: `AI_ENABLED=true`, `AI_PROVIDER=openai`, `OPENAI_SECRET_ARN=<arn>`, `AWS_REGION=<region>`,
   `OPENAI_MODEL_PRIMARY=<model>`, `OPENAI_MODEL_FALLBACK=<model>`, `OPENAI_STORE=false`,
   `AI_MAX_OUTPUT_TOKENS`, `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_TOOL_CALLS`, `AI_MAX_COST_PER_REQUEST`,
   `AI_DAILY_USER_BUDGET`.
4. Deploy the image (which includes `@aws-sdk/client-secrets-manager` and `openai`).
5. Verify `GET /api/ai/status` → `{available:true, provider:"openai"}`. If unavailable, the reason is
   surfaced (fail-closed) — check SDK install + secret ARN/region + IAM permission.

## Fail-closed behavior
- Production start refuses to boot without SDK + Secret ARN + region.
- `AI_PROVIDER=openai` but secret not loadable → AI **unavailable** (503 on `/api/ai/copilot`); the UI
  shows "AI unavailable". We never silently downgrade to the mock provider in production.

## Rotation
Rotate the OpenAI key in Secrets Manager; no code change or key redeploy — the key is read at startup
(restart to pick up a rotated secret).

## Cost / quota controls
Per-user rate/token/cost budgets, system daily budget, concurrency cap, circuit breaker, and fallback
model are enforced by `CostController`. Fallback usage is surfaced in the usage event + logs. Metrics
persist in `ai_usage_records` (estimated + actual cost micro-USD).

## Kill / disable
Set `AI_ENABLED=false` (or `AI_PROVIDER=mock` in non-prod). AI cannot place/modify/cancel orders,
change leverage/position mode, or move funds under any configuration — it only proposes drafts for
explicit user approval, and the Phase 3 Risk Engine + human confirmation gate remain authoritative.

## Data / privacy
`store:false` (no provider retention). Conversations are user-isolated in PostgreSQL with soft delete;
only a short reasoning_summary is stored (never raw chain-of-thought); no secrets/auth headers stored.
Conversation export/delete supported per user.
