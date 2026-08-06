-- Phase 7 · 0008 (PostgreSQL DOWN). Reverse order; drops ONLY what 0008 adds (0007's source/executable
-- are left intact). Data-destructive.
DROP INDEX IF EXISTS idx_order_drafts_user_created;
DROP INDEX IF EXISTS idx_order_drafts_idem;

ALTER TABLE order_drafts DROP COLUMN IF EXISTS allowed;
ALTER TABLE order_drafts DROP COLUMN IF EXISTS valid;
ALTER TABLE order_drafts DROP COLUMN IF EXISTS idempotency_key;
ALTER TABLE order_drafts DROP COLUMN IF EXISTS updated_at;
ALTER TABLE order_drafts DROP COLUMN IF EXISTS version;
