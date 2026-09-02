-- 0040 · 운영 오류 관측(ops_errors).
--
-- 왜 필요한가
-- ----------
-- 지금까지 서비스 오류를 아는 유일한 경로는 **고객 신고**였다. 클라이언트 오류는
-- console.error 로만 남고(아무도 보지 않는다), 서버의 처리되지 않은 예외는 어디에도
-- 쌓이지 않았다. 실주문이 열려 있는 서비스에서 이건 눈을 가린 상태와 같다.
--
-- 왜 fingerprint 로 묶는가
-- -----------------------
-- 오류는 폭주한다. 같은 원인이 초당 수십 번 발생하면 행이 수만 개로 늘어 정작
-- 읽을 수 없게 되고, 알림을 보내면 메일함이 막힌다. 그래서 (출처, 메시지, 스택
-- 앞부분)을 해시해 **한 원인당 한 행**으로 모으고 seen_count 를 올린다.
-- "언제 처음 났고, 마지막이 언제고, 몇 번 났는가" 가 원인 추적에 필요한 최소값이다.
--
-- 개인정보
-- -------
-- user_id 는 선택이고 ON DELETE SET NULL 이다. 회원을 지우면 오류 기록은 남되
-- 누구인지는 지워진다 — 원인 분석은 계속 가능하고 개인은 남지 않는다.
CREATE TABLE IF NOT EXISTS ops_errors (
  id            TEXT PRIMARY KEY,
  fingerprint   TEXT NOT NULL UNIQUE,
  -- 'client' = 브라우저에서 올라온 것, 'server' = API 처리 중 발생한 것.
  source        TEXT NOT NULL,
  message       TEXT NOT NULL,
  stack         TEXT,
  -- 클라이언트는 화면 URL, 서버는 요청 경로.
  url           TEXT,
  method        TEXT,
  status        INTEGER,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  seen_count    INTEGER NOT NULL DEFAULT 1,
  first_seen_at BIGINT NOT NULL,
  last_seen_at  BIGINT NOT NULL,
  -- 이 지문으로 마지막으로 알림을 보낸 시각. 폭주 시 메일을 막는 데 쓴다.
  alerted_at    BIGINT,
  CONSTRAINT ops_errors_source_chk CHECK (source IN ('client','server'))
);

-- 운영자 화면은 "최근에 난 것" 순으로 읽는다.
CREATE INDEX IF NOT EXISTS ops_errors_last_seen_idx ON ops_errors (last_seen_at DESC);
