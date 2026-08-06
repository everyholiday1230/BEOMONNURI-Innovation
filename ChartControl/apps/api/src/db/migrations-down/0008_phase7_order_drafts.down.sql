-- 0008_phase7_order_drafts.down.sql
--
-- Rollback for 0008. Drops ONLY what 0008 adds, leaving the 0007 shape of `order_drafts` intact
-- (`source` and `executable` belong to 0007 and are NOT touched here).
--
-- Indexes are dropped before the columns they reference: SQLite will refuse to drop a column that an
-- index still depends on, so the order is a correctness requirement, not a style choice.

DROP INDEX IF EXISTS idx_order_drafts_user_created;
DROP INDEX IF EXISTS idx_order_drafts_idem;

ALTER TABLE order_drafts DROP COLUMN allowed;
ALTER TABLE order_drafts DROP COLUMN valid;
ALTER TABLE order_drafts DROP COLUMN idempotency_key;
ALTER TABLE order_drafts DROP COLUMN updated_at;
ALTER TABLE order_drafts DROP COLUMN version;

DELETE FROM schema_migrations WHERE version = '0008_phase7_order_drafts';
