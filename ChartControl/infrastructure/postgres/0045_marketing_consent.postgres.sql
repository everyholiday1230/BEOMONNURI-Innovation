-- ============================================================
-- 0045 — 마케팅 수신 동의 기록
-- ------------------------------------------------------------
-- 왜 필요한가
--
--   가입 화면이 마케팅 수신 체크박스를 보여주고 값도 서버로 보냈는데, 받는 곳이
--   없어서 **조용히 버려졌다.** 즉 동의를 받은 척만 하고 기록이 없었다.
--   기록 없는 동의는 받지 않은 것과 같다 — 입증 책임은 우리에게 있다.
--
--   개인정보보호법 §22③④ 는 마케팅 동의를 필수 동의와 **별도로, 적극적으로**
--   받으라고 한다. 정보통신망법 §50① 은 영리목적 광고성 정보 전송에 사전 동의를
--   요구한다. 둘 다 "언제 어떻게 받았는가" 를 남겨야 지킬 수 있다.
--
-- ★★ 기본값이 FALSE 다.
--
--   화면 기본값도 해제로 바꿨다(pages-auth.jsx). 기본 체크로 받은 동의는 적극적
--   동의로 보기 어렵다. 컬럼 기본값을 TRUE 로 두면 기존 가입자 전원이 동의한 것으로
--   기록돼 사실과 달라진다 — 그들은 묻지 않았거나 기본 체크로 지나갔다.
--
-- ★ NULL 을 쓰지 않고 opt_in_at 으로 구별한다.
--
--   marketing_opt_in = FALSE + at IS NULL   → 묻지 않았거나 거절했다(발송 금지)
--   marketing_opt_in = TRUE  + at 있음      → 그 시각에 동의했다(발송 가능)
--   marketing_opt_in = FALSE + at 있음      → 동의했다가 철회했다(발송 금지)
--
--   철회 시각을 따로 두지 않은 이유: at 을 갱신하면 "마지막으로 상태가 바뀐 때" 로
--   읽히고, 그것이 수신거부 처리 시점 입증에 필요한 값이다.
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at TIMESTAMPTZ;

-- 수신 동의자만 뽑는 조회가 발송 때마다 일어난다. 부분 인덱스로 충분하다.
CREATE INDEX IF NOT EXISTS idx_users_marketing_opt_in
  ON users (marketing_opt_in_at DESC)
  WHERE marketing_opt_in = TRUE;
