# PHASE 2 — Database Schema

Concrete store: **SQLite** (`better-sqlite3`) for dev/test (file-based, runnable in sandbox).
Written to be **Postgres-portable** (portable types, no SQLite-only features in the logical model).
Access is only through repository interfaces (`packages/auth/src/repositories.ts`), so swapping to
Postgres is an adapter change, not an app change.

## Tables (Phase 2 scope)

### users
| column | type (SQLite / Postgres) | notes |
|---|---|---|
| id | TEXT / UUID PK | uuid v4 |
| email | TEXT UNIQUE NOT NULL | lowercased, citext in PG |
| password_hash | TEXT NOT NULL | `scrypt$N$r$p$saltB64$hashB64` (no plaintext ever) |
| role | TEXT NOT NULL DEFAULT 'user' | 'user' \| 'admin' |
| status | TEXT NOT NULL DEFAULT 'active' | 'active' \| 'disabled' |
| mfa_enabled | INTEGER/BOOLEAN DEFAULT 0 | MFA-ready (not implemented) |
| created_at | INTEGER(ms)/TIMESTAMPTZ | UTC |
| updated_at | INTEGER(ms)/TIMESTAMPTZ | UTC |

### sessions
| column | type | notes |
|---|---|---|
| id | TEXT PK | opaque 256-bit token (base64url); the cookie value |
| user_id | TEXT NOT NULL FK→users(id) ON DELETE CASCADE | |
| csrf_secret | TEXT NOT NULL | bound to the session (double-submit) |
| created_at | INTEGER/TIMESTAMPTZ | |
| expires_at | INTEGER/TIMESTAMPTZ | idle+absolute expiry enforced in app |
| ip | TEXT | last-seen ip (redacted in logs) |
| user_agent | TEXT | truncated |

### roles / permissions (static seed + join)
Phase 2 uses a **code-defined** RBAC (see `PHASE2-04-rbac-matrix.md`) with a `roles` seed table for
future dynamic roles:
- `roles(name TEXT PK, description TEXT)` seeded with `user`, `admin`.

### user_preferences
| column | type | notes |
|---|---|---|
| user_id | TEXT PK FK→users(id) | |
| theme/brand/density/longshort/locale | TEXT | mirrors design-token variants |
| updated_at | INTEGER/TIMESTAMPTZ | |

### layouts (server persistence interface; opt-in)
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| user_id | TEXT FK→users(id) | |
| name | TEXT | |
| version | INTEGER | optimistic concurrency |
| data | TEXT (JSON) | validated by `LayoutSchema` before persist |
| updated_at | INTEGER/TIMESTAMPTZ | |

### audit_logs
| column | type | notes |
|---|---|---|
| id | TEXT PK | |
| actor_user_id | TEXT NULL | null for anonymous/system |
| action | TEXT NOT NULL | e.g. auth.register, auth.login.success/failure, auth.logout |
| target | TEXT NULL | affected entity |
| ip | TEXT NULL | |
| at | INTEGER/TIMESTAMPTZ NOT NULL | |
| meta | TEXT (JSON) NULL | sanitized (never passwords/secrets) |

### exchange_connections / encrypted_credentials (INTERFACE ONLY — not created in Phase 2)
Documented for future; Phase 2 provides the repository interface + envelope-encryption seam
(KMS) but creates **no** table and stores **no** secret (Production Release Gate / future).

## Indexing
- `users(email)` unique; `sessions(user_id)`, `sessions(expires_at)`; `audit_logs(at)`,
  `audit_logs(actor_user_id)`.

## Money/time rules (carried from `docs/04`)
All timestamps stored UTC (ms epoch in SQLite / TIMESTAMPTZ in PG). No money columns in Phase 2.
Decimal columns (future orders/balances) use NUMERIC in PG.

DDL files: `apps/api/src/db/migrations/0001_init.sql` (SQLite) and
`infrastructure/postgres/0001_init.postgres.sql` (Postgres).
