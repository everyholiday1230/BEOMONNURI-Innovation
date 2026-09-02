-- 0041 되돌리기.
ALTER TABLE kucoin_oauth_states DROP CONSTRAINT IF EXISTS kucoin_oauth_states_markets_chk;
ALTER TABLE kucoin_oauth_states DROP COLUMN IF EXISTS markets;
