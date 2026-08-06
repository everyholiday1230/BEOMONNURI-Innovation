-- Phase 8 · 0010 (PostgreSQL DOWN). Reverse order; drops ONLY what 0010 adds. Data-destructive:
-- dropping `trade_journal` discards every journal entry and its annotations.
DROP INDEX IF EXISTS idx_trade_journal_user_symbol;
DROP INDEX IF EXISTS idx_trade_journal_user_closed;
DROP TABLE IF EXISTS trade_journal;

ALTER TABLE orders DROP COLUMN IF EXISTS reduce_only;
