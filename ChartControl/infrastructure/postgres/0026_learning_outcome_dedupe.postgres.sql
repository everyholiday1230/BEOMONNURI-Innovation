-- ============================================================
-- 0026 — 학습 결과 중복 방지 + 조회 도우미
-- ------------------------------------------------------------
-- 왜 필요한가
--   결과는 **조회할 때마다** 수집한다(배경 작업 없이, 이미 인증된 읽기 경로에
--   얹는다). 그래서 같은 체결을 여러 번 보게 된다 — 이용자가 주문 내역을 열 때마다
--   거래소가 같은 주문을 돌려준다.
--
-- ★★ 막지 않으면 어떻게 되는가
--   같은 거래가 표본으로 10번, 100번 들어간다. 그 표본은 학습에서 **그만큼
--   가중치를 갖는다** — 자주 화면을 여는 이용자의 거래가 모델을 지배한다.
--   오류도 없고 개수만 늘어나므로 알아채기 어렵다.
--
-- ★ 판단 × 결과종류로 유일하게 만든다.
--   한 판단에 'filled' 와 'closed' 는 함께 있을 수 있다(진입 체결 → 나중에 청산).
--   그러나 'filled' 가 두 개일 수는 없다.
--
-- ★ 판단이 없는 결과(decision_id IS NULL)는 제약에서 빠진다.
--   거래소에서 직접 낸 주문의 손익이며, 여러 건이 정상이다. 부분 인덱스를 쓴다.
-- ============================================================

/*
   ★ 기존 중복을 먼저 정리한다. 제약을 걸기 전에 남아 있으면 마이그레이션이
     실패하고, 그 시점에는 무엇을 지워야 할지 판단할 근거가 없다.
   ★ 가장 오래된 것을 남긴다 — 처음 관측한 값이 그 시점의 사실이다.
*/
DELETE FROM trade_outcomes o
 WHERE o.decision_id IS NOT NULL
   AND o.id <> (
     SELECT o2.id FROM trade_outcomes o2
      WHERE o2.decision_id = o.decision_id
        AND o2.outcome_kind = o.outcome_kind
      ORDER BY o2.observed_at ASC, o2.id ASC
      LIMIT 1
   );

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_outcomes_decision_kind
  ON trade_outcomes (decision_id, outcome_kind)
  WHERE decision_id IS NOT NULL;

/*
   ★ 판단을 clientOrderId 로 찾는 조회가 결과 수집의 뜨거운 경로다.
     0025 에 부분 인덱스가 이미 있으므로 추가하지 않는다.

   ★ 결과 수집은 "이 이용자의 최근 판단"을 통째로 읽는다 — subject 인덱스가
     아니라 user_id 기준이 필요하다(가명은 내보내기용이고, 수집은 user 단위다).
*/
CREATE INDEX IF NOT EXISTS idx_trade_decisions_user_time
  ON trade_decisions (user_id, decided_at DESC)
  WHERE user_id IS NOT NULL;

COMMENT ON INDEX uq_trade_outcomes_decision_kind IS
  '판단×결과종류 유일. 조회마다 수집하는 구조에서 같은 거래가 여러 표본이 되는 것을 막는다.';
