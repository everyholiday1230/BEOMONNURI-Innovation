-- ============================================================
-- 0021 — 데이터 정합성 보강 (감사 기록 보존 · 등급/상태 제약)
-- ------------------------------------------------------------
-- 조사에서 확인된 4건 중 스키마로 고칠 수 있는 것을 처리한다.
-- 런칭을 막는 결함은 아니지만, 각각 나중에 실제 손해로 나타난다.
-- ============================================================

-- ------------------------------------------------------------
-- 1. admin_actions.actor_user_id — CASCADE 제거
--
-- ★★ 관리자 계정을 삭제하면 **그 사람이 남긴 감사 기록 전체가 함께
--    사라졌다.** admin_actions 는 "누가 무엇을 했는지" 의 근거이고, API 는
--    이 목록을 appendOnly 로 선언해 내려준다(수정·삭제 없음). 그런데 스키마는
--    사용자 삭제 한 번으로 기록을 지웠다 — 선언과 정반대다.
--
--    가장 문제가 되는 상황이 정확히 그 상황이다: 어떤 관리자가 문제를 일으켜
--    계정을 지우면, 그가 무엇을 했는지 확인할 방법이 같이 없어진다.
--
-- ★ SET NULL 로 바꾼다. 행위자 계정이 사라져도 행은 남는다.
--   `actor_role` 과 `reason`, `at`, `ip` 가 같은 행에 이미 저장되므로
--   "어느 등급의 누군가가 언제 무엇을 했다" 는 사실은 보존된다.
--
-- ★ NOT NULL 을 함께 풀어야 한다. 풀지 않으면 SET NULL 이 실행될 때
--   제약 위반으로 삭제가 실패하고, 회원 삭제 기능이 통째로 막힌다.
-- ------------------------------------------------------------

ALTER TABLE admin_actions ALTER COLUMN actor_user_id DROP NOT NULL;

ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_actor_user_id_fkey;
ALTER TABLE admin_actions
  ADD CONSTRAINT admin_actions_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN admin_actions.actor_user_id IS
  '행위자. 계정이 삭제되면 NULL 이 되고 행은 남는다(감사 기록은 append-only). 등급은 actor_role 에 보존된다.';

-- ------------------------------------------------------------
-- 2. admin_actions.target_user_id — FK 추가 (SET NULL)
--
-- FK 가 없어서 대상 회원을 삭제하면 존재하지 않는 id 를 가리키는 행이 남았다.
-- 조회 화면이 그 id 로 사용자를 찾지 못해 빈 칸이 되는데, 그것이 "대상이
-- 삭제됨" 인지 "데이터가 깨짐" 인지 구분할 수 없었다.
--
-- SET NULL 이면 "대상 계정이 더 이상 없다" 는 사실이 명확해진다.
-- 무엇을 했는지는 action·resource_id·reason 에 남는다.
-- ------------------------------------------------------------

-- 먼저 이미 발생한 고아 값을 정리한다(FK 추가가 실패하지 않도록).
UPDATE admin_actions SET target_user_id = NULL
WHERE target_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = admin_actions.target_user_id);

ALTER TABLE admin_actions DROP CONSTRAINT IF EXISTS admin_actions_target_user_id_fkey;
ALTER TABLE admin_actions
  ADD CONSTRAINT admin_actions_target_user_id_fkey
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_admin_actions_target ON admin_actions(target_user_id, at DESC);

-- ------------------------------------------------------------
-- 3. audit_logs.actor_user_id — FK 추가 (SET NULL)
--
-- 실측으로 확인한 것: 세션이 많은 사용자를 삭제하면 이 컬럼에 고아가
-- 575행 남았다. 감사 로그는 보존이 목적이므로 행을 지우지 않고 NULL 로 둔다.
-- (기존에 FK 를 두지 않은 것이 의도였을 수 있으나 어디에도 적혀 있지 않았다.
--  여기서 의도를 정하고 주석으로 남긴다.)
-- ------------------------------------------------------------

UPDATE audit_logs SET actor_user_id = NULL
WHERE actor_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = audit_logs.actor_user_id);

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey;
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_actor_user_id_fkey
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN audit_logs.actor_user_id IS
  '행위자. 계정 삭제 시 NULL(기록은 보존). 삭제된 계정의 행위였음을 뜻한다.';

