-- 0013 되돌리기.
--
-- ★ 고객 대응 기록이 사라진다. 분쟁 근거이므로 되돌리기 전에 반드시 백업할 것.
DROP INDEX IF EXISTS idx_messages_ticket;
DROP TABLE IF EXISTS support_messages;
DROP INDEX IF EXISTS idx_tickets_user;
DROP INDEX IF EXISTS idx_tickets_status;
DROP TABLE IF EXISTS support_tickets;
