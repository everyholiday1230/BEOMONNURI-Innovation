-- ============================================================
-- 0025 — 거래 학습 데이터셋 (AI 학습용 원천 기록)
-- ------------------------------------------------------------
-- 무엇을 위한 표인가
--   "누가 어떤 지표를 켜고, 어떤 상황에서, 어떻게 매매했고, 그 결과가
--   어땠는가" 를 **빠짐없이** 남긴다. 나중에 이 기록으로 모델을 학습시킨다.
--
-- ★★ 왜 기존 표로는 안 되는가
--
--   · `orders` 는 **모의거래만** 기록된다(sim-projection 이 쓴다). 실주문은
--     거래소로 보내고 나서 아무 것도 남기지 않았다. 학습은커녕 사후 확인도
--     불가능한 상태였다.
--   · `orders` 에는 **판단의 근거가 없다.** 심볼·방향·수량뿐이다. 어떤 지표를
--     보고 있었는지, 그때 호가가 어땠는지가 없으면 "왜 그렇게 했는가" 를
--     학습할 수 없다. 결과만 있는 데이터는 상관관계를 만들지 못한다.
--   · `trade_journal` 은 **사람이 손으로 쓰는 일지**다. 비어 있는 것이 정상이고,
--     기계가 채우면 이용자의 기록을 덮어쓴다.
--
-- ★★ 손실도 학습한다
--   이용자가 명시한 요구다. 수익 난 거래만 남기면 "무엇을 하지 말아야 하는가" 를
--   배울 수 없다. 그래서 이 표는 **거부된 주문·취소된 주문·손절·청산까지**
--   전부 남긴다. 성과로 걸러내지 않는다.
--
-- ★★ 판단 근거는 화면만 안다
--   어떤 지표가 켜져 있었는지는 서버가 알 수 없다. 그래서 화면이 주문할 때
--   함께 보낸다(`context`). 화면이 보내지 않으면 그 칸은 **비운다** —
--   기본값을 넣으면 "MA20 을 보고 있었다" 는 없던 사실이 데이터에 생긴다.
--
-- ★ 개인정보
--   이 표는 개인의 거래 행동이다. 학습에 쓸 때는 `subject_key`(가명)만 쓰고
--   user_id 는 내보내지 않는다. 회원 탈퇴 시 처리는 0022(분리 보관) 규칙을
--   따른다 — 이 표에서 user_id 를 끊되 가명 기록은 남긴다(그래야 이미 학습에
--   들어간 표본과 앞으로의 표본이 어긋나지 않는다).
--
-- ★ 왜 JSONB 인가
--   지표 목록·시장 스냅샷은 앞으로 항목이 늘어난다. 열로 고정하면 지표를
--   하나 추가할 때마다 마이그레이션이 필요하고, 과거 행은 그 열이 NULL 이라
--   "그때는 없었다" 와 "그때 껐다" 를 구분할 수 없게 된다.
-- ============================================================

