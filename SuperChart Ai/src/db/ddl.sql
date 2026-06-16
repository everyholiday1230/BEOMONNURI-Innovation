-- AI Chart Analysis OS — DDL v1
-- PostgreSQL 15+

-- ═══════════════════════════════════════════
-- 1. USERS & AUTH
-- ═══════════════════════════════════════════

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255),
    nickname        VARCHAR(80) NOT NULL,
    phone           VARCHAR(20),
    referral_code   VARCHAR(50),
    role            VARCHAR(30) NOT NULL DEFAULT 'user',
    tier            VARCHAR(10) NOT NULL DEFAULT 'free',
    bitmart_cid     BIGINT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    referral_verified_at TIMESTAMPTZ,
    referral_exchange VARCHAR(20),
    token_version     INTEGER NOT NULL DEFAULT 0,
    email_verified_at TIMESTAMPTZ,
    email_token       VARCHAR(100),
    reset_token       VARCHAR(100),
    reset_token_at    TIMESTAMPTZ
);
CREATE INDEX idx_users_created_at ON users(created_at);

CREATE TABLE user_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token_hash  VARCHAR(255) NOT NULL,
    user_agent          VARCHAR(255),
    ip_address          INET,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_user ON user_sessions(user_id);

-- ═══════════════════════════════════════════
-- 2. EXCHANGES & SYMBOLS
-- ═══════════════════════════════════════════

