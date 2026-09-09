/*
   0047 되돌리기.

   ★ status CHECK 를 원래대로 돌리기 전에 'pending' 행을 정리해야 한다. 남겨 두면
     제약 추가가 실패한다. pending 은 접근권이 없는 상태이므로 지워도 고객이 쓰던
     권한을 빼앗지 않는다.
*/

DELETE FROM subscriptions WHERE status = 'pending';

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'canceled', 'expired'));

DROP INDEX IF EXISTS subscriptions_provider_ref_uidx;

ALTER TABLE subscriptions DROP COLUMN IF EXISTS pending_since;

DROP TABLE IF EXISTS payment_webhook_events;
