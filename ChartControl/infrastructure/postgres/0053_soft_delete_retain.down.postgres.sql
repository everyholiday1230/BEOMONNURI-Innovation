-- 되돌리기. ★ 열을 지우면 "삭제됨" 표시가 사라져 **삭제한 항목이 되살아난다.**
--   내리기 전에 그 행들을 어떻게 할지 결정해야 한다. 여기서는 열만 지운다.
DROP INDEX IF EXISTS idx_user_strategies_alive;
DROP INDEX IF EXISTS idx_saved_items_alive;
ALTER TABLE user_strategies DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE saved_items     DROP COLUMN IF EXISTS deleted_at;
