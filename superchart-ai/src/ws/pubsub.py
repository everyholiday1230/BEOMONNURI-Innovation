"""Redis Pub/Sub 메시지 브로커 — ingest ↔ WS 서버 간 통신."""
import json as _json_std
import redis.asyncio as aioredis
from src.config import settings

try:
    import orjson as _json
except Exception:  # pragma: no cover
    _json = None


def _dumps(obj: dict) -> str:
    if _json is not None:
        return _json.dumps(obj).decode()
    return _json_std.dumps(obj, default=str)


def _loads(raw: str):
    if _json is not None:
        return _json.loads(raw)
    return _json_std.loads(raw)

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
    await r.publish(CHANNEL_CANDLE, _dumps(candle))


async def publish_ticker(ticker: dict):
    """티커 데이터를 Redis 채널에 발행."""
    r = await get_publisher()
    await r.publish(CHANNEL_TICKER, _dumps(ticker))


async def subscribe_loop(on_candle_cb, on_ticker_cb):
    """Redis 채널 구독 루프 (WS 서버에서 실행)."""
    r = await get_subscriber()
    pubsub = r.pubsub(ignore_subscribe_messages=True)
    await pubsub.subscribe(CHANNEL_CANDLE, CHANNEL_TICKER)

    async for message in pubsub.listen():
        if message.get("type") != "message":
            continue
        try:
            data = _loads(message["data"])
            channel = message["channel"]
            if channel == CHANNEL_CANDLE:
                await on_candle_cb(data)
            elif channel == CHANNEL_TICKER:
                await on_ticker_cb(data)
        except Exception:
            # malformed 메시지는 무시하고 다음 메시지 처리
            continue
