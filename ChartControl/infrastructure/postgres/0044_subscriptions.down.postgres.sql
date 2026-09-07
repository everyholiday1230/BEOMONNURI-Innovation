/*
   되돌리기.

   ★ 구독 행을 지우면 유료 고객의 상태가 사라진다. 그래서 되돌리기는 개발·시험
     환경에서만 쓰는 것으로 본다. 운영에서 이걸 돌리기 전에 결제 대행사 쪽 구독을
     먼저 정리해야 한다 — 안 하면 돈은 계속 빠지고 서비스는 무료로 떨어진다.
*/
DROP INDEX IF EXISTS idx_subscriptions_due;
DROP TABLE IF EXISTS subscriptions;
