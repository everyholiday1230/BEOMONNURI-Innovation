-- 0036 — 사용자가 만든 전략/지표 (Option B: 전용 저장소)
-- 내장 전략 카탈로그(코드)와 별개로, 사용자가 직접 만들어 저장(유료)하고
-- 편집·삭제·재백테스트할 수 있는 자기 소유 전략/지표를 담는다.
CREATE TABLE IF NOT EXISTS user_strategies (
  id               TEXT PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL DEFAULT 'strategy' CHECK (kind IN ('strategy', 'indicator')),
  name             TEXT NOT NULL,
  base_strategy_id TEXT,
  symbol           TEXT,
  timeframe        TEXT,
  config           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_strategies_user ON user_strategies(user_id, kind, created_at DESC);
