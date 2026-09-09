-- 0045 되돌리기.
--
-- ★ 동의 기록을 지우는 작업이다. 되돌리면 "언제 동의했는가" 가 사라지고, 그 뒤에는
--   발송해도 되는지 알 수 없다. 운영에서 실행하기 전에 백업을 확인할 것.

DROP INDEX IF EXISTS idx_users_marketing_opt_in;
ALTER TABLE users DROP COLUMN IF EXISTS marketing_opt_in_at;
ALTER TABLE users DROP COLUMN IF EXISTS marketing_opt_in;
