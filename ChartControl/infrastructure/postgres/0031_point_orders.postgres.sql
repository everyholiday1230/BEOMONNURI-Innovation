-- ============================================================
-- 0031 — 포인트 충전 주문 (point orders)
-- ------------------------------------------------------------
-- 무엇을 해결하는가
--   고객이 PayPal 또는 USDT 로 포인트를 구매(충전)한다. 결제 제공자에서 결제가
--   확인되면 point_ledger 에 reason='purchase' 로 적립한다. 그 결제 시도를 추적하는
--   원장이 이 테이블이다.
--
-- 멱등(idempotency)
--   결제 콜백/웹훅은 중복으로 올 수 있다. (provider, provider_ref) 유니크로 같은
--   결제 참조에 대해 주문이 하나만 생기게 하고, 적립 자체는 point_ledger 의
--   uq_points_ref (user_id, reason, ref_type='payment', ref_id=order.id) 로 이중 적립을
--   막는다. 즉 두 겹으로 안전하다.
-- ============================================================

CREATE TABLE IF NOT EXISTS point_orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 결제 수단. 새 수단이 생기면 마이그레이션으로 추가한다(자유 문자열 금지).
  provider TEXT NOT NULL CHECK (provider IN ('paypal', 'usdt')),
  -- 구매한 패키지 식별자(있으면). 임의 금액 충전이면 NULL.
  package_id TEXT,
  -- 적립될 포인트 수. 0/음수 금지.
  points INTEGER NOT NULL CHECK (points > 0),
  -- 청구 금액과 통화(예: 9.99 USD, 10 USDT).
  amount NUMERIC(24, 8) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL,
  -- 주문 상태. created 로 시작해 결제 확인 시 paid, 실패/만료 시 failed/expired.
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'expired')),
  -- 제공자 측 참조. PayPal order id 또는 크립토 인보이스 id.
  provider_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_point_orders_user ON point_orders (user_id, created_at DESC);

-- 하나의 제공자 참조(주문/인보이스 id)당 주문 하나 — 웹훅/재요청 중복 시 이중 생성 방지.
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_orders_ref
  ON point_orders (provider, provider_ref)
  WHERE provider_ref IS NOT NULL;
