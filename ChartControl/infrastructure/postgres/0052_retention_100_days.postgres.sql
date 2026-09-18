-- 보관기간을 전부 100일로 통일한다 (운영 결정 2026-09-18).
--
-- ★★★ 왜: 저장소가 둘이고 만료 규칙이 서로 달랐다.
--       · saved_items     — 30일 뒤 만료
--       · user_strategies — 만료 없음
--     고객이 "어느 쪽에 저장했는지" 를 기억해야 결과를 예측할 수 있었다.
--     운영자 지적으로 하나로 합친다.
--
-- ★★★ 기존 행의 기준 시각에 주의.
--     `created_at + 100일` 로 계산하면 **오래된 항목이 즉시 만료된다** — 고객이
--     포인트를 내고 저장한 것이 이 마이그레이션 때문에 사라지는 셈이다.
--     그래서 `now() + 100일` 로 준다. 누구도 이 변경으로 잃지 않는다.

ALTER TABLE user_strategies
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 이미 있던 규칙은 지금부터 100일. (created_at 기준이 아니다 — 위 주석 참고)
UPDATE user_strategies
   SET expires_at = now() + interval '100 days'
 WHERE expires_at IS NULL;

-- 30일로 저장돼 있던 항목도 100일로 늘린다. 줄어드는 고객은 없어야 한다.
-- ★ GREATEST 로 이미 100일보다 먼 것은 그대로 둔다(연장해 둔 고객을 깎지 않는다).
UPDATE saved_items
   SET expires_at = GREATEST(COALESCE(expires_at, now()), now() + interval '100 days')
 WHERE expires_at IS NULL OR expires_at < now() + interval '100 days';

-- 만료 조회가 잦다(목록마다 본다).
CREATE INDEX IF NOT EXISTS idx_user_strategies_expires ON user_strategies (user_id, expires_at);
