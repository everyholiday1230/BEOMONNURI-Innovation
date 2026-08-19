-- ============================================================
-- 0024 — KuCoin Fast API (OAuth 2.0) 진행 상태
-- ------------------------------------------------------------
-- 무엇을 위한 표인가
--   KuCoin Fast API 는 OAuth 인증 코드 방식이다. 이용자를 KuCoin 로그인
--   페이지로 보내고, 돌아올 때 `code` 와 `state` 를 받는다. 그 `state` 가
--   **우리가 보낸 것과 같은지** 확인해야 한다.
--
-- ★★ state 를 검증하지 않으면 CSRF 가 된다.
--
--   공격자가 자기 KuCoin 계정으로 인증한 뒤 그 콜백 주소를 피해자에게
--   열게 하면, **피해자 계정에 공격자의 거래소 키가 연결된다.** 그 뒤 피해자가
--   내는 주문이 공격자 계정에서 실행된다. 그래서 state 는
--     · 우리가 만든 난수여야 하고
--     · 만든 사람(세션)에 묶여야 하고
--     · 한 번만 쓸 수 있어야 하고
--     · 짧게 만료돼야 한다.
--
-- ★ 왜 메모리가 아니라 표인가
--   서버를 여러 대로 늘리면 시작 요청과 콜백이 다른 인스턴스로 갈 수 있다.
--   메모리에 두면 그때 "state 를 모른다" 로 실패한다. 재시작 중 진행되던
--   인증도 같은 이유로 깨진다.
--
-- ★ 토큰은 저장하지 않는다.
--   우리 용도는 "키를 한 번 발급받는 것" 이다. 액세스 토큰으로
--   `/api-key/add` 를 한 번 부르면 영구 API 키가 나오고, 그 뒤로 토큰이
--   필요하지 않다. 저장하지 않으면 유출될 것도 없다(리프레시 토큰을
--   3일간 들고 있는 것이 더 위험하다).
-- ============================================================

CREATE TABLE IF NOT EXISTS kucoin_oauth_states (
  /*
     state 값 자체를 기본키로 쓴다.

     ★ 난수를 그대로 키로 두면 같은 state 가 두 번 들어올 수 없다(UNIQUE).
       "한 번만 사용" 은 아래 used_at 으로, "중복 생성 불가" 는 이 제약으로 막는다.
  */
  state TEXT PRIMARY KEY,
  /** 이 인증을 시작한 이용자. 계정이 사라지면 진행 중 인증도 의미가 없다. */
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /*
     시작 시점의 세션 지문.

     ★ 같은 이용자라도 **다른 브라우저에서 시작한 인증**을 이어받을 수 없게 한다.
       세션 토큰 원문을 저장하지 않고 해시만 둔다 — 이 표가 유출되어도
       세션을 탈취할 수 없어야 한다.
  */
  session_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  /** 만료. 인증은 몇 분 안에 끝나므로 짧게 둔다(라우트가 10분으로 만든다). */
  expires_at TIMESTAMPTZ NOT NULL,
  /** 사용 시각. NULL 이 아니면 이미 쓴 state 이므로 거부한다(재생 공격 차단). */
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_kucoin_oauth_states_user ON kucoin_oauth_states(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kucoin_oauth_states_expiry ON kucoin_oauth_states(expires_at);

COMMENT ON TABLE kucoin_oauth_states IS
  'KuCoin Fast API(OAuth) 진행 상태. state 검증용이며 토큰은 저장하지 않는다(키 발급 후 토큰은 불필요).';
