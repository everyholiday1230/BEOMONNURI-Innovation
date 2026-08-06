-- 0010_phase8_analytics.sql
--
-- Phase 8 — G7 trade journal + realized PnL.
--
-- WHY A NEW TABLE RATHER THAN A VIEW OVER `executions`
--
-- `executions` records individual fills (price, quantity, fee, liquidity, at). A journal entry is a
-- ROUND TRIP: an entry price, an exit price and the realized PnL between them. Those cannot be derived
-- from the current fill data, because nothing records whether a fill OPENED or CLOSED a position:
-- `orders.side` is the direction ('long'/'short'), not the intent. FIFO matching over fills would have
-- to guess, and a guessed realized PnL is worse than none.
--
-- So this migration does two things:
--   1. adds `orders.reduce_only`, which is what makes future automatic derivation possible at all, and
--   2. adds `trade_journal`, which stores closed round trips with an explicit realized PnL plus the
--      user's own annotations (mood / tags / note) that the design calls for.
--
-- Automatic population from fills is NOT implemented here. It needs `reduce_only` to be present on new
-- orders (from now on) and a matching job; until then entries are created explicitly. The API reports
-- which source an entry came from so a derived row is never confused with a hand-recorded one.
--
-- Additive only: one nullable ADD COLUMN and one CREATE TABLE IF NOT EXISTS.
-- Rollback: infrastructure/postgres/0010_phase8_analytics.down.postgres.sql (PostgreSQL).

-- Records order intent. NULL for every pre-existing row: unknown, not false — claiming a historical
-- order was not reduce-only would be an assertion we cannot support.
ALTER TABLE orders ADD COLUMN reduce_only INTEGER;

CREATE TABLE IF NOT EXISTS trade_journal (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  symbol TEXT NOT NULL,
  -- Direction of the round trip: 'long' | 'short'.
  side TEXT NOT NULL,

  -- Decimal STRINGS, like every other money column in this schema. Storing REAL would reintroduce the
  -- float drift the rest of the codebase goes out of its way to avoid.
  entry_price TEXT NOT NULL,
  exit_price TEXT NOT NULL,
  size TEXT NOT NULL,
  realized_pnl TEXT NOT NULL,
  fees TEXT,

  -- Return on the position, as a decimal string percentage. Nullable: it needs a cost basis, and a
  -- zero-notional entry has none.
  roi_pct TEXT,

  opened_at INTEGER NOT NULL,
  closed_at INTEGER NOT NULL,

  -- User annotations. All optional — a journal entry is useful without them.
  mood TEXT,
  -- JSON array of short tags. Stored as text for SQLite/PostgreSQL parity with the rest of the schema.
  tags TEXT,
  note TEXT,

  -- 'manual' when a user recorded it, 'derived' when a matching job produced it from fills. Recorded so
  -- a derived number is never presented as a user-confirmed one.
  source TEXT NOT NULL DEFAULT 'manual',
  -- Optional links back to the orders that opened and closed the position.
  open_order_id TEXT,
  close_order_id TEXT,

  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- The two read paths: "my journal, newest first" and "PnL for a date range".
CREATE INDEX IF NOT EXISTS idx_trade_journal_user_closed ON trade_journal(user_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_trade_journal_user_symbol ON trade_journal(user_id, symbol);
