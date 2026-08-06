-- Phase 2 · 0001 (PostgreSQL DOWN). Drops all 0001 objects. Data-destructive.
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS layouts;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
