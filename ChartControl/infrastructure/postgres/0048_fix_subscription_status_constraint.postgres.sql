/*
   0047 이 남긴 낡은 제약을 치운다.

   ★★★ 무엇을 놓쳤나 — 배포 후 프로덕션에서 발견했다

     0047 에서 이렇게 썼다:

       ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;

     그런데 프로덕션의 기존 제약 이름은 **`subscriptions_status`** 였다. 0044 가
     `CONSTRAINT subscriptions_status CHECK (...)` 로 이름을 직접 준 것이고, 나는
     Postgres 가 자동 생성하는 이름(`_check` 접미사)을 가정했다.

     `IF EXISTS` 라서 오류 없이 지나갔고, 마이그레이션은 성공으로 보였다. 결과:

       · subscriptions_status        : active/canceled/expired   ← 남아 있었다
       · subscriptions_status_check  : pending/active/canceled/expired

     CHECK 는 **모두** 만족해야 한다. 그래서 'pending' INSERT 가 거부됐다.
     실측(프로덕션): ERROR ... violates check constraint "subscriptions_status".

   ★ 즉 승인 대기 기록이 프로덕션에서 **전혀 동작하지 않았다.** markPending 이
     실패를 로그만 남기고 넘어가도록 만들어 두었기 때문에 결제 흐름 자체는 멈추지
     않았지만, 되찾을 단서를 남기지 못하는 원래 문제가 그대로였다.

   ★★ 교훈: 제약을 이름으로 지울 때는 **이름을 확인하고 지운다.** `IF EXISTS` 는
     오타를 조용히 넘긴다. 아래는 이름을 가정하지 않고 카탈로그에서 찾아 지운다.
*/

DO $$
DECLARE
  c RECORD;
BEGIN
  /*
     status 를 검사하는 CHECK 를 **모두** 찾아 지운다. 이름을 가정하지 않는다.
     0047 이 만든 것도 함께 지우고 아래에서 하나만 다시 만든다 — 그래야 몇 번
     실행해도 결과가 같다(멱등).
  */
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'subscriptions'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE subscriptions DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE '낡은 status 제약을 지웠다: %', c.conname;
  END LOOP;
END $$;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status
  CHECK (status IN ('pending', 'active', 'canceled', 'expired'));
