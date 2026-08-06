-- Phase 7 · 0009 (PostgreSQL DOWN). Reverse order; drops ONLY what 0009 adds. Data-destructive.
ALTER TABLE incidents DROP COLUMN IF EXISTS acknowledged_by;
ALTER TABLE incidents DROP COLUMN IF EXISTS acknowledged_at;

DROP INDEX IF EXISTS idx_ai_policy_history_at;
DROP TABLE IF EXISTS ai_policy_history;
DROP TABLE IF EXISTS ai_policy;

DROP TABLE IF EXISTS mock_gateway_state;

DROP INDEX IF EXISTS idx_admin_reports_type_at;
DROP TABLE IF EXISTS admin_reports;

DROP INDEX IF EXISTS idx_account_lockouts_locked;
DROP TABLE IF EXISTS account_lockouts;
