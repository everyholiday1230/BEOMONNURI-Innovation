# PHASE 5 — Test Report

Raw logs: `artifacts/logs/phase5-*.log` (headers: command/env/git SHA/start/end/exit). All exit 0.

| Command | Result | Exit | Log |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | up to date | 0 | phase5-install.log |
| `pnpm lint` | 0 errors | 0 | phase5-lint.log |
| `pnpm typecheck` | 14/14 projects | 0 | phase5-typecheck.log |
| `pnpm test` | **276 passed** (offline; PG suite skipIf) | 0 | phase5-test.log |
| `pnpm build` | all packages + apps (apps/admin separate bundle) | 0 | phase5-build.log |
| `pnpm e2e` | **10 passed** (Chromium) | 0 | phase5-e2e.log |
| `pnpm test:postgres` | **12 passed** (real PG17, incl. migration 0005 + admin tables) | 0 | phase5-postgres.log |
| `pnpm test:integration` | **33 passed** | 0 | phase5-integration.log |
| `pnpm test:admin` | **29 passed** (admin-domain 16 + admin-api 13) | 0 | phase5-admin.log |

## Admin coverage
- admin-domain (16): default-deny RBAC (USER/PRO_USER zero), role→permission map, privilege-escalation
  prevention, no self-role-change, last-SUPER_ADMIN guard, incident/release-gate/kill-switch/prompt
  state machines (no-fake-pass + WAIVED guard + fail-closed), redaction (secrets/CSV/HTML/mask).
- admin-api (13, security scenarios): user-access-deny, SUPPORT no role change, ADMIN no SUPER_ADMIN
  escalation, self-role denied, last-SUPER_ADMIN disable denied, CSRF fail, redacted detail,
  disabled-admin session invalid, kill-switch step-up + optimistic-lock 409, release-gate no-fake-pass
  + ADMIN-can't-WAIVE, audit-export permission (SUPPORT 403 / ANALYST 200), SQLi parameterized,
  append-only admin_actions recorded.

## E2E
Chromium (Phase 1–4 flows preserved, no regression). Full admin-UI Playwright E2E (real browser
against the admin app) is limited — the admin app is a separate bundle not booted by the shared
playwright webServer; admin E2E is **Not Executed** here (Chromium admin-UI E2E = Release Gate).
Firefox/WebKit = Not Executed (CI gate).

## Admin UI Closure Pass (2026-07-29) — `phase5-closure-*.log`
All 10 commands exit 0:
| Command | Result | Log |
|---|---|---|
| lint / typecheck | 0 / 15 projects | phase5-closure-lint/typecheck.log |
| `pnpm test` | **277 passed** (offline) | phase5-closure-test.log |
| `pnpm build` | ok (admin separate bundle) | phase5-closure-build.log |
| `pnpm e2e` (User App) | **10 passed** (Chromium) | phase5-closure-e2e.log |
| `pnpm test:postgres` | **12 passed** (real PG17, incl. 0005) | phase5-closure-postgres.log |
| `pnpm test:integration` | **33 passed** | phase5-closure-integration.log |
| `pnpm test:admin` | **30 passed** (admin-domain 16 + admin-api 14) | phase5-closure-admin-test.log |
| `pnpm e2e:admin` (Admin App) | **31 passed** (Chromium — 30 required scenarios + [21b]) | phase5-closure-admin-e2e.log |

E2E split: **User App E2E 10 passed (Chromium)** · **Admin App E2E 31 passed (Chromium)** ·
**Firefox Admin E2E Not Executed** (opt-in) · **WebKit Admin E2E Not Executed** (not in matrix). The
admin UI is real (login/overview/users/exchange/orders/ai/audit/incidents/flags/kill/gates), route
code-split, and NOT in the /trade bundle (grep of apps/web/dist = 0 admin refs). All 30 required admin
E2E scenarios are Executed on Chromium (see PHASE5-15). A route-ordering defect was fixed so
`/api/admin/*` resolves to the Phase-5 admin handlers (the legacy Phase-2 `/admin/audit` +
`/admin/users/:id` support endpoints had shadowed the audit list + user detail).
