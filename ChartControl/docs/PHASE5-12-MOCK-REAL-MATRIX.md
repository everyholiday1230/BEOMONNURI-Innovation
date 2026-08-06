# PHASE 5 — Mock / Real Matrix

Labels: FI=Fully implemented · UT=Unit-tested · IT=Integration-tested · MK=Mock/seed data · NE=Not
Executed · DOC=Documented · PB=Production-blocked.

| Capability | Status |
|---|---|
| Admin RBAC (permissions + role map, default-deny, USER/PRO_USER blocked) | FI, UT, IT |
| RBAC invariants (escalation/self/last-super-admin) | FI, UT, IT |
| Disabled-admin session revoke | FI, IT |
| Admin API (overview/users/exchange/orders/positions/ai/health/audit/incidents/flags/kill/gates) | FI, IT |
| Auth + admin-role gate + CSRF + permission + rate-limit + schema + no-store + redaction | FI, IT |
| Migration 0005 admin_* (SQLite + PG + down) | FI; PG IT (real, incl. admin tables) |
| Optimistic locking (version) + history tables | FI, IT (409 conflict) |
| Append-only admin_actions audit | FI, IT |
| Kill switches (fail-closed live scopes, step-up, audit) | FI, UT, IT |
| Feature flags (+history, optimistic lock) | FI, IT |
| Incidents (+events, state machine, severities) | FI, UT, IT |
| Release gates (no-fake-pass, WAIVED guard, evidence) | FI, UT, IT |
| Prompt-change lifecycle (no direct edit-to-prod) | FI, UT |
| Redaction (secrets/CSV/HTML/mask) | FI, UT |
| Overview/health honest states (Unavailable/Not Connected/Not Executed) | FI |
| apps/admin separate bundle (screens A–K: login/overview/users/exchange/orders/ai/audit/incidents/flags/kill/gates) | FI (build + route code-split); not in /trade bundle (grep=0) |
| Admin UI common states + i18n (ko/en) + dark/light + a11y + lazy routing | FI |
| Admin UI Playwright E2E (real browser) | Chromium 31 passed (30 required + [21b]); Firefox/WebKit NE |
| MFA / step-up real provider | DOC (Not Implemented / Release Gate; step-up flag enforced) |
| Table virtualization (1000+ rows) / re-render profiling | NE (bounded pagination used) — BETA gate |
| Multi-node kill-switch/flag propagation, distributed rate limit | DOC (PROD gate) |
| Live trading enablement via admin | intentionally ABSENT (forbidden) |
| Admin order submission / withdrawal / position creation | intentionally ABSENT (forbidden) |
| Pending live gates (Stage A / Private WS / Controlled Live / Live OpenAI / …) | NE (unchanged) |
