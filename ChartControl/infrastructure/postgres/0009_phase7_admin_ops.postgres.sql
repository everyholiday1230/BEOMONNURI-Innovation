-- Phase 7 · 0009 (PostgreSQL). Admin operational parity with SQLite 0009_phase7_admin_ops.sql
-- (ADM-API-07/08/09/11/12/13/15). Additive; safe on clean and populated databases. UP
--
-- The two deliberate safety constraints from the SQLite version are preserved verbatim:
--   * ai_policy.live_execution_enabled carries CHECK (= 0): the DATABASE refuses a row that would
--     enable live AI execution.
--   * ai_policy stores only a digest/algorithm/length of the system prompt — never the raw text.

-- 1. persisted brute-force lockout (ADM-API-13)
CREATE TABLE IF NOT EXISTS account_lockouts (
  user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  fails         INTEGER NOT NULL DEFAULT 0,
  first_fail_at BIGINT NOT NULL,
  locked_until  BIGINT NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'mfa',
  version       INTEGER NOT NULL DEFAULT 0,
  updated_at    BIGINT NOT NULL,
  cleared_at    BIGINT,
  cleared_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_lockouts_locked ON account_lockouts(locked_until);

-- 2. report snapshots (ADM-API-12) — immutable, with provenance.
CREATE TABLE IF NOT EXISTS admin_reports (
  id           TEXT PRIMARY KEY,
  report_type  TEXT NOT NULL,
  source_json  TEXT NOT NULL,
  data_json    TEXT NOT NULL,
  row_count    INTEGER NOT NULL DEFAULT 0,
  window_from  BIGINT,
  window_to    BIGINT,
  generated_by TEXT NOT NULL,
  generated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_reports_type_at ON admin_reports(report_type, generated_at);

-- 3. LOCAL MOCK gateway control state (ADM-API-08) — never a real exchange connection.
CREATE TABLE IF NOT EXISTS mock_gateway_state (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'MOCK_IDLE',
  resync_count      INTEGER NOT NULL DEFAULT 0,
  reconnect_count   INTEGER NOT NULL DEFAULT 0,
  last_resync_at    BIGINT,
  last_reconnect_at BIGINT,
  version           INTEGER NOT NULL DEFAULT 0,
  updated_by        TEXT,
  updated_at        BIGINT NOT NULL
);

-- 4. AI policy (ADM-API-11) — no raw prompt, no provider key, live execution impossible by CHECK.
CREATE TABLE IF NOT EXISTS ai_policy (
  id                      TEXT PRIMARY KEY,
  live_execution_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_enabled = 0),
  max_output_tokens       INTEGER NOT NULL DEFAULT 1024,
  daily_cost_limit_micros BIGINT NOT NULL DEFAULT 0,
  allowed_tools_json      TEXT NOT NULL DEFAULT '[]',
  system_prompt_digest    TEXT,
  system_prompt_algo      TEXT,
  system_prompt_len       INTEGER,
  prompt_version          TEXT,
  version                 INTEGER NOT NULL DEFAULT 0,
  updated_by              TEXT,
  updated_at              BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_policy_history (
  id             TEXT PRIMARY KEY,
  policy_id      TEXT NOT NULL,
  before_json    TEXT,
  after_json     TEXT NOT NULL,
  reason         TEXT,
  changed_by     TEXT NOT NULL,
  correlation_id TEXT,
  at             BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_policy_history_at ON ai_policy_history(policy_id, at);

-- 5. incident acknowledgement (ADM-API-09) — distinct fact from incident STATUS.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS acknowledged_at BIGINT;
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS acknowledged_by TEXT;
