-- ============================================================
-- 0027 — 고객 등급 제도
-- ------------------------------------------------------------
-- 무엇을 위한 것인가
--   실제 거래 활동으로 고객 등급을 정하고, 그 등급을 화면에 보여준다.
--   사장님이 정한 기준: **실제로 거래한 날 · 거래 금액 · 거래 횟수**,
--   그리고 **우리 링크로 가입했는지**가 크게 작용한다.
--
-- ★★ 왜 기준을 코드가 아니라 표에 두는가
--
--   등급 기준은 운영하면서 바뀐다. 코드에 박으면 기준을 조정할 때마다 배포가
--   필요하고, 과거에 어떤 기준으로 등급을 줬는지 알 수 없게 된다. 고객이
--   "지난달엔 VIP였는데 왜 내려갔나" 고 물으면 답할 근거가 있어야 한다.
--
-- ★★ 모의 거래는 등급에 넣지 않는다
--
--   모의 주문은 우리 서버가 즉시 체결시킨다. 등급에 반영하면 누구나 버튼을
--   눌러 최고 등급을 만들 수 있고, 그 등급으로 수수료 혜택을 준다면 그대로
--   손실이다. 그래서 계산은 `execution_mode = 'live'` 만 본다.
--
-- ★★ 등급을 만들 수 없으면 등급을 주지 않는다
--
--   거래소 키가 없으면 거래 금액을 **알 수 없다**(조회 자체가 불가능하다).
--   그것은 "거래액 0" 과 다르다. 알 수 없는 상태를 최저 등급으로 처리하면
--   실제로 많이 거래한 고객이 키를 다시 연결하는 동안 등급이 떨어진다.
--   그래서 상태를 따로 남긴다(`measurable`).
-- ============================================================

/* ------------------------------------------------------------------
   1) 등급 정의 — 운영자가 조정하는 기준
   ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS tier_definitions (
  /** 기계가 쓰는 코드. 화면 문구는 번역 키로 따로 둔다. */
  code TEXT PRIMARY KEY,
  /*
     화면에 쓰는 번역 키.

     ★ 이름 문자열을 넣지 않는다. 서버가 사람이 읽는 문장을 담으면 이용자의
       언어를 서버가 알아야 하고, 3개 언어 화면에 영어가 섞인다(누적 규칙 16).
  */
  name_key TEXT NOT NULL,
  /*
     정렬 순서. 큰 값이 높은 등급이다.

     ★ 임계값으로 순서를 추론하지 않는다. 기준이 여러 개(금액·횟수·일수)라
       무엇이 더 높은 등급인지 값만으로는 판단할 수 없다.
  */
  rank INTEGER NOT NULL,

  /* ---- 조건. 모두 만족해야 그 등급이다 ---- */
  /** 30일 실거래 금액(견적통화). NULL = 조건 없음. */
  min_volume_30d NUMERIC,
  /** 30일 실거래 체결 횟수. */
  min_trades_30d INTEGER,
  /*
     30일 중 **실제로 거래한 날** 수.

     ★ 금액·횟수만 보면 하루에 몰아서 넣은 사람과 꾸준히 거래한 사람이 같아진다.
       사장님이 "실제로 거래한 날" 을 기준으로 든 이유가 이것이다.
  */
  min_active_days_30d INTEGER,
  /*
     우리 추천 링크로 거래소에 가입했는가.

     ★★ 이것이 크게 작용한다(사장님 지시). 우리 링크로 가입한 고객의 거래에서만
       브로커 리베이트가 우리에게 귀속되므로, 같은 거래량이어도 회사에 주는
       가치가 다르다.

     ★ TRUE 면 "가입 확인된 고객만" 이 등급을 받는다. NULL/FALSE 면 상관없다.
  */
  requires_referral BOOLEAN NOT NULL DEFAULT FALSE,

  /*
     이 등급의 혜택 설명 키.

     ★ 혜택 수치를 여기 적지 않는다. 우리가 수수료율을 정하지 않기 때문이다 —
       요율은 거래소가 고객 계정 기준으로 정한다. 없는 혜택을 표에 적으면
       화면이 그것을 약속한다.
  */
  benefit_key TEXT,

  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tier_definitions_rank
  ON tier_definitions(rank DESC) WHERE active;

COMMENT ON TABLE tier_definitions IS
  '고객 등급 기준(거래일·금액·횟수·추천가입). 코드가 아니라 표에 둔다 — 운영 중 조정되고, 과거 기준을 추적할 수 있어야 한다.';

/* ------------------------------------------------------------------
   2) 계산된 등급 상태 — 사람마다 한 행
   ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS user_tier_state (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  /*
     현재 등급 코드. NULL = 어떤 등급 조건도 만족하지 않음(기본 등급).

     ★ 정의 표를 참조하지 않는다(외래키 없음). 등급 정의를 지워도 과거 상태가
       사라지면 안 되고, "그때 어떤 코드였는지" 는 그 자체로 기록이다.
  */
  tier_code TEXT,

  /* ---- 계산에 쓴 값. 왜 그 등급인지 설명할 수 있어야 한다 ---- */
  volume_30d NUMERIC,
  trades_30d INTEGER,
  active_days_30d INTEGER,
  referred BOOLEAN NOT NULL DEFAULT FALSE,
  /*
     측정 가능했는가.

     ★★ FALSE 면 위 숫자들은 **모르는 값**이다(0 이 아니다). 거래소 키가 없거나
       조회가 실패하면 거래를 볼 방법이 없다. 화면은 이 값으로 '—' 를 쓴다.
  */
  measurable BOOLEAN NOT NULL DEFAULT FALSE,

  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  /** 계산 시점의 기준 스냅샷 — 나중에 기준이 바뀌어도 판단 근거가 남는다. */
  criteria_snapshot JSONB
);

CREATE INDEX IF NOT EXISTS idx_user_tier_state_tier
  ON user_tier_state(tier_code) WHERE tier_code IS NOT NULL;

COMMENT ON TABLE user_tier_state IS
  '고객별 계산된 등급 + 계산 근거. measurable=false 면 숫자는 모르는 값이다(0 이 아니다).';

/* ------------------------------------------------------------------
   3) 기본 등급 4단계 (시작값)

   ★★ 임계값은 **추측이다.** 실거래 표본이 없으므로 근거가 될 분포가 없다.
     운영자가 조정할 것을 전제로 넣는다 — 그래서 표에 두었다.

   ★ 혜택 문구를 비워 둔다. 우리에게 수수료 재량이 없고 페이백 제도도 아직
     시작하지 않았다. 없는 혜택을 약속하지 않는다.
   ------------------------------------------------------------------ */
INSERT INTO tier_definitions
  (code, name_key, rank, min_volume_30d, min_trades_30d, min_active_days_30d, requires_referral, benefit_key)
VALUES
  ('starter',  'tier_name_starter',  10, NULL,      NULL, NULL, FALSE, NULL),
  ('active',   'tier_name_active',   20, 10000,     10,   3,    FALSE, NULL),
  ('pro',      'tier_name_pro',      30, 100000,    50,   8,    FALSE, NULL),
  /*
     최고 등급만 추천 가입을 요구한다.

     ★ 사장님 지시("우리 링크로 가입한 것도 크게 작용")를 이렇게 반영했다.
       모든 등급에 요구하면 이미 KuCoin 계정이 있던 고객은 영원히 최저 등급이
       된다 — 소급 귀속이 불가능하므로 그 사람 잘못이 아니다.
  */
  ('partner',  'tier_name_partner',  40, 500000,    150,  15,   TRUE,  NULL)
ON CONFLICT (code) DO NOTHING;
