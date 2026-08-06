-- Phase 2 · 0001_init (PostgreSQL). Same logical schema as the SQLite migration.
-- Requires: CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; (or use gen_random_uuid via pgcrypto)

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  status        TEXT NOT NULL DEFAULT 'active',
  mfa_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_secret TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS roles (name TEXT PRIMARY KEY, description TEXT);
INSERT INTO roles(name, description) VALUES ('user','Registered end user'),('admin','Administrator')
  ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme TEXT, brand TEXT, density TEXT, longshort TEXT, locale TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS layouts (
  id         TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_layouts_user ON layouts(user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  actor_user_id UUID,
  action        TEXT NOT NULL,
  target        TEXT,
  ip            TEXT,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta          JSONB
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_logs(at);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id);
