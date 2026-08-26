-- 0034 — point_orders.provider 에 'toss'(한국결제) 허용
-- 기존 CHECK 는 ('paypal','usdt') 만 허용해 토스 주문 INSERT 가 실패한다.
ALTER TABLE point_orders DROP CONSTRAINT IF EXISTS point_orders_provider_check;
ALTER TABLE point_orders ADD CONSTRAINT point_orders_provider_check
  CHECK (provider IN ('paypal', 'usdt', 'toss'));
