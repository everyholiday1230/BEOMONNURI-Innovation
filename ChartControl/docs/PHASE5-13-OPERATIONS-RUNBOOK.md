# PHASE 5 — Operations Runbook (Admin Dashboard)

## Access
- Admin app is a SEPARATE bundle (`apps/admin`, dev port 5174), proxying `/api` to the BFF. Only
  SUPPORT/ANALYST/ADMIN/SUPER_ADMIN can use it; USER/PRO_USER get 403 server-side.
- Sign in at `/admin/login` with an admin account. Disabling an admin immediately revokes their sessions.

## Granting admin roles
Only ADMIN/SUPER_ADMIN may change roles (with reason). ADMIN cannot grant ADMIN/SUPER_ADMIN or modify
ADMIN/SUPER_ADMIN accounts; only SUPER_ADMIN manages SUPER_ADMIN. The last active SUPER_ADMIN cannot be
disabled or demoted. Role changes revoke the target's sessions (re-auth).

## Kill switches (high-risk)
`PATCH /api/admin/kill-switches/:id` requires `admin.kill_switch.write`, CSRF, a **reason**, the current
`version` (409 on conflict), and a **step-up re-auth flag** (`reauth:true`). Live-trading scopes are
fail-closed (default ACTIVE/blocked). Every change is written to `kill_switch_history` + `admin_actions`.

## Release gates
`PATCH /api/admin/release-gates/:id`. Cannot set PASSED without evidence. Only SUPER_ADMIN may WAIVE,
with a reason + future expiry (production-required ≤ 30 days). Pending gates stay NOT_EXECUTED until the
owning admin/operator validates them in a separate Live Validation pass.

## Incidents
Create/patch via `/api/admin/incidents`; state machine OPEN→INVESTIGATING→MITIGATED→RESOLVED→CLOSED
(illegal transition → 409). SEV1/SEV2 should surface a top banner + kill-switch state in the UI.

## Audit
`/api/admin/audit` (read) is append-only and redacted. Export (`/api/admin/audit/export`) needs
`admin.audit.export`, is row-limited + audited, and CSV is formula-injection-safe.

## What admins cannot do
Submit/modify/cancel orders, change leverage/position mode, withdraw/transfer, create positions, view
secrets/hashes/tokens, or enable live trading. `LIVE_TRADING_ENABLED=false` /
`EMERGENCY_KILL_SWITCH=true` defaults are preserved.
