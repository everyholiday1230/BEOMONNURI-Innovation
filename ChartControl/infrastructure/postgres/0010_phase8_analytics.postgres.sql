-- Phase 8 · 0010 (PostgreSQL). Trade journal + realized PnL. Parity with SQLite
-- apps/api/src/db/migrations/0010_phase8_analytics.sql. Additive. UP
--
-- A journal entry is a ROUND TRIP (entry → exit → realized PnL), which cannot be derived from
-- `executions`: nothing there records whether a fill opened or closed a position (`orders.side` is the
-- direction, not the intent). This adds `orders.reduce_only` so that derivation becomes possible for new
-- orders, and `trade_journal` to hold closed trips with the user annotations the design requires.
--
-- Money stays in TEXT decimal strings, matching every other money column in this schema.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS reduce_only INTEGER;

CREATE TABLE IF NOT EXISTS trade_journal (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  symbol TEXT NOT NULL,
  side TEXT NOT NULL,

  entry_price TEXT NOT NULL,
  exit_price TEXT NOT NULL,
  size TEXT NOT NULL,
  realized_pnl TEXT NOT NULL,
  fees TEXT,
  roi_pct TEXT,

  opened_at BIGINT NOT NULL,
  closed_at BIGINT NOT NULL,

  mood TEXT,
  tags TEXT,
  note TEXT,

  source TEXT NOT NULL DEFAULT 'manual',
  open_order_id TEXT,
  close_order_id TEXT,

  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trade_journal_user_closed ON trade_journal(user_id, closed_at);
CREATE INDEX IF NOT EXISTS idx_trade_journal_user_symbol ON trade_journal(user_id, symbol);
