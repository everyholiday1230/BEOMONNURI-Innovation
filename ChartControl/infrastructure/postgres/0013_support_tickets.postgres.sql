-- ============================================================
-- 0013 — 고객 지원 티켓 (support tickets)
-- ------------------------------------------------------------
-- 왜 필요한가
-- ----------
-- 운영 등급(SUPPORT/ANALYST)의 승인된 업무 범위가 "시스템 상태 확인 + 티켓 대응"
-- 이다. 그런데 티켓을 담을 곳이 없었다 — 관리자 화면은 목업 배열을 보여주고
-- 있었다. 운영자가 그 화면을 근거로 "처리 중" 이라고 답하면 실제로는 아무
-- 기록도 남지 않는다.
--
-- 설계 결정
-- --------
-- · 티켓과 메시지를 분리한다. 한 티켓에 여러 왕복이 생기고, 본문을 티켓 행에
--   덮어쓰면 이전 대화가 사라진다.
-- · 내부 메모(internal)를 같은 테이블에 두고 플래그로 구분한다. 별 테이블로
--   나누면 시간순으로 섞어 보여줄 때 두 소스를 병합해야 하고, 정렬이 어긋난다.
--   ★ internal=true 는 고객에게 절대 보내지 않는다. 조회 시 반드시 필터링한다.
-- · 사용자가 지워져도 티켓은 남긴다(ON DELETE SET NULL). 대응 기록은 분쟁
--   근거이므로 계정 삭제로 사라지면 안 된다.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY,

  -- 문의한 사용자. 삭제되어도 티켓은 보존한다.
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- 사용자가 지워졌을 때도 누구였는지 알 수 있게 이메일을 복사해 둔다.
  -- 정규화를 깨는 대신, 삭제 후에도 대응 기록을 읽을 수 있게 한다.
  user_email TEXT,

  subject TEXT NOT NULL,

  -- 'open' → 접수됨 · 'pending' → 고객 답변 대기 · 'resolved' → 종료
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'resolved')),

  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),

  /*
     분류. 자유 문자열로 둔다 — 값을 제약하면 새 분류를 추가할 때마다
     마이그레이션이 필요해진다. 화면은 아이콘·색 선택에만 쓴다.
  */
  category TEXT NOT NULL DEFAULT 'general',

  -- 담당자. 지정하지 않으면 NULL(미배정).
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- 관리자 목록은 "열린 것부터, 최근 갱신 순" 으로 훑는다.
CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets (status, updated_at DESC);
-- 사용자는 자기 티켓만 본다.
CREATE INDEX IF NOT EXISTS idx_tickets_user ON support_tickets (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id UUID PRIMARY KEY,
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,

  -- 작성자. NULL 이면 삭제된 계정이 남긴 메시지다.
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  -- 'customer' | 'staff' — 화면이 좌우 정렬과 색을 고르는 데 쓴다.
  -- 작성자 등급이 나중에 바뀌어도 그때 누구 입장이었는지는 고정되어야 한다.
  author_side TEXT NOT NULL CHECK (author_side IN ('customer', 'staff')),

  body TEXT NOT NULL,

  /*
     내부 메모.

     ★ true 이면 고객에게 보이지 않는다. 운영자끼리 남기는 판단 근거다.
       조회 쿼리가 이 조건을 빠뜨리면 내부 메모가 고객에게 노출된다 —
       되돌릴 수 없는 사고이므로 저장소 레벨에서 두 함수로 분리한다.
  */
  internal BOOLEAN NOT NULL DEFAULT FALSE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 대화는 항상 시간순으로 읽는다.
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON support_messages (ticket_id, created_at);
