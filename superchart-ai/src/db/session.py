"""DB 연결."""
import os
import time
import logging
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from src.config import settings


def _env_int(name: str, default: int) -> int:
    try:
        v = int(os.getenv(name, "") or default)
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default


# ── 커넥션 풀 크기 ────────────────────────────────────────────────
# Render basic-256mb Postgres 는 최대 100 connection. 앱은 uvicorn 단일
# 프로세스로 구동되므로, 한 프로세스가 풀을 과도하게 열면 DB 한도를 소진해
# "connection 초과 / ERR_CONNECTION_CLOSED" 를 유발한다.
# 256MB DB 기준 보수적으로 pool_size=10 + overflow=10 (최대 20)로 제한.
# 상위 DB 플랜으로 올릴 경우 환경변수로 확장.
_POOL_SIZE = _env_int("DB_POOL_SIZE", 10)
_MAX_OVERFLOW = _env_int("DB_MAX_OVERFLOW", 10)
_POOL_TIMEOUT = _env_int("DB_POOL_TIMEOUT", 30)

engine = create_async_engine(
    settings.database_url,
    pool_size=_POOL_SIZE,
    max_overflow=_MAX_OVERFLOW,
    pool_timeout=_POOL_TIMEOUT,
    pool_pre_ping=True,
    pool_recycle=1800,
)
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
    # 예외 발생 시 롤백을 보장해 세션 오염/커넥션 누수를 방지한다.
    # (기존: 예외가 나도 rollback 없이 세션이 닫혀 트랜잭션이 애매하게 남을 수 있었음)
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise

from contextlib import asynccontextmanager

@asynccontextmanager
async def get_db_context():
    """Depends 없이 사용 가능한 async context manager."""
    async with SessionLocal() as session:
        yield session
