-- 0041 · KuCoin OAuth 에서 **고객이 고른 시장**을 기억한다.
--
-- 왜 필요한가
-- ----------
-- 지금까지 키 발급 요청의 authGroupMap 이 코드에 고정돼 있었다:
--   API_COMMON · API_SPOT · API_FUTURES 를 **항상 함께** 요구한다.
--
-- KuCoin 은 authGroupMap 이 이용자가 승인 화면에서 실제로 허가한 권한과 맞아야
-- 하고, 특히 API_FUTURES 는 그 계정에 **선물 거래가 먼저 활성화**돼 있어야 한다.
-- 안 맞으면 code=40503 으로 키 발급이 실패한다. 프로덕션 로그에 이 실패가 6건
-- 남아 있었고(계정 3개), 고객 화면에는 일반 오류만 떴다.
--
-- 즉 현물만 쓰려는 고객, 또는 선물을 아직 활성화하지 않은 고객은 연결 자체를
-- 할 수 없었다. 필요하지도 않은 권한을 요구해서 막힌 것이다.
--
-- 그래서 시작할 때 고객이 고른 시장을 여기 저장하고, 콜백에서 그 선택대로만
-- 권한을 요구한다. state 는 이미 CSRF 방어로 검증하므로, 선택을 여기 두면
-- 고객이 콜백 주소를 조작해 권한을 넓히는 것도 불가능하다.
--
-- 값: 'spot' | 'futures' | 'both'
ALTER TABLE kucoin_oauth_states
  ADD COLUMN IF NOT EXISTS markets TEXT NOT NULL DEFAULT 'both';

-- ★ 알 수 없는 값이 들어오면 권한 판단이 흔들린다. DB 에서 막는다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kucoin_oauth_states_markets_chk'
  ) THEN
    ALTER TABLE kucoin_oauth_states
      ADD CONSTRAINT kucoin_oauth_states_markets_chk
      CHECK (markets IN ('spot', 'futures', 'both'));
  END IF;
END $$;
