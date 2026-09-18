/*
   0051 — 사용자가 만든 **신호 규칙**을 저장할 수 있게 한다.

   왜 필요한가
   ----------
   운영 결정(2026-09-18): 매매 신호는 우리가 주는 것이 아니라 **고객이 만든다.**
   고객이 조건을 쓰고(예: `CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))`),
   서비스는 그 조건이 성립한 봉을 차트에 표시한다. 규칙은 고객 것이고, 표시는
   계산 결과이며, 주문은 발생하지 않는다(약관 제2조4호·제4조2호).

   `user_strategies` 를 그대로 쓴다 — 이미 사용자 소유·유료 저장·편집·삭제가 갖춰져
   있다. 새 표만 만들면 그 네 가지를 다시 만들어야 하고, 두 저장소가 어긋난다.
   `config` JSONB 에 `{ rule, pane, ... }` 을 담는다.

   ★★★ **CHECK 제약 이름을 가정하지 않는다.**

     0047 에서 `subscriptions_status_check` 라는 이름을 가정해 지웠는데 실제 이름은
     `subscriptions_status` 였다. `IF EXISTS` 라서 오류 없이 지나갔고, 낡은 제약이
     남아 프로덕션에서 INSERT 가 거부됐다(0048 이 그것을 치웠다).

     그래서 여기서는 kind 를 검사하는 CHECK 를 **카탈로그에서 찾아** 모두 지우고
     하나만 다시 만든다. 몇 번 실행해도 결과가 같다(멱등).

   ★ 기존 값('strategy'·'indicator')을 그대로 허용한다. 빠뜨리면 기존 행을 수정할
     때 제약 위반이 된다.
*/

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'user_strategies'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE user_strategies DROP CONSTRAINT %I', c.conname);
    RAISE NOTICE '낡은 kind 제약을 지웠다: %', c.conname;
  END LOOP;
END $$;

ALTER TABLE user_strategies
  ADD CONSTRAINT user_strategies_kind
  CHECK (kind IN ('strategy', 'indicator', 'signal'));
