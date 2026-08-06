# PHASE 2 — Migration & Rollback Plan

## Migration mechanism
- **Forward-only, ordered SQL files** run by a tiny idempotent runner in `apps/api/src/db/sqlite.ts`.
- A `schema_migrations(version TEXT PK, applied_at INTEGER)` table records applied migrations;
  the runner applies any file whose version is absent, inside a transaction.
- SQLite (dev/test): `apps/api/src/db/migrations/000N_*.sql`.
- Postgres (prod-portable): `infrastructure/postgres/000N_*.postgres.sql` (same logical schema).
- DB path via `DATABASE_URL` (Postgres) or `SQLITE_PATH` (default `apps/api/.data/quantumtrade.db`);
  tests use an in-memory / temp-file DB so they never touch dev data.

## Phase 2 migrations
- `0001_init`: `schema_migrations`, `users`, `sessions`, `roles`(seed user/admin),
  `user_preferences`, `layouts`, `audit_logs`. (No exchange-credentials table — interface only.)

## Apply / verify
```
# dev (SQLite): auto-migrates on BFF boot; or explicitly:
pnpm --filter @quantumtrade/api run migrate
# verify:
sqlite3 apps/api/.data/quantumtrade.db '.tables'   # or a repo integration test
```

## Rollback strategy
1. **Code rollback (safest):** `git checkout phase-1-approved-v0.1.0` — Phase 1 has NO DB dependency,
   so the app runs exactly as approved with the DB simply unused.
2. **Feature flag:** `AUTH_ENABLED=false` disables mounting `/api/auth/*` + `/api/account/*` and DB
   init; the rest of the app is unaffected (auth is additive).
3. **Schema rollback:** each migration ships a documented inverse (`-- DOWN` section). Since Phase 2
   only ADDS tables, the down step is `DROP TABLE` for the added tables (data-destructive → requires
   explicit operator confirmation; not run automatically).
4. **Data safety:** migrations are transactional; a failed migration rolls back its transaction and
   the runner aborts boot with a clear error (no partial schema).

## Forward-compatibility to Postgres
- No SQLite-only SQL in the logical model; types map cleanly (TEXT→UUID/citext/TEXT,
  INTEGER-ms→TIMESTAMPTZ). Switching stores = point `DATABASE_URL` at Postgres + run the
  `infrastructure/postgres/*` migrations; repositories are swapped by config, app code unchanged.

## Regression protection during migration work
Every migration/repo change re-runs the Phase-1 suite (99 unit + 9 e2e). Auth/DB code is isolated;
if DB init fails, market/sim/ai endpoints remain fully functional (auth endpoints return 503).
