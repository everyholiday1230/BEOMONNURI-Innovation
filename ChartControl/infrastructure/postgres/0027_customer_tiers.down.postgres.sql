-- 0027 되돌리기
--
-- ★ 계산된 등급 상태가 사라진다. 다시 계산할 수 있으므로(거래 기록에서 나온다)
--   되돌릴 수 있는 손실이다 — 단, 그때의 기준 스냅샷은 복원되지 않는다.
DROP TABLE IF EXISTS user_tier_state;
DROP TABLE IF EXISTS tier_definitions;
