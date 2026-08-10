-- 0019 되돌리기.
--
-- ★ 자산 이력이 사라진다. 다시 쌓으려면 그 기간을 기다려야 한다 — 과거
--   자산은 거래소가 소급해서 주지 않는다.
--
--   되돌리기 전에 내보내기:
--     \copy (SELECT * FROM equity_snapshots) TO 'equity.csv' CSV HEADER

DROP INDEX IF EXISTS idx_equity_user_date;
DROP TABLE IF EXISTS equity_snapshots;
