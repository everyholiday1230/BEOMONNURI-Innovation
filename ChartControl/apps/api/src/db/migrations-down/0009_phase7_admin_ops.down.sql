-- 0009_phase7_admin_ops.down.sql
--
-- Rollback for 0009. Drops ONLY what 0009 adds; the 0005 shape of `incidents` is restored by dropping
-- the two acknowledgement columns and nothing else.
--
-- Indexes are dropped before their tables/columns: SQLite refuses to drop a column an index still
-- depends on, so the ordering is a correctness requirement rather than a style choice.

DROP INDEX IF EXISTS idx_ai_policy_history_at;
DROP INDEX IF EXISTS idx_admin_reports_type_at;
DROP INDEX IF EXISTS idx_account_lockouts_locked;

DROP TABLE IF EXISTS ai_policy_history;
DROP TABLE IF EXISTS ai_policy;
DROP TABLE IF EXISTS mock_gateway_state;
DROP TABLE IF EXISTS admin_reports;
DROP TABLE IF EXISTS account_lockouts;

ALTER TABLE incidents DROP COLUMN acknowledged_by;
ALTER TABLE incidents DROP COLUMN acknowledged_at;

DELETE FROM schema_migrations WHERE version = '0009_phase7_admin_ops';
