-- 0016 되돌리기.
--
-- ★★ 포인트 원장이 사라진다 ★★
--
-- 포인트는 부채다. 원장을 지우면 사용자가 가진 잔액의 근거가 없어지고
-- 복구할 방법도 없다(잔액을 따로 저장하지 않으므로 원장이 유일한 기록이다).
-- 되돌리기 전에 반드시 백업할 것.
DROP INDEX IF EXISTS idx_redemptions_active;
DROP INDEX IF EXISTS idx_redemptions_user;
DROP TABLE IF EXISTS point_redemptions;
DROP TABLE IF EXISTS point_catalog;
DROP INDEX IF EXISTS uq_points_ref;
DROP INDEX IF EXISTS idx_points_reason;
DROP INDEX IF EXISTS idx_points_user;
DROP TABLE IF EXISTS point_ledger;
DROP TABLE IF EXISTS point_settings;
