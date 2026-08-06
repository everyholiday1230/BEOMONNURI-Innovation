-- 0007_phase7_user_data.down.sql
--
-- Rollback for 0007. Drops ONLY what 0007 adds.
--
-- The forward runner is forward-only by design, so this is not applied automatically; it exists so the
-- rollback path is executable and testable rather than a claim in a document. The migration test applies
-- 0007, writes rows, runs this script, and asserts the schema is back to its 0006 shape.
--
-- SQLite has supported `ALTER TABLE ... DROP COLUMN` since 3.35 (better-sqlite3 ships far newer), so the
-- added columns are dropped directly rather than by table rebuild. Dropping a column is destructive for
-- the data in it — that is inherent to rolling back an additive migration and is why the test asserts
-- only the SCHEMA returns, not the data.

DROP INDEX IF EXISTS idx_notifications_user_unread;
DROP INDEX IF EXISTS idx_notifications_user_created;
DROP INDEX IF EXISTS idx_user_favorites_user;

DROP TABLE IF EXISTS user_favorites_meta;
DROP TABLE IF EXISTS user_favorites;

ALTER TABLE order_drafts DROP COLUMN executable;
ALTER TABLE order_drafts DROP COLUMN source;

ALTER TABLE notifications DROP COLUMN correlation_id;
ALTER TABLE notifications DROP COLUMN read_at;
ALTER TABLE notifications DROP COLUMN severity;

ALTER TABLE user_preferences DROP COLUMN version;

DELETE FROM schema_migrations WHERE version = '0007_phase7_user_data';
