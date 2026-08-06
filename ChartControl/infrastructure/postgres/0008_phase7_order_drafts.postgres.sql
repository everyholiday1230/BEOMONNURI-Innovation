-- Phase 7 · 0008 (PostgreSQL). Order draft/validate parity with SQLite 0008_phase7_order_drafts.sql.
-- Adds optimistic version, mutation timestamp, idempotency key and the recorded verdict, plus the
-- per-(user, idempotency key) partial unique index. Additive. UP

ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Recorded verdict (why a draft was valid/allowed). `executable` (0007) is always 0.
ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS valid INTEGER;
ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS allowed INTEGER;

-- One draft per (user, idempotency key): a retried request is a DATA-layer no-op. Partial index so the
-- many pre-existing NULL-key rows do not collide (PostgreSQL supports partial unique indexes).
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_drafts_idem
  ON order_drafts(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_drafts_user_created ON order_drafts(user_id, created_at);
