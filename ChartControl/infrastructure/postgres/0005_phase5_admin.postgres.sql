-- Phase 5 · 0005 (PostgreSQL UP). Admin & operations domain. epoch-ms as BIGINT (aligns with SQLite).
CREATE TABLE IF NOT EXISTS admin_actions (
  id TEXT PRIMARY KEY, actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_role TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL, resource_id TEXT,
  target_user_id UUID, result TEXT NOT NULL, risk_level TEXT NOT NULL DEFAULT 'low',
  ip TEXT, correlation_id TEXT, before_json JSONB, after_json JSONB, reason TEXT, at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_actor ON admin_actions(actor_user_id, at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_corr ON admin_actions(correlation_id);

CREATE TABLE IF NOT EXISTS admin_sessions_metadata (
  session_id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_status TEXT NOT NULL DEFAULT 'NOT_IMPLEMENTED', last_step_up_at BIGINT, created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, enabled BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT, expires_at BIGINT, version INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS feature_flag_history (
  id TEXT PRIMARY KEY, flag_id TEXT NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  before_enabled BOOLEAN, after_enabled BOOLEAN NOT NULL, reason TEXT NOT NULL, changed_by TEXT NOT NULL,
  correlation_id TEXT, at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS kill_switches (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, target TEXT, active BOOLEAN NOT NULL DEFAULT FALSE,
  allow_cancel_reduce BOOLEAN NOT NULL DEFAULT TRUE, reason TEXT, expires_at BIGINT,
  version INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at BIGINT NOT NULL, UNIQUE (scope, target)
);
CREATE TABLE IF NOT EXISTS kill_switch_history (
  id TEXT PRIMARY KEY, kill_switch_id TEXT NOT NULL REFERENCES kill_switches(id) ON DELETE CASCADE,
  before_active BOOLEAN, after_active BOOLEAN NOT NULL, reason TEXT NOT NULL, changed_by TEXT NOT NULL,
  approver_id TEXT, correlation_id TEXT, at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, severity TEXT NOT NULL, service TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN', owner TEXT, impact TEXT, root_cause TEXT, mitigation TEXT,
  resolution TEXT, related_release TEXT, related_kill_switch TEXT, postmortem_link TEXT,
  version INTEGER NOT NULL DEFAULT 0, detected_at BIGINT NOT NULL, created_by TEXT NOT NULL,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS incident_events (
  id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, note TEXT, correlation_id TEXT, actor TEXT NOT NULL, at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_gates (
  id TEXT PRIMARY KEY, gate_key TEXT NOT NULL UNIQUE, phase TEXT NOT NULL, description TEXT NOT NULL,
  owner TEXT, exit_criteria TEXT, status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  production_required BOOLEAN NOT NULL DEFAULT FALSE, reason TEXT, approved_by TEXT, expires_at BIGINT,
  version INTEGER NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS release_gate_evidence (
  id TEXT PRIMARY KEY, gate_id TEXT NOT NULL REFERENCES release_gates(id) ON DELETE CASCADE,
  evidence_path TEXT NOT NULL, note TEXT, added_by TEXT NOT NULL, at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_saved_filters (
  id TEXT PRIMARY KEY, user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, screen TEXT NOT NULL, query_json JSONB NOT NULL, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_notifications (
  id TEXT PRIMARY KEY, level TEXT NOT NULL, title TEXT NOT NULL, body TEXT, read BOOLEAN NOT NULL DEFAULT FALSE,
  correlation_id TEXT, created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_change_requests (
  id TEXT PRIMARY KEY, prompt_id TEXT NOT NULL, from_version TEXT, to_version TEXT NOT NULL,
  checksum TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',
  requested_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_approvals (
  id TEXT PRIMARY KEY, change_request_id TEXT NOT NULL REFERENCES prompt_change_requests(id) ON DELETE CASCADE,
  approver_id TEXT NOT NULL, decision TEXT NOT NULL, note TEXT, at BIGINT NOT NULL
);
