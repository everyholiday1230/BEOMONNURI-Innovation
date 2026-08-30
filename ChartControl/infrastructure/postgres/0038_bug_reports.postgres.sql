-- 0038 · 오류 제보(버그 리포트).
--
-- 고객이 오류를 제보하고, 운영자가 확인하면 포인트를 지급한다. 제보는 각 고객별로
-- 저장되고(user_id), 상태는 open → confirmed | rejected 로 흐른다. 지급 포인트와
-- 처리자·사유를 함께 남겨 나중에 "누가 언제 얼마를 왜 줬는지" 추적할 수 있게 한다.
CREATE TABLE IF NOT EXISTS bug_reports (
  id            TEXT PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  area          TEXT,
  status        TEXT NOT NULL DEFAULT 'open',
  points_awarded INTEGER NOT NULL DEFAULT 0,
  resolution    TEXT,
  resolved_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at   BIGINT,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  CONSTRAINT bug_reports_status_chk CHECK (status IN ('open','confirmed','rejected'))
);

CREATE INDEX IF NOT EXISTS bug_reports_user_idx ON bug_reports (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bug_reports_status_idx ON bug_reports (status, created_at DESC);
