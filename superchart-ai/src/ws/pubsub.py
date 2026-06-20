"""Redis Pub/Sub 메시지 브로커 — ingest ↔ WS 서버 간 통신."""
import json
import redis.asyncio as aioredis
from src.config import settings

CHANNEL_CANDLE = "beomon:candle"
CHANNEL_TICKER = "beomon:ticker"

_redis_pub: aioredis.Redis | None = None
_redis_sub: aioredis.Redis | None = None


async def get_publisher() -> aioredis.Redis:
    """발행용 Redis 연결 (ingest/API에서 사용)."""
    global _redis_pub
    if _redis_pub is None:
        _redis_pub = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis_pub


async def get_subscriber() -> aioredis.Redis:
    """구독용 Redis 연결 (WS 서버에서 사용)."""
    global _redis_sub
    if _redis_sub is None:
        _redis_sub = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis_sub


async def publish_candle(candle: dict):
    """캔들 데이터를 Redis 채널에 발행."""
    r = await get_publisher()
    await r.publish(CHANNEL_CANDLE, json.dumps(candle, default=str))


async def publish_ticker(ticker: dict):
    """티커 데이터를 Redis 채널에 발행."""
    r = await get_publisher()
    await r.publish(CHANNEL_TICKER, json.dumps(ticker, default=str))


async def subscribe_loop(on_candle_cb, on_ticker_cb):
    """Redis 채널 구독 루프 (WS 서버에서 실행)."""
    r = await get_subscriber()
    pubsub = r.pubsub()
    await pubsub.subscribe(CHANNEL_CANDLE, CHANNEL_TICKER)

    async for message in pubsub.listen():
        if message["type"] != "message":
            continue
        try:
            data = json.loads(message["data"])
            channel = message["channel"]
            if channel == CHANNEL_CANDLE:
                await on_candle_cb(data)
            elif channel == CHANNEL_TICKER:
                await on_ticker_cb(data)
        except Exception:
            pass
