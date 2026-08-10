-- ============================================================
-- 0016 — 포인트 제도
-- ------------------------------------------------------------
-- 왜 이 설계인가
-- ------------
-- 포인트는 **부채**다. 사용자가 1,000 포인트를 갖고 있으면 우리가 그만큼의
-- 가치를 제공할 의무가 있다. 그래서 잔액을 직접 저장하지 않는다.
--
--   ✗ users.points 컬럼을 두고 더하고 뺀다
--       → 어디서 왜 늘었는지 알 수 없다. 버그로 잔액이 틀어지면 되돌릴 근거가
--         없다. 이중 지급·이중 차감을 사후에 찾을 수 없다.
--
--   ✓ 원장(ledger)에 증감만 쌓고 잔액은 합계로 구한다
--       → 모든 변동에 이유와 근거가 남는다. 잘못된 항목은 지우지 않고
--         반대 항목으로 상쇄한다(회계와 같은 방식).
--
-- ★ 포인트는 현금이 아니다.
--   출금 경로를 만들지 않는다. 현금으로 바꿔주면 그것은 자금 이동업이고,
--   우리는 그 자격이 없다. 사이트 안에서만 쓰인다.
--
-- ★ 포인트 구매(현금 → 포인트)는 별도 스위치다.
--   결제 대행사가 연결되지 않으면 켤 수 없다. 결제 없이 구매를 열면
--   "결제했는데 포인트가 안 들어왔다" 가 발생한다.
-- ============================================================

/*
   제도 조건.

   단일 행(id='default'). 여러 조건을 동시에 운영하면 어떤 적립이 어느 조건인지
   추적해야 하고, 그 복잡도를 감당할 이유가 지금은 없다.
*/
CREATE TABLE IF NOT EXISTS point_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',

  -- 제도 시작 여부. false 면 적립도 사용도 하지 않는다.
  enabled BOOLEAN NOT NULL DEFAULT FALSE,

  -- 화면에 표시할 이름. '포인트' / 'Credits' 등 배포마다 다를 수 있다.
  unit_name TEXT NOT NULL DEFAULT 'Points',

  /*
     현금 구매 허용 여부.

     ★ 결제 대행사가 연결되지 않으면 켜면 안 된다. 결제 흐름 없이 구매를
       열면 사용자가 돈을 보내고 포인트를 못 받는다. 서버가 이 값과 별개로
       결제 제공자 설정을 확인한다.
  */
  purchase_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  /*
     만료 정책 (일). 0 = 만료 없음.

     명시적으로 둔다 — 정책이 없으면 부채가 무한히 쌓이고, 나중에 만료를
     도입하면 이미 적립한 사용자에게 소급 적용하는 문제가 된다.
  */
  expiry_days INTEGER NOT NULL DEFAULT 0,

  /*
     리퍼럴 보상을 포인트로 지급할지.

     켜면 초대 보상을 원장에 자동 적립할 수 있다 — 우리가 실제로 할 수 있는
     지급이다(사이트 내부 재화). 끄면 외부 송금으로만 지급한다(수동).
  */
  referral_as_points BOOLEAN NOT NULL DEFAULT FALSE,
  -- 초대 1건당 포인트. referral_as_points 가 true 일 때만 쓴다.
  referral_points INTEGER NOT NULL DEFAULT 0,

  version INTEGER NOT NULL DEFAULT 0,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT point_settings_single CHECK (id = 'default')
);

