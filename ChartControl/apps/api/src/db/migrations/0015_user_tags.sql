-- 0015 — user_tags (겸직 태그). SQLite(개발·테스트)용. users FK 없음(0013 규칙).
CREATE TABLE IF NOT EXISTS user_tags (
  user_id    TEXT NOT NULL,
  tag        TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  PRIMARY KEY (user_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_user_tags_tag ON user_tags(tag);
