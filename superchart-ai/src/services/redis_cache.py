"""Redis shared cache — in-memory dict 캐시 대체."""
import orjson
import structlog
import redis.asyncio as aioredis
from src.config import settings

logger = structlog.get_logger(__name__)
_pool: aioredis.Redis | None = None
_PREFIX = "co:"


def _redis() -> aioredis.Redis:
    global _pool
    if _pool is None:
        _pool = aioredis.from_url(settings.redis_url, decode_responses=False)
    return _pool


def reset_redis_pool():
    """루프 변경 시 풀 리셋 (테스트/재시작 안전)."""
    global _pool
    _pool = None


async def cache_get(namespace: str, key: str):
    """캐시 조회. 히트 시 파싱된 데이터, 미스 시 None."""
    try:
        raw = await _redis().get(f"{_PREFIX}{namespace}:{key}")
        if raw:
            return orjson.loads(raw)
        return None
    except Exception as e:
        logger.debug("cache_get.fail", namespace=namespace, key=str(key)[:80], error=str(e)[:100])
        return None


async def cache_set(namespace: str, key: str, data, ttl: int = 120):
    """캐시 저장. ttl 초 후 자동 만료."""
    try:
        await _redis().set(f"{_PREFIX}{namespace}:{key}", orjson.dumps(data, default=str), ex=ttl)
    except Exception as e:
        logger.debug("cache_set.fail", namespace=namespace, key=str(key)[:80], ttl=ttl, error=str(e)[:100])


# ── 구버전 시그니처 호환 별칭 (ttl 인자 포함) ─────────────
# charts/qsignal/charts_indicators 에서 쓰던 이름. 순환 import 방지를 위해
# 이곳에 통합됨 (기존엔 src/api/charts.py 에 정의되어 있었음).

async def _get_cached(name: str, key: str, ttl: int):
    """하위 호환: ttl 인자는 무시 (조회에는 영향 없음). cache_get 위임."""
    return await cache_get(name, key)


async def _set_cached(name: str, key: str, data, ttl: int = 120):
    """하위 호환: cache_set 위임."""
    await cache_set(name, key, data, ttl)