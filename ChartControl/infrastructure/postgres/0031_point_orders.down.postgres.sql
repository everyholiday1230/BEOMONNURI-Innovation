-- 0031 롤백 — 포인트 충전 주문 테이블 제거
DROP INDEX IF EXISTS uq_point_orders_ref;
DROP INDEX IF EXISTS idx_point_orders_user;
DROP TABLE IF EXISTS point_orders;
