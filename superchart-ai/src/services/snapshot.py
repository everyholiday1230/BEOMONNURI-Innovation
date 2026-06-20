"""공통 계산 결과 snapshot — 여러 endpoint가 동일 candles에 대해 재사용."""
from src.services.redis_cache import cache_get, cache_set


async def get_snapshot(symbol: str, tf: str, candles: list[dict], component: str):
    """캐시된 계산 결과 반환. 미스 시 계산 후 캐시."""
    key = f"{symbol}:{tf}:{len(candles)}"
    cached = await cache_get(f"snap:{component}", key)
    if cached is not None:
        return cached

    result = _compute(component, candles)
    await cache_set(f"snap:{component}", key, result, ttl=60)
    return result


def _compute(component: str, candles: list[dict]):
    if component == "ultra_trend":
        from src.services.beom_candle import compute_ultra_trend
        return compute_ultra_trend(candles)
    elif component == "order_blocks":
        from src.services.trade_zone import compute_order_blocks
        return compute_order_blocks(candles)
    elif component == "trendlines":
        from src.services.trendlines import compute_trendlines
        return compute_trendlines(candles)
    elif component == "vwap_cluster":
        from src.services.vwap_ma_cluster import compute_vwap_ma_cluster
        return compute_vwap_ma_cluster(candles, 122)
    elif component == "trade_pressure":
        from src.services.trade_pressure import compute_trade_pressure
        return compute_trade_pressure(candles)
    elif component == "capital_flow":
        from src.services.trade_pressure import compute_capital_flow
        return compute_capital_flow(candles)
    return {}
