-- Phase 4 · 0004 (PostgreSQL DOWN). Reverse order. Drops only the NEW copilot tables and the columns
-- added by 0004; leaves the Phase 2 ai_conversations/ai_messages/ai_signals base tables intact.
DROP TABLE IF EXISTS ai_feedback;
DROP TABLE IF EXISTS ai_evaluation_runs;
DROP TABLE IF EXISTS ai_prompt_versions;
DROP TABLE IF EXISTS ai_usage_records;
DROP TABLE IF EXISTS chart_overlays;
DROP TABLE IF EXISTS chart_commands;
DROP TABLE IF EXISTS ai_tool_outputs;
DROP TABLE IF EXISTS ai_tool_calls;
DROP TABLE IF EXISTS ai_runs;

ALTER TABLE ai_signals DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE ai_signals DROP COLUMN IF EXISTS expires_at;
ALTER TABLE ai_signals DROP COLUMN IF EXISTS user_edited;
ALTER TABLE ai_signals DROP COLUMN IF EXISTS data_snapshot_id;
ALTER TABLE ai_signals DROP COLUMN IF EXISTS prompt_version;
ALTER TABLE ai_signals DROP COLUMN IF EXISTS model;
ALTER TABLE ai_signals DROP COLUMN IF EXISTS conversation_id;
ALTER TABLE ai_signals DROP COLUMN IF EXISTS market_type;
ALTER TABLE ai_messages DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE ai_messages DROP COLUMN IF EXISTS reasoning_summary;
ALTER TABLE ai_conversations DROP COLUMN IF EXISTS deleted_at;
