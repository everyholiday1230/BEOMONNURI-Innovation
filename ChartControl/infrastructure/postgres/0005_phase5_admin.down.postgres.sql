-- Phase 5 · 0005 (PostgreSQL DOWN). Reverse order; data-destructive.
DROP TABLE IF EXISTS prompt_approvals;
DROP TABLE IF EXISTS prompt_change_requests;
DROP TABLE IF EXISTS admin_notifications;
DROP TABLE IF EXISTS admin_saved_filters;
DROP TABLE IF EXISTS release_gate_evidence;
DROP TABLE IF EXISTS release_gates;
DROP TABLE IF EXISTS incident_events;
DROP TABLE IF EXISTS incidents;
DROP TABLE IF EXISTS kill_switch_history;
DROP TABLE IF EXISTS kill_switches;
DROP TABLE IF EXISTS feature_flag_history;
DROP TABLE IF EXISTS feature_flags;
DROP TABLE IF EXISTS admin_sessions_metadata;
DROP TABLE IF EXISTS admin_actions;
