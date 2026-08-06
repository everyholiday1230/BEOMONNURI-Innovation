-- Phase 4 · 0004 (SQLite). AI copilot domain. EXTENDS the Phase 2 ai_conversations/ai_messages/
-- ai_signals tables (do not re-create) and ADDS the new copilot tables. User-scoped + soft-delete.
-- Cost = integer micro-USD. Raw chain-of-thought is NEVER stored (only reasoning_summary). No secrets.
-- Runs exactly once (tracked in schema_migrations), so bare ALTER ADD COLUMN is safe. UP

-- Extend Phase 2 tables (SQLite has no ADD COLUMN IF NOT EXISTS; 0004 applies once).
ALTER TABLE ai_conversations ADD COLUMN deleted_at INTEGER;
ALTER TABLE ai_messages ADD COLUMN reasoning_summary TEXT;   -- SHORT summary only; never chain-of-thought
ALTER TABLE ai_messages ADD COLUMN deleted_at INTEGER;
ALTER TABLE ai_signals ADD COLUMN market_type TEXT;
ALTER TABLE ai_signals ADD COLUMN conversation_id TEXT;
ALTER TABLE ai_signals ADD COLUMN model TEXT;
ALTER TABLE ai_signals ADD COLUMN prompt_version TEXT;
ALTER TABLE ai_signals ADD COLUMN data_snapshot_id TEXT;
ALTER TABLE ai_signals ADD COLUMN user_edited INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_signals ADD COLUMN expires_at INTEGER;
ALTER TABLE ai_signals ADD COLUMN deleted_at INTEGER;

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  fallback_used INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, correlation_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL, args_json TEXT NOT NULL, at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_tool_outputs (
  id TEXT PRIMARY KEY, tool_call_id TEXT NOT NULL REFERENCES ai_tool_calls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ok INTEGER NOT NULL, output_json TEXT NOT NULL, at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chart_commands (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT, command TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
  data_json TEXT NOT NULL, source TEXT NOT NULL, ai_generated INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chart_overlays (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, timeframe TEXT NOT NULL, kind TEXT NOT NULL, data_json TEXT NOT NULL,
  ai_generated INTEGER NOT NULL DEFAULT 0, user_edited INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS ai_usage_records (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT, correlation_id TEXT, model TEXT NOT NULL, fallback_used INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  estimated_cost_micros INTEGER NOT NULL, actual_cost_micros INTEGER, at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_at ON ai_usage_records(user_id, at);

CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  prompt_id TEXT NOT NULL, version TEXT NOT NULL, language TEXT NOT NULL, mode TEXT NOT NULL,
  checksum TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, test_dataset_version TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY (prompt_id, version)
);

CREATE TABLE IF NOT EXISTS ai_evaluation_runs (
  id TEXT PRIMARY KEY, dataset_version TEXT NOT NULL, report_json TEXT NOT NULL, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_feedback (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT, target_type TEXT NOT NULL, target_id TEXT, rating INTEGER, comment TEXT,
  created_at INTEGER NOT NULL
);

-- DOWN (data-destructive): DROP the new tables; ALTER-added columns remain (SQLite cannot easily drop columns).
-- DROP TABLE ai_feedback; DROP TABLE ai_evaluation_runs; DROP TABLE ai_prompt_versions;
-- DROP TABLE ai_usage_records; DROP TABLE chart_overlays; DROP TABLE chart_commands;
-- DROP TABLE ai_tool_outputs; DROP TABLE ai_tool_calls; DROP TABLE ai_runs;
