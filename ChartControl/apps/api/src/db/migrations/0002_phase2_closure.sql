-- Phase 2 Closure · 0002 (SQLite). Additive to 0001. Postgres mirror:
-- infrastructure/postgres/0002_phase2_closure.postgres.sql. All user-owned tables carry user_id
-- (FK, ON DELETE CASCADE) for cross-user isolation. Tokens store HASH only (never plaintext).
-- UP

-- MFA-ready columns (mfa_enabled already exists in 0001).
ALTER TABLE users ADD COLUMN mfa_secret TEXT;
ALTER TABLE users ADD COLUMN mfa_type TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

-- Structured audit fields (actor/action already exist; add result + trace + request id).
ALTER TABLE audit_logs ADD COLUMN result TEXT;
ALTER TABLE audit_logs ADD COLUMN trace_id TEXT;

-- Auth lifecycle tokens (hash + expiry + single-use).
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);

-- RBAC (permission-based). roles seeded in 0001; add permissions + join tables.
CREATE TABLE IF NOT EXISTS permissions (name TEXT PRIMARY KEY, description TEXT);
CREATE TABLE IF NOT EXISTS role_permissions (role TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY (role, permission));
CREATE TABLE IF NOT EXISTS user_roles (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, PRIMARY KEY (user_id, role));

INSERT OR IGNORE INTO roles(name, description) VALUES
  ('USER','Standard user'),('PRO_USER','Pro user'),('SUPPORT','Support agent'),
  ('ANALYST','Analyst'),('ADMIN','Administrator'),('SUPER_ADMIN','Super administrator');
INSERT OR IGNORE INTO permissions(name, description) VALUES
  ('account.read.self',''),('account.update.self',''),('layout.read.self',''),('layout.write.self',''),
  ('signal.read.self',''),('signal.write.self',''),('order-draft.read.self',''),('order-draft.write.self',''),
  ('support.user.read',''),('audit.read',''),('role.manage',''),('system.admin','');

-- Persisted user-owned domain data.
CREATE TABLE IF NOT EXISTS layout_versions (
  id TEXT PRIMARY KEY, layout_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_layout_versions_user ON layout_versions(user_id);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_msg_user ON ai_messages(user_id);

CREATE TABLE IF NOT EXISTS ai_signals (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, timeframe TEXT, direction TEXT, status TEXT NOT NULL DEFAULT 'PROPOSED',
  data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_signals_user ON ai_signals(user_id);

CREATE TABLE IF NOT EXISTS signal_versions (
  id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES ai_signals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signal_versions_user ON signal_versions(user_id);

CREATE TABLE IF NOT EXISTS chart_overlays (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overlays_user ON chart_overlays(user_id);

CREATE TABLE IF NOT EXISTS order_drafts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, side TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_drafts_user ON order_drafts(user_id);

CREATE TABLE IF NOT EXISTS simulation_orders (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_order_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
  status TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (user_id, client_order_id)
);
CREATE INDEX IF NOT EXISTS idx_sim_orders_user ON simulation_orders(user_id);

CREATE TABLE IF NOT EXISTS simulation_order_events (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES simulation_orders(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_state TEXT, to_state TEXT NOT NULL, actor TEXT NOT NULL, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sim_events_order ON simulation_order_events(order_id);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, condition TEXT NOT NULL, data TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, message TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id);

-- DOWN (data-destructive; explicit operator confirmation required)
-- DROP TABLE usage_records; DROP TABLE notifications; DROP TABLE alerts;
-- DROP TABLE simulation_order_events; DROP TABLE simulation_orders; DROP TABLE order_drafts;
-- DROP TABLE chart_overlays; DROP TABLE signal_versions; DROP TABLE ai_signals;
-- DROP TABLE ai_messages; DROP TABLE ai_conversations; DROP TABLE layout_versions;
-- DROP TABLE user_roles; DROP TABLE role_permissions; DROP TABLE permissions;
-- DROP TABLE password_reset_tokens; DROP TABLE email_verification_tokens;
