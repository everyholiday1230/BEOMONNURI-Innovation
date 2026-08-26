-- 0034 롤백 — toss 제거(paypal/usdt 만)
ALTER TABLE point_orders DROP CONSTRAINT IF EXISTS point_orders_provider_check;
ALTER TABLE point_orders ADD CONSTRAINT point_orders_provider_check
  CHECK (provider IN ('paypal', 'usdt'));
