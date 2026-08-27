-- 0014 — 사용자가 만든 전략/지표 (Option B). SQLite(개발·테스트)용.
-- ★ user_id 에 users FK 를 걸지 않는다(0013 참고: 회원이 PG, 리소스가 SQLite 인
--   배포에서 FK 가 깨진다). 접근 스코프는 코드에서 user_id 로 강제한다.
CREATE TABLE IF NOT EXISTS user_strategies (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'strategy',
  name             TEXT NOT NULL,
  base_strategy_id TEXT,
  symbol           TEXT,
  timeframe        TEXT,
  config           TEXT NOT NULL DEFAULT '{}',
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_strategies_user ON user_strategies(user_id, kind, created_at);