CREATE TABLE exchanges (
    id              SMALLINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    exchange_code   VARCHAR(30) NOT NULL UNIQUE,
    name            VARCHAR(100) NOT NULL,
    region          VARCHAR(20) NOT NULL,
    asset_support   VARCHAR(100) NOT NULL DEFAULT 'crypto',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO exchanges (exchange_code, name, region, asset_support) VALUES
    ('UPBIT', 'Upbit', 'KR', 'crypto'),
    ('BINANCE', 'Binance', 'GLOBAL', 'crypto'),
    ('KRX', 'Korea Exchange', 'KR', 'stock'),
    ('TWELVE_DATA', 'Twelve Data', 'GLOBAL', 'mixed');

CREATE TABLE symbols (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    exchange_id     SMALLINT NOT NULL REFERENCES exchanges(id),
    asset_class     VARCHAR(20) NOT NULL,  -- crypto, stock_kr, stock_us
    market_type     VARCHAR(20) NOT NULL DEFAULT 'spot',
    symbol_code     VARCHAR(50) NOT NULL,
    base_asset      VARCHAR(30) NOT NULL,
    quote_asset     VARCHAR(30) NOT NULL,
    display_name_ko VARCHAR(120),
    display_name_en VARCHAR(120),
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    metadata        JSONB DEFAULT '{}',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (exchange_id, symbol_code)
);
CREATE INDEX idx_symbols_asset_class ON symbols(asset_class);
CREATE INDEX IF NOT EXISTS idx_symbols_sort_order ON symbols(sort_order);
CREATE INDEX idx_symbols_search ON symbols(symbol_code, base_asset);
CREATE INDEX idx_symbols_metadata ON symbols USING gin(metadata);

-- 기본 심볼 시드 (Binance Futures)
INSERT INTO symbols (exchange_id, asset_class, market_type, symbol_code, base_asset, quote_asset, display_name_ko, display_name_en, metadata) VALUES
(2,'crypto','futures','BTCUSDT','BTC','USDT','비트코인','Bitcoin','{}'),
(2,'crypto','futures','ETHUSDT','ETH','USDT','이더리움','Ethereum','{}'),
(2,'crypto','futures','SOLUSDT','SOL','USDT','솔라나','Solana','{}'),
(2,'crypto','futures','XRPUSDT','XRP','USDT','리플','XRP','{}'),
(2,'crypto','futures','DOGEUSDT','DOGE','USDT','도지코인','Dogecoin','{}'),
(2,'crypto','futures','BNBUSDT','BNB','USDT','바이낸스코인','BNB','{}'),
(2,'crypto','futures','ADAUSDT','ADA','USDT','에이다','Cardano','{}'),
(2,'crypto','futures','AVAXUSDT','AVAX','USDT','아발란체','Avalanche','{}'),
(2,'crypto','futures','DOTUSDT','DOT','USDT','폴카닷','Polkadot','{}'),
(2,'crypto','futures','LINKUSDT','LINK','USDT','체인링크','Chainlink','{}'),
(2,'crypto','futures','MATICUSDT','MATIC','USDT','폴리곤','Polygon','{}'),
(2,'crypto','futures','LTCUSDT','LTC','USDT','라이트코인','Litecoin','{}'),
(2,'crypto','futures','TRXUSDT','TRX','USDT','트론','TRON','{}'),
(2,'crypto','futures','ATOMUSDT','ATOM','USDT','코스모스','Cosmos','{}'),
(2,'crypto','futures','NEARUSDT','NEAR','USDT','니어','NEAR Protocol','{}'),
(2,'crypto','futures','AAVEUSDT','AAVE','USDT','에이브','Aave','{}'),
(2,'crypto','futures','APTUSDT','APT','USDT','앱토스','Aptos','{}'),
(2,'crypto','futures','ARBUSDT','ARB','USDT','아비트럼','Arbitrum','{}'),
(2,'crypto','futures','OPUSDT','OP','USDT','옵티미즘','Optimism','{}'),
(2,'crypto','futures','SUIUSDT','SUI','USDT','수이','Sui','{}'),
(2,'crypto','futures','PEPEUSDT','PEPE','USDT','페페','Pepe','{"api_code":"1000PEPEUSDT"}'),
(2,'crypto','futures','SHIBUSDT','SHIB','USDT','시바이누','Shiba Inu','{"api_code":"1000SHIBUSDT"}'),
(2,'crypto','futures','WIFUSDT','WIF','USDT','위프','dogwifhat','{}'),
(2,'crypto','futures','FETUSDT','FET','USDT','페치AI','Fetch.ai','{}'),
(2,'crypto','futures','FILUSDT','FIL','USDT','파일코인','Filecoin','{}')
ON CONFLICT (exchange_id, symbol_code) DO NOTHING;

-- ═══════════════════════════════════════════
-- 3. MARKET DATA (시계열)
-- ═══════════════════════════════════════════

CREATE TABLE candle_bars (
    id              BIGINT GENERATED ALWAYS AS IDENTITY,
    symbol_id       UUID NOT NULL,
    exchange_id     SMALLINT NOT NULL,
    timeframe       VARCHAR(10) NOT NULL,
    open_time       TIMESTAMPTZ NOT NULL,
    close_time      TIMESTAMPTZ NOT NULL,
    open            NUMERIC(30,12) NOT NULL,
    high            NUMERIC(30,12) NOT NULL,
    low             NUMERIC(30,12) NOT NULL,
    close           NUMERIC(30,12) NOT NULL,
    volume          NUMERIC(38,12) NOT NULL DEFAULT 0,
    quote_volume    NUMERIC(38,12) DEFAULT 0,
    trade_count     INT DEFAULT 0,
    is_final        BOOLEAN NOT NULL DEFAULT FALSE,
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, open_time)
) PARTITION BY RANGE (open_time);

-- 월별 파티션 (2026년)
CREATE TABLE candle_bars_2026_01 PARTITION OF candle_bars FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE candle_bars_2026_02 PARTITION OF candle_bars FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE candle_bars_2026_03 PARTITION OF candle_bars FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE candle_bars_2026_04 PARTITION OF candle_bars FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE candle_bars_2026_05 PARTITION OF candle_bars FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE candle_bars_2026_06 PARTITION OF candle_bars FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE candle_bars_2026_07 PARTITION OF candle_bars FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE candle_bars_2026_08 PARTITION OF candle_bars FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE candle_bars_2026_09 PARTITION OF candle_bars FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE candle_bars_2026_10 PARTITION OF candle_bars FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE candle_bars_2026_11 PARTITION OF candle_bars FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE candle_bars_2026_12 PARTITION OF candle_bars FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE UNIQUE INDEX idx_candles_unique ON candle_bars(symbol_id, exchange_id, timeframe, open_time);
CREATE INDEX idx_candles_query ON candle_bars(symbol_id, timeframe, open_time DESC);

