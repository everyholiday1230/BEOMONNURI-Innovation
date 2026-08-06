# PHASE 3 — Migration & Rollback

- SQLite: `apps/api/src/db/migrations/0003_phase3_trading.sql` (auto-applied by the runner).
- Postgres: `infrastructure/postgres/0003_phase3_trading.postgres.sql` (+ `.down`). Runner
  `apps/api/src/db/pg.ts` applies UP in order and DOWN in reverse, transactionally, tracked in
  `schema_migrations`. Verified on real PostgreSQL 16 (up/down/re-up, unique/FK/index).
- Money/price/qty: TEXT (SQLite) / NUMERIC (PG). Never JS number for money.
- Rollback: `git checkout phase-2-approved-v0.2.0` (Phase 3 additive; app runs without trading tables).
  Feature flags: trading endpoints only mount when auth/db init succeeds; live disabled by default.
- Down migrations are DROP TABLE (data-destructive) → explicit operator action only.
