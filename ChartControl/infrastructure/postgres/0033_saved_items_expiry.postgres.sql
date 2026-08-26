-- ============================================================
-- 0033 — 저장 항목 만료·범위(차등가격)
-- ------------------------------------------------------------
--   · expires_at: 저장은 기본 30일 유효. 만료 전 연장(포인트)로 반복 매출.
--   · scope: 'symbol'(그 종목 전용, 저렴) | 'global'(모든 종목에서 재사용, 비쌈).
--   기존 행은 scope='symbol', 만료는 생성 30일 뒤로 소급 설정한다(없으면 NULL=무기한
--   으로 취급되지 않도록 채운다).
-- ============================================================

ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'symbol';
ALTER TABLE saved_items ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- 기존 행: 생성 30일 뒤 만료로 채운다.
UPDATE saved_items SET expires_at = created_at + INTERVAL '30 days' WHERE expires_at IS NULL;

-- 만료 정리/조회용 인덱스
CREATE INDEX IF NOT EXISTS idx_saved_items_expires ON saved_items (expires_at);
