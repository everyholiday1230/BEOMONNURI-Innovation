"""DB 연결."""
import time
import logging
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from src.config import settings

engine = create_async_engine(settings.database_url, pool_size=50, max_overflow=50, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ── 슬로우 쿼리 로깅 (1초 이상) ──
# pg_stat_statements 활성화가 어려운 환경에서 애플리케이션 레벨로 추적.
# 운영 모니터링 가시성 확보 + 비용 거의 없음 (event listener).
_SLOW_THRESHOLD_SEC = 1.0
_db_logger = logging.getLogger("db.slow_query")


@event.listens_for(engine.sync_engine, "before_cursor_execute")
def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    context._query_start = time.time()


@event.listens_for(engine.sync_engine, "after_cursor_execute")
def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    elapsed = time.time() - getattr(context, "_query_start", time.time())
    if elapsed >= _SLOW_THRESHOLD_SEC:
        # 첫 200자만 로그 (PII/거대 쿼리 방어)
        _db_logger.warning(
            f"slow_query elapsed={elapsed:.2f}s sql={statement[:200].replace(chr(10),' ')}"
        )

async def get_db():
    async with SessionLocal() as session:
        yield session

from contextlib import asynccontextmanager

@asynccontextmanager
async def get_db_context():
    """Depends 없이 사용 가능한 async context manager."""
    async with SessionLocal() as session:
        yield session
