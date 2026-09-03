-- 0042 되돌리기.
--
-- ★ 컬럼을 지우면 저장된 국가 정보가 사라진다. 되돌릴 일이 생기면 그 사실을
--   알고 실행해야 하므로, 여기서는 제약과 인덱스만 정리하고 컬럼은 남긴다.
--   컬럼이 남아 있어도 코드가 읽지 않으면 아무 영향이 없다 — 데이터를 지우는
--   쪽이 위험하다.
DROP INDEX IF EXISTS idx_users_country;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_country_format;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_country_source_values;
