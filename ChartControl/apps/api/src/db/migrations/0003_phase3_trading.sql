-- Phase 3 · 0003 (SQLite). Trading domain. User-scoped + credential-scoped. Money/price/qty are
-- TEXT (Decimal); never JS number. Postgres mirror: infrastructure/postgres/0003_phase3_trading.*.
-- UP

CREATE TABLE IF NOT EXISTS exchange_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exchange TEXT NOT NULL DEFAULT 'bitmart',
  label TEXT,
  access_key_masked TEXT NOT NULL,
  encrypted_access_key TEXT NOT NULL,
  encrypted_secret_key TEXT NOT NULL,
  encrypted_memo TEXT NOT NULL,
  wrapped_dek TEXT NOT NULL,
  encryption_key_version TEXT NOT NULL,
  algo TEXT NOT NULL,
  permissions_verified INTEGER NOT NULL DEFAULT 0,
  ip_whitelist_confirmed INTEGER NOT NULL DEFAULT 0,
  connection_status TEXT NOT NULL DEFAULT 'UNVERIFIED',
  last_verified_at INTEGER, last_used_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_excred_user ON exchange_credentials(user_id);

CREATE TABLE IF NOT EXISTS exchange_connections (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL REFERENCES exchange_credentials(id) ON DELETE CASCADE,
  mode TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trading_policies (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'global', user_id TEXT,
  allowed_symbols TEXT NOT NULL, max_order_notional TEXT NOT NULL, max_leverage INTEGER NOT NULL,
  max_open_positions INTEGER NOT NULL, daily_order_limit INTEGER NOT NULL, daily_loss_limit TEXT NOT NULL,
  price_deviation_limit_pct REAL NOT NULL, updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS order_intents (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT, symbol TEXT NOT NULL, side TEXT NOT NULL, type TEXT NOT NULL,
  data TEXT NOT NULL, correlation_id TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intents_user ON order_intents(user_id);

CREATE TABLE IF NOT EXISTS orders (
  internal_order_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT,
  client_order_id TEXT NOT NULL,
  exchange_order_id TEXT,
  idempotency_key TEXT,
  correlation_id TEXT,
  symbol TEXT NOT NULL, side TEXT NOT NULL, type TEXT NOT NULL,
  price TEXT, quantity TEXT NOT NULL, filled_quantity TEXT NOT NULL DEFAULT '0',
  status TEXT NOT NULL, mode TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE (user_id, client_order_id)
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);

CREATE TABLE IF NOT EXISTS order_events (
  id TEXT PRIMARY KEY, internal_order_id TEXT NOT NULL REFERENCES orders(internal_order_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_state TEXT, to_state TEXT NOT NULL, actor TEXT NOT NULL, seq INTEGER, at INTEGER NOT NULL, meta TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(internal_order_id);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY, internal_order_id TEXT NOT NULL REFERENCES orders(internal_order_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exec_id TEXT, price TEXT NOT NULL, quantity TEXT NOT NULL, fee TEXT, liquidity TEXT, at INTEGER NOT NULL,
  UNIQUE (internal_order_id, exec_id)
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, side TEXT NOT NULL, size TEXT NOT NULL, entry_price TEXT, mark_price TEXT,
  liquidation_price TEXT, leverage INTEGER, margin_mode TEXT, unrealized_pnl TEXT, updated_at INTEGER NOT NULL,
  UNIQUE (user_id, symbol, side)
);

CREATE TABLE IF NOT EXISTS position_snapshots (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, data TEXT NOT NULL, at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_balances (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset TEXT NOT NULL, available TEXT NOT NULL, equity TEXT NOT NULL, used TEXT NOT NULL, at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_checks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  internal_order_id TEXT, passed INTEGER NOT NULL, fail_count INTEGER NOT NULL, gates TEXT NOT NULL,
  live_gate_allowed INTEGER NOT NULL, reasons TEXT, at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id TEXT PRIMARY KEY, user_id TEXT, trigger TEXT NOT NULL, result TEXT NOT NULL,
  mismatches INTEGER NOT NULL DEFAULT 0, detail TEXT, started_at INTEGER NOT NULL, finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS exchange_websocket_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL, connected_at INTEGER, disconnected_at INTEGER, reconnects INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  idempotency_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trading_kill_switches (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, target TEXT, active INTEGER NOT NULL DEFAULT 1,
  allow_cancel_reduce INTEGER NOT NULL DEFAULT 1, reason TEXT, created_at INTEGER NOT NULL, created_by TEXT
);

-- DOWN (data-destructive)
-- DROP TABLE trading_kill_switches; DROP TABLE idempotency_records; DROP TABLE exchange_websocket_sessions;
-- DROP TABLE reconciliation_runs; DROP TABLE risk_checks; DROP TABLE account_balances;
-- DROP TABLE position_snapshots; DROP TABLE positions; DROP TABLE executions; DROP TABLE order_events;
-- DROP TABLE orders; DROP TABLE order_intents; DROP TABLE trading_policies; DROP TABLE exchange_connections;
-- DROP TABLE exchange_credentials;
