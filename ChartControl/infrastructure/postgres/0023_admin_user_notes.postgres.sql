-- ============================================================
-- 0023 — 관리자 노트 (회원별 운영 메모)
-- ------------------------------------------------------------
-- 왜 필요한가
--   화면에는 '관리자 노트' 탭이 있었지만 저장할 곳이 없었다. 지원 업무에서
--   "이 회원은 지난번에 이런 문의를 했다" 같은 맥락이 남지 않으면 담당자가
--   바뀔 때마다 처음부터 다시 묻게 된다.
--
-- ★★ 이 표에는 개인정보가 들어간다.
--   운영자가 자유롭게 쓰는 글이므로 무엇이든 적힐 수 있다. 그래서
--   개인정보처리방침이 정한 것과 같은 규칙을 적용한다.
--
--     · 회원이 삭제되면 함께 사라진다(CASCADE) — 법령이 보관을 요구하는
--       자료가 아니다. 분리 보관 대상(약관 동의·주문)과 성질이 다르다.
--     · 누가 썼는지 남긴다. 잘못된 기록의 출처를 확인할 수 있어야 한다.
--     · 조회·작성·수정·삭제를 모두 감사 로그에 남긴다(라우트에서 처리).
--
-- ★ 작성자 계정이 삭제되어도 노트는 남긴다(SET NULL). 내용이 업무 맥락이므로
--   사람이 떠났다고 지우면 남은 담당자가 배경을 잃는다. 이메일을 함께 남겨
--   누가 썼는지는 계속 알 수 있게 한다.
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_user_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /** 대상 회원. 회원이 사라지면 노트도 사라진다. */
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  /** 작성자. 계정이 삭제되면 NULL 이 되고 노트는 남는다. */
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  /** 작성 당시의 작성자 이메일 — 계정이 사라져도 출처를 알 수 있게. */
  author_email TEXT,
  /*
     본문.

     길이를 제한한다. 상한이 없으면 화면이 감당하지 못하는 양이 들어오고,
     실수로 붙여넣은 로그 전체가 저장될 수 있다(그 안에 무엇이 있을지 모른다).
  */
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_notes_user ON admin_user_notes(user_id, created_at DESC);

COMMENT ON TABLE admin_user_notes IS
  '회원별 운영 메모. 개인정보가 담길 수 있어 회원 삭제 시 함께 파기한다(분리 보관 대상 아님).';
