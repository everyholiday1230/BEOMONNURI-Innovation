"""메인 FastAPI 앱."""
import asyncio
import logging
import os
import time as _time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request as _Req
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from starlette.responses import JSONResponse, HTMLResponse
import structlog
from src.ingest.manager import IngestManager
from src.ws.gateway import ws_manager
from src.services.alert_engine import alert_engine

# 로그 로테이션 (10MB × 5파일) — 디렉토리 먼저 생성 후 handler 연결
os.makedirs("logs", exist_ok=True)
_log_handler = RotatingFileHandler("logs/chartos.log", maxBytes=10_000_000, backupCount=3, encoding="utf-8")
_log_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
logging.root.addHandler(_log_handler)
logging.root.setLevel(logging.INFO)

# 노이즈 라이브러리 로그 레벨 강제 — 모든 HTTP 요청 INFO 로그를 WARNING으로
# (Binance API 호출이 분당 수백건 → 38MB 로그 노이즈의 99% 차지)
for _noisy in ("httpx", "httpcore", "httpcore.http11", "httpcore.connection",
               "urllib3", "urllib3.connectionpool",
               "asyncio", "websockets.client", "websockets.protocol"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# Sentry 에러 추적 (SENTRY_DSN 환경변수 설정 시 활성화)
_sentry_dsn = os.getenv("SENTRY_DSN", "")
if _sentry_dsn:
    import sentry_sdk
    sentry_sdk.init(dsn=_sentry_dsn, traces_sample_rate=0.1, profiles_sample_rate=0.1)
    # 활성화 로그는 logger 초기화 후 feature.status 에서 통합 표시
# from src.services.demo_trader import demo_trader          # 데모 삭제
# from src.services.multi_demo import multi_demo as multi_demo_engine  # 멀티데모 삭제

logger = structlog.get_logger(__name__)
ingest = IngestManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ─ DB 부트스트랩: symbols.sort_order 보장 + seed ─────────────
    # 기존 DB 에 sort_order 컬럼이 없거나 모두 0 인 경우 대비.
    # 각 문장을 별개 트랜잭션으로 실행 — 권한 부족/중복 에러가 다른
    # 문장에 영향 주지 않음. idempotent.
    try:
        from sqlalchemy import text as _sa_text
        from src.db.session import engine as _engine

        # 1. 컬럼 보장 (권한 없으면 조용히 skip)
        try:
            async with _engine.begin() as _conn:
                await _conn.execute(_sa_text(
                    "ALTER TABLE symbols ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0"
                ))
        except Exception as ce:
            logger.debug("seed.alter_skip", error=str(ce)[:150])

        # 2. 시총 순 시드 (sort_order = 0 인 것만)
        SEED = [
            ('BTCUSDT',1),('ETHUSDT',2),('XRPUSDT',3),('BNBUSDT',4),('SOLUSDT',5),
            ('ADAUSDT',6),('DOGEUSDT',7),('TRXUSDT',8),('AVAXUSDT',9),('LINKUSDT',10),
            ('TONUSDT',11),('DOTUSDT',12),('SUIUSDT',13),('SHIBUSDT',14),('LTCUSDT',15),
            ('BCHUSDT',16),('UNIUSDT',17),('NEARUSDT',18),('APTUSDT',19),('ICPUSDT',20),
            ('ETCUSDT',21),('HBARUSDT',22),('XLMUSDT',23),('RENDERUSDT',24),('FILUSDT',25),
            ('ARBUSDT',26),('OPUSDT',27),('ATOMUSDT',28),('INJUSDT',29),('FETUSDT',30),
            ('STXUSDT',31),('IMXUSDT',32),('GRTUSDT',33),('ALGOUSDT',34),('THETAUSDT',35),
            ('VETUSDT',36),('AAVEUSDT',37),('TIAUSDT',38),('JUPUSDT',39),('SEIUSDT',40),
            ('KASUSDT',41),('ONDOUSDT',42),('WLDUSDT',43),('ENAUSDT',44),('PEPEUSDT',45),
            ('BONKUSDT',46),('FLOKIUSDT',47),('WIFUSDT',48),('TRUMPUSDT',49),('PENGUUSDT',50),
            ('POLUSDT',51),('LABUSDT',52),
        ]
        updated = 0
        try:
            async with _engine.begin() as _conn:
                for code, order in SEED:
                    r = await _conn.execute(_sa_text(
                        "UPDATE symbols SET sort_order = :o WHERE symbol_code = :c AND sort_order = 0"
                    ), {"o": order, "c": code})
                    updated += (r.rowcount or 0)
            if updated > 0:
                logger.info("seed.symbol_sort_order.applied", rows=updated)
        except Exception as ue:
            logger.debug("seed.update_skip", error=str(ue)[:150])
    except Exception as e:
        logger.warning("seed.symbol_sort_order.failed", error=str(e)[:200])

    # ensure_schema.sql 자동 실행 (최근 추가 테이블/컬럼 보장 — Render 정합성)
    # 문장 단위로 분리해 개별 실행한다: asyncpg의 execute()에 세미콜론으로 구분된
    # 여러 문장을 한 번에 넘기면 simple query protocol 상 암묵적으로 하나로 묶여,
    # 앞쪽 문장 하나가 실패(예: 대상 테이블이 아직 없어 인덱스 생성 실패)하면 뒤쪽의
    # 안전한 문장(예: users.points 컬럼 보강)까지 함께 실행되지 않을 위험이 있었다.
    try:
        from pathlib import Path as _Path
        _ddl = _Path(__file__).resolve().parent.parent / "scripts" / "db" / "ensure_schema.sql"
        _db_url = os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
        if _ddl.exists() and _db_url:
            import asyncpg as _apg
            _c = await _apg.connect(_db_url)
            _raw = _ddl.read_text(encoding="utf-8")
            # 줄 단위 주석(--) 제거 후 세미콜론 기준으로 개별 문장 분리
            _lines = [_ln.split("--", 1)[0] for _ln in _raw.splitlines()]
            _stmts = [s.strip() for s in "\n".join(_lines).split(";") if s.strip()]
            _ok, _fail = 0, 0
            for _stmt in _stmts:
                try:
                    await _c.execute(_stmt)
                    _ok += 1
                except Exception as _se:
                    _fail += 1
                    logger.debug("startup.ensure_schema.stmt_failed", error=str(_se)[:150], stmt=_stmt[:80])
            await _c.close()
            logger.info("startup.ensure_schema.applied", ok=_ok, failed=_fail)
    except Exception as e:
        logger.warning("startup.ensure_schema.failed", error=str(e)[:200])

    # reseed_symbols.sql 자동 실행 (stock/commodity 등 누락 심볼 보충)
    try:
        from pathlib import Path as _Path
        _reseed_sql = _Path(__file__).resolve().parent.parent / "scripts" / "db" / "reseed_symbols.sql"
        if _reseed_sql.exists():
            import asyncpg as _apg
            _db_url = os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
            if _db_url:
                _rconn = await _apg.connect(_db_url)
                _before = await _rconn.fetchval("SELECT COUNT(*) FROM symbols")
                await _rconn.execute(_reseed_sql.read_text(encoding="utf-8"))
                _after = await _rconn.fetchval("SELECT COUNT(*) FROM symbols")
                await _rconn.close()
                if _after > _before:
                    logger.info("startup.reseed_symbols", before=_before, after=_after)
    except Exception as e:
        logger.debug("startup.reseed_skip", error=str(e)[:200])

    # seed_faqs.sql 자동 실행 (FAQ가 거의 없을 때만 정답본으로 보충)
    try:
        from pathlib import Path as _Path
        _faq_sql = _Path(__file__).resolve().parent.parent / "scripts" / "db" / "seed_faqs.sql"
        _db_url = os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
        if _faq_sql.exists() and _db_url:
            import asyncpg as _apg
            _fc = await _apg.connect(_db_url)
            _fb = await _fc.fetchval("SELECT COUNT(*) FROM faqs")
            await _fc.execute(_faq_sql.read_text(encoding="utf-8"))
            _fa = await _fc.fetchval("SELECT COUNT(*) FROM faqs")
            await _fc.close()
            if _fa != _fb:
                logger.info("startup.seed_faqs", before=_fb, after=_fa)
    except Exception as e:
        logger.debug("startup.seed_faqs_skip", error=str(e)[:200])

    # seed_korean_names.sql 자동 실행 (한국어명이 영문 티커로만 채워진 종목 보강)
    try:
        from pathlib import Path as _Path
        _kr_sql = _Path(__file__).resolve().parent.parent / "scripts" / "db" / "seed_korean_names.sql"
        _db_url = os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
        if _kr_sql.exists() and _db_url:
            import asyncpg as _apg
            _kc = await _apg.connect(_db_url)
            _kb = await _kc.fetchval(
                "SELECT COUNT(*) FROM symbols WHERE asset_class='crypto' "
                "AND (display_name_ko IS NULL OR display_name_ko='' OR display_name_ko=base_asset OR display_name_ko=display_name_en)")
            await _kc.execute(_kr_sql.read_text(encoding="utf-8"))
            _ka = await _kc.fetchval(
                "SELECT COUNT(*) FROM symbols WHERE asset_class='crypto' "
                "AND (display_name_ko IS NULL OR display_name_ko='' OR display_name_ko=base_asset OR display_name_ko=display_name_en)")
            await _kc.close()
            if _ka != _kb:
                logger.info("startup.seed_korean_names", missing_before=_kb, missing_after=_ka)
    except Exception as e:
        logger.debug("startup.seed_korean_names_skip", error=str(e)[:200])

    # seed_new_symbols_*.sql 자동 실행 (거래량 상위 신규 종목 추가)
    try:
        from pathlib import Path as _Path
        _ns = _Path(__file__).resolve().parent.parent / "scripts" / "db" / "seed_new_symbols_20260608.sql"
        _db_url = os.getenv("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
        if _ns.exists() and _db_url:
            import asyncpg as _apg
            _nc = await _apg.connect(_db_url)
            await _nc.execute(_ns.read_text(encoding="utf-8"))
            await _nc.close()
            logger.info("startup.seed_new_symbols.applied")
    except Exception as e:
        logger.debug("startup.seed_new_symbols_skip", error=str(e)[:200])

    # DB에서 심볼 캐시 로드 (다른 모듈보다 먼저).
    # DB가 일시적으로 늦게 뜨거나 장애 상태여도 앱 자체는 기동해
    # /health에서 degraded 상태를 보고할 수 있어야 한다.
    try:
        from src.services.symbol_resolver import load as _load_symbols
        await _load_symbols()
    except Exception as e:
        logger.warning("startup.symbol_load_failed", error=str(e)[:200])

    alert_engine.set_ws_manager(ws_manager)
    # demo_trader.set_ws_manager(ws_manager)       # 데모 삭제
    # multi_demo_engine.set_ws_manager(ws_manager)  # 멀티데모 삭제

    # 알림 규칙을 DB에서 메모리로 로드 (서버 재시작 시 유실 방지)
    try:
        await alert_engine.load_from_db()
    except Exception as e:
        logger.warning("alert.lifespan_load_failed", error=str(e))
    # 서버 재시작 시 데모 매매 자동 복원
    # 멀티데모 자동 복원 — 삭제
    # if multi_demo_engine.running and ...

    # 실전매매 자동 복원 — 비활성화
    # from src.services.live_trader_v2 import live_trader_v2, LiveTraderV2

    # 실시간 데이터 플로우 진단용 카운터 (/v1/debug/ingest 로 확인)
    app.state.ingest_stats = {
        "total_candles": 0,
        "total_broadcasts": 0,
        "last_candle_at": 0.0,
        "last_broadcast_at": 0.0,
        "last_symbol": "",
        "last_tf": "",
        "by_symbol": {},  # {symbol: {count, last_at, last_sent}}
    }

    async def on_candle(candle):
        # 수신 기록
        try:
            now = _time.time()
            st = app.state.ingest_stats
            st["total_candles"] += 1
            st["last_candle_at"] = now
            st["last_symbol"] = candle.get("symbol", "")
            st["last_tf"] = candle.get("timeframe", "")
            sym = candle.get("symbol", "?")
            bs = st["by_symbol"].setdefault(sym, {"count": 0, "last_at": 0.0, "last_sent": 0})
            bs["count"] += 1
            bs["last_at"] = now
        except Exception as _e:
            logger.debug("main.silent_except", error=str(_e)[:100])
        sent = await ws_manager.broadcast("candle", candle["symbol"], candle.get("timeframe", ""), candle)
        # Redis Pub/Sub로도 발행 (별도 WS 서버용)
        try:
            from src.ws.pubsub import publish_candle
            await publish_candle(candle)
        except Exception:
            pass
        if sent > 0:
            try:
                st = app.state.ingest_stats
                st["total_broadcasts"] += 1
                st["last_broadcast_at"] = _time.time()
                bs = st["by_symbol"].setdefault(candle.get("symbol", "?"), {"count": 0, "last_at": 0.0, "last_sent": 0})
                bs["last_sent"] = sent
            except Exception as _e:
                logger.debug("main.silent_except", error=str(_e)[:100])
            logger.debug("ws.sent", symbol=candle["symbol"], tf=candle.get("timeframe"), sent=sent)
        try:
            price = float(candle.get("close", 0))
        except (TypeError, ValueError):
            price = 0.0
        if price > 0:
            try:
                await alert_engine.evaluate(candle["symbol"], price)
            except Exception as e:
                logger.warning("alert.evaluate_error", error=str(e))
        # OB 시그널 체크는 프론트엔드에서만 처리 (서버/프론트 데이터 불일치 방지)
        if candle.get("isFinal") or candle.get("is_final"):
            pass

    async def on_ticker(ticker):
        await ws_manager.broadcast("ticker", ticker["symbol"], "", ticker)
        try:
            from src.ws.pubsub import publish_ticker
            await publish_ticker(ticker)
        except Exception:
            pass
        try:
            price = float(ticker.get("last_price", 0))
        except (TypeError, ValueError):
            price = 0.0
        if price > 0:
            try:
                await alert_engine.evaluate(ticker["symbol"], price)
            except Exception as e:
                logger.warning("alert.ticker_evaluate_error", error=str(e))

    ingest.on_candle(on_candle)
    ingest.on_ticker(on_ticker)

    # ── Candle DB writer: 마감봉을 candle_bars 테이블에 영구 저장 ──
    from src.services.candle_writer import candle_writer
    async def on_candle_db(candle):
        await candle_writer.enqueue(candle)
    ingest.on_candle(on_candle_db)
    # 주기적 flush (5초마다)
    app.state.candle_flush_task = asyncio.create_task(candle_writer.periodic_flush_loop())

    # ── Leader election: ingest는 leader worker만 실행 ──
    from src.services.leader import leader
    await leader.acquire()
    asyncio.create_task(leader.renew_loop())

    # ── Redis Pub/Sub Subscribe (모든 워커) ──
    # leader 워커 1개가 ingest → publish_candle/ticker
    # 모든 워커가 subscribe → 각자의 ws 클라이언트에 브로드캐스트
    # (gunicorn 다중 워커 환경에서 클라이언트 분산 대응)
    async def _redis_subscribe_loop():
        try:
            from src.ws.pubsub import subscribe_loop
            async def _on_candle(candle):
                try:
                    sym = candle.get("symbol", "")
                    tf = candle.get("timeframe", "")
                    await ws_manager.broadcast("candle", sym, tf, candle)
                except Exception as e:
                    logger.debug("ws.broadcast_candle_fail", err=str(e)[:100])
            async def _on_ticker(ticker):
                try:
                    sym = ticker.get("symbol", "")
                    await ws_manager.broadcast("ticker", sym, "", ticker)
                except Exception as e:
                    logger.debug("ws.broadcast_ticker_fail", err=str(e)[:100])
            await subscribe_loop(_on_candle, _on_ticker)
        except Exception as e:
            logger.warning("redis_subscribe.unavailable_retry", error=str(e)[:200], retry_in=30)
            await asyncio.sleep(30)
            asyncio.create_task(_redis_subscribe_loop())  # 자동 재시작

    asyncio.create_task(_redis_subscribe_loop())
    logger.info("redis_subscribe.started", pid=__import__('os').getpid())

    # ingest task가 예외로 조용히 죽는 것을 방지 — 실패 시 로그 + 자동 재시작
    async def _ingest_supervisor():
        _attempt = 0
        while True:
            if not leader.is_leader:
                await asyncio.sleep(5)
                continue
            try:
                _attempt = 0
                logger.info("ingest.leader_start", pid=__import__('os').getpid())
                await ingest.start()
                logger.info("ingest.start_returned")
                break
            except asyncio.CancelledError:
                raise
            except Exception as e:
                _attempt += 1
                delay = min(300, 5 * (2 ** min(_attempt, 6)))
                logger.error("ingest.crashed", error=str(e), retry_in=delay, attempt=_attempt, exc_info=True)
                await asyncio.sleep(delay)
                logger.info("ingest.restarting", attempt=_attempt)

    app.state.ingest_task = asyncio.create_task(_ingest_supervisor())

    # ── Ticker fallback broadcaster ─────────────────────────────
    # Binance/Redis/leader 장애가 겹치면 서버는 살아 있어도 ticker.update가
    # 0건이 될 수 있다. 활성 ticker 구독자에게만 Bitget/Binance fallback
    # ticker를 폴링해 실시간 가격 정지를 방지한다.
    async def _ticker_fallback_loop():
        from src.services.market import fetch_ticker
        while True:
            await asyncio.sleep(3)
            try:
                symbols = ws_manager.ticker_symbols()
                if not symbols:
                    continue
                results = await asyncio.gather(*(fetch_ticker(sym) for sym in symbols[:50]), return_exceptions=True)
                for ticker in results:
                    if isinstance(ticker, dict) and ticker.get("symbol") and ticker.get("last_price"):
                        await on_ticker(ticker)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.debug("ticker_fallback.loop_error", error=str(e)[:160])

    app.state.ticker_fallback_task = asyncio.create_task(_ticker_fallback_loop())

    # WS 좀비 연결 + ingest_stats 정리 (60초마다)
    async def _ws_cleanup_loop():
        while True:
            await asyncio.sleep(60)
            try:
                await ws_manager.cleanup_dead()
            except Exception as _e:
                logger.debug("main.silent_except", error=str(_e)[:100])
            # ingest_stats["by_symbol"] 무제한 증가 방지:
            # 최근 10분간 수신 없는 심볼 엔트리 제거 (진단은 최근 120초만 노출하므로 영향 없음).
            try:
                st = getattr(app.state, "ingest_stats", None)
                if st and isinstance(st.get("by_symbol"), dict):
                    cutoff = _time.time() - 600
                    bs = st["by_symbol"]
                    stale = [k for k, v in bs.items() if v.get("last_at", 0) < cutoff]
                    for k in stale:
                        bs.pop(k, None)
            except Exception as _e:
                logger.debug("main.silent_except", error=str(_e)[:100])
    asyncio.create_task(_ws_cleanup_loop())

    # 실전매매 자동 복원 — 비활성화 (라이브트레이딩 분리)
    # if LiveTraderV2.was_running() and not live_trader_v2.running:
    #     live_trader_v2.start()
    #     if not live_trader_v2._task or live_trader_v2._task.done():
    #         live_trader_v2._task = asyncio.create_task(live_trader_v2._loop())
    yield
    # ── graceful shutdown ──
    logger.info("shutdown.started")
    from src.services.leader import leader
    await leader.release()
    await ingest.stop()
    await ws_manager.close_all()
    from src.services.market import _http
    if _http and not _http.is_closed:
        await _http.aclose()
    # LLM 신호 공유 클라이언트 정리
    try:
        from src.services.llm_signal import aclose as _llm_aclose
        await _llm_aclose()
    except Exception:
        pass
    # Redis 풀 리셋 (루프 안전)
    from src.services.redis_cache import reset_redis_pool as _rr1
    from src.db.redis import reset_redis_pool as _rr2
    _rr1(); _rr2()
    logger.info("shutdown.complete")

app = FastAPI(title="AI Chart Analysis OS", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

# CORS — src/middleware/cors.py로 분리
# 운영에서 CORS_ORIGINS 미설정 시 기동 실패 (ENV=prod일 때)
from src.middleware.cors import register as _register_cors
_register_cors(app, logger=logger)

# GZip 압축 (1KB 이상 응답) — src/middleware/compression.py로 분리
from src.middleware.compression import register as _register_gzip
_register_gzip(app)

# Brotli 압축 (gzip보다 20% 작음) — src/middleware/brotli.py로 분리
from src.middleware.brotli import register as _register_brotli
_register_brotli(app)


# 정적 파일 캐시 제어 — src/middleware/static_cache.py로 분리
from src.middleware.static_cache import register as _register_static_cache
_register_static_cache(app)
logger.info("worker.started", pid=os.getpid())

# 기능별 환경변수 상태 요약 로깅 (값 없이 활성 여부만)
from src.services.env_check import log_feature_status as _log_feature_status, enforce_prod_requirements as _enforce_prod
_log_feature_status(logger)
# 프로덕션 필수 환경변수 검증 (누락 시 기동 중단)
_enforce_prod(logger)

# ── Rate Limiting ──
# 차트 서비스는 1페이지 로드에 6~10개 endpoint 호출 + 실시간 갱신 + 다중 패널 폴링
# (워치리스트/히트맵/인기TOP/추세강도/포지션 등). 정상 사용에서도 분당 요청이 많아
# 600/min 은 false 429(요청이 많습니다)를 유발 → 2000/min 으로 상향.
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
limiter = Limiter(key_func=get_remote_address, default_limits=["2000/minute"], headers_enabled=True)

# ── 모니터링: 요청 추적 + 에러 수집 ──
from src.services.monitoring import metrics, generate_request_id
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
# default_limits 가 모든 라우트에 자동 적용되도록 미들웨어 등록
app.add_middleware(SlowAPIMiddleware)

# 쿠키 → Authorization 헤더 변환 — src/middleware/cookie_auth.py로 분리
from src.middleware.cookie_auth import register as _register_cookie_auth
_register_cookie_auth(app)


# CSRF Double Submit Cookie 검증 — src/middleware/csrf.py로 분리
from src.middleware.csrf import register as _register_csrf
_register_csrf(app)

# 요청 바디 크기 제한 (1MB) — src/middleware/body_size.py로 분리
from src.middleware.body_size import register as _register_body_size
_register_body_size(app)

# 보안 헤더 + 요청 추적 + 점검모드 + 응답시간 — src/middleware/security.py로 분리
from src.middleware.security import register as _register_security
_register_security(app, generate_request_id=generate_request_id, metrics=metrics, logger=logger)

# 방문 추적 + Rate Limit — src/middleware/track_visits.py 및 src/services/visit_tracker.py로 분리
from src.middleware.track_visits import register as _register_track_visits
_register_track_visits(app)

# API 라우터
from src.api import auth, symbols, charts, watchlists, layouts, alerts, analysis, trading, site
from src.api import portfolio
from src.api import paper_trading
from src.api import qsignal
from src.api import signal_board
app.include_router(auth.router, prefix="/v1/auth", tags=["Auth"])
app.include_router(site.router, prefix="/v1/site", tags=["Site"])
app.include_router(symbols.router, prefix="/v1", tags=["Symbols"])
app.include_router(charts.router, prefix="/v1/charts", tags=["Charts"])
app.include_router(qsignal.router, prefix="/v1/charts", tags=["QSignal"])
app.include_router(watchlists.router, prefix="/v1/watchlists", tags=["Watchlists"])
app.include_router(layouts.router, prefix="/v1/layouts", tags=["Layouts"])
app.include_router(alerts.router, prefix="/v1/alerts", tags=["Alerts"])
app.include_router(analysis.router, prefix="/v1/analysis", tags=["AI Analysis"])
app.include_router(trading.router, prefix="/v1/trading", tags=["Auto Trading"])
app.include_router(portfolio.router, prefix="/v1/portfolio", tags=["Portfolio"])
app.include_router(paper_trading.router)  # /v1/paper/* (prefix는 router에 정의)
app.include_router(signal_board.router)  # /v1/signals/* (prefix는 router에 정의)
from src.api.referral import router as referral_router
from src.api.purchases import router as purchases_router
app.include_router(referral_router, prefix="/v1", tags=["Referral"])
app.include_router(purchases_router, prefix="/v1", tags=["Purchases"])
from src.api.points import router as points_router
app.include_router(points_router, prefix="/v1", tags=["Points"])  # /v1/points/*
from src.api.admin_roles import router as admin_roles_router
app.include_router(admin_roles_router, prefix="/v1", tags=["AdminRoles"])  # /v1/admin-roles/*
from src.api.plans import router as plans_router
app.include_router(plans_router, prefix="/v1", tags=["Plans"])  # /v1/plans/*
from src.api.toss_payments import router as toss_router
app.include_router(toss_router, prefix="/v1", tags=["Toss Payments"])  # /v1/toss/*
from src.api.llm_signal import router as llm_signal_router
app.include_router(llm_signal_router, prefix="/v1", tags=["LLM Signal"])  # /v1/llm-signal/*

# 보안: 소스 코드 보호 (chart-engine + 서버 파일) — src/middleware/source_protection.py로 분리
from src.middleware.source_protection import register as _register_source_protection
_register_source_protection(app)

# WebSocket 엔드포인트
@app.websocket("/v1/ws")
async def websocket_endpoint(ws: WebSocket):
    conn_id = await ws_manager.connect(ws)
    if not conn_id:
        return
    try:
        while True:
            data = await ws.receive_json()
            await ws_manager.handle_message(conn_id, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(conn_id)
    except Exception:
        ws_manager.disconnect(conn_id)

# /health — src/api/ops/health.py 로 분리
from src.api.ops.health import router as _health_router
app.include_router(_health_router, tags=["Ops"])

# /v1/ops/* 및 /v1/debug/* 엔드포인트 — src/api/ops/ops.py 로 분리
from src.api.ops.ops import router as _ops_router
app.include_router(_ops_router, tags=["Ops"])

@app.get("/favicon.ico")
async def favicon():
    return FileResponse("static/favicon.svg", media_type="image/svg+xml")

@app.get("/robots.txt")
async def robots():
    return FileResponse("static/robots.txt", media_type="text/plain")

@app.get("/sitemap.xml")
async def sitemap():
    return FileResponse("static/sitemap.xml", media_type="application/xml")

@app.get("/privacy")
async def privacy():
    return FileResponse("static/privacy.html")

@app.get("/manifest.json")
async def manifest():
    return FileResponse("static/manifest.json", media_type="application/json")

@app.get("/admin")
async def admin(request: _Req):
    """관리자 로그인 — 403 + HTML 로그인 폼."""
    return HTMLResponse('''<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin — BEOM ON AI</title>
<link rel="preload" href="/static/fonts/pretendard/PretendardVariable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/fonts/pretendard/pretendard.css">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --color-primary:#921230;
  --color-primary-hover:#6F0E24;
  --color-bg:#F7F1EA;
  --color-surface-raised:#FFFDF9;
  --color-text-primary:#3D2B1F;
  --color-text-secondary:#6B5B50;
  --color-border:rgba(216,182,106,0.25);
  --color-border-strong:rgba(216,182,106,0.5);
  --color-error:#A8334B;
  --shadow-md:0 4px 12px rgba(146,18,48,0.08);
}
body{
  background:var(--color-bg);color:var(--color-text-primary);
  font-family:'Pretendard Variable','Pretendard',-apple-system,sans-serif;
  display:flex;align-items:center;justify-content:center;
  min-height:100vh;padding:24px;letter-spacing:-0.01em;
  -webkit-font-smoothing:antialiased
}
.box{
  background:var(--color-surface-raised);border:1px solid var(--color-border);
  border-radius:12px;padding:40px 32px;max-width:360px;width:100%;
  box-shadow:var(--shadow-md);text-align:center
}
.box h2{
  font-size:20px;font-weight:700;color:var(--color-primary);
  margin-bottom:8px;letter-spacing:-0.02em
}
.box .sub{font-size:13px;color:var(--color-text-secondary);margin-bottom:24px}
.box label{
  display:block;text-align:left;font-size:13px;font-weight:500;
  color:var(--color-text-secondary);margin:12px 0 4px
}
.box input{
  width:100%;padding:10px 12px;background:var(--color-surface-raised);
  border:1px solid var(--color-border-strong);border-radius:8px;color:var(--color-text-primary);
  font-size:14px;font-family:inherit;outline:none;
  transition:border-color 0.15s,box-shadow 0.15s
}
.box input:focus{
  border-color:var(--color-primary);
  box-shadow:0 0 0 3px rgba(146,18,48,0.15)
}
.box button{
  width:100%;padding:10px;margin-top:20px;
  background:var(--color-primary);color:var(--color-surface-raised);border:none;
  border-radius:8px;cursor:pointer;font-weight:600;font-size:14px;
  font-family:inherit;transition:background 0.15s
}
.box button:hover{background:var(--color-primary-hover)}
.box button:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}
#msg{font-size:12px;color:var(--color-error);margin-top:12px;min-height:16px}
@media(max-width:480px){
  body{padding:16px}
  .box{padding:28px 20px}
  .box h2{font-size:18px}
}
</style></head>
<body><div class="box">
  <h2> 관리자 로그인</h2>
  <div class="sub">BEOM ON AI 관리 콘솔</div>
  <label for="k">Admin Key</label>
  <input id="k" type="password" placeholder="관리자 키" autocomplete="off">
  <label for="pw">Password</label>
  <input id="pw" type="password" placeholder="비밀번호" autocomplete="current-password">
  <button onclick="go()">로그인</button>
  <p id="msg"></p>
</div>
<script>async function go(){const k=document.getElementById('k').value;const pw=document.getElementById('pw').value;if(!k||!pw)return;
const r=await fetch('/v1/auth/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:k,password:pw})});
if(r.ok){window.location.href='/admin/dashboard'}
else if(r.status===429){document.getElementById('msg').textContent='잠금 상태입니다. 잠시 후 다시 시도하세요.'}
else{document.getElementById('msg').textContent='인증 실패'}}
document.querySelectorAll('input').forEach(i=>i.addEventListener('keydown',e=>{if(e.key==='Enter')go()}))</script>
</body></html>''', status_code=403)

@app.get("/admin/dashboard")
async def admin_dashboard_page(request: _Req):
    """관리자 대시보드 — admin 세션 쿠키 필수 (Redis 검증)."""
    from src.api.auth import _verify_admin_cookie_async
    if not await _verify_admin_cookie_async(request):
        raise HTTPException(403, "Forbidden")
    from starlette.responses import FileResponse as _FR
    resp = _FR("templates/admin.html")
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return resp





@app.get("/chart/{symbol}")
async def chart_page(symbol: str):
    """종목별 전용 URL — SEO/공유 미리보기(OG·Twitter 카드)용 서버 렌더 메타태그 포함.

    보안: symbol은 반드시 화이트리스트 정규식(영문 대문자+숫자, 2~20자)을 통과해야
    한다. HTML에 그대로 삽입되므로, 통과하지 못하면 기본 index.html로 폴백해
    사용자 입력이 마크업에 섞여 들어가는 것(HTML/속성 인젝션)을 원천 차단한다.
    """
    import re as _re
    import os as _os
    from starlette.responses import FileResponse, HTMLResponse

    _base_url = _os.environ.get("PUBLIC_BASE_URL", "https://chart.beomonnuri.com").rstrip("/")
    if not _re.match(r'^[A-Z0-9]{2,20}$', symbol.upper()):
        return FileResponse("static/index.html")

    with open("static/index.html", "r", encoding="utf-8") as f:
        html = f.read()

    sym = symbol.upper()
    base = sym[:-4] if sym.endswith("USDT") else sym
    page_title = f"{base}/USDT 실시간 차트 — 범온 AI 슈퍼차트"
    og_title = f"{base}/USDT 실시간 차트 — 범온 AI 슈퍼차트"
    og_desc = f"{base}/USDT 실시간 차트와 AI 분석, 범온 독자 지표(범온캔들·거래밀집구간 등)를 한 화면에서 확인하세요."
    canonical_url = f"{_base_url}/chart/{symbol.lower()}"

    html = html.replace(
        "<title>범온 AI 슈퍼차트 — 160+ 종목 실시간 AI 차트 분석 · 독자 지표 · 자동 시그널</title>",
        f"<title>{page_title}</title>",
        1,
    )
    html = html.replace(
        '<meta property="og:title" content="범온 AI 슈퍼차트 — 실시간 암호화폐 AI 차트 분석">',
        f'<meta property="og:title" content="{og_title}">',
        1,
    )
    html = html.replace(
        '<meta property="og:description" content="실시간 암호화폐·주식 차트 + AI 분석. 50+ 보조지표와 올인원 트레이딩 플랫폼.">',
        f'<meta property="og:description" content="{og_desc}">',
        1,
    )
    html = html.replace(
        '<meta property="og:url" content="https://chart.beomonnuri.com/">',
        f'<meta property="og:url" content="{canonical_url}">',
        1,
    )
    html = html.replace(
        '<meta name="twitter:title" content="범온 AI 슈퍼차트">',
        f'<meta name="twitter:title" content="{og_title}">',
        1,
    )
    html = html.replace(
        '<meta name="twitter:description" content="실시간 암호화폐 AI 차트 분석 플랫폼">',
        f'<meta name="twitter:description" content="{og_desc}">',
        1,
    )
    html = html.replace(
        f'<link rel="canonical" href="{_base_url}/">',
        f'<link rel="canonical" href="{canonical_url}">',
        1,
    )

    # 정적 자산 캐시 버스팅
    import time as _time
    build_ver = _os.environ.get("BUILD_VER")
    if not build_ver:
        try:
            # static/js 하위 .js 중 가장 최근 수정시각 + index.html → 어떤 JS를 고쳐도 ?v= 자동 갱신
            _mt = _os.path.getmtime("static/index.html")
            for _root, _dirs, _files in _os.walk("static/js"):
                for _f in _files:
                    if _f.endswith(".js"):
                        _m = _os.path.getmtime(_os.path.join(_root, _f))
                        if _m > _mt:
                            _mt = _m
            build_ver = str(int(_mt))
        except Exception:
            build_ver = str(int(_time.time()))
    html = _re.sub(r'\?v=[A-Za-z0-9._-]+', f'?v={build_ver}', html)
    # dynamic import (e.g. await import('./compare.js')) 도 캐시 무효화되도록 window._buildVer 주입
    html = html.replace(
        '</head>',
        f'<script>window._buildVer="{build_ver}";</script></head>',
        1,
    )
    return HTMLResponse(
        html,
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@app.get("/faq")
async def faq():
    return FileResponse("static/faq.html")

@app.get("/terms")
async def terms():
    return FileResponse("static/terms.html")


@app.get("/notice")
async def notice():
    return FileResponse("static/notice.html")
@app.get("/reset")
async def reset_browser_state():
    """브라우저의 모든 사이트 데이터 강제 삭제 (쿠키/캐시/SW).
    
    사용자가 /reset 에 접속하면:
    1) Clear-Site-Data 헤더로 브라우저가 자동으로
       쿠키/캐시/Storage/executionContexts 삭제
    2) 간단한 HTML 반환 후 2초 뒤 / 로 이동
    
    로그인 문제나 캐시 오염 등 비상 시 사용.
    """
    from starlette.responses import HTMLResponse
    html = '''<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta http-equiv="refresh" content="2; url=/">
<title>초기화 중...</title>
<style>
body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
     min-height:100vh;margin:0;background:#F7F1EA;color:#3D2B1F;text-align:center}
.box{padding:32px;background:#FFFDF9;border-radius:12px;
     box-shadow:0 4px 12px rgba(146,18,48,0.1);max-width:400px}
h2{color:#921230;margin:0 0 12px}
p{color:#6B5B50;margin:0;font-size:14px;line-height:1.6}
</style></head>
<body>
<div class="box">
  <h2>브라우저 상태 초기화 완료</h2>
  <p>쿠키 · 캐시 · Service Worker 모두 제거되었습니다.<br>
  2초 후 메인 페이지로 이동합니다...</p>
</div>
</body></html>'''
    return HTMLResponse(
        html,
        headers={
            # 브라우저가 이 origin 의 모든 데이터를 삭제
            "Clear-Site-Data": '"cache", "cookies", "storage", "executionContexts"',
            "Cache-Control": "no-cache, no-store, must-revalidate",
        },
    )


def _index_response():
    """index.html + 자동 캐시 버스팅 응답을 생성한다.

    GET/HEAD 모두 같은 라우트 계약을 공유해 도메인/업타임 모니터가
    HEAD / 를 사용할 때 405로 오탐하지 않도록 한다.
    """
    try:
        with open("static/index.html", "r", encoding="utf-8") as f:
            html = f.read()
        # 빌드 버전 — 환경변수 우선, 없으면 파일 mtime 기반 타임스탬프
        import os as _os
        import time as _time
        build_ver = _os.environ.get("BUILD_VER")
        if not build_ver:
            try:
                _mt = _os.path.getmtime("static/index.html")
                for _root, _dirs, _files in _os.walk("static/js"):
                    for _f in _files:
                        if _f.endswith(".js"):
                            _m = _os.path.getmtime(_os.path.join(_root, _f))
                            if _m > _mt:
                                _mt = _m
                build_ver = str(int(_mt))
            except Exception:
                build_ver = str(int(_time.time()))
        # 모든 ?v=... 쿼리를 현재 빌드 버전으로 덮어씀
        import re as _re
        html = _re.sub(r'\?v=[A-Za-z0-9._-]+', f'?v={build_ver}', html)
        # dynamic import 캐시 무효화용 window._buildVer 주입
        html = html.replace(
            '</head>',
            f'<script>window._buildVer="{build_ver}";</script></head>',
            1,
        )
        from starlette.responses import HTMLResponse
        return HTMLResponse(
            html,
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
    except Exception:
        # fallback
        return FileResponse("static/index.html")


@app.get("/")
async def index():
    """루트: index.html + 자동 캐시 버스팅.
    
    BUILD_VER(환경변수 또는 현재 시간 분 단위)를 ?v= 쿼리에 주입해
    정적 자산 브라우저 캐시를 우회. SW도 별도 CACHE_VER로 관리.
    """
    return _index_response()


@app.head("/")
async def index_head():
    """도메인/업타임 모니터와 프록시 사전 확인용 HEAD 지원."""
    return _index_response()

@app.get("/static/admin.html")
async def block_static_admin():
    raise HTTPException(404, "Not found")

@app.get("/landing")
async def landing():
    """랜딩 페이지 — 서비스 소개."""
    return FileResponse("static/landing.html")

@app.get("/chart")
async def chart_app():
    """차트 앱 직접 진입."""
    return _index_response()

app.mount("/static", StaticFiles(directory="static"), name="static")

# ── 에러 핸들링 ──
def _ERR_PAGE(code, msg):
    """공통 에러 페이지 (404, 500 등)."""
    # 정적 HTML 파일 사용 (디자인 일관성)
    from starlette.responses import FileResponse
    import os.path
    file_path = f"static/{code}.html"
    if os.path.isfile(file_path):
        return FileResponse(file_path, status_code=code, media_type="text/html")
    # fallback: 인라인 HTML
    return HTMLResponse(f'''<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{code} — 범온 AI 슈퍼차트</title>
<style>body{{font-family:sans-serif;text-align:center;padding:48px;color:#3D2B1F}}h1{{font-size:48px;color:#921230}}</style>
</head><body><h1>{code}</h1><p>{msg}</p><a href="/">메인으로 →</a></body></html>''', status_code=code)


@app.exception_handler(404)
async def not_found(request, exc):
    if request.url.path.startswith("/v1/"):
        # exc.detail 이 명시적이면 그것 사용 (etc. resolve_symbol 의 '등록되지 않은 심볼')
        msg = "요청한 리소스를 찾을 수 없습니다"
        if hasattr(exc, "detail") and isinstance(exc.detail, str) and exc.detail and exc.detail != "Not Found":
            msg = exc.detail
        return JSONResponse(status_code=404, content={"success": False, "error": {"code": "NOT_FOUND", "message": msg}})
    return _ERR_PAGE(404, "페이지를 찾을 수 없습니다")

from fastapi.exceptions import RequestValidationError
from fastapi import HTTPException as _HTTPException

@app.exception_handler(_HTTPException)
async def http_exception_handler(request, exc):
    """HTTPException 일관된 응답 형식. /v1/ 만 ApiResponse 형식 적용."""
    code_map = {
        400: "BAD_REQUEST",
        401: "UNAUTHORIZED",
        403: "FORBIDDEN",
        404: "NOT_FOUND",
        409: "CONFLICT",
        429: "RATE_LIMITED",
    }
    if request.url.path.startswith("/v1/"):
        # detail 이 dict 면 그대로, 문자열이면 message 로 wrap
        detail = exc.detail if isinstance(exc.detail, dict) else {"code": code_map.get(exc.status_code, "ERROR"), "message": str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content={"success": False, "error": detail})
    # /v1/ 외 (HTML 페이지 등)는 기본 동작
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(str(exc.detail), status_code=exc.status_code)

@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    errors = exc.errors()
    def _loc(e):
        loc = e.get("loc") or [""]
        return str(loc[-1]) if loc else ""
    msg = "; ".join(f"{_loc(e)}: {e.get('msg','')}" for e in errors[:3])
    return JSONResponse(status_code=422, content={"success": False, "error": {"code": "VALIDATION_ERROR", "message": msg}})


def _iter_exc_chain(exc):
    """ExceptionGroup/원인 체인을 펼쳐 dependency outage 판별에 사용."""
    seen = set()
    stack = [exc]
    while stack:
        cur = stack.pop()
        if cur is None or id(cur) in seen:
            continue
        seen.add(id(cur))
        yield cur
        stack.extend(getattr(cur, "exceptions", ()) or ())
        stack.append(getattr(cur, "__cause__", None))
        stack.append(getattr(cur, "__context__", None))


def _dependency_outage(exc):
    """DB/Redis 등 외부 의존성 장애를 내부 서버 오류와 구분한다."""
    transient_types = {
        "ConnectionRefusedError", "ConnectionError", "OperationalError",
        "TimeoutError", "CannotConnectNowError", "PostgresConnectionError",
    }
    transient_markers = (
        "connection refused", "connect call failed", "connection is closed",
        "could not connect", "error 111 connecting", "[errno 111]",
        "localhost:5432", "localhost:6379", "postgres", "redis",
    )
    for item in _iter_exc_chain(exc):
        type_name = type(item).__name__
        module = type(item).__module__.lower()
        message = str(item).lower()
        if type_name in transient_types and (
            "redis" in module or "asyncpg" in module or "sqlalchemy" in module or "builtins" in module
        ):
            return True
        if any(marker in message for marker in transient_markers):
            return True
    return False


def _service_unavailable_response(request, exc):
    if not request.url.path.startswith("/v1/"):
        return None
    logger.warning(
        "dependency_unavailable",
        method=request.method,
        path=request.url.path,
        exc_type=type(exc).__name__,
        error=str(exc)[:200],
    )
    return JSONResponse(
        status_code=503,
        content={
            "success": False,
            "error": {
                "code": "SERVICE_DEGRADED",
                "message": "일시적으로 데이터 저장소 또는 캐시 연결이 불안정합니다. 잠시 후 다시 시도해주세요.",
            },
        },
        headers={"Retry-After": "30"},
    )


@app.exception_handler(500)
async def server_error(request, exc):
    if _dependency_outage(exc):
        degraded = _service_unavailable_response(request, exc)
        if degraded is not None:
            return degraded
    logger.error("500_error", method=request.method, path=request.url.path, error=str(exc), exc_info=True)
    if request.url.path.startswith("/v1/"):
        return JSONResponse(status_code=500, content={"success": False, "error": {"code": "INTERNAL_ERROR", "message": "Internal server error"}})
    return _ERR_PAGE(500, "서버 오류가 발생했습니다")


# 모든 미처리 예외 — traceback/내부 메시지 노출 차단
@app.exception_handler(Exception)
async def unhandled_exception(request, exc):
    """예상치 못한 예외를 일반 메시지로 wrap. traceback 은 서버 로그에만."""
    if _dependency_outage(exc):
        degraded = _service_unavailable_response(request, exc)
        if degraded is not None:
            return degraded
    logger.error(
        "unhandled_exception",
        method=request.method,
        path=request.url.path,
        exc_type=type(exc).__name__,
        error=str(exc)[:200],
        exc_info=True,
    )
    if request.url.path.startswith("/v1/"):
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": {"code": "INTERNAL_ERROR", "message": "Internal server error"}},
        )
    return _ERR_PAGE(500, "서버 오류가 발생했습니다")
