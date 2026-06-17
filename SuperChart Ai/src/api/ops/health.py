"""헬스체크 엔드포인트.

DB, Redis, Ingest freshness, Leader 상태를 한 번에 확인합니다.
ELB/L7 로드밸런서 health check 용도. 인증 불필요.
"""
import os
import time as _time
from urllib.parse import urlparse

from fastapi import APIRouter, Request
import structlog

logger = structlog.get_logger(__name__)

router = APIRouter()


def _truthy_env(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


def _is_local_host(hostname: str | None) -> bool:
    if not hostname:
        return True
    return hostname in {"localhost", "127.0.0.1", "::1"}


def _is_default_local_db_url(raw_env_value: str, resolved_url: str) -> bool:
    # DATABASE_URL 미설정 상태에서 기본 localhost 값을 쓰는 경우를 구분
    if raw_env_value:
        return False
    parsed = urlparse(resolved_url)
    return _is_local_host(parsed.hostname)


def _is_default_local_redis_url(raw_env_value: str, resolved_url: str) -> bool:
    if raw_env_value:
        return False
    parsed = urlparse(resolved_url)
    return _is_local_host(parsed.hostname)


@router.get("/health")
async def health(request: Request):
    """앱 전체 헬스체크.

    Response:
      status: ok | degraded
      version: 앱 버전
      ws_connections: 현재 WebSocket 연결 수
      pid: 프로세스 ID
      db: ok | error message
      redis: ok | unavailable
      ingest_age_sec: 마지막 캔들 수신 경과 초 (120초 넘으면 degraded)
      leader: 현재 워커가 리더인지
    """
    # ws_manager 는 main.py 기동 시 import 되므로 지연 import (순환 방지)
    from src.ws.gateway import ws_manager

    checks = {
        "status": "ok",
        "version": "0.1.0",
        "ws_connections": ws_manager.connection_count,
        "pid": os.getpid(),
    }

    # DB
    from src.config import settings

    raw_db_env = os.getenv("DATABASE_URL", "").strip()
    require_db = _truthy_env("HEALTH_REQUIRE_DB")
    db_is_default_local = _is_default_local_db_url(raw_db_env, settings.database_url)

    if db_is_default_local and not require_db:
        checks["db"] = "not_configured"
    else:
        try:
            from src.db.session import SessionLocal
            from sqlalchemy import text
            async with SessionLocal() as db:
                await db.execute(text("SELECT 1"))
            checks["db"] = "ok"
        except Exception as e:
            checks["db"] = f"error: {e}"
            checks["status"] = "degraded"

    # Redis
    raw_redis_env = os.getenv("REDIS_URL", "").strip()
    require_redis = _truthy_env("HEALTH_REQUIRE_REDIS")
    redis_is_default_local = _is_default_local_redis_url(raw_redis_env, settings.redis_url)

    if redis_is_default_local and not require_redis:
        checks["redis"] = "not_configured"
    else:
        try:
            import redis.asyncio as aioredis
            r = aioredis.from_url(settings.redis_url)
            await r.ping()
            await r.aclose()
            checks["redis"] = "ok"
        except Exception:
            checks["redis"] = "unavailable"
            if checks["status"] == "ok":
                checks["status"] = "degraded"

    # Ingest freshness (app.state.ingest_stats 에서 조회)
    st = getattr(request.app.state, "ingest_stats", None) or {}
    last_c = st.get("last_candle_at", 0)
    age = round(_time.time() - last_c, 1) if last_c else None
    checks["ingest_age_sec"] = age
    if age and age > 120:
        checks["status"] = "degraded"

    # Leader
    try:
        from src.services.leader import leader
        checks["leader"] = leader.is_leader
    except Exception as e:
        logger.debug("health.leader_check_fail", error=str(e)[:100])
        checks["leader"] = False

    return checks
