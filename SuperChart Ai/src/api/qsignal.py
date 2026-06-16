"""Q-Signal API — 멀티팩터 퀀트매매 신호 엔드포인트."""
from fastapi import APIRouter, Request
from src.models.schemas import ApiResponse
from src.services.market import fetch_candles
from src.services.symbol_resolver import resolve_symbol
from src.services.redis_cache import _get_cached, _set_cached
from src.services.beom_free import get_user_tier

router = APIRouter()


@router.get("/qsignal", response_model=ApiResponse)
async def get_qsignal(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, ver: str = "std"):
    """Q-Signal 멀티팩터 퀀트매매 신호. ver: safe/std/aggr"""
    if ver not in ("safe", "std", "aggr"): ver = "std"
    tier = await get_user_tier(request)
    if tier not in ("pro", "premium"):
        return ApiResponse(data={"_access": "pro_only"})
    key = f"qsig:{symbolId}:{timeframe}:{limit}:{ver}"
    cached = await _get_cached("qsig", key, 60)
    if cached is not None:
        return ApiResponse(data=cached)

    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles or len(candles) < 350:
        return ApiResponse(data={"signals": [], "regime_history": [], "debug": {"error": "insufficient_data"}})

    # Order Blocks
    from src.services.snapshot import get_snapshot
    obs_raw = await get_snapshot(symbolId, timeframe, candles, "order_blocks")
    bull_obs = obs_raw.get('bull', [])
    bear_obs = obs_raw.get('bear', [])

    # AI 예측 (청산/기대보상 평가용)
    ai_pred = None
    try:
        from src.services.ai_predict import predict
        ai_pred = predict(candles, symbol=symbolId)
    except Exception:
        pass

    from src.services.qsignal_engine import compute_qsignals
    result = compute_qsignals(
        candles, timeframe=timeframe,
        bull_obs=bull_obs, bear_obs=bear_obs, ai_pred=ai_pred, ver=ver)

    # numpy 직렬화 방지
    output = {
        'signals': result['signals'],
        'regime_history': result['regime_history'][-50:],  # 최근 50봉만
        'debug': result['debug'],
        'symbol': symbolId,
        'timeframe': timeframe,
    }

    await _set_cached("qsig", key, output, 60)
    return ApiResponse(data=output)
