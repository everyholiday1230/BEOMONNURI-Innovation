-- ============================================================
-- 0021 되돌리기
-- ------------------------------------------------------------
-- ★ 되돌려도 **이미 NULL 이 된 값은 복구되지 않는다.**
--   0021 이 고아 행의 user_id 를 NULL 로 정리했고, 그 원래 값은 어디에도
--   남아 있지 않다(가리키던 사용자가 이미 삭제된 상태였다). 되돌리기는
--   제약만 원래대로 만든다.
--
-- ★ trading_policies · reconciliation_runs 의 고아 행은 삭제했으므로
--   되돌려도 돌아오지 않는다. 둘 다 사용자가 없으면 의미가 없는 데이터다.
-- ============================================================

-- 6. 인덱스
DROP INDEX IF EXISTS idx_exchange_connections_user;
DROP INDEX IF EXISTS idx_ai_runs_user;
DROP INDEX IF EXISTS idx_risk_checks_user;
DROP INDEX IF EXISTS idx_order_events_user;
DROP INDEX IF EXISTS idx_executions_user;

-- 5. CHECK
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 4. trading_policies / reconciliation_runs
ALTER TABLE reconciliation_runs DROP CONSTRAINT IF EXISTS reconciliation_runs_user_id_fkey;
ALTER TABLE trading_policies DROP CONSTRAINT IF EXISTS trading_policies_user_id_fkey;

-- 3. audit_logs
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey;

-- 2. admin_actions.target_user_id
DROP INDEX IF EXISTS idx_admin_actions_target;
ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_target_user_id_fkey;

-- 1. admin_actions.actor_user_id — CASCADE + NOT NULL 로 복원
--
-- ★ NOT NULL 을 되돌리려면 NULL 인 행이 없어야 한다. 0021 이후 관리자
--   계정이 삭제된 적이 있으면 그 행이 NULL 이므로 이 문장이 실패한다.
--   그때는 해당 행을 어떻게 할지(보존 vs 삭제) 판단해야 한다 — 감사
--   기록이므로 임의로 지우지 않는다.
ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_actor_user_id_fkey;
ALTER TABLE admin_actions
  ADD CONSTRAINT admin_actions_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE admin_actions ALTER COLUMN actor_user_id SET NOT NULL;
