-- 0033 롤백
DROP INDEX IF EXISTS idx_saved_items_expires;
ALTER TABLE saved_items DROP COLUMN IF EXISTS expires_at;
ALTER TABLE saved_items DROP COLUMN IF EXISTS scope;
