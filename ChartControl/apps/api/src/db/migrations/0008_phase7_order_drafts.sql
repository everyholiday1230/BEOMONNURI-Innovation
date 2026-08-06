-- 0008_phase7_order_drafts.sql
--
-- Phase 7 / Prompt 5 — B4 order draft/validate contract.
--
-- `order_drafts` (0002) held only id/user/symbol/side/data/created_at. The draft contract needs four
-- things that table cannot express: an optimistic version, a mutation timestamp, the idempotency key the
-- draft was created under, and the VERDICT the server reached.
--
-- The verdict is stored rather than recomputed on read. A draft row that is inspected months later during
-- an audit must show what the server decided at the time, not what today's policy would decide.
--
-- Additive only: every statement is a nullable ADD COLUMN or IF NOT EXISTS, so this is safe on a clean
-- database and on a populated one. Rollback: 0008_phase7_order_drafts.down.sql.

ALTER TABLE order_drafts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE order_drafts ADD COLUMN updated_at INTEGER;
ALTER TABLE order_drafts ADD COLUMN idempotency_key TEXT;

-- The recorded verdict. `executable` already exists (0007) and is always 0; these two record WHY.
ALTER TABLE order_drafts ADD COLUMN valid INTEGER;
ALTER TABLE order_drafts ADD COLUMN allowed INTEGER;

-- One draft per (user, idempotency key). This is what makes a retried draft request a no-op at the DATA
-- layer instead of depending on the route checking first. Partial index so the many pre-existing rows
-- with a NULL key do not collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_drafts_idem
  ON order_drafts(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_drafts_user_created ON order_drafts(user_id, created_at);
