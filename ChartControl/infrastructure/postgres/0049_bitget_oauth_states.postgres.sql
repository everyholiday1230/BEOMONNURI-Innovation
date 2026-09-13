-- ============================================================
-- 0049 — Bitget FastApi (OAuth) 진행 상태
-- ------------------------------------------------------------
-- 무엇을 위한 표인가
--   Bitget FastApi 는 KuCoin 과 흐름이 다르다. 인증 코드를 받아 우리가 키를
--   교환하는 것이 아니라, **Bitget 이 우리 콜백으로 API 키를 직접 POST 한다.**
--   그 요청에는 세션 쿠키가 없다(서버 대 서버). 따라서 진위 판정은
--   **서명 검증뿐**이고, 그 서명은 우리가 시작 단계에서 만든 `serialNo` 를
--   되돌려주는 형태다.
--
-- ★★★ serialNo 를 저장하고 대조하지 않으면 계정 탈취가 된다.
--
--   공격자가 자기 Bitget 계정으로 인증한 뒤, 콜백 본문의 `clientUserId` 만
--   피해자 것으로 바꿔 보내면 **피해자 계정에 공격자의 거래소 키가 연결된다.**
--   그 뒤 피해자가 내는 주문이 공격자 계정에서 실행된다.
--
--   FastApi 문서도 이것을 명시한다:
--     "bind serialNo to the clientUserId and avoid using it across multiple
--      accounts" / "it is recommended to set an expiration time for serialNo"
--
--   그래서 serialNo 는
--     · 우리가 만든 난수여야 하고         (추측 불가)
--     · 만든 사람(user_id)에 묶여야 하고   (다른 계정에 못 쓴다)
--     · 한 번만 쓸 수 있어야 하고          (used_at)
--     · 짧게 만료돼야 한다                 (10분 권장)
--
-- ★ 왜 메모리가 아니라 표인가
--   서버를 여러 대로 늘리면 시작 요청과 콜백이 다른 인스턴스로 갈 수 있다.
--   메모리에 두면 그때 "serialNo 를 모른다" 로 실패한다. 재시작 중 진행되던
--   인증도 같은 이유로 깨진다. KuCoin 표(0024)와 같은 이유다.
--
-- ★ API 키를 이 표에 저장하지 않는다.
--   키는 곧바로 자격증명 금고(exchange_credentials, KEK 로 암호화)에 넣는다.
--   중간 표에 평문으로 남기면 유출 지점이 하나 늘어난다.
-- ============================================================

CREATE TABLE IF NOT EXISTS bitget_oauth_states (
  -- FastApi 의 `serialNo`. 우리가 만들어 인증 URL 에 실어 보낸다.
  serial_no     TEXT PRIMARY KEY,

  -- 이 인증을 시작한 우리 회원. 콜백의 `clientUserId` 와 **반드시 일치해야 한다**.
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- 시작 요청의 세션 지문. 다른 브라우저에서 돌아오는 것을 걸러낸다.
  -- ★ 콜백(서버 대 서버)에는 쓰지 않는다 — 쿠키가 없으므로 대조할 것이 없다.
  --   브라우저 복귀(redirectUrl) 검증에만 쓴다.
  session_hash  TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,

  -- 한 번만 쓰이도록. NULL 이면 아직 사용되지 않았다.
  used_at       TIMESTAMPTZ,

  -- 콜백이 준 Bitget 사용자 식별자(암호화된 값). 재인증 판별·지원 문의에 쓴다.
  -- ★ 평문 Bitget UID 가 아니다 — 문서상 "Encrypted Bitget user ID" 다.
  open_id       TEXT
);

-- 만료 청소용. 오래된 행을 지우는 작업이 전체 스캔을 하지 않게 한다.
CREATE INDEX IF NOT EXISTS idx_bitget_oauth_expires
  ON bitget_oauth_states (expires_at);

-- 사용자별 진행 건 조회(중복 시작 방지·지원 문의).
CREATE INDEX IF NOT EXISTS idx_bitget_oauth_user
  ON bitget_oauth_states (user_id, created_at DESC);
