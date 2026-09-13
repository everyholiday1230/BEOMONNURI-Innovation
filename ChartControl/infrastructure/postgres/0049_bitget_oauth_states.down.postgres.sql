-- 0049 되돌리기.
-- ★ 진행 중이던 인증은 사라진다. 고객이 다시 시작하면 되므로 손실은 없다
--   (키는 이 표가 아니라 exchange_credentials 에 있다).
DROP INDEX IF EXISTS idx_bitget_oauth_user;
DROP INDEX IF EXISTS idx_bitget_oauth_expires;
DROP TABLE IF EXISTS bitget_oauth_states;
