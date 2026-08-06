-- Phase 6 · 0006 (PostgreSQL). MFA parity with SQLite migration 0006_phase6_mfa.sql.
--
-- Type mapping vs SQLite: user_id -> UUID (users.id is UUID in PG), ms-epoch INTEGER timestamps ->
-- BIGINT (matching the BIGINT convention 0005 established and the Date.now() integers the app writes),
-- boolean flags kept as INTEGER 0/1 to mirror the SQLite column semantics exactly, JSON columns as TEXT
-- (the app persists JSON.stringify output, not a validated document). Live trading is unaffected. UP

CREATE TABLE IF NOT EXISTS mfa_credentials (
  user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled                  INTEGER NOT NULL DEFAULT 0,
  secret_encrypted         TEXT,             -- AES-256-GCM token; NULL until enrollment verified
  pending_secret_encrypted TEXT,             -- during enrollment, before first-code verification
  pending_expires_at       BIGINT,           -- enrollment/setup expiry (ms epoch)
  recovery_codes_json      TEXT,             -- JSON array of { hash, usedAt } (hashes only)
  last_used_counter        BIGINT,           -- TOTP step replay guard
  updated_at               BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash TEXT PRIMARY KEY,               -- hash of the short-lived pending-login token
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_challenges(user_id);
