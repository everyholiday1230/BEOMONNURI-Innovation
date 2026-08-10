-- ============================================================
-- 0015 — 친구 초대(리퍼럴) 제도
-- ------------------------------------------------------------
-- 왜 이 설계인가 — 지급 경로부터 정한다
-- ----------------------------------
-- 우리는 비수탁이다. 고객 자금을 보관하지 않으므로 **사용자 계정에 돈을 넣을
-- 방법이 없다.** 그래서 "포인트가 자동 적립되고 지갑에 입금된다" 식의 제도는
-- 만들 수 없다 — 만들면 지급 시점에 거짓이 된다.
--
-- 실제로 가능한 구조는 하나다:
--   1. 우리가 거래소로부터 리베이트·추천 수수료를 받는다.
--   2. 그 중 정해진 비율을 초대자에게 **외부 수단으로** 지급한다.
--      (거래소 계정 간 송금, 계좌 이체 등 — 운영자가 직접 실행한다)
--   3. 시스템은 **정확히 추적하고 기록**한다. 자동 지급은 하지 않는다.
--
-- 그래서 테이블이 넷이다:
--   referral_settings  제도 조건 (비율·최소지급액·통화). 없으면 제도 자체가 꺼짐.
--   referral_codes     사용자별 초대 코드
--   referral_signups   코드로 가입한 사람과 단계(가입·이메일인증·키연결·첫거래)
--   referral_payouts   실제 지급 기록 (운영자가 입력) — 잔액 계산의 근거
--
-- ★ 적립액을 우리가 계산하지 않는다.
--   우리 수익은 거래소가 산정한 리베이트다. 그 금액은 거래소 어필리에이트
--   대시보드에만 있고 우리 DB 에는 없다. 우리가 추정해서 "적립 $12.40" 을
--   보여주면 실제 지급액과 어긋나 분쟁이 된다.
--   대신 **단계별 인원**을 보여주고, 확정 금액은 운영자가 입력한 것만 쓴다.
-- ============================================================

/*
   제도 조건.

   행이 없으면 제도가 **꺼진 상태**다. 그때는 코드를 발급하지 않고 화면이
   "아직 시작하지 않았습니다" 를 보여준다 — 코드를 먼저 뿌리고 조건을 나중에
   정하면, 이미 초대한 사람에게 소급 적용 문제가 생긴다.

   단일 행만 둔다(id='default'). 여러 조건을 동시에 운영하면 어떤 초대가 어느
   조건인지 추적해야 하고, 그 복잡도를 감당할 이유가 지금은 없다.
*/
CREATE TABLE IF NOT EXISTS referral_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',

  -- 제도 시작 여부. false 면 코드 발급도, 귀속도 하지 않는다.
  enabled BOOLEAN NOT NULL DEFAULT FALSE,

  /*
     초대자에게 돌려주는 비율 (0~100).

     "우리가 거래소로부터 받은 금액" 기준이다. 거래 수수료 기준이 아니다 —
     우리가 받는 금액을 우리도 사전에 알 수 없으므로 그것을 기준으로 삼아야
     지급 가능한 약속이 된다.
  */
  share_pct NUMERIC(5,2) NOT NULL DEFAULT 0,

  -- 최소 지급액. 이하면 다음 회차로 넘긴다(송금 수수료가 지급액보다 클 수 있다).
  min_payout NUMERIC(18,8) NOT NULL DEFAULT 0,
  payout_currency TEXT NOT NULL DEFAULT 'USDT',

  /*
     지급 방법 설명 (사용자에게 보여줄 문구).

     자동 지급이 아니므로 "어떻게 받는지" 를 반드시 밝혀야 한다.
     비워두면 화면이 제도를 시작하지 않은 것으로 취급한다.
  */
  payout_note TEXT,

  -- 조건 변경 이력을 남긴다. 소급 적용 분쟁의 근거가 된다.
  version INTEGER NOT NULL DEFAULT 0,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 단일 행 강제.
  CONSTRAINT referral_settings_single CHECK (id = 'default')
);

/*
   사용자별 초대 코드.

   user_id 를 UNIQUE 로 두어 한 사람에게 코드가 하나만 생기게 한다.
   여러 개면 어느 코드로 온 초대인지는 알 수 있지만, 사용자가 자기 코드를
   헷갈리고 지급 집계도 코드별/사용자별로 갈라진다.
*/
CREATE TABLE IF NOT EXISTS referral_codes (
  code TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 남용 시 코드를 막되 기록은 남긴다.
  disabled BOOLEAN NOT NULL DEFAULT FALSE
);

/*
   초대로 가입한 사람.

   ★ 가입 시점에만 귀속한다. 소급 적용하지 않는다 — 이미 가입한 사람을
     나중에 누군가의 초대로 바꾸면 그 근거를 검증할 방법이 없다.

   단계를 나누는 이유
   ----------------
   가입만으로는 우리 수익이 없다. 거래소 계정을 연결하고 거래를 해야
   리베이트가 발생한다. 단계를 기록하면 초대자에게 "무엇이 남았는지" 를
   정확히 보여줄 수 있고, 운영자도 실제 수익 발생 여부를 판단할 수 있다.
*/
CREATE TABLE IF NOT EXISTS referral_signups (
  id UUID PRIMARY KEY,

  code TEXT NOT NULL REFERENCES referral_codes(code) ON DELETE CASCADE,
  -- 초대자. 코드에서 유도할 수 있지만, 코드가 지워져도 집계가 남아야 한다.
  referrer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  /*
     초대받아 가입한 사람.

     UNIQUE — 한 사람이 두 코드에 귀속될 수 없다. 중복 귀속을 허용하면
     같은 사용자로 두 명이 보상을 받는다.
  */
  referred_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,

  signed_up_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 단계 도달 시각. NULL = 아직 도달하지 않음 (false 가 아니라 '없음').
  email_verified_at TIMESTAMPTZ,
  keys_connected_at TIMESTAMPTZ,
  first_trade_at TIMESTAMPTZ,

  /*
     제도 조건 스냅샷.

     가입 시점의 share_pct 를 박아둔다. 나중에 조건을 바꿔도 이미 초대된
     건에는 그때 조건이 적용된다 — 소급 인하는 분쟁이 되고, 소급 인상은
     예산을 넘긴다.
  */
  share_pct_at_signup NUMERIC(5,2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ref_signups_referrer ON referral_signups (referrer_user_id, signed_up_at DESC);
CREATE INDEX IF NOT EXISTS idx_ref_signups_code ON referral_signups (code);

/*
   지급 기록.

   운영자가 실제로 보낸 것만 입력한다. 시스템이 자동으로 만들지 않는다 —
   자동 생성하면 "지급됐다고 기록됐는데 실제로는 안 보냈다" 가 가능해진다.

   잔액 = 기록된 지급의 합계. 그것 외에 '적립 예정액' 을 우리가 계산하지 않는다
   (거래소가 산정한 금액을 우리 DB 에 갖고 있지 않다).
*/
CREATE TABLE IF NOT EXISTS referral_payouts (
  id UUID PRIMARY KEY,
  referrer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  amount NUMERIC(18,8) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USDT',

  /*
     지급 수단과 참조.

     '거래소 계정 송금 · TxID …' 처럼 확인 가능한 근거를 적는다.
     근거 없는 지급 기록은 나중에 검증할 수 없다.
  */
  method TEXT NOT NULL,
  reference TEXT,

  -- 어느 기간에 대한 지급인지. 중복 지급 확인에 쓴다.
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,

  note TEXT,
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ref_payouts_user ON referral_payouts (referrer_user_id, paid_at DESC);
