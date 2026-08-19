-- 0028 되돌리기
--
-- ★★ 읽음 기록이 사라진다. 되돌린 뒤 다시 적용하면 **이미 읽은 팝업이 모든
--   이용자에게 다시 뜬다.** 실행 전에 notice_reads 를 내보내 둘 것.
DROP TABLE IF EXISTS notice_reads;

ALTER TABLE notices DROP CONSTRAINT IF EXISTS notices_severity_check;
ALTER TABLE notices
  DROP COLUMN IF EXISTS popup,
  DROP COLUMN IF EXISTS severity;
