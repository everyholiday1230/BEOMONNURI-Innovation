-- 0032 롤백 — 저장 항목 테이블 제거
DROP INDEX IF EXISTS idx_saved_items_user_kind;
DROP INDEX IF EXISTS idx_saved_items_user;
DROP TABLE IF EXISTS saved_items;
