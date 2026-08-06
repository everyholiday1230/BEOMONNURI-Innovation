# PHASE 2 — Implementation Plan · Authentication, User Account, Database Persistence & Security Foundation

Builds **additively** on the frozen Phase 1 baseline (`v0.1.0` @ `1a43f8e`). No refactor of approved
code. All Phase-1 protected features must keep working (see `PHASE2-01-regression-risk.md`).

## Goals
1. Persistent storage foundation with a swappable repository layer (SQLite now, Postgres-portable).
2. Secure authentication: register/login/logout/session, scrypt password hashing.
3. Session + CSRF + secure cookies + security headers (CSP tightening path).
4. RBAC (user/admin) with a permission matrix + middleware.
5. Login rate limiting + audit logging + error sanitization.
6. User account + preferences persistence; server-side layout persistence interface (opt-in).

## Non-goals (stay out of scope — remain in gates/future)
Real exchange keys / KMS envelope encryption (interface only), production trading, central market
data gateway (Production Release Gate), OAuth/MFA (MFA-ready structure only).

## Package/topology (additive)
```
packages/auth/                 (NEW, framework-agnostic, no native deps → unit-testable)
  src/password.ts              scrypt hash/verify
  src/session.ts               opaque token gen, expiry
  src/csrf.ts                  double-submit token verify
  src/rbac.ts                  roles, permissions, can()
  src/service.ts               AuthService (register/login/logout/me) over repository interfaces
  src/repositories.ts          IUserRepository / ISessionRepository / IAuditRepository
  src/memory-repo.ts           in-memory impl (tests/dev)
  src/schemas.ts               zod: RegisterInput / LoginInput
apps/api/src/db/               (NEW, server-only; better-sqlite3)
  sqlite.ts                    connection + migrate runner
  repos.ts                     SQLite-backed repositories (implement packages/auth interfaces)
  migrations/0001_init.sql     users/sessions/roles/audit_logs/user_preferences (SQLite)
infrastructure/postgres/       (NEW) 0001_init.postgres.sql  (Postgres-portable DDL)
apps/api/src/auth-routes.ts    (NEW) /api/auth/* + /api/account/* ; mounted in index.ts (existing routes untouched)
apps/web/src/app/AuthPages.tsx (WIRE existing stub → real endpoints; login stays OPTIONAL)
```

## Endpoints (new namespaces only)
- `GET  /api/auth/csrf` → issues CSRF cookie + token.
- `POST /api/auth/register` {email,password} → creates user (role=user), audit.
- `POST /api/auth/login` {email,password} + CSRF → sets session cookie, audit, rate-limited.
- `POST /api/auth/logout` + CSRF → destroys session.
- `GET  /api/auth/me` → current user (or 401).
- `GET/PUT /api/account/preferences` (auth required) → user_preferences.

Existing `/api/market/*`, `/api/sim/*`, `/api/ai/*`, `/health`, `/ready`, `/api/config` **unchanged**.

## Phased steps (each ends green: 99 existing tests + new tests)
1. `packages/auth` primitives + service + in-memory repo + unit tests. (no server change yet)
2. SQLite adapter + migrations in apps/api; repo integration tests.
3. Mount `/api/auth/*` + `/api/account/*` in BFF behind cookie/CSRF middleware; API tests.
4. Wire web AuthPages (optional login; no gating of /trade). Keep e2e green; add 1 auth e2e.
5. Full regression: `pnpm lint/typecheck/test/build/e2e` + new suites. Update docs.

## Verification gates for Phase 2 completion
- All Phase-1 tests still pass (99 unit, 9 Chromium e2e).
- New: auth unit tests (hash/session/csrf/rbac), repo tests (memory+sqlite), api tests (register/
  login/logout/me/csrf/rate-limit/rbac), 1 auth e2e.
- No secret in logs/responses; cookies HttpOnly+SameSite; 401/403 sanitized.