/* ------------------------------------------------------------------
   1) 판단 기록 — 주문을 내려고 한 순간의 모든 것
   ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS trade_decisions (
  id TEXT PRIMARY KEY,

  /*
     주체.

     ★ user_id 는 ON DELETE SET NULL 이다(CASCADE 아님).
       CASCADE 로 두면 회원 한 명이 탈퇴할 때 **이미 학습에 쓴 표본이 사라진다.**
       가명 키(subject_key)는 남으므로 데이터셋의 연속성이 유지된다.
  */
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  /*
     가명 키. 학습·내보내기에서 개인을 가리키는 유일한 식별자다.

     ★ 이메일이나 UUID 를 그대로 쓰지 않는다. 내보낸 파일이 유출되면
       그것만으로 개인을 특정할 수 있게 된다.
  */
  subject_key TEXT NOT NULL,

  /* ---- 무엇을 하려 했는가 ---- */
  /** 'futures' | 'spot' — 시장을 섞으면 승수·수수료가 달라 학습이 오염된다. */
  market TEXT NOT NULL,
  /** 'live' | 'paper' — 실주문과 모의를 반드시 구분한다(체결 성질이 다르다). */
  execution_mode TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  order_type TEXT NOT NULL,
  price NUMERIC,
  quantity NUMERIC NOT NULL,
  leverage NUMERIC,
  margin_mode TEXT,
  reduce_only BOOLEAN NOT NULL DEFAULT FALSE,
  /** 이용자가 함께 지정한 보호 주문 (없으면 NULL — 0 으로 채우지 않는다). */
  stop_price NUMERIC,
  take_profit_price NUMERIC,

  /* ---- 어떤 근거로 했는가 ---- */
  /*
     화면 문맥. 화면이 보낸 것을 그대로 담는다.

       {
         "timeframe": "15m",
         "indicators": [{"id":"ma","params":{"length":20}}, {"id":"rsi","params":{"length":14}}],
         "drawings": 3,
         "preset": "standard-trader",
         "chartType": "candle",
         "source": "order-panel" | "chart-hotkey" | "copilot"
       }

     ★ 비어 있을 수 있다. 화면이 보내지 않았다는 뜻이며, 그것이 사실이다.
  */
  ui_context JSONB,
  /*
     그 순간의 시장. **서버가** 직접 채운다(화면 값을 믿지 않는다).

       {"last":..., "bid":..., "ask":..., "spreadBps":...,
        "mark":..., "index":..., "fundingRate":..., "chg24hPct":...,
        "capturedAt": 1786... , "stale": false}

     ★ 화면이 보낸 가격을 그대로 저장하면, 조작된 요청이 학습 데이터를
       오염시킬 수 있다. 시세는 우리 쪽 값만 쓴다.
  */
  market_snapshot JSONB,
  /*
     계정 상태(그 순간). 잔고·미결제·증거금.

     ★ 값을 얻지 못하면 NULL 이다. 0 으로 채우면 "잔고가 없었다" 가 된다.
  */
  account_snapshot JSONB,
  /** 위험 게이트 판정 결과 — 왜 통과/차단됐는지. */
  risk_snapshot JSONB,

  /* ---- 어떻게 됐는가 (전송 단계) ---- */
  /** 'ACCEPTED' | 'REJECTED' | 'SUBMIT_UNKNOWN' | 'BLOCKED' */
  submit_status TEXT NOT NULL,
  /** 거부·차단 사유 코드. 사람이 읽는 문장이 아니다. */
  submit_reason TEXT,
  client_order_id TEXT,
  exchange_order_id TEXT,

  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id TEXT
);

/* 이용자별 시간순 — 한 사람의 매매 흐름을 순서대로 뽑을 때 쓴다. */
CREATE INDEX IF NOT EXISTS idx_trade_decisions_subject
  ON trade_decisions(subject_key, decided_at DESC);
/* 내보내기용 — 기간으로 자른다. */
CREATE INDEX IF NOT EXISTS idx_trade_decisions_time
  ON trade_decisions(decided_at);
/* 체결 연결용 — clientOrderId 로 결과를 붙인다. */
CREATE INDEX IF NOT EXISTS idx_trade_decisions_coid
  ON trade_decisions(client_order_id)
  WHERE client_order_id IS NOT NULL;

COMMENT ON TABLE trade_decisions IS
  '주문을 내려고 한 순간의 판단 기록(지표·시장·계정·위험). AI 학습 원천. 거부·차단도 남긴다.';

