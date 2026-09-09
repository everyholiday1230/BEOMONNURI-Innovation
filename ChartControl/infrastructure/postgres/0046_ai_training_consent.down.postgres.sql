-- 0046 되돌리기.
--
-- ★ 동의 기록을 지운다. 되돌리면 "누가 학습 이용에 동의했는가" 가 사라지고, 그 뒤에는
--   학습에 써도 되는 기록인지 판단할 수 없다. 운영에서 실행하기 전에 백업을 확인할 것.

DROP INDEX IF EXISTS idx_users_ai_training_opt_in;
ALTER TABLE users DROP COLUMN IF EXISTS ai_training_opt_in_at;
ALTER TABLE users DROP COLUMN IF EXISTS ai_training_opt_in;
