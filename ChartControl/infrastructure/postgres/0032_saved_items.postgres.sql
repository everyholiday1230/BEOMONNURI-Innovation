-- ============================================================
-- 0032 — 사용자 저장 항목 (saved items): 신호·지표·드로잉
-- ------------------------------------------------------------
-- 무엇을 해결하는가
--   고객이 자기가 만든 신호(SignalObject)나 지표 설정(indicator preset), 드로잉을
--   저장해 나중에 다시 불러온다. 저장할 때 포인트를 차감한다(point sink).
--
-- 왜 새 테이블인가 (레거시 SQLite 저장을 안 쓰는 이유)
--   기존 /me/signals·/me/overlays·/me/layouts 는 SQLite 테이블이고 user_id 가 SQLite
--   users 를 FK 참조한다. 그런데 프로덕션은 사용자를 PostgreSQL 에 두므로 그 FK 가
--   항상 실패해(SQLITE_CONSTRAINT_FOREIGNKEY) 저장이 500 으로 죽는다(AI 대화와 동일
--   문제). 그래서 사용자를 PG 에 두는 이 저장은 처음부터 PG 로 만든다.
-- ============================================================

CREATE TABLE IF NOT EXISTS saved_items (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 저장 종류. 새 종류가 생기면 마이그레이션으로 추가한다(자유 문자열 금지).
  kind TEXT NOT NULL CHECK (kind IN ('signal', 'indicator', 'drawing')),
  name TEXT NOT NULL,
  symbol TEXT,
  timeframe TEXT,
  -- 저장 본문(신호 객체 / 지표 설정 / 드로잉 등). 구조가 종류마다 달라 JSONB 로 둔다.
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_items_user ON saved_items (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_items_user_kind ON saved_items (user_id, kind, created_at DESC);
