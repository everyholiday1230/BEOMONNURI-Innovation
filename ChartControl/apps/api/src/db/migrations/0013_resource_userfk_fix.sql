-- ============================================================
-- 0013 — resource 테이블의 잘못된 user FK 제거 (프로덕션 500 수정)
-- ------------------------------------------------------------
-- 무엇을/왜
--   layouts, layout_versions, ai_signals, signal_versions, chart_overlays,
--   order_drafts 는 SQLite 에 있으면서 user_id 가 SQLite users(id) 를 FK 로
--   참조한다. 프로덕션은 사용자를 PostgreSQL 에 두므로(SQLite users 는 비어 있음)
--   이 테이블에 INSERT 하면 SQLITE_CONSTRAINT_FOREIGNKEY → 500 이 난다
--   (/me/layouts·/me/signals·/me/overlays·/me/order-drafts). 0012 가 AI 대화
--   테이블에 한 것과 동일한 수정을 resource 테이블로 확장한다.
--
-- 방법 (중요)
--   users(id) FK 만 제거하고 **현재 스키마의 모든 컬럼·인덱스·테이블 간 FK를
--   그대로 유지**한다. (ai_signals 는 0004, order_drafts 는 0007/0008 에서 컬럼이
--   추가됐다 — 그 컬럼을 잃지 않도록 현재 스키마를 그대로 재현한다.)
--   프로덕션에서 이 테이블들은 쓰기가 늘 500 이라 비어 있으므로 DROP+CREATE 안전.
--   자식(버전) 먼저 drop, 부모 먼저 create.
-- ============================================================

PRAGMA foreign_keys=OFF;

DROP TABLE IF EXISTS signal_versions;
DROP TABLE IF EXISTS layout_versions;
DROP TABLE IF EXISTS ai_signals;
DROP TABLE IF EXISTS chart_overlays;
DROP TABLE IF EXISTS order_drafts;
DROP TABLE IF EXISTS layouts;

-- layouts (users FK 제거)
CREATE TABLE layouts (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_layouts_user ON layouts(user_id);

-- ai_signals (0004 추가 컬럼 포함, users FK 제거)
CREATE TABLE ai_signals (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  symbol TEXT NOT NULL, timeframe TEXT, direction TEXT, status TEXT NOT NULL DEFAULT 'PROPOSED',
  data TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  market_type TEXT, conversation_id TEXT, model TEXT, prompt_version TEXT, data_snapshot_id TEXT,
  user_edited INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_signals_user ON ai_signals(user_id);

-- chart_overlays (users FK 제거)
CREATE TABLE chart_overlays (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  symbol TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_overlays_user ON chart_overlays(user_id);

-- order_drafts (0007/0008 추가 컬럼·인덱스 포함, users FK 제거)
CREATE TABLE order_drafts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
  symbol TEXT NOT NULL, side TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'MOCK', executable INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER, idempotency_key TEXT,
  valid INTEGER, allowed INTEGER
);
CREATE INDEX IF NOT EXISTS idx_order_drafts_user ON order_drafts(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_drafts_idem
  ON order_drafts(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_drafts_user_created ON order_drafts(user_id, created_at);

-- layout_versions (layouts FK 유지, users FK 제거)
CREATE TABLE layout_versions (
  id TEXT PRIMARY KEY,
  layout_id TEXT NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_layout_versions_user ON layout_versions(user_id);

-- signal_versions (ai_signals FK 유지, users FK 제거)
CREATE TABLE signal_versions (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES ai_signals(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  version INTEGER NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signal_versions_user ON signal_versions(user_id);

PRAGMA foreign_keys=ON;