/*
   포인트 원장 — 추가만 한다(append-only).

   ★ 행을 수정하거나 삭제하지 않는다.
     잘못 적립했으면 반대 부호의 항목을 새로 넣어 상쇄한다. 그래야 "언제
     무엇이 잘못됐고 언제 고쳤는지" 가 남는다.

   balance_after 를 함께 저장하는 이유
   --------------------------------
   잔액은 SUM(delta) 로 구할 수 있다. 그런데 그 값을 항목에도 박아두면
   나중에 원장을 훑어 **불변식 위반을 찾을 수 있다** — 어떤 항목의
   balance_after 가 앞 항목 + delta 와 다르면 그 지점에서 문제가 생긴 것이다.
   (동시 요청을 행 잠금으로 직렬화하므로 이 값은 항상 맞아야 한다.)
*/
CREATE TABLE IF NOT EXISTS point_ledger (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  /*
     증감. 양수 = 적립, 음수 = 사용.

     0 을 금지한다 — 아무것도 바꾸지 않는 항목은 원장을 읽기 어렵게만 만든다.
  */
  delta INTEGER NOT NULL CHECK (delta <> 0),

  /*
     이 항목 직후의 잔액. 음수가 될 수 없다.

     DB 제약으로 막는다 — 애플리케이션 버그로 초과 사용이 들어와도
     여기서 막힌다. 잔액이 음수가 되면 사용자에게 빚을 지우는 셈이다.
  */
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),

  /*
     적립·사용 이유. 자유 문자열이 아니라 열거값이다.

     자유 문자열이면 같은 이유가 'referral' / 'REFERRAL' / '초대' 로 갈려
     집계가 불가능해진다. 새 이유가 필요하면 마이그레이션으로 추가한다 —
     그 정도로 드물게 늘어나야 하는 값이다.
  */
  reason TEXT NOT NULL CHECK (reason IN (
    'referral_signup',   -- 초대 보상
    'event_reward',      -- 이벤트·대회 보상
    'competition_prize', -- 모의대회 상금
    'admin_grant',       -- 운영자 수동 지급
    'admin_revoke',      -- 운영자 회수 (오적립 상쇄)
    'purchase',          -- 현금 구매 (결제 대행사 연결 시)
    'redeem',            -- 상품 사용
    'refund',            -- 사용 취소 환급
    'expiry'             -- 만료 소멸
  )),

  /*
     근거. 무엇에 대한 증감인지 가리킨다.

     ref_type/ref_id 로 둔다 — 외래키를 쓰면 참조 대상 테이블마다 컬럼이
     필요하고, 대상이 지워지면 원장 항목도 지워진다(원장은 남아야 한다).
  */
  ref_type TEXT,
  ref_id TEXT,

  -- 사람이 읽을 설명. 감사 화면에 그대로 보여준다.
  memo TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 운영자가 만든 항목이면 누구인지. 자동 적립이면 NULL.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

-- 잔액 계산과 내역 조회가 가장 흔한 질의다.
CREATE INDEX IF NOT EXISTS idx_points_user ON point_ledger (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_points_reason ON point_ledger (reason, created_at DESC);

/*
   중복 적립 방지.

   같은 근거로 두 번 적립하는 것을 DB 가 막는다. 예: 같은 초대 건에 대해
   보상을 두 번 주는 사고. ref 가 없는 항목(운영자 수동 지급 등)은 제외한다.
*/
CREATE UNIQUE INDEX IF NOT EXISTS uq_points_ref
  ON point_ledger (user_id, reason, ref_type, ref_id)
  WHERE ref_type IS NOT NULL AND ref_id IS NOT NULL;

/*
   상품 목록 — 포인트로 살 수 있는 것.

   ★ 이미 무료인 기능을 상품으로 만들지 않는다.
     지표 27종은 지금 전부 무료다. 그것을 유료로 바꾸면 기능 축소다.
     포인트는 **우리에게 실제 비용이 드는 것** 또는 **한정된 것**에 쓴다:
       · AI 분석 실행 (토큰 비용이 실제로 발생한다)
       · 모의대회 참가 (상금 재원이 필요하다)
*/
CREATE TABLE IF NOT EXISTS point_catalog (
  id TEXT PRIMARY KEY,

  -- 표시 이름은 사전 키로 둔다. 상품명을 DB 에 넣으면 번역할 수 없다.
  name_key TEXT NOT NULL,
  desc_key TEXT,

  /*
     종류. 사용 시 무엇이 일어나는지를 코드가 판단하는 근거다.
       ai_run      — AI 분석 실행권
       competition — 모의대회 참가권
       feature     — 기간제 기능 이용권
  */
  kind TEXT NOT NULL CHECK (kind IN ('ai_run', 'competition', 'feature')),

  cost INTEGER NOT NULL CHECK (cost > 0),

  /*
     사용권 수량 또는 기간.

     ai_run 이면 실행 횟수, feature 면 이용 일수. competition 은 1 회다.
     의미가 종류마다 다르므로 이름을 일반화한다.
  */
  grants INTEGER NOT NULL DEFAULT 1 CHECK (grants > 0),

  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

/*
   사용 기록.

   원장 항목과 1:1 로 연결한다 — 사용했는데 차감되지 않았거나 그 반대인
   상태를 찾을 수 있어야 한다.
*/
CREATE TABLE IF NOT EXISTS point_redemptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id TEXT NOT NULL REFERENCES point_catalog(id),

  -- 차감된 원장 항목. 이것이 없으면 사용 기록만 있고 차감이 없는 셈이다.
  ledger_id UUID NOT NULL REFERENCES point_ledger(id),

  cost INTEGER NOT NULL CHECK (cost > 0),
  /*
     남은 사용권.

     ai_run 처럼 여러 번 쓰는 상품은 여기서 줄어든다. 0 이 되면 소진이다.
     기간제(feature)는 expires_at 을 함께 본다.
  */
  remaining INTEGER NOT NULL DEFAULT 0 CHECK (remaining >= 0),
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redemptions_user ON point_redemptions (user_id, created_at DESC);
-- 사용 가능한 이용권을 찾는 질의.
CREATE INDEX IF NOT EXISTS idx_redemptions_active
  ON point_redemptions (user_id, catalog_id)
  WHERE remaining > 0;
