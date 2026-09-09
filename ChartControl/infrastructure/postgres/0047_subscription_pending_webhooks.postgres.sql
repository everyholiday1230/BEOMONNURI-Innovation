/*
   결제 후 접근권을 못 받는 구멍을 막는다.

   ★★★ 무엇이 문제였나 — 고객이 돈을 내고 아무것도 못 받을 수 있었다

     구독 흐름이 checkout → (PayPal 승인) → confirm 두 단계다. 승인 전에 'active' 로
     저장하지 않는 것은 **맞다** — 결제하지 않은 사람이 유료 기능을 쓰면 안 된다.

     그런데 반대쪽 구멍이 있었다. checkout 이 만든 구독 id(provider_ref)를 **아무 데도
     저장하지 않고** 화면에만 돌려줬다. 그래서 고객이 PayPal 에서 승인을 마친 뒤
     브라우저를 닫거나 네트워크가 끊기면:

       · PayPal 쪽 구독은 ACTIVE 이고 **요금이 청구된다**
       · 우리 DB 에는 아무 기록도 없다
       · 되찾을 단서(provider_ref)조차 없어 **수동 복구도 불가능하다**

   ★ 그래서 승인 대기 상태를 저장한다. 'pending' 은 접근권을 주지 않는다(entitled 는
     'active' 와 기간으로만 판단한다). 저장하는 목적은 **나중에 대조**하기 위함이다.

   ★★ 'pending' 을 status CHECK 에 넣는다. 넣지 않으면 INSERT 가 제약 위반으로
     실패하고, 그 실패를 무시하면 지금과 똑같이 단서가 사라진다.
*/

ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('pending', 'active', 'canceled', 'expired'));

/*
   ★ provider_ref 로 찾을 수 있어야 한다. 웹훅과 대조 작업은 사용자 id 가 아니라
     PayPal 의 구독 id 를 들고 온다.

   ★★ UNIQUE 다. 같은 PayPal 구독이 두 사람에게 붙으면 한 번 결제로 두 계정이
     유료 기능을 쓴다. DB 가 막아야 한다 — 응용 코드의 검사만으로는 경합에서 샌다.
*/
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_provider_ref_uidx
  ON subscriptions (provider_ref)
  WHERE provider_ref IS NOT NULL;

/*
   승인 대기가 언제 시작됐는지. 대조 작업이 "충분히 오래된 pending" 만 정리하도록
   쓴다. 방금 만든 것을 지우면 고객이 PayPal 화면에서 결제하는 중에 사라진다.
*/
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pending_since TIMESTAMPTZ;

/*
   웹훅 중복 처리 방지.

   ★★ PayPal 은 같은 이벤트를 **여러 번 보낸다**(재시도 정책). 멱등하지 않으면
     포인트가 두 번 지급되거나 기간이 두 번 연장된다. event_id 를 기본키로 두어
     DB 가 중복을 막는다.

   ★ 처리 결과도 남긴다. 실패한 이벤트를 나중에 찾아 다시 처리할 수 있어야 한다.
     "받았지만 처리하지 못했다" 를 조용히 버리면 원인을 찾을 수 없다.
*/
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  event_id   TEXT PRIMARY KEY,
  provider   TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  handled    BOOLEAN NOT NULL DEFAULT false,
  note       TEXT
);

CREATE INDEX IF NOT EXISTS payment_webhook_events_unhandled_idx
  ON payment_webhook_events (received_at)
  WHERE handled = false;
