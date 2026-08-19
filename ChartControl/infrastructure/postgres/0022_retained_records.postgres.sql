-- ============================================================
-- 0022 — 회원 삭제 시 법정 보관분 분리 보관
-- ------------------------------------------------------------
-- 왜 필요한가
--   우리가 게시한 개인정보처리방침(v1.0, 시행 2026-08-10)은 두 가지를 동시에
--   약속했다.
--
--     6절: "회원 탈퇴 시 계정 정보와 거래소 연동 정보를 지체 없이 파기합니다."
--     6절: "법령이 보관을 요구하는 정보는 그 기간 동안 분리 보관한 뒤 파기합니다."
--     1절 표: 주문·체결 기록 5년 · 약관 동의 기록 5년 · 문의 내역 3년
--
--   현재 스키마는 `users` 를 지우면 이 기록들이 CASCADE 로 함께 사라진다. 즉
--   탈퇴를 처리하면 방침이 보관하겠다고 한 것까지 지워지고, 보관하려고 탈퇴를
--   막으면 "지체 없이 파기" 를 못 지킨다. 어느 쪽이든 방침 위반이다.
--
-- 무엇을 하는가
--   활성 DB 와 분리된 테이블(`retained_*`)로 옮긴 뒤 원본을 지운다.
--   이 테이블들은 users 를 참조하지 않는다 — 참조하면 다시 CASCADE 로 사라진다.
--
-- ★★ 설계에서 중요한 판단
--
--   1) 이메일을 남긴다(해시가 아니라 원문).
--      동의 기록의 목적은 "이 사람이 이 버전에 동의했다" 를 증명하는 것이다.
--      분쟁이 생기면 상대를 특정해야 하므로 해시만 남기면 증명할 수 없다.
--      대신 그것 말고는 아무것도 남기지 않는다(비밀번호 해시·IP·설정·키 등 제외).
--
--   2) 주문 기록에서 거래소 자격증명 참조(credential_id)를 뺀다.
--      보관 목적은 거래 이력과 분쟁 대응이다. 어느 키로 냈는지는 그 목적에
--      필요하지 않고, 남기면 삭제된 키를 가리키는 값이 계속 남는다.
--
--   3) 파기 예정일(purge_after)을 행마다 저장한다.
--      "5년" 을 코드에 두면 나중에 그 코드를 고칠 때 이미 보관 중인 행의
--      기준이 함께 바뀐다. 옮기는 시점의 약속을 행에 적어 둔다.
--
--   4) 이 테이블은 일반 관리자 화면에서 조회하지 않는다.
--      분리 보관의 취지가 "그 목적에만 쓴다" 이므로, 회원 목록·상세에서
--      읽히면 분리한 의미가 없다. 접근은 별도 절차(법적 요청)로만 한다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. 약관 동의 기록 (5년)
--
-- 무엇을 증명하는가: 어느 이메일이 어느 문서의 어느 버전에 언제 동의했는지.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retained_legal_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /*
     삭제된 계정의 식별자.

     ★ users 를 참조하지 않는다(FK 없음). 참조하면 계정 삭제와 함께 사라져
       보관의 의미가 없어진다. 값은 남지만 그 계정은 더 이상 존재하지 않는다.
  */
  former_user_id UUID NOT NULL,
  former_email TEXT NOT NULL,
  kind TEXT NOT NULL,
  version TEXT NOT NULL,
  agreed_at TIMESTAMPTZ NOT NULL,
  /*
     ★ document_id 는 남기지 않는다.

       legal_documents 를 참조하면 그 문서를 지울 수 없게 되고(RESTRICT),
       참조 없이 UUID 만 남기면 무엇을 가리키는지 알 수 없는 값이 된다.
       증명에 필요한 것은 kind + version + 시각이므로 그것만 둔다.
  */
  /** 옮긴 시각과 이유(감사 대응). */
  retained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_reason TEXT NOT NULL,
  /** 이 시각이 지나면 파기한다. 옮길 때의 약속을 행에 적어 둔다. */
  purge_after TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_retained_consents_purge ON retained_legal_consents(purge_after);
CREATE INDEX IF NOT EXISTS idx_retained_consents_email ON retained_legal_consents(former_email);

COMMENT ON TABLE retained_legal_consents IS
  '분리 보관: 탈퇴 회원의 약관 동의 기록(방침 1절 5년). 일반 관리자 화면에서 조회하지 않는다.';

-- ------------------------------------------------------------
-- 2. 주문 기록 (5년)
--
-- 무엇을 증명하는가: 어느 계정이 언제 무엇을 얼마에 주문했는지.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retained_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  former_user_id UUID NOT NULL,
  former_email TEXT NOT NULL,
  internal_order_id TEXT NOT NULL,
  exchange_order_id TEXT,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  type TEXT NOT NULL,
  price NUMERIC,
  quantity NUMERIC,
  filled_quantity NUMERIC,
  status TEXT NOT NULL,
  /*
     ★ 모의/실주문 구분을 남긴다.

       분쟁 대응에서 이것이 가장 먼저 필요하다 — 모의 거래 기록을 실거래로
       읽으면 사실 판단이 처음부터 틀어진다.
  */
  mode TEXT NOT NULL,
  ordered_at TIMESTAMPTZ NOT NULL,
  retained_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_reason TEXT NOT NULL,
  purge_after TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_retained_orders_purge ON retained_orders(purge_after);
CREATE INDEX IF NOT EXISTS idx_retained_orders_email ON retained_orders(former_email);

COMMENT ON TABLE retained_orders IS
  '분리 보관: 탈퇴 회원의 주문 기록(방침 1절 5년). credential_id 는 옮기지 않는다.';

-- ------------------------------------------------------------
-- 3. 삭제 처리 기록 (영구)
--
-- ★ 이것 자체는 파기 대상이 아니다.
--   "누가 언제 어떤 계정을 삭제했고 무엇을 얼마나 보관했는지" 는 삭제
--   처리가 적법했음을 보이는 근거다. 이 기록이 없으면 나중에 "왜 지웠나"
--   에 답할 수 없다. 개인정보는 담지 않는다(이메일 제외).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_deletion_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  former_user_id UUID NOT NULL,
  former_email TEXT NOT NULL,
  /** 요청자: 'self'(이용자 본인) | 'admin'(관리자 처리) */
  requested_by TEXT NOT NULL,
  /*
     처리한 관리자.

     ★ FK 를 두지 않는다. 그 관리자 계정이 나중에 삭제되어도 이 기록은
       남아야 한다(0021 에서 감사 로그에 대해 내린 것과 같은 판단).
       사람을 특정할 수 있게 이메일도 함께 남긴다.
  */
  actor_user_id UUID,
  actor_email TEXT,
  reason TEXT NOT NULL,
  /** 무엇을 얼마나 옮겼는지 — 나중에 대조할 수 있게 개수를 남긴다. */
  retained_consents INTEGER NOT NULL DEFAULT 0,
  retained_orders INTEGER NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deletion_records_email ON user_deletion_records(former_email);
CREATE INDEX IF NOT EXISTS idx_deletion_records_at ON user_deletion_records(deleted_at DESC);

COMMENT ON TABLE user_deletion_records IS
  '회원 삭제 처리 기록(영구 보존). 삭제가 적법하게 처리되었음을 보이는 근거.';
