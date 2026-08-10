-- ============================================================
-- 0012 — 공지 (notices)
-- ------------------------------------------------------------
-- 왜 notifications 를 재사용하지 않는가
-- ----------------------------------
-- notifications 는 user_id 를 필수로 갖는 **개인 알림**이다. 공지는 전체 공개이고
-- 발행 전 초안 상태가 있으며, 게시 기간과 고정(pin) 개념이 있다.
-- 하나의 테이블에 두 성격을 섞으면 "user_id 가 NULL 이면 공지" 같은 규칙이 생기고,
-- 그 규칙을 잊은 조회가 개인 알림에 공지를 섞어 보여준다.
--
-- 감사 추적
-- --------
-- 누가 언제 무엇을 게시했는지 남긴다. 공지는 전체 사용자에게 보이므로
-- 잘못된 내용이 나갔을 때 책임 소재를 확인할 수 있어야 한다.
-- ============================================================

CREATE TABLE IF NOT EXISTS notices (
  id UUID PRIMARY KEY,

  -- 표시 내용
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  -- 'maintenance' | 'promotion' | 'policy' | 'feature' | 'incident'
  -- 자유 문자열로 둔다. 화면이 아이콘·색을 고르는 데만 쓰고, 값을 제약하면
  -- 새 종류를 추가할 때 마이그레이션이 필요해진다.
  category TEXT NOT NULL DEFAULT 'notice',

  -- 게시 상태. 'draft' 는 사용자에게 보이지 않는다.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),

  -- 상단 고정. 점검 공지처럼 반드시 봐야 하는 것에 쓴다.
  pinned BOOLEAN NOT NULL DEFAULT FALSE,

  /*
     게시 기간.

     publish_at 이 미래면 아직 보이지 않는다(예약 게시).
     expires_at 이 지나면 보이지 않는다 — 끝난 점검 공지가 계속 떠 있으면
     사용자가 현재 상태를 오해한다.
     둘 다 NULL 이면 즉시·무기한이다.
  */
  publish_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- 언어. 다국어 공지를 별 행으로 넣는다. 한 행에 여러 언어를 담으면
  -- 언어를 추가할 때마다 스키마를 바꿔야 한다.
  locale TEXT NOT NULL DEFAULT 'en',

  -- 감사 추적. 사용자가 삭제되어도 기록은 남긴다(ON DELETE SET NULL).
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

-- 사용자 화면은 "지금 보여야 하는 공지" 를 자주 조회한다.
CREATE INDEX IF NOT EXISTS idx_notices_visible
  ON notices (status, pinned DESC, publish_at DESC)
  WHERE status = 'published';

-- 관리자 목록은 상태별로 훑는다.
CREATE INDEX IF NOT EXISTS idx_notices_status ON notices (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notices_locale ON notices (locale);
