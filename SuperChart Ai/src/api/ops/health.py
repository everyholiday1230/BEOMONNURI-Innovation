"""헬스체크 엔드포인트.

DB, Redis, Ingest freshness, Leader 상태를 한 번에 확인합니다.
ELB/L7 로드밸런서 health check 용도. 인증 불필요.
"""
import os
import time as _time

from fastapi import APIRouter, Request
import structlog

logger = structlog.get_logger(__name__)

router = APIRouter()


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
    try:
        import redis.asyncio as aioredis
        from src.config import settings
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