-- ------------------------------------------------------------
-- 4. trading_policies.user_id / reconciliation_runs.user_id — FK 추가
--
-- 둘 다 사용자별 데이터이며 그 사용자가 없으면 의미가 없다. 남겨 둘 이유가
-- 없으므로 CASCADE 로 함께 지운다(감사 기록과 성질이 다르다).
-- ------------------------------------------------------------

DELETE FROM trading_policies
WHERE user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = trading_policies.user_id);

ALTER TABLE trading_policies DROP CONSTRAINT IF EXISTS trading_policies_user_id_fkey;
ALTER TABLE trading_policies
  ADD CONSTRAINT trading_policies_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

DELETE FROM reconciliation_runs
WHERE user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = reconciliation_runs.user_id);

ALTER TABLE reconciliation_runs DROP CONSTRAINT IF EXISTS reconciliation_runs_user_id_fkey;
ALTER TABLE reconciliation_runs
  ADD CONSTRAINT reconciliation_runs_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ------------------------------------------------------------
-- 5. users.role / users.status — CHECK 제약
--
-- 실측으로 확인한 것: `INSERT ... role='TOTALLY_INVALID_ROLE'` 이 성공했다.
-- 권한 판정은 fail-closed(모르는 등급 → 권한 없음)이므로 권한 상승으로
-- 이어지지는 않지만, 데이터가 조용히 오염되고 그 계정은 아무것도 못 하는
-- 상태가 된다. 원인을 찾기 어려운 종류의 장애다.
--
-- ★ 레거시 소문자 값을 함께 허용한다.
--   실제 데이터에 `user` 10건, `USER` 2건이 공존하고, packages/auth 의
--   ROLE_ALIASES 가 `user`→USER · `admin`→ADMIN 을 의도적으로 지원한다.
--   대문자만 허용하면 기존 10개 계정이 제약 위반이 되어 마이그레이션이
--   실패한다. 목적은 "쓰레기값 차단" 이지 "표기 통일" 이 아니다.
--   (표기 통일은 데이터 변경이므로 별도 판단이 필요하다.)
--
-- ★ status 는 서버가 실제로 쓰는 3개만 허용한다:
--   active(정상) · disabled(정지) · locked(로그인 시도 초과).
--   화면에는 suspended·pending 같은 표현이 있으나 그것은 표시용이고
--   DB 에 들어가는 값이 아니다(setUserStatus 는 active/disabled 만 쓴다).
-- ------------------------------------------------------------

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (
    role IN (
      -- 정규 등급 (packages/auth ROLE_NAMES)
      'USER', 'PRO_USER', 'SUPPORT', 'ANALYST', 'ADMIN', 'SUPER_ADMIN',
      -- 레거시 표기 (ROLE_ALIASES 가 지원한다)
      'user', 'admin'
    )
  );

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users
  ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled', 'locked'));

COMMENT ON COLUMN users.role IS
  '권한 등급. 정규 표기는 대문자이며 레거시 소문자(user/admin)도 ROLE_ALIASES 로 지원한다.';
COMMENT ON COLUMN users.status IS
  'active | disabled(관리자 정지) | locked(로그인 시도 초과).';

-- ------------------------------------------------------------
-- 6. users 참조 FK 컬럼의 인덱스
--
-- 부모 행을 지울 때 Postgres 는 각 자식 테이블을 확인한다. 선두 인덱스가
-- 없으면 순차 스캔이므로, 행이 늘어나면 회원 삭제가 점점 느려진다.
-- 지금은 대부분 0행이라 무해하지만, executions·order_events 는 이미 쌓이고
-- 있다. 자주 커지는 것만 먼저 만든다(전부 만들면 쓰기 비용이 늘어난다).
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_executions_user ON executions(user_id);
CREATE INDEX IF NOT EXISTS idx_order_events_user ON order_events(user_id);
CREATE INDEX IF NOT EXISTS idx_risk_checks_user ON risk_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_runs_user ON ai_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_exchange_connections_user ON exchange_connections(user_id);
