-- 0029 되돌리기
--
-- ★ 순서가 중요하다. 설정 표를 먼저 지우고 칼럼을 지운다 — 반대로 하면
--   칼럼을 참조하는 것이 남아 있을 수 있다.

DROP TABLE IF EXISTS tier_benefit_settings;

/*
   ★ benefit_key 는 0027 이 만든 칼럼이므로 지우지 않는다. 값만 NULL 로 되돌린다.
     여기서 DROP 하면 0027 의 스키마가 깨진다.
*/
UPDATE tier_definitions SET benefit_key = NULL
 WHERE code IN ('starter', 'active', 'pro', 'partner');

ALTER TABLE tier_definitions DROP COLUMN IF EXISTS rebate_share_bps;
