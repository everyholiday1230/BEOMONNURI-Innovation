-- ============================================================
-- 0028 — 공지 팝업 + 긴급도, 그리고 "읽음" 기록
-- ------------------------------------------------------------
-- 무엇을 해결하는가
--   공지를 발행해도 고객이 `/notifications` 에 들어가야 봤다. 점검 예고나 긴급
--   공지를 그렇게 두면 대부분 못 본다.
--
-- ★★ 왜 "전부 팝업" 이 아닌가
--
--   모든 공지를 띄우면 이용자가 **닫는 데 익숙해진다.** 그러면 정작 중요한
--   공지도 읽지 않고 닫는다. 그래서 운영자가 공지마다 정하고, 기본값은 꺼짐이다.
--
-- ★ `pinned` 를 재활용하지 않는다.
--   "목록 상단에 고정" 과 "화면에 띄운다" 는 다른 의도다. 한 칸으로 합치면
--   상단에 오래 두려는 공지가 매번 팝업으로 튀어나온다.
-- ============================================================

/* ------------------------------------------------------------------
   1) 공지에 팝업 여부와 긴급도
   ------------------------------------------------------------------ */
ALTER TABLE notices
  /*
     팝업으로 띄울지. **기본값 FALSE.**

     ★ 기존 공지는 전부 팝업이 아니어야 한다. 기본값을 TRUE 로 두면 이 마이그레이션
       직후 이용자에게 옛 공지가 한꺼번에 튀어나온다.
  */
  ADD COLUMN IF NOT EXISTS popup BOOLEAN NOT NULL DEFAULT FALSE,
  /*
     긴급도. 'info' | 'warning' | 'critical'

     ★ 화면 동작이 이 값으로 갈린다:
         info     — 배너. 자동으로 사라져도 된다.
         warning  — 팝업. 닫으면 끝.
         critical — 팝업. **명시적으로 닫아야** 사라진다(바깥 클릭·Esc 로 닫히지 않는다).

     ★ 점검 예고와 "지금 장애 중" 은 같은 무게로 보이면 안 된다. 같게 보여주면
       이용자가 둘 다 가볍게 여긴다.
  */
  ADD COLUMN IF NOT EXISTS severity TEXT NOT NULL DEFAULT 'info';

/*
   값 제약. 화면이 이 세 값만 처리한다.

   ★ 제약이 없으면 운영자 화면의 오타('critcal')가 조용히 저장되고, 화면은
     그것을 모르는 값으로 취급해 **가장 약한 표시**로 떨어진다 — 긴급 공지가
     배너로 지나간다.
*/
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notices_severity_check'
  ) THEN
    ALTER TABLE notices
      ADD CONSTRAINT notices_severity_check
      CHECK (severity IN ('info', 'warning', 'critical'));
  END IF;
END $$;

/* 팝업 대상만 골라 읽는 조회가 로그인마다 돈다. */
CREATE INDEX IF NOT EXISTS idx_notices_popup
  ON notices(published_at DESC)
  WHERE popup AND status = 'published';

/* ------------------------------------------------------------------
   2) 읽음 기록 — 기기가 바뀌어도 다시 뜨지 않게
   ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS notice_reads (
  /*
     ★★ 왜 서버에 저장하는가

       로컬(localStorage)에만 두면 **다른 기기·다른 브라우저에서 또 뜬다.**
       공지를 이미 읽은 이용자가 기기를 바꿀 때마다 같은 팝업을 본다.

     ★ 공지가 삭제되면 읽음 기록도 의미가 없다 → CASCADE.
     ★ 회원이 사라지면 그 사람의 읽음도 의미가 없다 → CASCADE.
  */
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notice_id UUID NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, notice_id)
);

/* "이 사람이 아직 안 읽은 팝업" 을 찾는 조회의 뜨거운 경로다. */
CREATE INDEX IF NOT EXISTS idx_notice_reads_user
  ON notice_reads(user_id);

COMMENT ON TABLE notice_reads IS
  '공지 읽음 기록. 서버에 두는 이유: 로컬 저장이면 기기를 바꿀 때마다 같은 팝업이 다시 뜬다.';
COMMENT ON COLUMN notices.popup IS
  '팝업으로 띄울지. 기본 FALSE — 전부 띄우면 이용자가 닫는 데 익숙해져 중요한 공지도 읽지 않는다.';
COMMENT ON COLUMN notices.severity IS
  'info(배너) | warning(팝업) | critical(명시적으로 닫아야 사라지는 팝업)';
