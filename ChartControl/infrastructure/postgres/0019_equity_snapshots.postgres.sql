-- 0019: 일별 자산 스냅샷 (자산곡선의 근거)
--
-- 왜 필요한가
-- ---------
-- `/portfolio` 의 자산곡선과 기간 선택(1D·7D·30D…)이 동작하려면 **과거 자산**이
-- 있어야 한다. 지금은 아무도 기록하지 않아서 그 버튼들을 비활성으로 두고
-- "자산 이력을 저장하지 않습니다" 라고 표시하고 있다.
--
-- 기존 테이블로는 안 되는 이유
-- -------------------------
--   · `position_snapshots` — 포지션 **개별** 기록이다. 총자산이 아니다.
--   · `account_balances`   — 자산별 **현재** 잔고다. 과거 값이 남지 않는다.
--
-- 설계 원칙
-- -------
-- ★★ **보간하지 않는다.** 사용자가 며칠 접속하지 않으면 그 날은 기록이 없다.
--   그것이 사실이므로 빈 구간으로 둔다. 앞뒤 값을 이어 그리면 없었던 자산
--   변화를 만들어내고, 사용자는 그 곡선으로 성과를 판단한다.
--
-- ★★ **조회 성공 시에만 기록한다.** 거래소 조회가 실패했을 때 0 을 기록하면
--   곡선에 급락이 그려진다. 실제로는 자산이 그대로인데 화면은 폭락을 보여준다.
--
-- ★ 하루 한 행. 같은 날 여러 번 조회하면 마지막 값으로 갱신한다 — 하루 안의
--   변동을 다 남기면 행이 폭증하고, 자산곡선에는 일 단위면 충분하다.
--
-- ★ 통화를 함께 저장한다. USDT 기준으로 합산한 값이라는 사실이 남아야 하고,
--   나중에 기준 통화가 바뀌면 과거 값과 섞이면 안 된다.

CREATE TABLE IF NOT EXISTS equity_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  /*
     기록 일자 (UTC 날짜).

     ★ timestamptz 가 아니라 date 다. 자산곡선은 일 단위이고, 사용자의 시간대에
       따라 같은 순간이 다른 날로 갈리는 문제를 피하려면 기준을 하나로 고정해야
       한다. UTC 를 쓰고 화면이 표시할 때 변환한다.
  */
  snapshot_date date NOT NULL,

  -- 총자산 (평가액). 이것이 자산곡선의 y 값이다.
  equity        numeric NOT NULL,
  -- 주문에 쓸 수 있는 금액.
  available     numeric,
  -- 포지션에 묶인 증거금.
  used          numeric,
  /*
     미실현 손익.

     ★ NULL 을 허용한다. 표시가를 모르면 계산할 수 없다 — 0 으로 넣으면
       "손익이 없었다" 는 거짓이 된다.
  */
  unrealized_pnl numeric,

  -- 합산 기준 통화. 보통 USDT.
  currency      text NOT NULL DEFAULT 'USDT',

  /*
     어디서 온 값인가.

     ★ 'exchange' = 거래소 조회 성공값 / 'mock' = 모의 거래 기록 기반.
       섞이면 곡선의 의미가 달라지므로 구분해서 저장하고, 화면이 표시한다.
       실거래 곡선에 모의 값이 섞이면 사용자가 실제 성과로 읽는다.
  */
  source        text NOT NULL CHECK (source IN ('exchange', 'mock')),

  created_at    timestamptz NOT NULL DEFAULT now(),

  -- 하루 한 행. 같은 날 재조회는 갱신이다.
  UNIQUE (user_id, snapshot_date, source)
);

-- 자산곡선은 "이 사용자의 최근 N일" 을 읽는다.
CREATE INDEX IF NOT EXISTS idx_equity_user_date
  ON equity_snapshots (user_id, snapshot_date DESC);
