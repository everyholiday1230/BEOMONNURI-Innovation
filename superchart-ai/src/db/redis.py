"""Redis 클라이언트 — admin 세션 + 캐시."""
import redis.asyncio as aioredis
import os

_pool = None

async def redis_client():
    global _pool
    if _pool is None:
        url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        _pool = aioredis.from_url(url, decode_responses=True)
    return _pool

def reset_redis_pool():
    """루프 변경 시 풀 리셋."""
    global _pool
    _pool = None
