-- Phase 2 · 0001_init (SQLite). Postgres-portable logical schema; see
-- infrastructure/postgres/0001_init.postgres.sql for the Postgres DDL.
-- UP

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  status        TEXT NOT NULL DEFAULT 'active',
  mfa_enabled   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_secret TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS roles (
  name        TEXT PRIMARY KEY,
  description TEXT
);
INSERT OR IGNORE INTO roles(name, description) VALUES
  ('user', 'Registered end user'),
  ('admin', 'Administrator');

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme      TEXT,
  brand      TEXT,
  density    TEXT,
  longshort  TEXT,
  locale     TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS layouts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_layouts_user ON layouts(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  actor_user_id TEXT,
  action        TEXT NOT NULL,
  target        TEXT,
  ip            TEXT,
  at            INTEGER NOT NULL,
  meta          TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id);

-- DOWN (data-destructive; run only with explicit operator confirmation)
-- DROP TABLE audit_logs; DROP TABLE layouts; DROP TABLE user_preferences;
-- DROP TABLE roles; DROP TABLE sessions; DROP TABLE users;
