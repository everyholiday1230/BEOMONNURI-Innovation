-- 0026 되돌리기
--
-- ★ 제약을 풀면 같은 거래가 여러 표본으로 들어갈 수 있게 된다. 되돌린 뒤에는
--   내보내기 전에 중복을 확인해야 한다.
DROP INDEX IF EXISTS uq_trade_outcomes_decision_kind;
DROP INDEX IF EXISTS idx_trade_decisions_user_time;
