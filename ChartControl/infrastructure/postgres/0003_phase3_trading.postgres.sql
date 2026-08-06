-- Phase 3 · 0003 (PostgreSQL UP). Trading domain. Decimal columns use NUMERIC.
CREATE TABLE IF NOT EXISTS exchange_credentials (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange TEXT NOT NULL DEFAULT 'bitmart', label TEXT,
  access_key_masked TEXT NOT NULL, encrypted_access_key TEXT NOT NULL, encrypted_secret_key TEXT NOT NULL,
  encrypted_memo TEXT NOT NULL, wrapped_dek TEXT NOT NULL, encryption_key_version TEXT NOT NULL, algo TEXT NOT NULL,
  permissions_verified BOOLEAN NOT NULL DEFAULT FALSE, ip_whitelist_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  connection_status TEXT NOT NULL DEFAULT 'UNVERIFIED', last_verified_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_excred_user ON exchange_credentials(user_id);

CREATE TABLE IF NOT EXISTS exchange_connections (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES exchange_credentials(id) ON DELETE CASCADE,
  mode TEXT NOT NULL, status TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trading_policies (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'global', user_id UUID,
  allowed_symbols TEXT NOT NULL, max_order_notional NUMERIC NOT NULL, max_leverage INTEGER NOT NULL,
  max_open_positions INTEGER NOT NULL, daily_order_limit INTEGER NOT NULL, daily_loss_limit NUMERIC NOT NULL,
  price_deviation_limit_pct NUMERIC NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS order_intents (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, credential_id TEXT,
  symbol TEXT NOT NULL, side TEXT NOT NULL, type TEXT NOT NULL, data JSONB NOT NULL, correlation_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intents_user ON order_intents(user_id);
CREATE TABLE IF NOT EXISTS orders (
  internal_order_id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, credential_id TEXT,
  client_order_id TEXT NOT NULL, exchange_order_id TEXT, idempotency_key TEXT, correlation_id TEXT,
  symbol TEXT NOT NULL, side TEXT NOT NULL, type TEXT NOT NULL, price NUMERIC, quantity NUMERIC NOT NULL,
  filled_quantity NUMERIC NOT NULL DEFAULT 0, status TEXT NOT NULL, mode TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_order_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY, internal_order_id TEXT NOT NULL REFERENCES orders(internal_order_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, from_state TEXT, to_state TEXT NOT NULL, actor TEXT NOT NULL, seq INTEGER, at TIMESTAMPTZ NOT NULL DEFAULT now(), meta JSONB
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(internal_order_id);
CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY, internal_order_id TEXT NOT NULL REFERENCES orders(internal_order_id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, exec_id TEXT, price NUMERIC NOT NULL, quantity NUMERIC NOT NULL,
  fee NUMERIC, liquidity TEXT, at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (internal_order_id, exec_id)
);
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT NOT NULL, side TEXT NOT NULL,
  size NUMERIC NOT NULL, entry_price NUMERIC, mark_price NUMERIC, liquidation_price NUMERIC, leverage INTEGER, margin_mode TEXT,
  unrealized_pnl NUMERIC, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (user_id, symbol, side)
);
CREATE TABLE IF NOT EXISTS position_snapshots (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, symbol TEXT NOT NULL, data JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS account_balances (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, asset TEXT NOT NULL, available NUMERIC NOT NULL, equity NUMERIC NOT NULL, used NUMERIC NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS risk_checks (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, internal_order_id TEXT, passed BOOLEAN NOT NULL, fail_count INTEGER NOT NULL, gates JSONB NOT NULL, live_gate_allowed BOOLEAN NOT NULL, reasons JSONB, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id TEXT PRIMARY KEY, user_id UUID, trigger TEXT NOT NULL, result TEXT NOT NULL, mismatches INTEGER NOT NULL DEFAULT 0, detail JSONB, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS exchange_websocket_sessions (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, status TEXT NOT NULL, connected_at TIMESTAMPTZ, disconnected_at TIMESTAMPTZ, reconnects INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS idempotency_records (
  idempotency_key TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, result JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trading_kill_switches (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, target TEXT, active BOOLEAN NOT NULL DEFAULT TRUE, allow_cancel_reduce BOOLEAN NOT NULL DEFAULT TRUE, reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT
);
