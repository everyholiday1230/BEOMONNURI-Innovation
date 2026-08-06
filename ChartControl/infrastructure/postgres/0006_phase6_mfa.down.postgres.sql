-- Phase 6 · 0006 (PostgreSQL DOWN). Reverse order; data-destructive. Drops ONLY what 0006 adds.
DROP INDEX IF EXISTS idx_mfa_challenges_user;
DROP TABLE IF EXISTS mfa_challenges;
DROP TABLE IF EXISTS mfa_credentials;
