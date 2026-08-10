-- 0017 되돌리기.
--
-- ★ seq 를 지우면 원장 정합성 검사가 다시 created_at + uuid 로 정렬하게 되고,
--   같은 시각 항목에서 거짓 위반을 보고한다. 원장 자체는 안전하지만 감시가
--   신뢰할 수 없어진다.

DROP INDEX IF EXISTS idx_points_user_seq;
ALTER TABLE point_ledger DROP COLUMN IF EXISTS seq;
