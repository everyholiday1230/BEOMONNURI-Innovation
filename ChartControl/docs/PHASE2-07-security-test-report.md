# PHASE 2 — Security Test Report

All executed via `pnpm test` (SQLite :memory:, deterministic) + real PostgreSQL integration
(`PG_TEST_URL`). Raw logs: `artifacts/logs/test.log`, `artifacts/logs/pg-integration.log`.
Suite: `apps/api/src/__tests__/auth-api.test.ts` (19), `packages/auth/.../auth.test.ts` (10),
`apps/api/src/__tests__/postgres.integration.test.ts` (11, real PG).

| # | Security test (req §9) | Where | Result |
|---|---|---|---|
| 1 | Duplicate email registration | auth-api "duplicate email → 409" | ✅ 409 |
| 2 | Generic login error (no enumeration) | auth-api "generic login error…" | ✅ identical 401 for wrong-pw & unknown-email |
| 3 | Brute-force rate limit | auth-api "brute-force rate limit → 429 + Retry-After" | ✅ 429 + Retry-After |
| 4 | Session fixation | session ID rotation on login (new hashed token each login); logout server-side destroy | ✅ auth.test "register→login→validate→logout" + service rotation |
| 5 | Expired session | auth.test "expired session is invalid" | ✅ 401 after idle TTL |
| 6 | Revoked session | auth-api "revoke-others keeps only current" + password-change invalidation | ✅ |
| 7 | CSRF missing | auth-api "logout rejected when token missing" | ✅ 403 |
| 8 | CSRF mismatch | auth-api "logout rejected on token mismatch" | ✅ 403 |
| 9 | CSRF cross-origin | auth-api "cross-origin request rejected even with valid token" | ✅ 403 (Origin allowlist) |
| 10 | Unauthorized role (vertical priv-esc) | auth-api "normal user → admin audit 403" | ✅ 403 |
| 11 | Horizontal privilege escalation | auth-api "user A cannot read B layout/signal/order-draft" | ✅ 404 (ownership) + list excludes others |
| 12 | Vertical privilege escalation | same as #10 (permission-gated admin routes) | ✅ 403 |
| 13 | SQL injection input | auth-api "SQLi in login email neutralized"; PG "parameterized queries neutralize SQLi" | ✅ parameterized; tables intact |
| 14 | Malformed JSON | auth-api "malformed JSON → 400" | ✅ 400 |
| 15 | Oversized input | auth-api "oversized input → 400" (64 kB cap) | ✅ 400 |
| 16 | Sensitive log redaction | auth-api "audit log redaction"; auth.test "no password in meta" | ✅ no password/token/csrf/hash in audit |
| 17 | Cross-user data isolation | auth-api "#11" across layouts/signals/order-drafts | ✅ |
| 18 | Migration rollback | PG integration "migrate down removes 0002 then 0001" | ✅ real PG down + re-up |

## Additional auth-lifecycle coverage
- Email verification single-use token via MailSink — auth-api "email verification…": reuse fails.
- Password reset: generic `forgot-password` (unknown email → 200, no mail), real token reset works,
  sessions invalidated — auth-api "forgot-password is generic… reset works".
- Password change invalidates all sessions — auth-api "password change invalidates existing sessions".
- Session device list + current flag + revoke-others — auth-api "session device list…".

## Notes
- Session tokens are stored HASHED (sha256); the raw token exists only in the `qt_session` cookie.
- Verification/reset tokens store HASH + expiry + single-use (`used_at`); raw only emailed (MailSink in dev).
- CSRF = HMAC(serverKey, session.csrfSecret) — signed + session-bound + constant-time compare +
  Origin/Referer allowlist on unsafe methods; GET/HEAD are never mutated.
