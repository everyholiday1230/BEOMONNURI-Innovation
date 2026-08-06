# PHASE 5 — Known Issues

> Admin UI Closure Pass (2026-07-29): the Admin UI is REAL (screens A–K in a separate `apps/admin`
> bundle) and Admin App E2E runs on Chromium (**31 passed** = 30 required scenarios + [21b]). Remaining
> items below are narrowed accordingly.

- **Admin UI E2E breadth**: all 30 required Chromium admin E2E scenarios are Executed (auth/RBAC/user
  mgmt/exchange/orders/AI/audit+export/incident FSM/flags+409/kill-switch+step-up/gate no-fake-pass/
  i18n/theme/session-expiry/CSRF/offline/500/429 — see PHASE5-15). **Firefox/WebKit Admin E2E = Not
  Executed** (Firefox opt-in `PW_ALL_BROWSERS=1`; WebKit not in the project matrix / needs host deps).
- **Advanced table virtualization** (1,000+ rows) + full-dashboard re-render profiling were NOT measured
  (bounded pagination used instead) — BETA follow-up (PHASE5-16).
- **MFA**: `Not Implemented / Release Gate` — labeled accurately, never shown as enabled. Step-up is a
  structural flag (`reauth`) on high-risk kill-switch changes; a real MFA/step-up provider is a gate.
- **Kill switch / feature flag multi-node propagation + cache invalidation**: single-node in this
  build; distributed propagation is a PROD gate. Fail-closed defaults are enforced.
- **Rate limit** is per-node in-memory (120/min/actor); distributed rate limiting is a PROD gate.
- **PostgreSQL** is verified via the integration harness (migration 0005 + admin tables); the running
  app default store remains SQLite (PROD gate — unchanged from prior phases).
- Emergency Cancel / Reduce-only for operators is **Documented / Disabled** (requires separate security
  approval; not implemented per spec §6).
- Pending live gates (BitMart Stage A, Private WS soak, Controlled Live Order, Live OpenAI, Live-model
  eval, Live AI E2E, Firefox/WebKit, load, central gateway, backup/restore, MFA) remain **Not Executed**.
