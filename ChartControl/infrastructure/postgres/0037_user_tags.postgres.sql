-- 0037 — user_tags: 한 유저에게 여러 겸직 태그(team_leader, staff 등)를 붙인다.
-- 권한 역할(users.role)과 별개다: role 은 접근권한, tag 는 겸직/커미션 대상 표시.
CREATE TABLE IF NOT EXISTS user_tags (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  PRIMARY KEY (user_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_user_tags_tag ON user_tags(tag);
