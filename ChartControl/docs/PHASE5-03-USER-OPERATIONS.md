# PHASE 5 — User Operations

Admin user management (server-enforced, redacted):
- Search (email/status/role filters, paginated, SQLi-safe parameterized), account detail + stats
  (sessions, AI conversations/signals, orders, exchange credentials count), roles, sessions.
- Actions: disable / enable (reason required), revoke all sessions, role change (invariant-guarded),
  password-reset guidance (no password lookup). Data export/delete request status (documented).

Admins can NEVER see: password hash, session token, CSRF token, BitMart secret/memo, OpenAI key, KMS
data key, full auth headers, or internal chain-of-thought. Access keys are shown masked only. All
detail responses pass server-side `redact()`; verified by tests (no `password_hash`/token in output).