/* ------------------------------------------------------------------
   2) 결과 기록 — 그래서 어떻게 됐는가
   ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS trade_outcomes (
  id TEXT PRIMARY KEY,
  /*
     어느 판단의 결과인가.

     ★ NULL 을 허용한다. 우리 화면을 거치지 않고 **거래소에서 직접** 낸 주문의
       체결도 관측될 수 있다. 그것을 버리면 같은 계정의 손익이 앞뒤가 맞지 않게
       되므로, 판단 없이 결과만 남긴다(학습에서는 근거 없는 표본으로 취급).
  */
  decision_id TEXT REFERENCES trade_decisions(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  subject_key TEXT NOT NULL,

  market TEXT NOT NULL,
  execution_mode TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,

  /** 'filled' | 'partial' | 'canceled' | 'expired' | 'closed' | 'liquidated' */
  outcome_kind TEXT NOT NULL,

  entry_price NUMERIC,
  exit_price NUMERIC,
  filled_quantity NUMERIC,
  fees NUMERIC,
  /** 실현 손익. 미청산이면 NULL — 0 이 아니다. */
  realized_pnl NUMERIC,
  roi_pct NUMERIC,
  /** 보유 시간(초). 청산 전이면 NULL. */
  holding_seconds BIGINT,

  /*
     왜 끝났는가. 'take_profit' | 'stop_loss' | 'manual' | 'liquidation' | 'unknown'

     ★ 모르면 'unknown' 이다. 추측해서 'stop_loss' 로 적으면, 모델이
       "손절이 잘 작동한다" 는 잘못된 사실을 배운다.
  */
  close_reason TEXT NOT NULL DEFAULT 'unknown',

  /** 청산 시점의 시장 상태(추적 가능한 경우). */
  exit_snapshot JSONB,

  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  /** 관측 출처: 'exchange_order' | 'position_diff' | 'sim' */
  observed_from TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trade_outcomes_subject
  ON trade_outcomes(subject_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_outcomes_decision
  ON trade_outcomes(decision_id)
  WHERE decision_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_outcomes_time
  ON trade_outcomes(observed_at);

COMMENT ON TABLE trade_outcomes IS
  '거래 결과(체결·취소·청산·손익). 손실도 남긴다 — 무엇을 하지 말아야 하는지가 학습 대상이다.';

/* ------------------------------------------------------------------
   3) 가명 매핑 — 개인을 가리지 않고는 학습에 쓸 수 없다
   ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS learning_subjects (
  /*
     가명 키. 무작위로 만든다.

     ★ user_id 의 해시로 만들지 않는다. 해시는 후보군이 좁으면(우리 이용자
       목록) 되돌릴 수 있다 — 학습 데이터에서 개인을 다시 특정할 수 있게 된다.
  */
  subject_key TEXT PRIMARY KEY,
  /*
     ★ 회원이 탈퇴하면 이 연결만 끊는다(SET NULL). 가명 기록은 남는다.
       연결이 끊긴 뒤에는 어떤 표본이 누구인지 **우리도 알 수 없다.**
  */
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE learning_subjects IS
  '학습 데이터용 가명 매핑. 탈퇴 시 연결만 끊고 가명 기록은 유지한다(데이터셋 연속성).';

/* ------------------------------------------------------------------
   4) 내보내기 이력 — 무엇을 언제 학습에 넘겼는가
   ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS learning_exports (
  id TEXT PRIMARY KEY,
  /** 내보낸 사람(운영자). */
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  /** 대상 기간 */
  from_at TIMESTAMPTZ NOT NULL,
  to_at TIMESTAMPTZ NOT NULL,
  /** 표본 수 */
  sample_count INTEGER NOT NULL,
  /*
     형식. 'jsonl' 등.

     ★ 어떤 형식으로 내보냈는지 남겨야, 나중에 학습 결과가 이상할 때
       "그때 어떤 모양으로 넣었는가" 를 확인할 수 있다.
  */
  format TEXT NOT NULL,
  /** 내용 지문 — 같은 파일을 두 번 학습시키는 것을 알아챈다. */
  content_sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_learning_exports_time
  ON learning_exports(created_at DESC);

COMMENT ON TABLE learning_exports IS
  '학습용 내보내기 이력. 무엇을 언제 누가 넘겼는지 추적한다.';
