-- 0012 — AI 대화/메시지/사용량 테이블에서 user_id → users FK 제거.
--
-- 문제(프로덕션 장애): 이 세 테이블은 SQLite 에 있는데, 프로덕션은 사용자(users)를
-- PostgreSQL 에 둔다. 그래서 `user_id TEXT NOT NULL REFERENCES users(id)` 가 항상
-- 위반되어(SQLITE_CONSTRAINT_FOREIGNKEY) 대화 생성이 500 으로 죽었고, AI 코파일럿의
-- 대화 흐름 전체(생성→메시지 적재→사용량 기록)가 프로덕션에서 막혀 있었다.
--
-- 사용자 원본은 PG 이므로, 이 SQLite 테이블들은 user_id 를 **FK 없이 문자열로만** 보관한다.
-- (ai_messages.conversation_id → ai_conversations FK 는 같은 SQLite 안이라 유효하므로 유지.)
--
-- 프로덕션에서는 대화 생성이 계속 실패해 이 테이블들이 비어 있으므로 재생성이 안전하다.
-- AI 대화 기록은 비핵심 데이터라 재생성으로 인한 손실도 허용된다. 자식(ai_messages)을
-- 먼저 지우고 부모(ai_conversations)를 지운다(FK 순서).

DROP INDEX IF EXISTS idx_ai_msg_conv;
DROP INDEX IF EXISTS idx_ai_msg_user;
DROP INDEX IF EXISTS idx_ai_conv_user;
DROP INDEX IF EXISTS idx_ai_usage_user_at;

DROP TABLE IF EXISTS ai_messages;
DROP TABLE IF EXISTS ai_usage_records;
DROP TABLE IF EXISTS ai_conversations;

CREATE TABLE ai_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_ai_conv_user ON ai_conversations(user_id);

CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  reasoning_summary TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_ai_msg_conv ON ai_messages(conversation_id);
CREATE INDEX idx_ai_msg_user ON ai_messages(user_id);

CREATE TABLE ai_usage_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  correlation_id TEXT,
  model TEXT NOT NULL,
  fallback_used INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  estimated_cost_micros INTEGER NOT NULL,
  actual_cost_micros INTEGER,
  at INTEGER NOT NULL
);
CREATE INDEX idx_ai_usage_user_at ON ai_usage_records(user_id, at);
