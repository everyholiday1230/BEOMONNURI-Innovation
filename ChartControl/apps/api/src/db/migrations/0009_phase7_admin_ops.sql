-- 0009_phase7_admin_ops.sql
--
-- Phase 7 / Prompt 5 — B7 admin operational contracts (ADM-API-07/08/09/11/12/13/15).
--
-- Four things the existing schema genuinely cannot express, and one additive pair of columns:
--
-- 1. `account_lockouts` — the brute-force lockout that ADM-API-13 "unlock" is supposed to CLEAR lived in
--    a process-local `Map` inside apps/api/src/mfa/mfa-routes.ts. That state is invisible to any other
--    process, is lost on restart, and cannot be counted or cleared by an admin endpoint. An "unlock"
--    button over an unreachable Map would be theatre, so the lockout is persisted here instead. The MFA
--    routes keep exactly the same algorithm (@quantumtrade/mfa recordFailure/isLocked/resetLockout) —
--    only the STORE changes.
--
-- 2. `admin_reports` — ADM-API-12 reports are aggregates over users/orders/audit/incidents. They are
--    stored as IMMUTABLE SNAPSHOTS (no version column, no update path) together with their provenance,
--    because a report re-run months later would not reproduce the same numbers and an auditor needs the
--    figures that were actually produced at the time.
--
-- 3. `mock_gateway_state` — ADM-API-08 resync/reconnect must control something real or nothing at all.
--    This row is the LOCAL MOCK gateway's control state. It is deliberately NOT a connection to any
--    exchange host: no real gateway is reachable from this deployment, and the endpoint reports that
--    honestly rather than pretending to reconnect.
--
-- 4. `ai_policy` (+ `ai_policy_history`) — ADM-API-11 needs an optimistic version and an audited change
--    trail. Two deliberate constraints:
--      * `live_execution_enabled` carries a CHECK (= 0). Enabling live AI execution is not a code path
--        that can be forgotten and later re-enabled by accident: the DATABASE refuses the row.
--      * The raw system prompt is NEVER stored. Only a SHA-256 digest, its algorithm and its length are
--        kept, so neither the table nor any response derived from it can leak prompt text.
--
-- 5. `incidents.acknowledged_at/by` — ADM-API-09. Additive nullable columns; acknowledgement is a
--    distinct fact from the incident STATUS (an OPEN incident can be acknowledged), so it is not encoded
--    in the state machine.
--
-- Additive only: every statement is `IF NOT EXISTS` or a nullable `ADD COLUMN`, so this is safe on a
-- clean database and on a populated one. Rollback: migrations-down/0009_phase7_admin_ops.down.sql.

-- ---------------------------------------------------------------------------
-- 1. persisted brute-force lockout (ADM-API-13)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS account_lockouts (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  fails         INTEGER NOT NULL DEFAULT 0,
  first_fail_at INTEGER NOT NULL,
  -- 0 = "failures recorded but not locked". A lockout is EXPIRED, not absent, once now > locked_until;
  -- keeping the row lets the console distinguish "never locked" from "was locked, now expired".
  locked_until  INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT 'mfa',
  version       INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  cleared_at    INTEGER,
  cleared_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_lockouts_locked ON account_lockouts(locked_until);

-- ---------------------------------------------------------------------------
-- 2. report snapshots (ADM-API-12)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_reports (
  id           TEXT PRIMARY KEY,
  report_type  TEXT NOT NULL,
  -- Provenance: which tables the figures came from, and which of them were unavailable.
  source_json  TEXT NOT NULL,
  data_json    TEXT NOT NULL,
  row_count    INTEGER NOT NULL DEFAULT 0,
  window_from  INTEGER,
  window_to    INTEGER,
  generated_by TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_reports_type_at ON admin_reports(report_type, generated_at);

-- ---------------------------------------------------------------------------
-- 3. LOCAL MOCK gateway control state (ADM-API-08)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mock_gateway_state (
  id              TEXT PRIMARY KEY,
  status          TEXT NOT NULL DEFAULT 'MOCK_IDLE',
  resync_count    INTEGER NOT NULL DEFAULT 0,
  reconnect_count INTEGER NOT NULL DEFAULT 0,
  last_resync_at  INTEGER,
  last_reconnect_at INTEGER,
  version         INTEGER NOT NULL DEFAULT 0,
  updated_by      TEXT,
  updated_at      INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- 4. AI policy (ADM-API-11) — no raw prompt, no provider key, live execution impossible
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_policy (
  id                      TEXT PRIMARY KEY,
  -- CHECK, not just a default: the store itself refuses a row that enables live AI execution.
  live_execution_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (live_execution_enabled = 0),
  max_output_tokens       INTEGER NOT NULL DEFAULT 1024,
  daily_cost_limit_micros INTEGER NOT NULL DEFAULT 0,
  allowed_tools_json      TEXT NOT NULL DEFAULT '[]',
  -- Digest ONLY. The raw system prompt text is never written to this database.
  system_prompt_digest    TEXT,
  system_prompt_algo      TEXT,
  system_prompt_len       INTEGER,
  prompt_version          TEXT,
  version                 INTEGER NOT NULL DEFAULT 0,
  updated_by              TEXT,
  updated_at              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_policy_history (
  id             TEXT PRIMARY KEY,
  policy_id      TEXT NOT NULL,
  before_json    TEXT,
  after_json     TEXT NOT NULL,
  reason         TEXT,
  changed_by     TEXT NOT NULL,
  correlation_id TEXT,
  at             INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_policy_history_at ON ai_policy_history(policy_id, at);

-- ---------------------------------------------------------------------------
-- 5. incident acknowledgement (ADM-API-09)
-- ---------------------------------------------------------------------------
ALTER TABLE incidents ADD COLUMN acknowledged_at INTEGER;
ALTER TABLE incidents ADD COLUMN acknowledged_by TEXT;
