# PHASE 5-14 — Admin UI Closure

The Admin dashboard is now a real, separately-bundled UI (`apps/admin`) wired to the existing admin
API (no API/domain rewrite). It builds independently (`pnpm --filter @quantumtrade/admin build`),
dev-serves on port 5174, and previews via `vite preview`. Admin code is a separate Vite app — verified
NOT present in the `/trade` (apps/web) bundle (grep of `apps/web/dist` for admin refs = 0).

## Implemented screens (real UI)
| Screen | Route | Notes |
|---|---|---|
| A. Login / Access Denied | `#` (root gate) | login; non-admin → Permission Denied state; session-expired/unauth handled |
| B. Overview | `#/overview` | exchange/trading/AI/system cards; unmeasured → Unavailable/Not Connected/Not Executed |
| C. Users | `#/users` | search + list + detail (redacted); disable/enable/revoke/role with Confirm + reason + step-up |
| D. Exchange Connections | `#/exchange` | masked; no secret/memo/headers/KMS |
| E. Orders & Positions | `#/orders` | READ-ONLY; no submit/modify/cancel controls |
| F. AI Operations | `#/ai` | provider/mode/usage; Live → Not Connected/Not Executed |
| G. Audit Explorer | `#/audit` | table + CSV/JSON export links (permission + row-limit + formula-safe) |
| H. Incidents | `#/incidents` | list + create + severity; illegal transitions blocked (server 409) |
| I. Feature Flags | `#/flags` | toggle with reason + optimistic version (409 conflict surfaced) |
| J. Kill Switches | `#/kill` | step-up re-auth; live-trading blocked warning (server-enforced) |
| K. Release Gates | `#/gates` | pending shown NOT_EXECUTED; "Try PASS" without evidence is blocked (server 403) |

## Common UI states (all major screens)
Loading, Empty (No Data), Error, Permission Denied, Session Expired, Unavailable, Not Connected, Not
Executed, Stale, Partial, Conflict (409), Rate Limited, Offline — rendered at page/widget level via
`StateView` (not toast-only), `role=status/alert` + `aria-live`.

## Design / a11y / i18n
Own design tokens (dark/light via `data-theme`), ko-KR/en-US via `src/i18n.ts` (no hardcoded UI
strings), focus-visible, keyboard-navigable links/buttons, ARIA labels, reduced-motion, color+text
status badges, pagination-ready tables, desktop-first at 1366×768. No exchange-admin design cloned.
Route-level code-splitting via `React.lazy` (each screen is its own chunk).

## Closure delta (2026-07-29)
- Incidents screen now has a per-row **status-transition** control (server enforces the FSM; illegal
  transitions return 409 and surface a `role=alert`), and the Audit explorer has an **action search**
  filter — enabling genuine browser E2E of incident lifecycle and audit search.
- Route-ordering fix: the Phase-5 admin router is mounted **before** the Phase-2 auth router so
  `/api/admin/audit` and `/api/admin/users/:id` resolve to the admin dashboard handlers (append-only
  `admin_actions` + redacted user detail) rather than the legacy support endpoints.

## Not fully built (honest)
Advanced table virtualization for very large datasets, saved-filter UI, and some deep-drill panels are
minimal; the APIs support them and they are a BETA follow-up (PHASE5-11).
