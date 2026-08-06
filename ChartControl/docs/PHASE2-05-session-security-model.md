# PHASE 2 — Session & Security Model

## Session model
- **Type:** server-side opaque session (no JWT). Session id = `base64url(randomBytes(32))`.
- **Store:** `sessions` table (SQLite/Postgres). Lookup by id on each authenticated request.
- **Expiry:** idle TTL (default 12h, sliding) + absolute cap (default 7d). Expired → 401 + cookie
  cleared. Configurable via `AUTH_SESSION_IDLE_MS`, `AUTH_SESSION_ABSOLUTE_MS`.
- **Rotation:** new session id issued on login; logout deletes the row (server-side invalidation).
- **Revocation:** deleting the row immediately invalidates (admin disable → cascade delete sessions).

## Cookies
| cookie | flags | purpose |
|---|---|---|
| `qt_session` | HttpOnly, Secure*, SameSite=Lax, Path=/ | the session id (not JS-readable) |
| `qt_csrf` | Secure*, SameSite=Lax, Path=/ (readable) | CSRF double-submit token |

`*Secure` default ON; only OFF when `AUTH_COOKIE_INSECURE=true` (local http dev). SameSite=Lax
mitigates CSRF on top-level navigations; the CSRF token covers XHR state-changes.

## CSRF
- Double-submit, session-bound: token derived from `sessions.csrf_secret`. State-changing requests
  (`POST /api/auth/login|logout`, `PUT /api/account/*`) require `X-CSRF-Token` header == `qt_csrf`
  cookie; mismatch/absent → 403. Read endpoints exempt.

## Transport & headers
- `secure-headers` (already applied globally in Phase 1) retained. Phase 2 adds a **stricter CSP**
  path for authed HTML (documented; frontend is a SPA so CSP is served at the edge/host).
- CORS allowlist unchanged (`CORS_ALLOWED_ORIGINS`), `credentials: true` already set — cookies flow
  only to allowlisted origins.

## Secrets & data protection
- Passwords: scrypt (salted, params stored), timing-safe verify, never logged/returned.
- No secret/token/password in logs, errors, or analytics (redaction; audit meta sanitized).
- Exchange API secrets: **not stored** in Phase 2; `ICredentialVault` seam reserved for KMS
  envelope encryption (ciphertext-only) in a future gated phase.

## Abuse protection
- Login rate limit per ip+email (5/15min → 429 Retry-After) + audit `auth.ratelimited`.
- Generic auth errors (no user enumeration). Bot protection (captcha) = future beta gate.

## Threats addressed (delta over `docs/09-threat-model.md`)
| Threat | Control |
|---|---|
| Credential stuffing / brute force | rate limit + lockout + audit |
| Session theft via XSS | HttpOnly session cookie (not readable) |
| CSRF | double-submit token + SameSite=Lax |
| User enumeration | generic errors, constant-ish timing |
| Password disclosure | scrypt salted hash, timing-safe compare, no plaintext |
| Privilege escalation | RBAC middleware, role never self-granted |
| Session fixation | new id on login, server-side store |

## MFA-ready
`users.mfa_enabled` + an AuthService hook reserved for a future TOTP challenge step; the session
model does not change when MFA is added.
