-- 되돌리기. ★ 만료 시각은 복원하지 않는다 — 옛 값(30일 기준)을 알 수 없고,
--   짐작해서 넣으면 고객 항목이 즉시 만료될 수 있다. 열만 지운다.
DROP INDEX IF EXISTS idx_user_strategies_expires;
ALTER TABLE user_strategies DROP COLUMN IF EXISTS expires_at;
