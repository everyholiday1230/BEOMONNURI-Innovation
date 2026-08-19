-- 0025 되돌리기
--
-- ★★ 되돌리면 **학습 원천 기록이 사라진다.**
--
--   이 기록은 다시 만들 수 없다. 어떤 지표를 켜고 있었는지는 그 순간에만
--   알 수 있고, 지나간 화면 상태를 나중에 복원할 방법이 없다. 실행 전에
--   반드시 내보내 두어야 한다.
--
-- ★ 순서: 참조하는 쪽을 먼저 지운다(outcomes → decisions).
DROP TABLE IF EXISTS learning_exports;
DROP TABLE IF EXISTS trade_outcomes;
DROP TABLE IF EXISTS trade_decisions;
DROP TABLE IF EXISTS learning_subjects;