CREATE TABLE ticker_snapshots (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    symbol_id       UUID NOT NULL,
    exchange_id     SMALLINT NOT NULL,
    last_price      NUMERIC(30,12) NOT NULL,
    change_24h      NUMERIC(30,12),
    change_rate_24h NUMERIC(20,8),
    high_24h        NUMERIC(30,12),
    low_24h         NUMERIC(30,12),
    volume_24h      NUMERIC(38,12),
    snapshot_time   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticker_symbol ON ticker_snapshots(symbol_id, snapshot_time DESC);

CREATE TABLE orderbook_snapshots (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    symbol_id       UUID NOT NULL,
    exchange_id     SMALLINT NOT NULL,
    asks            JSONB NOT NULL DEFAULT '[]',
    bids            JSONB NOT NULL DEFAULT '[]',
    snapshot_time   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════
-- 4. WATCHLISTS
-- ═══════════════════════════════════════════

CREATE TABLE watchlists (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        VARCHAR(80) NOT NULL DEFAULT '관심종목',
    sort_order  INT NOT NULL DEFAULT 0,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_watchlists_user ON watchlists(user_id);

CREATE TABLE watchlist_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    watchlist_id    UUID NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
    symbol_id       UUID NOT NULL REFERENCES symbols(id),
    sort_order      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (watchlist_id, symbol_id)
);

-- ═══════════════════════════════════════════
-- 5. CHART LAYOUTS & DRAWINGS
-- ═══════════════════════════════════════════

CREATE TABLE chart_layouts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol_id   UUID NOT NULL REFERENCES symbols(id),
    name        VARCHAR(120) NOT NULL,
    timeframe   VARCHAR(10) NOT NULL DEFAULT '15m',
    chart_type  VARCHAR(20) NOT NULL DEFAULT 'candles',
    theme       VARCHAR(20) NOT NULL DEFAULT 'dark',
    layout_json JSONB NOT NULL DEFAULT '{}',
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_layouts_user ON chart_layouts(user_id, updated_at DESC);

CREATE TABLE chart_drawings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layout_id       UUID NOT NULL REFERENCES chart_layouts(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol_id       UUID NOT NULL REFERENCES symbols(id),
    drawing_type    VARCHAR(30) NOT NULL,
    geometry_json   JSONB NOT NULL,
    style_json      JSONB NOT NULL DEFAULT '{}',
    is_locked       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_drawings_layout ON chart_drawings(layout_id);

CREATE TABLE indicator_presets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    layout_id       UUID NOT NULL REFERENCES chart_layouts(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    indicator_code  VARCHAR(30) NOT NULL,
    params_json     JSONB NOT NULL DEFAULT '{}',
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    pane_index      INT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_indicators_layout ON indicator_presets(layout_id);

-- ═══════════════════════════════════════════
-- 6. ALERTS
-- ═══════════════════════════════════════════

CREATE TABLE alert_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol_id           UUID NOT NULL REFERENCES symbols(id),
    timeframe           VARCHAR(10),
    rule_type           VARCHAR(40) NOT NULL,
    rule_json           JSONB NOT NULL,
    delivery_channel    VARCHAR(20) NOT NULL DEFAULT 'inapp',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_alerts_user_active ON alert_rules(user_id, is_active);
CREATE INDEX idx_alerts_symbol ON alert_rules(symbol_id);

CREATE TABLE alert_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_rule_id       UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL,
    symbol_id           UUID NOT NULL,
    event_status        VARCHAR(20) NOT NULL DEFAULT 'triggered',
    trigger_snapshot    JSONB,
    trigger_price       NUMERIC(30,12),
    triggered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at        TIMESTAMPTZ
);
CREATE INDEX idx_alert_events_rule ON alert_events(alert_rule_id, triggered_at DESC);

-- ═══════════════════════════════════════════
-- 7. AI ANALYSES
-- ═══════════════════════════════════════════

CREATE TABLE ai_analyses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol_id       UUID NOT NULL REFERENCES symbols(id),
    timeframe       VARCHAR(10) NOT NULL,
    input_snapshot  JSONB NOT NULL,
    result_json     JSONB,
    model_name      VARCHAR(80),
    status          VARCHAR(20) NOT NULL DEFAULT 'queued',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_user ON ai_analyses(user_id, created_at DESC);
CREATE INDEX idx_ai_symbol ON ai_analyses(symbol_id, created_at DESC);

-- ═══════════════════════════════════════════
-- 8. ACCESS LOGS (IP-based rate limiting, login audit)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS access_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ip          VARCHAR(45) NOT NULL,
    path        VARCHAR(255) NOT NULL DEFAULT '',
    method      VARCHAR(10) NOT NULL DEFAULT 'GET',
    user_id     UUID,
    user_agent  VARCHAR(500),
    status_code INTEGER NOT NULL DEFAULT 200,
    event_type  VARCHAR(30) NOT NULL DEFAULT 'page_view',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_access_logs_ip ON access_logs(ip);
CREATE INDEX IF NOT EXISTS ix_access_logs_created ON access_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_access_logs_event ON access_logs(event_type, created_at DESC);

-- ═══════════════════════════════════════════
-- 9. NOTICES (admin-managed announcements)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notices (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         VARCHAR(200) NOT NULL,
    content       TEXT NOT NULL,
    content_type  VARCHAR(20) NOT NULL DEFAULT 'notice',
    status        VARCHAR(20) NOT NULL DEFAULT 'published',
    priority      INTEGER NOT NULL DEFAULT 0,
    is_pinned     BOOLEAN NOT NULL DEFAULT FALSE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    placement     VARCHAR(30) NOT NULL DEFAULT 'home',
    target_user   VARCHAR(20) NOT NULL DEFAULT 'all',
    dismiss_policy VARCHAR(20) NOT NULL DEFAULT 'close',
    start_at      TIMESTAMPTZ,
    end_at        TIMESTAMPTZ,
    locale        VARCHAR(5) NOT NULL DEFAULT 'ko',
    view_count    INTEGER NOT NULL DEFAULT 0,
    click_count   INTEGER NOT NULL DEFAULT 0,
    cta_text      VARCHAR(100),
    cta_url       VARCHAR(500),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_notices_active ON notices(is_active, is_pinned DESC, created_at DESC);

-- ═══════════════════════════════════════════
-- 10. FAQS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS faqs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question   VARCHAR(300) NOT NULL,
    answer     TEXT NOT NULL,
    category   VARCHAR(50) NOT NULL DEFAULT 'general',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active  BOOLEAN NOT NULL DEFAULT TRUE,
    locale     VARCHAR(5) NOT NULL DEFAULT 'ko',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_faqs_active ON faqs(is_active, sort_order);

-- ═══════════════════════════════════════════
-- 11. SITE SETTINGS (key/value)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS site_settings (
    key   VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

-- 기본값 시드
INSERT INTO site_settings (key, value) VALUES
    ('maintenance_mode', 'false'),
    ('site_name', 'AI Chart Analysis OS'),
    ('notice_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

-- Seed: 기본 FAQ
INSERT INTO faqs (question, answer, sort_order) VALUES
    ('서비스는 무료인가요?', '기본 차트와 지표는 무료입니다. PRO 기능은 거래소 레퍼럴 인증 후 무료로 이용 가능합니다.', 1),
    ('PRO 등급은 어떻게 받나요?', 'BitMart 또는 Bitget 거래소에서 초대 링크로 가입 후 인증하면 PRO 등급이 부여됩니다.', 2)
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════
-- 12. USER CHART SETTINGS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_chart_settings (
    user_id       UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════
-- 13. 추가 인덱스 (자주 쓰이는 조회 최적화)
-- ═══════════════════════════════════════════

CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);
CREATE INDEX IF NOT EXISTS ix_users_tier ON users(tier);
CREATE INDEX IF NOT EXISTS ix_chart_layouts_user ON chart_layouts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_watchlists_user ON watchlists(user_id);

-- ═══════════════════════════════════════════
-- 14. candle_bars 2027년 파티션 (1년 선제 확장)
--     매년 `python scripts/ensure_candle_partitions.py` 으로 자동 갱신 권장
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS candle_bars_2027_01 PARTITION OF candle_bars FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_02 PARTITION OF candle_bars FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_03 PARTITION OF candle_bars FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_04 PARTITION OF candle_bars FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_05 PARTITION OF candle_bars FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_06 PARTITION OF candle_bars FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_07 PARTITION OF candle_bars FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_08 PARTITION OF candle_bars FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_09 PARTITION OF candle_bars FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_10 PARTITION OF candle_bars FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_11 PARTITION OF candle_bars FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE IF NOT EXISTS candle_bars_2027_12 PARTITION OF candle_bars FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');

-- 2028년 파티션
CREATE TABLE IF NOT EXISTS candle_bars_2028_01 PARTITION OF candle_bars FOR VALUES FROM ('2028-01-01') TO ('2028-02-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_02 PARTITION OF candle_bars FOR VALUES FROM ('2028-02-01') TO ('2028-03-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_03 PARTITION OF candle_bars FOR VALUES FROM ('2028-03-01') TO ('2028-04-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_04 PARTITION OF candle_bars FOR VALUES FROM ('2028-04-01') TO ('2028-05-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_05 PARTITION OF candle_bars FOR VALUES FROM ('2028-05-01') TO ('2028-06-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_06 PARTITION OF candle_bars FOR VALUES FROM ('2028-06-01') TO ('2028-07-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_07 PARTITION OF candle_bars FOR VALUES FROM ('2028-07-01') TO ('2028-08-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_08 PARTITION OF candle_bars FOR VALUES FROM ('2028-08-01') TO ('2028-09-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_09 PARTITION OF candle_bars FOR VALUES FROM ('2028-09-01') TO ('2028-10-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_10 PARTITION OF candle_bars FOR VALUES FROM ('2028-10-01') TO ('2028-11-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_11 PARTITION OF candle_bars FOR VALUES FROM ('2028-11-01') TO ('2028-12-01');
CREATE TABLE IF NOT EXISTS candle_bars_2028_12 PARTITION OF candle_bars FOR VALUES FROM ('2028-12-01') TO ('2029-01-01');

-- 데모매매 거래 내역
CREATE TABLE IF NOT EXISTS demo_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol VARCHAR(30) NOT NULL,
    side VARCHAR(10) NOT NULL,
    entry_price NUMERIC(20,8) NOT NULL,
    exit_price NUMERIC(20,8),
    size NUMERIC(20,8) NOT NULL,
    pnl NUMERIC(20,8),
    pnl_pct NUMERIC(10,4),
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_demo_trades_user ON demo_trades(user_id, opened_at DESC);

-- 고객지원 문의
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    email VARCHAR(255),
    subject VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    category VARCHAR(30) NOT NULL DEFAULT 'general',
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    priority INTEGER NOT NULL DEFAULT 0,
    admin_memo TEXT,
    assigned_to VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_support_tickets_status ON support_tickets(status, created_at DESC);

-- ═══════════════════════════════════════════
-- 14. TICKET LOGS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ticket_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id  UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    action     VARCHAR(30) NOT NULL,
    old_status VARCHAR(20),
    new_status VARCHAR(20),
    memo       TEXT,
    admin_id   VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ticket_logs_ticket ON ticket_logs(ticket_id, created_at DESC);

-- ═══════════════════════════════════════════
-- 15. MIGRATIONS (기존 DB 에 컬럼 추가 시)
--     IF NOT EXISTS 기반 — idempotent.
--     신규 DB 에는 위 CREATE TABLE 로 이미 처리됨.
-- ═══════════════════════════════════════════

-- symbols.sort_order 컬럼 보장 (기존 DB 대비)
ALTER TABLE symbols
  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- ═══════════════════════════════════════════
-- 16. SYMBOL SORT ORDER SEED (시총 순)
--     sort_order = 0 인 행만 업데이트 (기존 수동 조정 보존).
--     운영자가 관리 페이지에서 변경한 순서는 보호됨.
-- ═══════════════════════════════════════════

UPDATE symbols SET sort_order =  1 WHERE symbol_code = 'BTCUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order =  2 WHERE symbol_code = 'ETHUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order =  3 WHERE symbol_code = 'XRPUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order =  4 WHERE symbol_code = 'BNBUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order =  5 WHERE symbol_code = 'SOLUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order =  6 WHERE symbol_code = 'ADAUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order =  7 WHERE symbol_code = 'DOGEUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order =  8 WHERE symbol_code = 'TRXUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order =  9 WHERE symbol_code = 'AVAXUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 10 WHERE symbol_code = 'LINKUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 11 WHERE symbol_code = 'TONUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 12 WHERE symbol_code = 'DOTUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 13 WHERE symbol_code = 'SUIUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 14 WHERE symbol_code = 'SHIBUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 15 WHERE symbol_code = 'LTCUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 16 WHERE symbol_code = 'BCHUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 17 WHERE symbol_code = 'UNIUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 18 WHERE symbol_code = 'NEARUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 19 WHERE symbol_code = 'APTUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 20 WHERE symbol_code = 'ICPUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 21 WHERE symbol_code = 'ETCUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 22 WHERE symbol_code = 'HBARUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 23 WHERE symbol_code = 'XLMUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 24 WHERE symbol_code = 'RENDERUSDT' AND sort_order = 0;
UPDATE symbols SET sort_order = 25 WHERE symbol_code = 'FILUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 26 WHERE symbol_code = 'ARBUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 27 WHERE symbol_code = 'OPUSDT'    AND sort_order = 0;
UPDATE symbols SET sort_order = 28 WHERE symbol_code = 'ATOMUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 29 WHERE symbol_code = 'INJUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 30 WHERE symbol_code = 'FETUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 31 WHERE symbol_code = 'STXUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 32 WHERE symbol_code = 'IMXUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 33 WHERE symbol_code = 'GRTUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 34 WHERE symbol_code = 'ALGOUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 35 WHERE symbol_code = 'THETAUSDT' AND sort_order = 0;
UPDATE symbols SET sort_order = 36 WHERE symbol_code = 'VETUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 37 WHERE symbol_code = 'AAVEUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 38 WHERE symbol_code = 'TIAUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 39 WHERE symbol_code = 'JUPUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 40 WHERE symbol_code = 'SEIUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 41 WHERE symbol_code = 'KASUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 42 WHERE symbol_code = 'ONDOUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 43 WHERE symbol_code = 'WLDUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 44 WHERE symbol_code = 'ENAUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 45 WHERE symbol_code = 'PEPEUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 46 WHERE symbol_code = 'BONKUSDT'  AND sort_order = 0;
UPDATE symbols SET sort_order = 47 WHERE symbol_code = 'FLOKIUSDT' AND sort_order = 0;
UPDATE symbols SET sort_order = 48 WHERE symbol_code = 'WIFUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 49 WHERE symbol_code = 'TRUMPUSDT' AND sort_order = 0;
UPDATE symbols SET sort_order = 50 WHERE symbol_code = 'PENGUUSDT' AND sort_order = 0;
UPDATE symbols SET sort_order = 51 WHERE symbol_code = 'POLUSDT'   AND sort_order = 0;
UPDATE symbols SET sort_order = 52 WHERE symbol_code = 'LABUSDT'   AND sort_order = 0;
