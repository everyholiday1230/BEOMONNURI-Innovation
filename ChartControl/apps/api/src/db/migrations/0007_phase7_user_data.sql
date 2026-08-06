-- 0007_phase7_user_data.sql
--
-- Phase 7 / Prompt 5 — persistence for the user data the UI was keeping in localStorage, plus the
-- optimistic-concurrency and provenance columns the new read models need.
--
-- Additive only. Every statement is IF NOT EXISTS or a nullable ADD COLUMN, so the migration is safe on
-- a clean database and on an already-populated one, and re-running it is a no-op (the runner is
-- forward-only and idempotent, and these statements are individually idempotent as well).
--
-- Rollback: see 0007_phase7_user_data.down.sql. The down script only drops what this file adds; it is
-- verified by the migration test rather than being assumed.

-- ---------------------------------------------------------------------------
-- Favourites. Previously localStorage only (Prompt 3 marked it BACKEND_REQUIRED as FAV-01/FAV-02).
--
-- One row per (user, symbol) rather than a JSON array so that: the uniqueness of a favourite is a
-- database constraint instead of application logic, a single toggle is one row write, and ordering is
-- explicit rather than dependent on array position.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT    NOT NULL,
  -- Explicit display order. Reordering does not have to rewrite the whole set.
  sort_index INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id, sort_index);

-- ---------------------------------------------------------------------------
-- Favourite-set version, held per user so PUT /api/me/favorites can use If-Match and a concurrent
-- edit from a second tab is a 409 instead of a silent overwrite. Kept in its own table because
-- `user_favorites` is one row per symbol — the version belongs to the SET, not to a row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_favorites_meta (
  user_id    TEXT    PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- Preferences: the table already existed (0001) with fixed columns and no version, so PUT could only
-- last-write-win. Adding a version lets the same optimistic-concurrency contract apply here too.
-- ---------------------------------------------------------------------------
ALTER TABLE user_preferences ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- Notifications: the table already existed (0002) but carried no severity, no read timestamp and no
-- correlation id, which the notification list and its read-state contract both need. `severity` is
-- constrained rather than free text so a rendering path cannot receive an unexpected value.
-- ---------------------------------------------------------------------------
ALTER TABLE notifications ADD COLUMN severity TEXT NOT NULL DEFAULT 'info';
ALTER TABLE notifications ADD COLUMN read_at INTEGER;
ALTER TABLE notifications ADD COLUMN correlation_id TEXT;
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read);

-- ---------------------------------------------------------------------------
-- Order drafts: the read model and the draft/validate contract both report where a value came from.
-- `source` records MOCK / SNAPSHOT / LIVE and `executable` records that a draft is NOT submittable —
-- stored rather than derived so an audit of the row alone shows it was never executable.
-- ---------------------------------------------------------------------------
ALTER TABLE order_drafts ADD COLUMN source TEXT NOT NULL DEFAULT 'MOCK';
ALTER TABLE order_drafts ADD COLUMN executable INTEGER NOT NULL DEFAULT 0;
