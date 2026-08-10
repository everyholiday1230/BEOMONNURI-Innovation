-- 0012 되돌리기.
--
-- ★ 공지 내용이 사라진다. 되돌리기 전에 필요한 공지를 백업할 것.
DROP INDEX IF EXISTS idx_notices_locale;
DROP INDEX IF EXISTS idx_notices_status;
DROP INDEX IF EXISTS idx_notices_visible;
DROP TABLE IF EXISTS notices;
