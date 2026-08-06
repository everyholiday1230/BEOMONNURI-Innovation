-- Phase 7 · 0007 (PostgreSQL DOWN). Reverse order; drops ONLY what 0007 adds. Data-destructive.
DROP INDEX IF EXISTS idx_notifications_user_unread;
DROP INDEX IF EXISTS idx_notifications_user_created;
DROP INDEX IF EXISTS idx_user_favorites_user;

ALTER TABLE order_drafts DROP COLUMN IF EXISTS executable;
ALTER TABLE order_drafts DROP COLUMN IF EXISTS source;

ALTER TABLE notifications DROP COLUMN IF EXISTS correlation_id;
ALTER TABLE notifications DROP COLUMN IF EXISTS read_at;
ALTER TABLE notifications DROP COLUMN IF EXISTS severity;

ALTER TABLE user_preferences DROP COLUMN IF EXISTS version;

DROP TABLE IF EXISTS user_favorites_meta;
DROP TABLE IF EXISTS user_favorites;
