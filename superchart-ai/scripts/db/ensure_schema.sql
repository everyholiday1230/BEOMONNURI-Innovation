-- ═══════════════════════════════════════════════════════════════════
-- ensure_schema.sql — 운영 DB 스키마 정합성 보강 (idempotent · 무위험)
--
-- 배경:
--   앱 부팅 시(main.py lifespan) 이 파일을 자동 실행한다. 그러나 실제로는
--   파일이 없어 조용히 skip 되고 있었다(스키마 보강 미실행).
--   런타임에 CREATE TABLE IF NOT EXISTS 로 지연 생성되는 20여 개 테이블의
--   인덱스가 코드 곳곳에 흩어져 있고, 일부 조회 핫패스에 인덱스가 누락돼
--   256MB DB 에서 풀스캔/성능 저하 위험이 있었다.
--
-- 원칙 (안전 최우선):
--   - CREATE INDEX IF NOT EXISTS / CREATE TABLE IF NOT EXISTS 만 사용.
--   - DROP / ALTER(파괴적) / 데이터 변경 없음 → 기존 데이터 무영향, 롤백 불필요.
--   - 대상 테이블이 아직 없으면 인덱스 생성이 실패할 수 있으나, lifespan 이
--     문장 단위 예외를 격리(전체 스크립트 1회 실행, 실패해도 앱 기동 계속)하며
--     해당 테이블은 첫 사용 시 코드가 생성하므로 다음 부팅에서 인덱스가 붙는다.
--   - 그래도 안전하게, 핵심 테이블은 IF NOT EXISTS 로 최소 정의를 선제 보장한다.
-- ═══════════════════════════════════════════════════════════════════

-- ── point_ledger: 포인트 원장 (레거시 DB 존재 가정, 없으면 최소 정의) ──
CREATE TABLE IF NOT EXISTS point_ledger (
    id         BIGSERIAL PRIMARY KEY,
    user_id    TEXT NOT NULL,
    amount     INTEGER NOT NULL,
    balance    INTEGER,
    reason     TEXT,
    ref_id     TEXT,
    note       TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 핵심 누락 인덱스: 사용자별 내역 조회 + 기간 집계 핫패스
CREATE INDEX IF NOT EXISTS idx_point_ledger_user_created
    ON point_ledger(user_id, created_at DESC);
-- 전체 기간 집계(대시보드: 적립/사용 합계) — created_at 범위 스캔
CREATE INDEX IF NOT EXISTS idx_point_ledger_created
    ON point_ledger(created_at DESC);
-- 멱등 조회(reason+ref_id+user_id) — 이미 코드에서 생성하나 정합성 위해 재보장
CREATE INDEX IF NOT EXISTS idx_point_ledger_reason_ref
    ON point_ledger(reason, ref_id, user_id);
-- ★ 동시 중복 지급 방지(레이스 컨디션 방어) ★
-- referral.py의 reward_referrer_on_verify/on_payment/apply_code 는
-- "SELECT로 지급 여부 확인 → 없으면 INSERT" 패턴을 쓰는데, 이 둘 사이에는 원자성이
-- 없어 동시 요청(중복 클릭/웹훅 재전송 등)이 겹치면 같은 (user_id, reason, ref_id)
-- 조합으로 point_ledger 행이 2번 INSERT 될 수 있다(= 포인트 중복 지급).
-- 대상은 "1회성 보상" 3종(referral_signup/referral_payment/signup_bonus)만으로
-- 명시적으로 좁힌다 — points.py의 'purchase'(포인트 상품, 같은 상품 여러 번 구매가
-- 정상 흐름) 등 반복 가능한 reason 까지 함께 막히는 부작용을 방지하기 위함.
-- ref_id가 없는 기존 레코드(관리자 수동 조정 등)는 영향받지 않음 —
-- 순수 추가(additive), 기존 데이터 무손실.
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_ledger_reward_once
    ON point_ledger(reason, ref_id, user_id)
    WHERE ref_id IS NOT NULL
      AND reason IN ('referral_signup', 'referral_payment', 'signup_bonus');

-- ── user_purchases: 지표/상품 구매 (status 필터 조회 보강) ──
CREATE INDEX IF NOT EXISTS idx_user_purchases_user_status
    ON user_purchases(user_id, status);

-- ── point_purchases: 포인트 상점 구매 이력 (사용자별 최신순) ──
CREATE INDEX IF NOT EXISTS idx_point_purchases_user_created
    ON point_purchases(user_id, created_at DESC);

-- ── llm_signal_log: 나만의 신호 사용 이력 (대시보드 통계/감사) ──
-- API 최초 호출 전에도 부팅 시 인덱스를 생성할 수 있도록 런타임 정의와 같은
-- 최소 테이블을 선제 보장한다. IF NOT EXISTS이므로 기존 테이블/데이터는 변경하지 않는다.
CREATE TABLE IF NOT EXISTS llm_signal_log (
    id                BIGSERIAL PRIMARY KEY,
    user_id           TEXT NOT NULL,
    symbol            TEXT,
    timeframe         TEXT,
    message           TEXT,
    signals_json      TEXT,
    signal_count      INTEGER NOT NULL DEFAULT 0,
    drawing_count     INTEGER NOT NULL DEFAULT 0,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens      INTEGER NOT NULL DEFAULT 0,
    charged_points    INTEGER NOT NULL DEFAULT 0,
    free_used         BOOLEAN NOT NULL DEFAULT FALSE,
    tier              TEXT,
    status            TEXT NOT NULL DEFAULT 'ok',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_llm_signal_log_user_created
    ON llm_signal_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_signal_log_created
    ON llm_signal_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_signal_log_status
    ON llm_signal_log(status);

-- ── referral_links: 추천 관계 (추천인별/상태별 조회) ──
CREATE INDEX IF NOT EXISTS idx_referral_links_referrer
    ON referral_links(referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_links_status
    ON referral_links(status, created_at DESC);

-- ── payment_events: 결제 웹훅 이벤트 (주문별 감사 조회) ──
CREATE INDEX IF NOT EXISTS idx_payment_events_order
    ON payment_events(order_id, created_at DESC);

-- ── demo_trades / support_tickets: 대시보드 목록 (사용자·상태별) ──
CREATE INDEX IF NOT EXISTS idx_demo_trades_user
    ON demo_trades(user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS ix_support_tickets_status
    ON support_tickets(status, created_at DESC);

-- ── access_logs: 접속/감사 로그 (대시보드 기간·유형별 집계) ──
CREATE INDEX IF NOT EXISTS ix_access_logs_created
    ON access_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_access_logs_event
    ON access_logs(event_type, created_at DESC);

-- ── users: 대시보드 필터(등급/가입일) ──
CREATE INDEX IF NOT EXISTS ix_users_tier ON users(tier);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

-- ── users.points: 포인트 정본 잔액 컬럼 (referral.py/points.py가 전제하는 컬럼) ──
-- 배경: referral.py, points.py가 "UPDATE users SET points = ..." 를 전제로 작성됐으나
--   이 컬럼을 생성하는 코드가 ddl.sql/모델/마이그레이션 어디에도 없었다. 컬럼이 없는
--   환경에서는 포인트 지급·조회·레퍼럴 보상이 전부 실패한다. IF NOT EXISTS 로 안전하게
--   추가한다(이미 존재하면 아무 일도 하지 않음 — 기존 데이터/값 무손실).
ALTER TABLE users ADD COLUMN IF NOT EXISTS points INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_users_points ON users(points) WHERE points > 0;
