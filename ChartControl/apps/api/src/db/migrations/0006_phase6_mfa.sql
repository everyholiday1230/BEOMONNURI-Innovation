-- Phase 6 · 0006 (SQLite). Real MFA (TOTP + recovery codes). Secret stored ENCRYPTED (AES-GCM token),
-- never in plaintext and never re-displayed. Recovery codes stored as HASHES only. `last_used_counter`
-- prevents TOTP replay. `mfa_challenges` is the short-lived post-password / pre-MFA pending login state.
-- Live trading is unaffected. UP

CREATE TABLE IF NOT EXISTS mfa_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  secret_encrypted TEXT,             -- AES-256-GCM token; NULL until enrollment verified
  pending_secret_encrypted TEXT,     -- during enrollment, before first-code verification
  pending_expires_at INTEGER,        -- enrollment/setup expiry
  recovery_codes_json TEXT,          -- JSON array of { hash, usedAt } (hashes only)
  last_used_counter INTEGER,         -- TOTP step replay guard
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash TEXT PRIMARY KEY,       -- hash of the short-lived pending-login token (cookie holds raw)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_challenges(user_id);
