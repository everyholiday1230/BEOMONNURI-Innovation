# PHASE 5 — Admin Architecture

## Separation
- `apps/admin` — a SEPARATE Vite React app (own entry `index.html`, own bundle, dev port 5174). It is
  NOT part of the user `/trade` (apps/web) bundle. Built independently by `pnpm build`.
- `apps/api/src/admin` — admin routes mounted under `/api/admin` (separate from user/trading/AI routes).
- `packages/admin-domain` — pure RBAC/invariant/state-machine/redaction logic (framework-free, unit-tested).
- `packages/admin-schemas` — Zod input schemas (length-limited, `.strict()`).

## Request path (every admin API)
```
Request → Authentication (session cookie; disabled users rejected)
        → Admin role gate (isAdminRole; USER/PRO_USER → 403)
        → Rate limit (per-actor fixed window)
        → Permission (hasAdminPermission, DEFAULT DENY)
        → [mutations] CSRF (HMAC + Origin/Referer allowlist)
        → Zod schema validation (length limits, strict)
        → Domain invariants (RBAC/state machines)
        → Repo (optimistic lock + history)
        → Audit (append-only admin_actions) + Redaction + Cache-Control: no-store
```
UI hiding is never the security boundary — the server enforces everything.

## Screens (spec)
/admin/login, /admin (overview), /admin/users, /admin/roles, /admin/exchange-connections,
/admin/orders, /admin/positions, /admin/ai-operations, /admin/system-health, /admin/audit,
/admin/incidents, /admin/feature-flags, /admin/release-gates, /admin/settings. As of the Admin UI
Closure Pass, `apps/admin` implements the operational screen set (Login/Access-Denied, Overview,
Users, Exchange, Orders&Positions, AI Ops, Audit, Incidents, Feature Flags, Kill Switches, Release
Gates) as real UI with route-level code-splitting (`React.lazy`), i18n (ko/en), dark/light, common
states, and a11y (see PHASE5-14). Admin E2E runs on Chromium (PHASE5-15).

## Unmeasured metrics
Overview/health report unmeasured values as `Unavailable` / `Not Connected` / `Not Executed` — never a
fake 0 or "OK".
