-- 0018: 법적 문서 (이용약관 · 개인정보처리방침 · 위험 고지)
--
-- 왜 DB 에 두는가
-- -------------
-- 이 문서들은 **법무 검토를 거친 실제 문장**이어야 한다. 코드에 박아 넣으면
-- 문구를 고칠 때마다 배포해야 하고, 무엇보다 **어느 버전에 동의했는지**를
-- 기록할 수 없다.
--
-- 회원가입에서 "약관에 동의합니다" 를 받는데 그 약관을 볼 수 없거나, 나중에
-- 조용히 바뀌면 그 동의는 의미가 없다. 그래서:
--   · 문서마다 버전을 매긴다
--   · 게시 시점을 남긴다
--   · 사용자가 동의한 버전을 따로 기록한다 (user_legal_consents)
--
-- ★ 초안과 게시를 분리한다.
--   법적 문서를 작성 중인 상태로 공개하면 그것이 우리 약관이 된다.
--   published_at 이 NULL 인 동안은 사용자에게 보이지 않는다.
--
-- ★ 게시된 문서는 수정하지 않는다.
--   문구를 바꾸려면 새 버전을 만든다. 이미 동의한 사람이 무엇에 동의했는지가
--   남아야 하기 때문이다. 지난 버전을 덮어쓰면 그 증거가 사라진다.

CREATE TABLE IF NOT EXISTS legal_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 문서 종류. 자유 문자열이면 'terms'/'TERMS'/'약관' 으로 갈려 조회가 깨진다.
  kind         text NOT NULL CHECK (kind IN ('terms', 'privacy', 'risk', 'security')),

  -- 표시 언어. 해외 런칭이므로 언어별로 따로 게시한다.
  locale       text NOT NULL,

  -- 사람이 읽는 버전 표기 (예: '1.0', '2026-08'). 정렬용이 아니라 표시·기록용.
  version      text NOT NULL,

  title        text NOT NULL,

  -- 본문. 마크다운 부분집합으로 렌더한다 (HTML 을 그대로 넣으면 XSS 경로가 된다).
  body         text NOT NULL,

  /*
     효력 발생일.

     게시 시점과 다를 수 있다 — "30일 후부터 적용" 같은 예고가 필요하기 때문이다.
     사용자에게 이 날짜를 보여준다.
  */
  effective_at timestamptz,

  -- NULL 이면 초안. 사용자에게 보이지 않는다.
  published_at timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- 같은 종류·언어에 같은 버전이 두 개 있으면 어느 것에 동의했는지 알 수 없다.
  UNIQUE (kind, locale, version)
);

-- 사용자 화면은 "이 종류·언어의 가장 최근 게시본" 을 찾는다.
CREATE INDEX IF NOT EXISTS idx_legal_live
  ON legal_documents (kind, locale, published_at DESC)
  WHERE published_at IS NOT NULL;

/*
   동의 기록.

   ★ 왜 필요한가: 분쟁이 생기면 "그 사람이 언제, 어느 버전에 동의했는가" 를
     보여야 한다. users 테이블에 accepted_terms boolean 하나만 두면 어느
     문구에 동의했는지 알 수 없고, 문구가 바뀌면 그 기록이 거짓이 된다.

   ★ 동의는 취소·수정하지 않는다. 철회하면 새 행을 넣는 것이 아니라 계정을
     닫는 문제다. 그래서 UPDATE 경로를 만들지 않는다.
*/
CREATE TABLE IF NOT EXISTS user_legal_consents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES legal_documents(id) ON DELETE RESTRICT,

  -- 동의 시점의 종류·버전을 함께 박아둔다. 문서가 지워져도 무엇에 동의했는지 남는다.
  kind        text NOT NULL,
  version     text NOT NULL,

  agreed_at   timestamptz NOT NULL DEFAULT now(),
  -- 분쟁 시 접속 흔적. 목적 외로 쓰지 않는다.
  ip          text,

  -- 같은 문서에 두 번 동의하지 않는다.
  UNIQUE (user_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_consent_user ON user_legal_consents (user_id, agreed_at DESC);
