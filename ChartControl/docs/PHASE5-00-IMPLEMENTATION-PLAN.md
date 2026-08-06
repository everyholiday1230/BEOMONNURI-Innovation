# PHASE 5 — Implementation Plan (Secure Admin & Operations Dashboard)

Branch `phase-5-admin-dashboard` from `c80bd2b` (Phase 4 RC `phase-4-rc-v0.4.0`). Phase 1/2 approval
tags and Phase 3/4 RC tags are NOT moved. Pending gates (BitMart Stage A, Private WS Soak, Controlled
Live Order, Live OpenAI, Live-model Eval, Live AI E2E) stay **Not Executed** (never auto-Passed). No
Phase 6 is started.

## Goal
An operations dashboard for the QuantumTrade AI team — NOT a CRM. Includes member/account management,
role/permission management, exchange-connection status, order/position monitoring (read-only), AI
usage/cost/error monitoring, system health, audit logs, feature flags, trading kill switches, incident
management, operational notifications, and Production Release Gate status.

## Excluded (by design)
Sales leads/contacts, marketing automation, CRM pipeline, admin-submits-order-for-user, user secret
lookup, withdrawal/transfer, user password lookup, AI auto-trade, admin arbitrary position creation.

## Deliverables
- `packages/admin-domain` (RBAC + invariants + state machines + redaction), `packages/admin-schemas`
  (Zod inputs), `apps/api/src/admin` (repos + routes), migration `0005` (admin_* tables), `apps/admin`
  (separate Vite app/bundle), tests (admin-domain + admin-api security scenarios), `test:admin`, docs.

## Safety posture
Server-side default-deny RBAC (SUPPORT/ANALYST/ADMIN/SUPER_ADMIN; USER/PRO_USER denied); privilege-
escalation prevention; no self-role-change; last-SUPER_ADMIN guard; disabled-admin session revoke;
kill switches fail-closed for live trading; release gates cannot be marked PASSED without evidence;
WAIVED requires SUPER_ADMIN + reason + future expiry (production-required capped at 30 days); no
secrets exposed; admin_actions append-only. `LIVE_TRADING_ENABLED=false`, `EMERGENCY_KILL_SWITCH=true`
defaults preserved — Phase 5 does not enable live trading.
