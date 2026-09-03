-- 0016 — 가입 시 선택한 국가 (SQLite 개발 백엔드).
--
-- ★★ 가입 화면은 이미 국가를 물었고 클라이언트도 보냈지만, 서버가 버렸다.
--   저장할 컬럼이 없었기 때문이다. PostgreSQL 쪽 0042 와 같은 목적이다.
--
-- ★ country_source 로 "사용자가 직접 고름(user)" 과 "브라우저로 추정(inferred)" 을
--   구분한다. 추정치를 선언으로 취급하면 나중에 국가별 평균이 조용히 왜곡된다.
--
-- ★ SQLite 는 ADD COLUMN 에 IF NOT EXISTS 가 없다. 마이그레이션 러너가 파일을
--   한 번만 적용하므로 그대로 둔다.
ALTER TABLE users ADD COLUMN country TEXT;
ALTER TABLE users ADD COLUMN country_source TEXT;
CREATE INDEX IF NOT EXISTS idx_users_country ON users (country);
