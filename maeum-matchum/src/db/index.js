import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = join(DATA_DIR, "maeum.db");

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate() {
  db.exec(`
    -- 사용자(본인)
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname      TEXT NOT NULL,
      age           INTEGER,
      gender        TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 프로필: 본인 또는 상대(파트너)의 10차원 평가 결과
    -- owner_type: 'self' | 'partner'
    CREATE TABLE IF NOT EXISTS profiles (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_type    TEXT NOT NULL DEFAULT 'self',
      label         TEXT,                       -- 상대 별칭 (예: "민준")
      answers_json  TEXT NOT NULL,              -- 원본 응답 { questionId: value }
      scores_json   TEXT NOT NULL,              -- 차원별 점수 { dimKey: value }
      attachment    TEXT,                       -- secure|anxious|avoidant
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 궁합 분석 결과 (본인 프로필 × 상대 프로필)
    CREATE TABLE IF NOT EXISTS analyses (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      self_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      partner_profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      overall_score   REAL NOT NULL,
      verdict         TEXT NOT NULL,            -- 판단 등급
      dimension_json  TEXT NOT NULL,            -- 차원별 상세
      report_json     TEXT NOT NULL,            -- 판단>근거>추천>보완>실행
      ai_used         INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 에이전트 대화 기록
    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,                -- user | assistant
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_user ON profiles(user_id);
    CREATE INDEX IF NOT EXISTS idx_analyses_user ON analyses(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_analysis ON messages(analysis_id);

    -- 고객(브라우저별 식별): 로그인 없이 client_key로 구분
    CREATE TABLE IF NOT EXISTS customers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      client_key  TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 자유 상담(진단 없이) 대화 — 고객별로 영구 보존
    CREATE TABLE IF NOT EXISTS consult_messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,                -- user | assistant
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_consult_customer ON consult_messages(customer_id);
  `);
}
