-- 0011 — G6 strategy gallery.
--
-- The strategy CATALOGUE is code (`@quantumtrade/strategy`), not data: the delivered design listed
-- user-authored strategies with subscription tiers, and neither feature exists. So there is no `strategies`
-- table — a row per strategy would invite editing a rule set's stated logic without changing the code that
-- runs, which is how a description stops matching behaviour.
--
-- What IS stored: cached backtest results, and per-user follow state.

-- Backtest results, cached by their EXACT inputs.
-- A backtest is only reproducible for the same window and the same parameters, so the cache key includes
-- both. `input_hash` covers the config (fees, slippage, equity, position fraction) so a fee change cannot
-- silently serve the old numbers.
CREATE TABLE IF NOT EXISTS strategy_backtests (
  id            TEXT PRIMARY KEY,
  strategy_id   TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  timeframe     TEXT NOT NULL,
  from_time     INTEGER NOT NULL,
  to_time       INTEGER NOT NULL,
  bar_count     INTEGER NOT NULL,
  input_hash    TEXT NOT NULL,
  -- Full result as JSON: metrics, trades, equity curve, config and caveats travel together so a consumer
  -- cannot read a metric without the window and assumptions that produced it.
  result_json   TEXT NOT NULL,
  -- Denormalised for sorting a gallery without parsing every blob. NULL where the metric is undefined
  -- (no closed trade has no win rate; a flat curve has no Sharpe) — never 0.
  total_return_pct   REAL NOT NULL,
  win_rate_pct       REAL,
  max_drawdown_pct   REAL NOT NULL,
  sharpe             REAL,
  trade_count        INTEGER NOT NULL,
  computed_at   INTEGER NOT NULL,
  UNIQUE (strategy_id, symbol, timeframe, from_time, to_time, input_hash)
);
CREATE INDEX IF NOT EXISTS idx_backtests_lookup ON strategy_backtests(strategy_id, symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_backtests_computed ON strategy_backtests(computed_at);

-- Per-user follow state. Following records interest; it does NOT copy trades.
-- There is no auto-execution: Approve Signal is not Submit Order, and neither is Follow.
CREATE TABLE IF NOT EXISTS strategy_follows (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_id TEXT NOT NULL,
  symbol      TEXT NOT NULL,
  timeframe   TEXT NOT NULL,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (user_id, strategy_id, symbol, timeframe)
);
CREATE INDEX IF NOT EXISTS idx_follows_user ON strategy_follows(user_id);
