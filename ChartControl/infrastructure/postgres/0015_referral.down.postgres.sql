-- 0015 되돌리기.
--
-- ★ 지급 기록이 사라진다. 누구에게 얼마를 보냈는지의 유일한 근거이므로
--   되돌리기 전에 반드시 백업할 것. 초대 귀속도 복구할 수 없다
--   (가입 시점에만 기록되므로 소급 재구성이 불가능하다).
DROP INDEX IF EXISTS idx_ref_payouts_user;
DROP TABLE IF EXISTS referral_payouts;
DROP INDEX IF EXISTS idx_ref_signups_code;
DROP INDEX IF EXISTS idx_ref_signups_referrer;
DROP TABLE IF EXISTS referral_signups;
DROP TABLE IF EXISTS referral_codes;
DROP TABLE IF EXISTS referral_settings;
