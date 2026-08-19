-- 0029: 등급 혜택 — 브로커 커미션 환급률
--
-- ────────────────────────────────────────────────────────────────────────
-- 왜 지금 만드나
--
--   0027 에서 등급 제도를 만들 때 `benefit_key` 칼럼만 두고 값을 비워 뒀다.
--   그때는 우리가 KuCoin 에서 받는 분배율을 몰라서, 무엇을 돌려줄 수 있는지
--   정할 근거가 없었기 때문이다.
--
--   2026-08 KuCoin BPP 공식 표를 확인했다.
--
--     우리 R-code 가입 + 우리 API 거래 : Level 0 에서 **50%**  (최대 70%)
--     우리 R-code 가입 + 직접 거래     : 40%
--     비제휴(기존 계정 API 연결)       : **Level 0 에서 0%**  ← L1 도달 시 40%
--
--   그리고 KuCoin 이 명시적으로 허용한다:
--     "Brokers can split your commission with your influencer partner,
--      marketing partner, or your affiliated/non-affiliated end users."
--
--   즉 커미션 일부를 고객에게 돌려주는 것이 제도적으로 가능하다.
--
-- ────────────────────────────────────────────────────────────────────────
-- ★★ 왜 fail-closed 인가 — 이 파일에서 가장 중요한 결정
--
--   우리는 **리베이트가 실제로 입금되는 것을 한 번도 확인하지 못했다.**
--   브로커 연결(brokerAttached: true)은 확인했지만 돈이 쌓이는 것은 못 봤다.
--
--   확인하지 못한 수입을 근거로 환급을 약속하면 두 가지 중 하나가 된다.
--     · 리베이트가 안 들어오는데 약속대로 지급 → 우리 돈으로 메운다
--     · 지급하지 못함 → 고객에게 한 약속을 깬다
--
--   그래서 `payouts_enabled` 를 두고 **기본값 FALSE** 로 잠근다. 실제 리베이트
--   입금을 확인한 뒤 운영자가 켠다. 잠긴 동안 화면은 "준비 중"으로 보여주고
--   금액을 말하지 않는다.
--
--   실주문 5겹 잠금과 같은 원칙이다 — 돈이 걸린 기능은 명시적으로 열어야 한다.
-- ────────────────────────────────────────────────────────────────────────

ALTER TABLE tier_definitions
  /*
     우리가 받는 커미션 중 고객에게 돌려주는 비율. 만분율(basis point).

     ★ 왜 bps 인가
       0.5% 같은 값을 실수로 저장하면 반올림 오차가 누적된다. 정수 만분율로
       두면 1000 = 10.00% 로 정확하다.

     ★ 왜 '우리 커미션의 비율' 인가 — '거래액의 비율' 이 아니다
       거래액 기준으로 적으면, 거래소가 수수료를 내리거나 고객이 KCS 할인을
       쓸 때 **우리가 받는 것보다 많이 돌려주게 된다.** 우리 수입에 연동하면
       무슨 일이 있어도 마이너스가 되지 않는다.

     상한 5000(50%)을 둔다. 절반을 넘겨 돌려줄 이유가 없고, 실수로 큰 값이
     들어가는 것을 DB 가 막는다.
  */
  ADD COLUMN IF NOT EXISTS rebate_share_bps INTEGER NOT NULL DEFAULT 0
    CHECK (rebate_share_bps >= 0 AND rebate_share_bps <= 5000);

COMMENT ON COLUMN tier_definitions.rebate_share_bps IS
  '우리가 받는 브로커 커미션 중 고객 환급 비율 (만분율, 1000 = 10%)';

/*
   운영 스위치 — 환급을 실제로 집행하는가.

   ★ 표를 따로 만들지 않고 한 줄 설정으로 둔다. 등급별로 켜고 끌 이유가 없다.
     "제도 전체가 열렸는가" 하나만 필요하다.
*/
CREATE TABLE IF NOT EXISTS tier_benefit_settings (
  /* 한 줄만 존재한다. */
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

  /*
     ★★ 기본 FALSE. 리베이트 입금을 확인한 뒤 운영자가 켠다.

       켜기 전에는 화면이 환급률을 "예정"으로만 보여주고 금액을 말하지 않는다.
  */
  payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,

  /*
     왜 켰는지 / 언제 켰는지. 나중에 "누가 이걸 열었나" 를 답할 수 있어야 한다.
  */
  enabled_at TIMESTAMPTZ,
  enabled_by TEXT,
  note TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tier_benefit_settings (id, payouts_enabled)
VALUES (TRUE, FALSE)
ON CONFLICT (id) DO NOTHING;

/*
   등급별 환급률.

   ★ 근거: 우리 커미션이 50%(L0, 추천가입+우리API) 이므로, 아래 비율을 모두
     지급해도 우리 몫이 남는다. 최고 등급 30% 를 줘도 우리에게 70% 가 남는다.

   ★ starter 가 0 인 이유
     비제휴 고객은 Level 0 에서 우리 커미션이 **0%** 다. 즉 우리가 받는 것이
     없으므로 돌려줄 것도 없다. 0 이 정직한 값이다.
*/
UPDATE tier_definitions SET rebate_share_bps =    0 WHERE code = 'starter';
UPDATE tier_definitions SET rebate_share_bps = 1000 WHERE code = 'active';   -- 10%
UPDATE tier_definitions SET rebate_share_bps = 2000 WHERE code = 'pro';      -- 20%
UPDATE tier_definitions SET rebate_share_bps = 3000 WHERE code = 'partner';  -- 30%

/*
   화면 문구용 번역 키를 채운다.

   ★ 서버가 사람이 읽는 문장을 담지 않는다(누적 규칙 16). 키만 준다.
*/
UPDATE tier_definitions SET benefit_key = 'tier_benefit_none'    WHERE code = 'starter';
UPDATE tier_definitions SET benefit_key = 'tier_benefit_rebate'  WHERE code IN ('active', 'pro', 'partner');
