# PHASE 4 — Implementation Plan (Production AI Copilot)

Branch `phase-4-production-ai` from `d008719` (Phase 3 RC `phase-3-rc-v0.3.1`). Phase 1/2/3 preserved;
Phase 1/2 approval tags and Phase 3 RC tag are NOT moved. BitMart Stage A / Private WS / Controlled
Live Order remain Production Release Gate items (Not Executed / not Passed).

## Goal
Replace the Mock AI with a provider-adapter architecture (OpenAI Responses API + Mock + Fake), strict
read-only tool calling, structured ChartCommand/SignalObject generation behind a validation pipeline,
a versioned prompt registry, AI safety, cost/quota/observability, and conversation persistence — with
**no real order submission** and **no ability for AI to bypass the Risk Engine**.

## What AI may do
Market-data lookups (read-only tools), chart-context analysis, technical explanation, ChartCommand
proposals, overlay create/update proposals, SignalObject generation, order-DRAFT proposals, risk-check
requests, and display of reasoning + uncertainty.

## What AI must never do
Submit/cancel/modify orders, change leverage/position mode, withdraw/transfer, access BitMart secrets,
bypass the Risk Engine, act without user approval, guarantee profit, or auto-create/send unconfirmed orders.

## Deliverables (this phase)
- `packages/ai` — interfaces, providers (Fake/Mock/OpenAI Responses), streaming, tools, prompts,
  safety, cost, orchestrator, evaluation, schemas.
- `apps/api` — migration 0004 (ai_* tables), conversation/usage repos, OpenAI secret loader (Secrets
  Manager, fail-closed), AI SSE routes; env wiring.
- Tests (unit + integration), `test:ai`, `eval:ai`; 30 failure scenarios; docs; regression.

## Honest status
No OpenAI key is present in this runtime → **Live provider = Not Executed**. Mock/Fake providers are
fully exercised. `store:false` by default. Provider is fail-closed: openai configured without a
Secrets Manager key → AI **unavailable** (never a silent mock swap).
