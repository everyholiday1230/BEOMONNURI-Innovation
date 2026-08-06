-- Phase 4 · 0004 (PostgreSQL UP). EXTENDS Phase 2 ai_conversations/ai_messages/ai_signals and ADDS
-- the new copilot tables. Cost = BIGINT micro-USD; no raw chain-of-thought stored.
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS reasoning_summary TEXT;
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE ai_signals ADD COLUMN IF NOT EXISTS market_type TEXT;
ALTER TABLE ai_signals ADD COLUMN IF NOT EXISTS conversation_id TEXT;
ALTER TABLE ai_signals ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE ai_signals ADD COLUMN IF NOT EXISTS prompt_version TEXT;
ALTER TABLE ai_signals ADD COLUMN IF NOT EXISTS data_snapshot_id TEXT;
ALTER TABLE ai_signals ADD COLUMN IF NOT EXISTS user_edited BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_signals ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE ai_signals ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  fallback_used BOOLEAN NOT NULL DEFAULT FALSE, status TEXT NOT NULL, correlation_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL, args_json JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_tool_outputs (
  id TEXT PRIMARY KEY, tool_call_id TEXT NOT NULL REFERENCES ai_tool_calls(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ok BOOLEAN NOT NULL, output_json JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS chart_commands (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT, command TEXT NOT NULL, symbol TEXT NOT NULL, timeframe TEXT NOT NULL,
  data_json JSONB NOT NULL, source TEXT NOT NULL, ai_generated BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS chart_overlays (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL, timeframe TEXT NOT NULL, kind TEXT NOT NULL, data_json JSONB NOT NULL,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE, user_edited BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS ai_usage_records (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT, correlation_id TEXT, model TEXT NOT NULL, fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
  estimated_cost_micros BIGINT NOT NULL, actual_cost_micros BIGINT, at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_at ON ai_usage_records(user_id, at);
CREATE TABLE IF NOT EXISTS ai_prompt_versions (
  prompt_id TEXT NOT NULL, version TEXT NOT NULL, language TEXT NOT NULL, mode TEXT NOT NULL,
  checksum TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE, test_dataset_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (prompt_id, version)
);
CREATE TABLE IF NOT EXISTS ai_evaluation_runs (
  id TEXT PRIMARY KEY, dataset_version TEXT NOT NULL, report_json JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_feedback (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT, target_type TEXT NOT NULL, target_id TEXT, rating INTEGER, comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
