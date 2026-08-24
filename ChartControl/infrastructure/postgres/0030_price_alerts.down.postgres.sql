-- 0030 롤백 — 가격 알림 테이블 제거
DROP INDEX IF EXISTS idx_price_alerts_user;
DROP INDEX IF EXISTS idx_price_alerts_active;
DROP TABLE IF EXISTS price_alerts;
