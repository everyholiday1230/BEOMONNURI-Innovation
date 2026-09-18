/*
   0051 되돌리기 — kind 에서 'signal' 을 다시 뺀다.

   ★★ 되돌리기 전에 **'signal' 행을 먼저 처리해야 한다.** 남아 있으면 새 CHECK 가
     기존 행을 위반해 ALTER 가 실패한다. 조용히 지우지 않는다 — 고객이 돈(포인트)을
     내고 저장한 자기 규칙이다. 개수를 알리고 멈춘다.

   ★ 운영자가 판단해서 옮기거나 지운 뒤 다시 실행한다.
*/

DO $$
DECLARE
  n BIGINT;
  c RECORD;
BEGIN
  SELECT COUNT(*) INTO n FROM user_strategies WHERE kind = 'signal';
  IF n > 0 THEN
    RAISE EXCEPTION '신호 규칙 %건이 남아 있다 — 되돌리기 전에 옮기거나 지울 것 (고객이 저장한 자기 규칙이다)', n;
  END IF;

  FOR c IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'user_strategies'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE user_strategies DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE user_strategies
  ADD CONSTRAINT user_strategies_kind
  CHECK (kind IN ('strategy', 'indicator'));
