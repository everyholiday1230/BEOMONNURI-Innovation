-- 0011 — G6 strategy gallery (PostgreSQL).
-- See apps/api/src/db/migrations/0011_phase8_strategies.sql for the rationale; there is deliberately no
-- `strategies` table because the catalogue is code.

CREATE TABLE IF NOT EXISTS strategy_backtests (
  id            TEXT PRIMARY KEY,
  strategy_id   TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  from_time     BIGINT NOT NULL,
  to_time       BIGINT NOT NULL,
  bar_count     INTEGER NOT NULL,
  input_hash    TEXT NOT NULL,
  result_json   JSONB NOT NULL,
  total_return_pct DOUBLE PRECISION NOT NULL,
  -- NULL where the metric is undefined, never 0.
  win_rate_pct     DOUBLE PRECISION,
  max_drawdown_pct DOUBLE PRECISION NOT NULL,
  sharpe           DOUBLE PRECISION,
  trade_count      INTEGER NOT NULL,
  computed_at   BIGINT NOT NULL,
  UNIQUE (strategy_id, symbol, timeframe, from_time, to_time, input_hash)
);
CREATE INDEX IF NOT EXISTS idx_backtests_lookup ON strategy_backtests(strategy_id, symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_backtests_computed ON strategy_backtests(computed_at);

CREATE TABLE IF NOT EXISTS strategy_follows (
  id          TEXT PRIMARY KEY,
  -- UUID, not TEXT: `users.id` is UUID in Postgres and a TEXT foreign key is rejected outright
  -- ("foreign key constraint cannot be implemented"). SQLite does not enforce the type, so this only
  -- surfaced against a real Postgres instance.
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  timeframe   TEXT NOT NULL,
  note        TEXT,
  created_at  BIGINT NOT NULL,
  UNIQUE (user_id, strategy_id, symbol, timeframe)
);
CREATE INDEX IF NOT EXISTS idx_follows_user ON strategy_follows(user_id);
