-- ============================================================
-- 0030 — 가격 알림 (price alerts)
-- ------------------------------------------------------------
-- 무엇을 해결하는가
--   고객이 "BTC 가 8만 달러에 닿으면 알려줘" 를 걸어두고, 조건이 충족되면
--   앱 알림(notifications)과 이메일로 통지받는다. 재방문을 만드는 기능이다.
--
-- 설계
--   · 한 행 = 한 알림. symbol + 방향(above/below) + 목표가.
--   · status: active → triggered(조건 충족) | cancelled(사용자 취소).
--     한 번 발동하면 다시 울리지 않는다(반복 알림은 사용자가 다시 만든다).
--   · notify_email: 이메일도 보낼지. 앱 알림은 항상 남긴다.
--   · 감시 루프가 activE 알림만 훑으므로 (status, symbol) 인덱스를 둔다.
-- ============================================================

CREATE TABLE IF NOT EXISTS price_alerts (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL,
  -- 'above' = 가격이 target 이상이 되면, 'below' = target 이하가 되면
  direction     TEXT NOT NULL CHECK (direction IN ('above', 'below')),
  target_price  DOUBLE PRECISION NOT NULL CHECK (target_price > 0),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'cancelled')),
  notify_email  BOOLEAN NOT NULL DEFAULT TRUE,
  -- 발동 시점의 실제 가격(사후 확인용). 지어내지 않고 실제 값을 기록한다.
  triggered_price DOUBLE PRECISION,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  triggered_at  TIMESTAMPTZ,
  cancelled_at  TIMESTAMPTZ
);

-- 감시 루프: 활성 알림을 심볼별로 훑는다.
CREATE INDEX IF NOT EXISTS idx_price_alerts_active
  ON price_alerts (symbol) WHERE status = 'active';

-- 사용자별 목록 조회.
CREATE INDEX IF NOT EXISTS idx_price_alerts_user
  ON price_alerts (user_id, created_at DESC);
