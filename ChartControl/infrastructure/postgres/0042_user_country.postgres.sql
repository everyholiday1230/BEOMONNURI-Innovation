-- 0042 — 가입 시 선택한 국가.
--
-- ★★ 왜 필요한가
--
--   가입 화면에는 이미 국가 선택 칸이 있고(195개국), 클라이언트도 그 값을 서버로
--   보냈다. 그런데 서버의 RegisterInputSchema 가 email·password 만 받고 나머지를
--   버렸고, users 테이블에 저장할 컬럼도 없었다. 즉 **고객이 고른 값이 어디에도
--   남지 않는 죽은 입력**이었다. 화면은 물어보고, 우리는 듣지 않았다.
--
-- ★★ country_source 를 함께 둔다
--
--   브라우저 언어·시간대로 국가를 추정해 미리 채워 주면 편하지만, 그렇게 채운
--   값과 사용자가 직접 고른 값은 **사실의 성질이 다르다.** 나중에 국가별 평균이나
--   언어 확장을 판단할 때 추정치를 선언으로 취급하면 숫자가 조용히 왜곡된다.
--   그래서 무엇이 근거인지 함께 남긴다.
--
-- ★ 둘 다 NULL 을 허용한다. 기존 가입자에게는 이 정보가 없고, 없는 것을 'US' 나
--   빈 문자열로 채우면 없는 사실을 만들어내는 것이 된다.

ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS country_source TEXT;

-- ★ 국가 코드는 ISO 3166-1 alpha-2 두 글자 대문자, 또는 목록에 없을 때 'OTHER'.
--   화면이 보내는 값을 그대로 믿지 않고 DB 에서도 막는다 — 코드가 바뀌어도
--   저장된 값의 모양은 유지돼야 집계가 깨지지 않는다.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_country_format;
ALTER TABLE users ADD CONSTRAINT users_country_format
  CHECK (country IS NULL OR country = 'OTHER' OR country ~ '^[A-Z]{2}$');

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_country_source_values;
ALTER TABLE users ADD CONSTRAINT users_country_source_values
  CHECK (country_source IS NULL OR country_source IN ('user', 'inferred'));

-- 국가별 집계를 위한 인덱스. 부분 인덱스로 둔다 — NULL 이 많을 것이고,
-- 집계는 값이 있는 행만 대상으로 한다.
CREATE INDEX IF NOT EXISTS idx_users_country ON users (country) WHERE country IS NOT NULL;
