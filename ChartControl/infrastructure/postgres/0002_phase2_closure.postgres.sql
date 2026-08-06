-- Phase 2 Closure · 0002 (PostgreSQL UP). Mirrors apps/api/src/db/migrations/0002_phase2_closure.sql.

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS result TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS trace_id TEXT;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);

CREATE TABLE IF NOT EXISTS permissions (name TEXT PRIMARY KEY, description TEXT);
CREATE TABLE IF NOT EXISTS role_permissions (role TEXT NOT NULL, permission TEXT NOT NULL, PRIMARY KEY (role, permission));
CREATE TABLE IF NOT EXISTS user_roles (user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL, PRIMARY KEY (user_id, role));

INSERT INTO roles(name, description) VALUES
  ('USER','Standard user'),('PRO_USER','Pro user'),('SUPPORT','Support agent'),
  ('ANALYST','Analyst'),('ADMIN','Administrator'),('SUPER_ADMIN','Super administrator')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO permissions(name, description) VALUES
  ('account.read.self',''),('account.update.self',''),('layout.read.self',''),('layout.write.self',''),
  ('signal.read.self',''),('signal.write.self',''),('order-draft.read.self',''),('order-draft.write.self',''),
  ('support.user.read',''),('audit.read',''),('role.manage',''),('system.admin','')
  ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS layout_versions (
  id TEXT PRIMARY KEY, layout_id TEXT NOT NULL, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_layout_versions_user ON layout_versions(user_id);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_conv_user ON ai_conversations(user_id);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_msg_conv ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_msg_user ON ai_messages(user_id);

CREATE TABLE IF NOT EXISTS ai_signals (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, timeframe TEXT, direction TEXT, status TEXT NOT NULL DEFAULT 'PROPOSED',
  data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_signals_user ON ai_signals(user_id);

CREATE TABLE IF NOT EXISTS signal_versions (
  id TEXT PRIMARY KEY, signal_id TEXT NOT NULL REFERENCES ai_signals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_signal_versions_user ON signal_versions(user_id);

CREATE TABLE IF NOT EXISTS chart_overlays (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, kind TEXT NOT NULL, data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_overlays_user ON chart_overlays(user_id);

CREATE TABLE IF NOT EXISTS order_drafts (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, side TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_order_drafts_user ON order_drafts(user_id);

CREATE TABLE IF NOT EXISTS simulation_orders (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_order_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL,
  status TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_order_id)
);
CREATE INDEX IF NOT EXISTS idx_sim_orders_user ON simulation_orders(user_id);

CREATE TABLE IF NOT EXISTS simulation_order_events (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES simulation_orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_state TEXT, to_state TEXT NOT NULL, actor TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sim_events_order ON simulation_order_events(order_id);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, condition TEXT NOT NULL, data JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, message TEXT NOT NULL, read BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id);
