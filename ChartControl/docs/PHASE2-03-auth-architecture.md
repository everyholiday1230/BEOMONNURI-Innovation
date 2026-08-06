# PHASE 2 — Authentication Architecture

## Overview
Server-side session authentication (opaque session cookie), scrypt password hashing, CSRF
double-submit, RBAC, login rate limiting, and audit logging. Framework-agnostic core in
`packages/auth`; the Hono BFF wires it to HTTP + cookies + SQLite repos.

```
Browser ──(HTTPS)──▶ Hono BFF /api/auth/* ──▶ AuthService (packages/auth)
                          │  cookie+CSRF mw        ├─ password.hash/verify (scrypt)
                          │                          ├─ session.create/validate (opaque token)
                          │                          ├─ rbac.can(role, permission)
                          ▼                          └─ repositories (IUser/ISession/IAudit)
                    Set-Cookie: qt_session (HttpOnly, Secure*, SameSite=Lax)          │
                    Set-Cookie: qt_csrf (readable; double-submit)                     ▼
                                                                        SQLite (dev) / Postgres (prod)
```
`*Secure` is on by default and disabled only when `AUTH_COOKIE_INSECURE=true` for local http dev.

## Password hashing (node:crypto scrypt — no external dep)
- On register: generate 16-byte random salt; `scrypt(password, salt, 64, {N:16384,r:8,p:1})`.
- Stored format: `scrypt$16384$8$1$<saltB64url>$<hashB64url>`. Never store/return plaintext.
- Verify: re-derive with stored params; **timing-safe** compare (`crypto.timingSafeEqual`).
- Password policy: min 10 chars, not equal to email (zod-validated); tunable.

## Session lifecycle
- Login success → `sessionId = base64url(randomBytes(32))`, persisted with `csrf_secret`,
  `expires_at = now + idleTTL` (default 12h) and an absolute cap (default 7d).
- Each authenticated request validates the session (exists, not expired), sliding idle refresh.
- Logout → delete session row + clear cookies.
- Cookies: `qt_session` (HttpOnly, Secure, SameSite=Lax, Path=/) — not readable by JS;
  `qt_csrf` (Secure, SameSite=Lax, readable) carrying the CSRF token.

## CSRF (double-submit, session-bound)
- `GET /api/auth/csrf` sets `qt_csrf` = token derived from the session's `csrf_secret`.
- State-changing auth/account requests require header `X-CSRF-Token` == cookie value; mismatch →
  403. GET/read endpoints and the existing `/api/market/*` are exempt (unchanged behavior).

## Rate limiting & lockout
- Login attempts limited per (ip + email): e.g. 5 failures / 15 min → 429 with `Retry-After`.
- In-memory limiter in Phase 2 (single node); Redis-backed in the scaling gate.

## Audit logging
- `auth.register`, `auth.login.success`, `auth.login.failure`, `auth.logout`, `auth.ratelimited`
  written to `audit_logs` with ip + sanitized meta (never password/secret/token).

## Error sanitization
- Login returns a generic “invalid credentials” for both unknown-email and wrong-password (no user
  enumeration). Internal errors → 500 with correlationId, no stack to client.

## MFA-ready / provider-swappable
- `users.mfa_enabled` reserved; AuthService exposes seams for a future TOTP step and for external
  IdP/OAuth adapters without changing the session model.

## Exchange credential storage (INTERFACE ONLY)
- `ICredentialVault` interface with `encrypt(envelope)/decrypt` seam for future AWS KMS envelope
  encryption; **ciphertext-only** persistence, **no plaintext**, strict access. Not wired in
  Phase 2; withdrawal-disabled keys recommended (future).
