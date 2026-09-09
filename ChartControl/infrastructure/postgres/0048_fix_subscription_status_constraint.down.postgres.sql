/*
   0048 되돌리기 — status 제약을 pending 없는 상태로 되돌린다.

   ★ pending 행을 먼저 지운다. 남겨 두면 제약 추가가 실패한다. pending 은 접근권이
     없는 상태이므로 지워도 고객이 쓰던 권한을 빼앗지 않는다.
*/

DELETE FROM subscriptions WHERE status = 'pending';

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'subscriptions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE subscriptions DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status
  CHECK (status IN ('active', 'canceled', 'expired'));
