-- Phase 5 · 0005 (SQLite). Admin & operations domain. Admin data separate from user data. Optimistic
-- lock via `version`. History tables preserve change trail. Append-only admin_actions (no update/delete
-- from the app). No secrets stored. PG mirror: infrastructure/postgres/0005_phase5_admin.*. UP

CREATE TABLE IF NOT EXISTS admin_actions (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL, resource TEXT NOT NULL, resource_id TEXT,
  target_user_id TEXT,
  result TEXT NOT NULL, risk_level TEXT NOT NULL DEFAULT 'low',
  ip TEXT, correlation_id TEXT, before_json TEXT, after_json TEXT, reason TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_actions_actor ON admin_actions(actor_user_id, at);
CREATE INDEX IF NOT EXISTS idx_admin_actions_corr ON admin_actions(correlation_id);

CREATE TABLE IF NOT EXISTS admin_sessions_metadata (
  session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mfa_status TEXT NOT NULL DEFAULT 'NOT_IMPLEMENTED', last_step_up_at INTEGER, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_flags (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 0,
  description TEXT, expires_at INTEGER, version INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS feature_flag_history (
  id TEXT PRIMARY KEY, flag_id TEXT NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
  before_enabled INTEGER, after_enabled INTEGER NOT NULL, reason TEXT NOT NULL,
  changed_by TEXT NOT NULL, correlation_id TEXT, at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS kill_switches (
  id TEXT PRIMARY KEY, scope TEXT NOT NULL, target TEXT, active INTEGER NOT NULL DEFAULT 0,
  allow_cancel_reduce INTEGER NOT NULL DEFAULT 1, reason TEXT, expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0, updated_by TEXT, updated_at INTEGER NOT NULL,
  UNIQUE (scope, target)
);
CREATE TABLE IF NOT EXISTS kill_switch_history (
  id TEXT PRIMARY KEY, kill_switch_id TEXT NOT NULL REFERENCES kill_switches(id) ON DELETE CASCADE,
  before_active INTEGER, after_active INTEGER NOT NULL, reason TEXT NOT NULL,
  changed_by TEXT NOT NULL, approver_id TEXT, correlation_id TEXT, at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, severity TEXT NOT NULL, service TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN', owner TEXT, impact TEXT, root_cause TEXT, mitigation TEXT,
  resolution TEXT, related_release TEXT, related_kill_switch TEXT, postmortem_link TEXT,
  version INTEGER NOT NULL DEFAULT 0, detected_at INTEGER NOT NULL, created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS incident_events (
  id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, note TEXT, correlation_id TEXT, actor TEXT NOT NULL, at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS release_gates (
  id TEXT PRIMARY KEY, gate_key TEXT NOT NULL UNIQUE, phase TEXT NOT NULL, description TEXT NOT NULL,
  owner TEXT, exit_criteria TEXT, status TEXT NOT NULL DEFAULT 'NOT_STARTED',
  production_required INTEGER NOT NULL DEFAULT 0, reason TEXT, approved_by TEXT, expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS release_gate_evidence (
  id TEXT PRIMARY KEY, gate_id TEXT NOT NULL REFERENCES release_gates(id) ON DELETE CASCADE,
  evidence_path TEXT NOT NULL, note TEXT, added_by TEXT NOT NULL, at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_saved_filters (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, screen TEXT NOT NULL, query_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_notifications (
  id TEXT PRIMARY KEY, level TEXT NOT NULL, title TEXT NOT NULL, body TEXT, read INTEGER NOT NULL DEFAULT 0,
  correlation_id TEXT, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_change_requests (
  id TEXT PRIMARY KEY, prompt_id TEXT NOT NULL, from_version TEXT, to_version TEXT NOT NULL,
  checksum TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',
  requested_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS prompt_approvals (
  id TEXT PRIMARY KEY, change_request_id TEXT NOT NULL REFERENCES prompt_change_requests(id) ON DELETE CASCADE,
  approver_id TEXT NOT NULL, decision TEXT NOT NULL, note TEXT, at INTEGER NOT NULL
);

-- DOWN (data-destructive)
-- DROP TABLE prompt_approvals; DROP TABLE prompt_change_requests; DROP TABLE admin_notifications;
-- DROP TABLE admin_saved_filters; DROP TABLE release_gate_evidence; DROP TABLE release_gates;
-- DROP TABLE incident_events; DROP TABLE incidents; DROP TABLE kill_switch_history; DROP TABLE kill_switches;
-- DROP TABLE feature_flag_history; DROP TABLE feature_flags; DROP TABLE admin_sessions_metadata; DROP TABLE admin_actions;
