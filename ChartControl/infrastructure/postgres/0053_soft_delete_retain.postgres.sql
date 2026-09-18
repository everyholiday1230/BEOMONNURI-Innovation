-- 고객이 삭제해도 서버에는 남긴다 (운영 결정 2026-09-18).
--
-- ★★★ 왜: "만료든 고객이 삭제하든 우리 서버에는 항상 저장되어야 해. 대화기록이나
--     매매기록은 필수고. 우리가 다 학습시킬 거야."
--
-- ★★★ 그래서 `DELETE` 를 쓰지 않고 `deleted_at` 을 찍는다. 고객 화면에서는 즉시
--     사라지고(삭제한 것으로 보인다), 서버에는 남는다.
--
-- ★★ **거래소 API 키는 이 방식을 쓰지 않는다.** 키를 삭제했다는데 서버에 남겨 두면
--     고객 자산에 접근할 수 있는 비밀을 계속 들고 있는 것이다. 보관 대상이 아니다.
--     (개인정보 문서도 "삭제할 때까지" 로 남겨 두었다)

ALTER TABLE user_strategies ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE saved_items     ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- 목록 조회가 이 열을 항상 본다.
CREATE INDEX IF NOT EXISTS idx_user_strategies_alive
  ON user_strategies (user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_saved_items_alive
  ON saved_items (user_id) WHERE deleted_at IS NULL;
