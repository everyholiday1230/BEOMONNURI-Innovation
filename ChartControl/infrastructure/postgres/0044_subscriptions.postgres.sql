/*
   구독 상태.

   ★★ 기존 tier_definitions 와 섞지 않는다.

     그 테이블은 **거래량 기반 리베이트 등급**이다(active/pro/partner, 30일 거래량
     기준). 이름이 비슷하다고 같은 테이블에 넣으면, 돈을 낸 구독자와 거래를 많이 한
     사람을 구별할 수 없게 된다. 별도 테이블로 둔다.

   ★★ 한 사람에 한 행만 둔다(user_id PRIMARY KEY).

     구독 이력이 필요하면 point_ledger 의 충전 기록과 결제 주문(point_orders)이
     남는다. 여기에 이력까지 쌓으면 "지금 무슨 플랜인가" 를 읽을 때마다 정렬이
     필요하고, 그 정렬을 빠뜨리면 옛 플랜을 현재로 읽는다.
*/

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

  /*
     플랜 코드. plans.ts 의 PlanCode 와 같은 값이다.

     ★ CHECK 로 고정하지 않는다 — 플랜을 추가할 때마다 마이그레이션이 필요해지고,
       그 마이그레이션을 빠뜨리면 결제는 됐는데 저장이 거부된다. 대신 서버가
       isPlanCode() 로 검증하고, 알 수 없는 값은 읽을 때 무료로 떨어뜨린다.
  */
  plan_code TEXT NOT NULL,

  /*
     상태.
       active    — 유효, 갱신 예정
       canceled  — 해지 요청됨. current_period_end 까지는 유효하다
       expired   — 기간이 끝났고 갱신되지 않았다
     ★ 'canceled' 와 'expired' 를 구별한다. 해지 즉시 기능을 끊으면 이미 낸 달의
       돈을 돌려주지 않으면서 서비스를 멈추는 것이 된다.
  */
  status TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT subscriptions_status CHECK (status IN ('active', 'canceled', 'expired')),

  /** 현재 결제 주기의 시작·끝. 끝 시각이 지나면 갱신 또는 만료 처리한다. */
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end TIMESTAMPTZ NOT NULL,

  /*
     결제 대행사의 구독 식별자.

     ★ NULL 이면 **결제로 만들어진 구독이 아니다**(운영자 수동 부여 등). 그 구별이
       중요하다 — 결제 없이 부여된 구독을 결제 취소로 끊으려 하면 대상이 없다.
  */
  provider TEXT,
  provider_ref TEXT,

  /*
     마지막으로 포인트를 충전한 주기의 시작 시각.

     ★★ 멱등 장치다. 갱신 처리가 두 번 돌면 포인트가 두 배로 들어간다. 이 값이
       current_period_start 와 같으면 이미 충전한 것으로 보고 건너뛴다.
  */
  last_grant_period TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/* 갱신 대상을 찾는 조회(기간이 끝난 active 행)를 위한 인덱스. */
CREATE INDEX IF NOT EXISTS idx_subscriptions_due
  ON subscriptions (current_period_end)
  WHERE status = 'active';
