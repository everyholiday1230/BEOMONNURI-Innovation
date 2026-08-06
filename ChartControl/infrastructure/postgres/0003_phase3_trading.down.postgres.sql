-- Phase 3 · 0003 (PostgreSQL DOWN). Data-destructive.
DROP TABLE IF EXISTS trading_kill_switches;
DROP TABLE IF EXISTS idempotency_records;
DROP TABLE IF EXISTS exchange_websocket_sessions;
DROP TABLE IF EXISTS reconciliation_runs;
DROP TABLE IF EXISTS risk_checks;
DROP TABLE IF EXISTS account_balances;
DROP TABLE IF EXISTS position_snapshots;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS executions;
DROP TABLE IF EXISTS order_events;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS order_intents;
DROP TABLE IF EXISTS trading_policies;
DROP TABLE IF EXISTS exchange_connections;
DROP TABLE IF EXISTS exchange_credentials;
