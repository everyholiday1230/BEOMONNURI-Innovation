-- Phase 7 · 0007 (PostgreSQL). User-data persistence parity with SQLite 0007_phase7_user_data.sql.
-- Favourites (one row per user+symbol), favourite-set version, preferences optimistic version, and the
-- notification / order-draft provenance columns. Additive; safe on clean and populated databases. UP

-- Favourites: one row per (user, symbol) so uniqueness is a DB constraint and ordering is explicit.
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id    UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT    NOT NULL,
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT  NOT NULL,
  PRIMARY KEY (user_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id, sort_index);

-- Favourite-SET version (belongs to the set, not a row) — powers If-Match optimistic concurrency.
CREATE TABLE IF NOT EXISTS user_favorites_meta (
  user_id    UUID    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at BIGINT  NOT NULL
);

-- Preferences optimistic version (table exists from 0001).
ALTER TABLE user_preferences ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- Notifications: severity (constrained default), read timestamp, correlation id (table exists from 0002).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at BIGINT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS correlation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read);

-- Order-draft provenance (table exists from 0002). `executable` stored (0/1) so an audit of the row
-- alone shows it was never submittable.
ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MOCK';
ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS executable INTEGER NOT NULL DEFAULT 0;
