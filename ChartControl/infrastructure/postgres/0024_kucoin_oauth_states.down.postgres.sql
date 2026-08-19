-- 0024 되돌리기
--
-- ★ 진행 중인 OAuth 인증이 있으면 그 콜백은 실패한다(state 를 확인할 수 없다).
--   이용자는 처음부터 다시 하면 되므로 손실은 없다.
DROP TABLE IF EXISTS kucoin_oauth_states;
