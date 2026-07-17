"""차트 지표 API — Ultra Trend, UPRSI, Bimaco 등."""
from fastapi import APIRouter, Request
from src.models.schemas import ApiResponse
from src.services.market import fetch_candles
from src.services.symbol_resolver import resolve_symbol
from src.services.redis_cache import _get_cached, _set_cached
from time import time as import_time
from src.services.beom_free import (
    get_user_tier, get_delay_cutoff_ms, build_delay_meta,
)

router = APIRouter()

def _empty_delayed_response(tier: str):
    """지연 후 빈 캔들 — _delay 메타 포함 빈 응답."""
    return ApiResponse(data={"d": [], "s": [], "_delay": build_delay_meta(tier, get_delay_cutoff_ms())})


async def _check_purchase(request: Request, code: str) -> bool:
    """서버측 구매 권한 검증. 해당 code가 '판매 상품'으로 등록된 경우에만 검증.
    구매(paid) / beom_allowed / admin 이면 True. 미등록 상품은 True(기존 동작 유지)."""
    from src.db.session import SessionLocal
    from sqlalchemy import text
    from src.services.auth import decode_token
    # user_id 추출 (get_user_tier와 동일 방식)
    auth = request.headers.get("authorization", "")
    tok = auth[7:] if auth.startswith("Bearer ") else (request.cookies.get("auth_token") or "")
    uid = None
    if tok:
        try:
            uid = decode_token(tok).get("sub")
        except Exception:
            uid = None
    async with SessionLocal() as db:
        prod = (await db.execute(text(
            "SELECT 1 FROM indicator_products WHERE indicator_code=:c AND is_active=true"
        ), {"c": code})).fetchone()
        if not prod:
            return True  # 판매 상품 아님 → 게이트 없음
        if not uid:
            return False
        # ── 무료 체험 기간(FREE_TRIAL_MODE): 로그인 사용자에게 유료 지표 전면 개방 ──
        # 환경변수 on/off. 끄면 즉시 구매/권한 검증으로 복귀(영구 코드변경 X).
        import os as _os
        if _os.getenv("FREE_TRIAL_MODE", "").lower() in ("1", "true", "on", "yes"):
            return True
        row = (await db.execute(text("SELECT role, COALESCE(beom_allowed,false) FROM users WHERE id=:u"), {"u": uid})).fetchone()
        if row and (row[0] == "admin" or row[1]):
            return True
        paid = (await db.execute(text(
            "SELECT 1 FROM user_purchases WHERE user_id=:u AND indicator_code=:c AND status='paid'"
        ), {"u": uid, "c": code})).fetchone()
        return bool(paid)

from src.services.beom_candle import compute_ultra_trend

@router.get("/candles", response_model=ApiResponse)
async def get_candles(symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 1000, endTime: str = ""):
    """캔들(OHLCV) 데이터 조회. symbolId: 심볼코드, timeframe: 1m/5m/15m/1h/4h/1d, limit: 최대 10000."""
    import re as _re
    if not _re.match(r'^[A-Z0-9]{2,20}$', symbolId):
        return ApiResponse(data={"symbolId": symbolId[:20], "timeframe": timeframe, "candles": []})
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit, end_time=int(endTime) if endTime else None)
    return ApiResponse(data={"symbolId": symbolId, "timeframe": timeframe, "candles": candles})

@router.get("/ind-b", response_model=ApiResponse)
async def get_ultra_trend(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    """Ultra Trend 지표 — PRO 전용."""
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    if not await _check_purchase(request, "ultra"):
        return ApiResponse(data={"_access": "purchase_required", "indicator_code": "ultra"})
    key = f"{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("ut", key, 30)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"d": [], "s": []})
    result = compute_ultra_trend(candles)
    result['_delay'] = build_delay_meta(tier, 0)
    await _set_cached("ut", key, result, 30)
    return ApiResponse(data=result)

@router.get("/ind-l", response_model=ApiResponse)
async def get_v12_signals(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    """PRO 전략 시그널 오버레이 — 과거 차트에 진입/TP/SL 표시."""
    key = f"v12sig:{symbolId}:{limit}"
    cached = await _get_cached("v12sig", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles_5m = await fetch_candles(api_sym, exchange_id, "5m", max(limit, 2000))
    candles_1h = await fetch_candles(api_sym, exchange_id, "1h", 2000)
    if not candles_5m or not candles_1h:
        return ApiResponse(data={"signals": []})
    from src.services.backtest import run_backtest
    result = run_backtest(candles_5m, candles_1h=candles_1h)
    await _set_cached("v12sig", key, result, 120)
    return ApiResponse(data=result)

@router.get("/ind-a", response_model=ApiResponse)
async def get_uprsi_stc(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, ver: str = ""):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    key = f"{symbolId}:{timeframe}:{limit}:{ver}"
    cached = await _get_cached("us", key, 30)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={})
    from src.services.beom_sub import compute_uprsi_stc
    _uv = {
        '': {'rsi_period':60,'rsi_lookback':300,'stoch_len':14,'stoch_smoothK':9,'stoch_lookback':240,'rsi_smooth':3,'stc1_period':26,'stc_fast':50,'stc_slow':100,'stc2_period':100},
        'orig': {'rsi_period':60,'rsi_lookback':300,'stoch_len':60,'stoch_smoothK':9,'stoch_lookback':240,'stc1_period':26,'stc_fast':50,'stc_slow':100,'stc2_period':100},
        '1m': {'rsi_period':14,'rsi_lookback':400,'stoch_len':60,'stoch_smoothK':9,'stoch_lookback':400,'rsi_smooth':5,'stoch_smooth':7,'stc1_period':50,'stc_fast':40,'stc_slow':100,'stc2_period':100},
        '1y_old': {'rsi_period':60,'rsi_lookback':300,'stoch_len':14,'stoch_smoothK':9,'stoch_lookback':240,'rsi_smooth':3,'stc1_period':50,'stc_fast':23,'stc_slow':80,'stc2_period':100},
        '1y': {'rsi_period':7,'rsi_lookback':500,'stoch_len':14,'stoch_smoothK':14,'stoch_lookback':400,'rsi_smooth':5,'stoch_smooth':10,'stc1_period':32,'stc_fast':12,'stc_slow':26,'stc2_period':60},
    }
    result = compute_uprsi_stc(candles, **_uv.get(ver, _uv['']))
    await _set_cached("us", key, result, 30)
    return ApiResponse(data=result)


@router.get("/ind-j", response_model=ApiResponse)
async def get_rsimfi_opt(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, ver: str = ""):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    key = f"{symbolId}:{timeframe}:{limit}:{ver}:rsimfi_opt"
    cached = await _get_cached("rsimfi_opt", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={})
    from src.services.beom_sub import compute_uprsi_stc
    result = compute_uprsi_stc(candles, rsi_period=30, stoch_len=60, stoch_smoothK=9, rsi_lookback=300, stoch_lookback=240)
    # RSI/MFI만 추출 (rsi=30 기반 + mfi=7은 별도 계산)
    from src.services.beom_sub import _rsi, _mfi, _ema
    import numpy as np
    c = np.array([float(x.get("close") or x.get("c",0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h",0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l",0)) for x in candles])
    v = np.array([float(x.get("volume") or x.get("v",0)) for x in candles])
    # ver에 따라 파라미터 변경
    _rm={'':{'rp':60,'mp':60,'sm':1},'orig':{'rp':60,'mp':60,'sm':1},'1m':{'rp':60,'mp':14,'sm':3},'1y_old':{'rp':45,'mp':7,'sm':7},'1y':{'rp':60,'mp':7,'sm':3}}
    _p=_rm.get(ver,_rm[''])
    rsi30 = _rsi(c, _p['rp'])
    mfi7 = _mfi(h, l, c, v, _p['mp'])
    if _p['sm']>1: rsi30=_ema(rsi30,_p['sm']);mfi7=_ema(mfi7,_p['sm'])
    opt_result = {"scaled_rsi": [{"index":i,"value":float(rsi30[i]/100-0.5)} for i in range(len(c))],
                  "scaled_mfi": [{"index":i,"value":float(mfi7[i]/100-0.5)} for i in range(len(c))]}
    await _set_cached("rsimfi_opt", key, opt_result, 120)
    return ApiResponse(data=opt_result)

@router.get("/ind-k", response_model=ApiResponse)
async def get_stc_opt(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, ver: str = ""):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    key = f"{symbolId}:{timeframe}:{limit}:{ver}:stc_opt"
    cached = await _get_cached("stc_opt", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={})
    from src.services.beom_sub import compute_uprsi_stc
    result = compute_uprsi_stc(candles, rsi_period=60, rsi_lookback=300, stoch_len=60, stoch_smoothK=9, stoch_lookback=240)
    # STC만 period=50, fast=50, slow=100으로 재계산
    from src.services.beom_sub import _ema, _rolling_min, _rolling_max
    import numpy as np
    c = np.array([float(x.get("close") or x.get("c",0)) for x in candles])
    n = len(c)
    # ver에 따라 STC 파라미터
    _sp={'':{'p':32,'f':23,'s':50},'orig':{'p':32,'f':23,'s':50},'1m':{'p':50,'f':40,'s':100},'1y_old':{'p':50,'f':23,'s':80},'1y':{'p':32,'f':12,'s':26}}
    _stcp=_sp.get(ver,_sp[''])
    diff = _ema(c, _stcp['f']) - _ema(c, _stcp['s'])
    lo_d = _rolling_min(diff, _stcp['p']); hi_d = _rolling_max(diff, _stcp['p'])
    rng = np.maximum(hi_d - lo_d, 1e-10)
    raw_stc1 = _ema(np.array([(diff[i]-lo_d[i])/rng[i]-0.5 for i in range(n)]), 3)
    # stc2: period=100 (기존 STC와 동일 구조)
    lo_d2 = _rolling_min(diff, _stcp['p']*2); hi_d2 = _rolling_max(diff, _stcp['p']*2)
    rng2 = np.maximum(hi_d2 - lo_d2, 1e-10)
    raw_stc2 = _ema(np.array([(diff[i]-lo_d2[i])/rng2[i]-0.5 for i in range(n)]), 3)
    stc1 = [{"index":i,"value":float(raw_stc1[i])} for i in range(n)]
    stc2 = [{"index":i,"value":float(raw_stc2[i])} for i in range(n)]
    await _set_cached("stc_opt", key, {"stc1": stc1, "stc2": stc2}, 120)
    return ApiResponse(data={"stc1": stc1, "stc2": stc2})

@router.get("/ind-c2", response_model=ApiResponse)
async def get_pasr_pvi_opt(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    key = f"{symbolId}:{timeframe}:{limit}:pp_opt"
    cached = await _get_cached("pp_opt", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={})
    from src.services.beom_pasr import compute_pasr_pvi
    result = compute_pasr_pvi(candles, vwma_period=40)
    await _set_cached("pp_opt", key, result, 120)
    return ApiResponse(data=result)

@router.get("/ind-a2", response_model=ApiResponse)
async def get_uprsi_stc_opt(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    key = f"{symbolId}:{timeframe}:{limit}:opt"
    cached = await _get_cached("us_opt", key, 30)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={})
    from src.services.beom_sub import compute_uprsi_stc
    result = compute_uprsi_stc(candles, rsi_period=21, rsi_lookback=250, stoch_len=60, stoch_smoothK=3, stoch_lookback=150, rsi_smooth=3, stoch_smooth=3)
    await _set_cached("us_opt", key, result, 30)
    return ApiResponse(data=result)

@router.get("/ind-c", response_model=ApiResponse)
async def get_pasr_pvi(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, ver: str = ""):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    key = f"{symbolId}:{timeframe}:{limit}:{ver}"
    cached = await _get_cached("pp", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={})
    from src.services.beom_pasr import compute_pasr_pvi
    _pp = {'':{},'orig':{'vwma_period':60,'pna_period':240},'1m':{'vwma_period':10,'pna_period':60},'1y_old':{'vwma_period':60,'pna_period':720},'1y':{'vwma_period':60,'pna_period':360}}
    result = compute_pasr_pvi(candles, **_pp.get(ver, {}))
    await _set_cached("pp", key, result, 120)
    return ApiResponse(data=result)

@router.get("/ind-f", response_model=ApiResponse)
async def get_entry_signals(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    key = f"{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("es", key, 60)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={})
    from src.services.beom_sub import compute_uprsi_stc
    from src.services.beom_pasr import compute_pasr_pvi
    from src.services.beom_candle import compute_ultra_trend
    from src.services.entry_signals import compute_entry_signals
    uprsi_stc = compute_uprsi_stc(candles)
    pasr_pvi = compute_pasr_pvi(candles)
    ultra = compute_ultra_trend(candles)
    result = compute_entry_signals(candles, uprsi_stc, pasr_pvi, ultra)
    await _set_cached("es", key, result, 60)
    return ApiResponse(data=result)

@router.get("/ind-d", response_model=ApiResponse)
async def get_bimaco2(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    """Bimaco2 — PRO 전용."""
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    if not await _check_purchase(request, "bimaco2"):
        return ApiResponse(data={"_access": "purchase_required", "indicator_code": "bimaco2"})
    key = f"{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("bm2", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"d": [], "de": []})
    from src.services.beom_candle_pro import compute_bimaco2
    result = compute_bimaco2(candles)
    result['_delay'] = build_delay_meta(tier, 0)
    await _set_cached("bm2", key, result, 120)
    return ApiResponse(data=result)

@router.get("/ind-d2", response_model=ApiResponse)
async def get_bimaco3(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, mode: str = "reversion"):
    """범온캔들 PRO 2 — HMA 추세필터·Z/추세 정렬·강도 활용 + 평균회귀/추세 모드. PRO 전용."""
    tier = await get_user_tier(request)
    if not tier:
        return ApiResponse(data={"_access": "pro_only"})
    if not await _check_purchase(request, "bimaco2"):
        return ApiResponse(data={"_access": "purchase_required", "indicator_code": "bimaco2"})
    mode = mode if mode in ("reversion", "trend") else "reversion"
    key = f"{symbolId}:{timeframe}:{limit}:{mode}"
    cached = await _get_cached("bm3", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"d": [], "de": [], "hma": []})
    from src.services.beom_candle_pro import compute_bimaco3
    result = compute_bimaco3(candles, mode=mode)
    result['_delay'] = build_delay_meta(tier, 0)
    await _set_cached("bm3", key, result, 120)
    return ApiResponse(data=result)

@router.get("/ind-d3", response_model=ApiResponse)
async def get_bimaco_vip(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    """범온캔들 VIP (BIMACO3) — PRO 업그레이드. 멀티TF 자동매매 신호 일체. PRO 전용."""
    tier = await get_user_tier(request)
    if not tier:
        return ApiResponse(data={"_access": "pro_only"})
    if not await _check_purchase(request, "bimaco2"):
        return ApiResponse(data={"_access": "purchase_required", "indicator_code": "bimaco2"})
    key = f"{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("bmvip", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"bars": [], "last": {}, "wave_stats": {}})
    from src.services.beom_candle_vip import compute_bimaco3 as compute_vip
    result = compute_vip(candles)
    result['_delay'] = build_delay_meta(tier, 0)
    await _set_cached("bmvip", key, result, 120)
    return ApiResponse(data=result)

@router.get("/ind-g", response_model=ApiResponse)
async def get_entry2(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    key = f"{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("e2", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={})
    from src.services.entry2 import compute_entry2
    result = compute_entry2(candles)
    await _set_cached("e2", key, result, 120)
    return ApiResponse(data=result)

@router.get("/ind-h", response_model=ApiResponse)
async def check_entry(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, barIndex: int = -1):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    """특정 봉의 진입 조건 체크"""
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles or len(candles) < 303:
        return ApiResponse(data={})
    
    import numpy as np
    from src.services.beom_sub import _ema, _rsi, _mfi, _stoch, _sma, _rolling_min, _rolling_max
    
    c = np.array([float(x.get("close") or x.get("c",0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h",0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l",0)) for x in candles])
    v = np.array([float(x.get("volume") or x.get("v",0)) for x in candles])
    n = len(c)
    
    d1=_ema(c,23)-_ema(c,80);l1=_rolling_min(d1,100);h1=_rolling_max(d1,100)
    stc_thick=(d1-l1)/np.maximum(h1-l1,1e-10)-0.5
    d3=_ema(c,12)-_ema(c,26);l3=_rolling_min(d3,60);h3=_rolling_max(d3,60)
    stc_thin=(d3-l3)/np.maximum(h3-l3,1e-10)-0.5
    rs=_stoch(c,h,l,14);ks=_sma(rs,9);ls=_rolling_min(ks,240);hs=_rolling_max(ks,240)
    upstoch=(ks-ls)/np.maximum(hs-ls,1e-10)-0.5
    rv=_ema(_rsi(c,60),3);lr=_rolling_min(rv,300);hr=_rolling_max(rv,300)
    uprsi=(rv-lr)/np.maximum(hr-lr,1e-10)-0.5
    s_rsi=_rsi(c,60)/100-0.5;s_mfi=_mfi(h,l,c,v,60)/100-0.5
    
    i = barIndex if 0 <= barIndex < n else n-1
    if i < 2: return ApiResponse(data={})
    
    # 각 조건 체크
    def tu(a,b):return a>b
    def gc(a,b):return a>0 and b<=0
    def dc(a,b):return a<0 and b>=0
    
    b1=uprsi[i]>0.24 or gc(uprsi[i],uprsi[i-1])
    b2=upstoch[i]>0.23 or gc(upstoch[i],upstoch[i-1])
    b3=(stc_thin[i]>0.21 and stc_thick[i]>0.21) or (stc_thin[i]>0 and stc_thick[i]>stc_thick[i-1])
    b4=(s_rsi[i]>0 and s_mfi[i]>0) or (s_rsi[i]>s_rsi[i-1] and s_mfi[i]>s_mfi[i-1] and s_rsi[i]>-0.15 and s_mfi[i]>-0.15) or (s_rsi[i]>0 and s_mfi[i]>s_mfi[i-1] and s_mfi[i]>-0.15) or (s_mfi[i]>0 and s_rsi[i]>s_rsi[i-1] and s_rsi[i]>-0.15)
    bf=bool(s_rsi[i]>0 and s_mfi[i]<0)
    
    s1=uprsi[i]<-0.24 or dc(uprsi[i],uprsi[i-1])
    s2=upstoch[i]<-0.23 or dc(upstoch[i],upstoch[i-1])
    s3=(stc_thin[i]<-0.21 and stc_thick[i]<-0.21) or (stc_thin[i]<0 and stc_thick[i]<stc_thick[i-1])
    s4=(s_rsi[i]<0 and s_mfi[i]<0) or (s_rsi[i]<s_rsi[i-1] and s_mfi[i]<s_mfi[i-1] and s_rsi[i]<0.15 and s_mfi[i]<0.15) or (s_rsi[i]<0 and s_mfi[i]<s_mfi[i-1] and s_mfi[i]<0.15) or (s_mfi[i]<0 and s_rsi[i]<s_rsi[i-1] and s_rsi[i]<0.15)
    sf=bool(s_rsi[i]<0 and s_mfi[i]>0)
    
    buy_ok = bool(b1 and b2 and b3 and b4 and not bf)
    sell_ok = bool(s1 and s2 and s3 and s4 and not sf)
    
    return ApiResponse(data={
        "index": i,
        "price": float(c[i]),
        "buy": {
            "udrsi": bool(b1), "udstoch": bool(b2), "stc": bool(b3), "rsimfi": bool(b4),
            "false_filter": bf, "result": buy_ok,
            "detail": {
                "uprsi": round(float(uprsi[i]),4), "uprsi_prev": round(float(uprsi[i-1]),4),
                "upstoch": round(float(upstoch[i]),4), "upstoch_prev": round(float(upstoch[i-1]),4),
                "stc_thin": round(float(stc_thin[i]),4), "stc_thick": round(float(stc_thick[i]),4),
                "stc_thick_prev": round(float(stc_thick[i-1]),4),
                "rsi": round(float(s_rsi[i]),4), "rsi_prev": round(float(s_rsi[i-1]),4),
                "mfi": round(float(s_mfi[i]),4), "mfi_prev": round(float(s_mfi[i-1]),4),
            }
        },
        "sell": {
            "udrsi": bool(s1), "udstoch": bool(s2), "stc": bool(s3), "rsimfi": bool(s4),
            "false_filter": sf, "result": sell_ok,
        }
    })

@router.get("/ind-i", response_model=ApiResponse)
async def get_indicator_signals(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, ind: str = "rsi"):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles or len(candles) < 303:
        return ApiResponse(data=[])
    import numpy as np
    from src.services.beom_sub import _ema, _rsi, _mfi, _stoch, _sma, _rolling_min, _rolling_max
    c=np.array([float(x.get("close") or x.get("c",0)) for x in candles])
    h=np.array([float(x.get("high") or x.get("h",0)) for x in candles])
    l=np.array([float(x.get("low") or x.get("l",0)) for x in candles])
    v=np.array([float(x.get("volume") or x.get("v",0)) for x in candles])
    n=len(c)
    d1=_ema(c,23)-_ema(c,80);l1=_rolling_min(d1,100);h1=_rolling_max(d1,100)
    stc_thick=(d1-l1)/np.maximum(h1-l1,1e-10)-0.5
    d3=_ema(c,12)-_ema(c,26);l3=_rolling_min(d3,60);h3=_rolling_max(d3,60)
    stc_thin=(d3-l3)/np.maximum(h3-l3,1e-10)-0.5
    rs=_stoch(c,h,l,14);ks=_sma(rs,9);ls=_rolling_min(ks,240);hs=_rolling_max(ks,240)
    us=(ks-ls)/np.maximum(hs-ls,1e-10)-0.5
    rv=_ema(_rsi(c,60),3);lr=_rolling_min(rv,300);hr=_rolling_max(rv,300)
    ur=(rv-lr)/np.maximum(hr-lr,1e-10)-0.5
    sr=_rsi(c,60)/100-0.5;sm=_mfi(h,l,c,v,60)/100-0.5
    
    def gc(a,b):return a>0 and b<=0
    def dc(a,b):return a<0 and b>=0
    
    signals=[]
    for i in range(1,n):
        if ind=='rsi':
            # 진입
            if ur[i]>-0.02 or gc(ur[i],ur[i-1]): signals.append({"index":i,"type":"buy","price":float(l[i]),"act":"진입"})
            if ur[i]<0.02 or dc(ur[i],ur[i-1]): signals.append({"index":i,"type":"sell","price":float(h[i]),"act":"진입"})
            # TP2: RSI 0반대
            if ur[i]<0: signals.append({"index":i,"type":"tp_long","price":float(h[i]),"act":"TP2"})
            if ur[i]>0: signals.append({"index":i,"type":"tp_short","price":float(l[i]),"act":"TP2"})
            # 손절: RSI 0크로스
            if dc(ur[i],ur[i-1]): signals.append({"index":i,"type":"sl_long","price":float(h[i]),"act":"손절↓"})
            if gc(ur[i],ur[i-1]): signals.append({"index":i,"type":"sl_short","price":float(l[i]),"act":"손절↑"})
        elif ind=='stoch':
            if us[i]>-0.02 or gc(us[i],us[i-1]): signals.append({"index":i,"type":"buy","price":float(l[i]),"act":"진입"})
            if us[i]<0.02 or dc(us[i],us[i-1]): signals.append({"index":i,"type":"sell","price":float(h[i]),"act":"진입"})
            # TP3: Stoch 0크로스
            if dc(us[i],us[i-1]): signals.append({"index":i,"type":"tp_long","price":float(h[i]),"act":"TP3"})
            if gc(us[i],us[i-1]): signals.append({"index":i,"type":"tp_short","price":float(l[i]),"act":"TP3"})
            # 역추세: 과매도 꺾임
            if us[i]<=-0.3 and us[i]>us[i-1]: signals.append({"index":i,"type":"reverse","price":float(l[i]),"act":"역추세↑"})
            if us[i]>=0.3 and us[i]<us[i-1]: signals.append({"index":i,"type":"reverse","price":float(h[i]),"act":"역추세↓"})
        elif ind=='stc':
            if (stc_thin[i]>0 and stc_thick[i]>0) or (stc_thin[i]>0 and stc_thick[i]>stc_thick[i-1]): signals.append({"index":i,"type":"buy","price":float(l[i]),"act":"진입"})
            if (stc_thin[i]<0 and stc_thick[i]<0) or (stc_thin[i]<0 and stc_thick[i]<stc_thick[i-1]): signals.append({"index":i,"type":"sell","price":float(h[i]),"act":"진입"})
            # TP1: 얇은선 0선 돌파
            if stc_thin[i]<0 and stc_thin[i-1]>=0: signals.append({"index":i,"type":"tp_long","price":float(h[i]),"act":"TP1↓"})
            if stc_thin[i]>0 and stc_thin[i-1]<=0: signals.append({"index":i,"type":"tp_short","price":float(l[i]),"act":"TP1↑"})
            # 손절: 두선 반대
            if stc_thin[i]<0 and stc_thick[i]<0: signals.append({"index":i,"type":"sl_long","price":float(h[i]),"act":"SL양↓"})
            if stc_thin[i]>0 and stc_thick[i]>0: signals.append({"index":i,"type":"sl_short","price":float(l[i]),"act":"SL양↑"})
            # TP4: 얇은선<굵은선 크로스
            if stc_thin[i]<stc_thick[i] and stc_thin[i-1]>=stc_thick[i-1]: signals.append({"index":i,"type":"tp_long","price":float(h[i]),"act":"TP4↓"})
            if stc_thin[i]>stc_thick[i] and stc_thin[i-1]<=stc_thick[i-1]: signals.append({"index":i,"type":"tp_short","price":float(l[i]),"act":"TP4↑"})
        elif ind=='rm':
            if (sr[i]>0 and sm[i]>0) or (sr[i]>sr[i-1] and sm[i]>sm[i-1] and sr[i]>-0.15 and sm[i]>-0.15) or (sr[i]>0 and sm[i]>sm[i-1] and sm[i]>-0.15) or (sm[i]>0 and sr[i]>sr[i-1] and sr[i]>-0.15): signals.append({"index":i,"type":"buy","price":float(l[i]),"act":"진입"})
            if (sr[i]<0 and sm[i]<0) or (sr[i]<sr[i-1] and sm[i]<sm[i-1] and sr[i]<0.15 and sm[i]<0.15) or (sr[i]<0 and sm[i]<sm[i-1] and sm[i]<0.15) or (sm[i]<0 and sr[i]<sr[i-1] and sr[i]<0.15): signals.append({"index":i,"type":"sell","price":float(h[i]),"act":"진입"})
            # 거짓필터
            if sr[i]>0 and sm[i]<0: signals.append({"index":i,"type":"false_buy","price":float(h[i]),"act":"거짓↑"})
            if sr[i]<0 and sm[i]>0: signals.append({"index":i,"type":"false_sell","price":float(l[i]),"act":"거짓↓"})
            # TP4: MFI가 RSI 하향돌파
            if sm[i]<sr[i] and sm[i-1]>=sr[i-1]: signals.append({"index":i,"type":"tp_long","price":float(h[i]),"act":"MFI↓"})
            if sm[i]>sr[i] and sm[i-1]<=sr[i-1]: signals.append({"index":i,"type":"tp_short","price":float(l[i]),"act":"MFI↑"})
            # 역추세: RSI↓+MFI↑
            if sr[i]<0 and sm[i]>0 and sm[i-1]<=0: signals.append({"index":i,"type":"reverse","price":float(l[i]),"act":"바닥?"})
    return ApiResponse(data=signals)

@router.get("/ind-e", response_model=ApiResponse)
async def bimaco_tp(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    """범온 Buy/Sell 신호 시 진입/손절/TP1~3 계산"""
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles or len(candles) < 200:
        return ApiResponse(data=[])
    
    import numpy as np
    from src.services.beom_candle import compute_ultra_trend
    
    c = np.array([float(x.get("close",0)) for x in candles])
    h = np.array([float(x.get("high",0)) for x in candles])
    l = np.array([float(x.get("low",0)) for x in candles])
    n = len(c)
    
    # ATR 200
    tr = np.maximum(h[1:]-l[1:], np.maximum(np.abs(h[1:]-c[:-1]), np.abs(l[1:]-c[:-1])))
    atr = np.zeros(n)
    atr[1] = np.mean(tr[:200]) if len(tr)>=200 else np.mean(tr)
    for i in range(2, n):
        atr[i] = (atr[i-1]*199 + (tr[i-1] if i-1<len(tr) else 0)) / 200
    atr_val = atr * 0.5
    
    # SMA high/low (target_length=10)
    from src.services.beom_sub import _sma
    sma_h = _sma(h, 10) + atr_val
    sma_l = _sma(l, 10) - atr_val
    
    # 범온 신호
    ut = compute_ultra_trend(candles)
    signals = ut.get("s", [])
    
    result = []
    target = 0  # 기본 target=0
    
    # 가격대 적응형 반올림 도우미 (저가 심볼 정밀도 보존)
    def _prec(v: float) -> int:
        if v >= 100: return 2
        if v >= 1: return 4
        if v >= 0.01: return 5
        if v >= 0.0001: return 7
        return 8

    for s in signals:
        idx = s.get("index", 0)
        if idx >= n or idx < 10: continue
        t = s.get("type", "")
        
        if t in ("buy", "ku"):
            entry = float(c[idx])
            stop = float(sma_l[idx])
            a = float(atr_val[idx])
            tp1 = entry + a * (5 + target)
            tp2 = entry + a * (10 + target * 2)
            tp3 = entry + a * (15 + target * 3)
            pr = _prec(entry)
            result.append({"index":idx,"dir":"long","entry":round(entry,pr),"stop":round(stop,pr),
                          "tp1":round(tp1,pr),"tp2":round(tp2,pr),"tp3":round(tp3,pr)})
        
        elif t in ("sell", "kd"):
            entry = float(c[idx])
            stop = float(sma_h[idx])
            a = float(atr_val[idx])
            tp1 = entry - a * (5 + target)
            tp2 = entry - a * (10 + target * 2)
            tp3 = entry - a * (15 + target * 3)
            pr = _prec(entry)
            result.append({"index":idx,"dir":"short","entry":round(entry,pr),"stop":round(stop,pr),
                          "tp1":round(tp1,pr),"tp2":round(tp2,pr),"tp3":round(tp3,pr)})
    
    return ApiResponse(data=result)


@router.get("/ind-ms", response_model=ApiResponse)
async def get_master_signal(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"score": [], "signals": [], "t": {}, "_access": "pro_only"})
    if not await _check_purchase(request, "master"):
        return ApiResponse(data={"_access": "purchase_required", "indicator_code": "master"})
    # 캐시 (30초) — 동일 심볼/TF/limit 다수 호출 방지
    key = f"{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("ms", key, 30)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"score": [], "signals": [], "t": {}})
    from src.services.master_signal_v2 import compute_master_signal_v2
    tf_map = {'1m':1,'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'2h':120,'4h':240,'1d':1440}
    result = compute_master_signal_v2(candles, tf_minutes=tf_map.get(timeframe, 60))
    await _set_cached("ms", key, result, 30)
    return ApiResponse(data=result)


@router.get("/ind-kvo", response_model=ApiResponse)
async def get_kvo(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    """KVO 거래량분석 — PRO 전용."""
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    if not await _check_purchase(request, "kvo"):
        return ApiResponse(data={"_access": "purchase_required", "indicator_code": "kvo"})
    # 캐시 (30초)
    key = f"{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("kvo", key, 30)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"kvo": [], "sig": [], "hist": []})
    highs = [c.get("high", c.get("h", 0)) for c in candles]
    lows = [c.get("low", c.get("l", 0)) for c in candles]
    closes = [c.get("close", c.get("c", 0)) for c in candles]
    volumes = [c.get("volume", c.get("v", 0)) for c in candles]
    for i in range(len(highs)):
        highs[i] = float(highs[i]); lows[i] = float(lows[i]); closes[i] = float(closes[i]); volumes[i] = float(volumes[i])
    n = len(closes)
    hlc = [(highs[i]+lows[i]+closes[i])/3 for i in range(n)]
    dm = [0.0]+[highs[i]-lows[i] for i in range(1, n)]
    trend = [0]+[1 if hlc[i]>hlc[i-1] else -1 for i in range(1, n)]
    cm = [dm[0]]
    for i in range(1, n):
        cm.append(cm[i-1]+dm[i] if trend[i]==trend[i-1] else dm[i-1]+dm[i])
    vf = [volumes[i]*abs(2*(dm[i]/cm[i]*100 if abs(cm[i])>0 else 0)-1)*trend[i] for i in range(n)]
    def _ema(data, period):
        k = 2/(period+1)
        r = [data[0]]
        for i in range(1, len(data)):
            r.append(data[i]*k + r[-1]*(1-k))
        return r
    kvo34, kvo55 = _ema(vf, 34), _ema(vf, 55)
    kvo_line = [kvo34[i]-kvo55[i] for i in range(n)]
    sig = _ema(kvo_line, 13)
    hist = [kvo_line[i]-sig[i] for i in range(n)]
    result = {"kvo": kvo_line, "sig": sig, "hist": hist}
    await _set_cached("kvo", key, result, 30)
    return ApiResponse(data=result)



@router.get("/ind-b-free", response_model=ApiResponse)
async def get_beom_free(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 500):
    """범온AI 캔들 (지연) — guest 1시간, free 30분, PRO 실시간."""
    tier = await get_user_tier(request)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"d": [], "delay_minutes": 0})
    
    # 지연 시간 결정
    if tier in ("pro", "premium"):
        delay_min = 0
    elif tier == "free":
        delay_min = 30
    else:
        delay_min = 60
    
    # 지연 적용: cutoff 이전만 범온 계산, 이후는 None
    if delay_min > 0:
        cutoff_ms = int((import_time() - delay_min * 60) * 1000)
        # 캔들 시간 기준 분리
        delayed_candles = []
        for c in candles:
            ts = c.get('t') or c.get('time') or c.get('openTime') or 0
            if isinstance(ts, str):
                ts = int(ts)
            if ts <= cutoff_ms:
                delayed_candles.append(c)
        compute_candles = delayed_candles
    else:
        compute_candles = candles
    
    if not compute_candles:
        return ApiResponse(data={"d": [], "delay_minutes": delay_min, "total_bars": len(candles)})
    
    result = compute_ultra_trend(compute_candles)
    # 지연 구간은 None으로 패딩
    d = result.get("d", [])
    padding = [None] * (len(candles) - len(d))
    d = d + padding
    
    return ApiResponse(data={"d": d, "delay_minutes": delay_min, "total_bars": len(candles), "computed_bars": len(compute_candles)})

@router.get("/ind-mtf", response_model=ApiResponse)
async def get_mtf_score(symbolId: str = "BTCUSDT", timeframe: str = "5m"):
    """MTF 추세 강도 — 인증 불필요, signal_sum만 반환."""
    key = f"mtf:{symbolId}:{timeframe}"
    cached = await _get_cached("mtf", key, 30)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, 200)
    if not candles or len(candles) < 50:
        return ApiResponse(data={"v": 0, "max_signals": 12})
    try:
        result = compute_ultra_trend(candles)
        t = result.get("t", {})
        data = {"v": t.get("v", 0), "max_signals": t.get("max_signals", 12)}
    except Exception:
        data = {"v": 0, "max_signals": 12}
    await _set_cached("mtf", key, data, 30)
    return ApiResponse(data=data)

@router.get("/ind-darak", response_model=ApiResponse)
async def get_darak_ma(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 500, mode: str = "balanced", period: int = 20):
    """범온 이동평균선 — 회원 전용."""
    tier = await get_user_tier(request)
    if tier == "guest":
        return ApiResponse(data={"_access": "login_required"})
    key = f"darak:{symbolId}:{timeframe}:{limit}:{mode}:{period}"
    cached = await _get_cached("darak", key, 60)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"ma": [], "signal": [], "upper": [], "lower": []})
    from src.services.beom_ma import compute_darak_ma
    result = compute_darak_ma(candles, mode=mode, length=period)
    await _set_cached("darak", key, result, 60)
    return ApiResponse(data=result)


# ════════════════════════════════════════════════════
# 🤖 자동매매 (Paper Trading — 차트 신호만, 실주문 없음)
# ════════════════════════════════════════════════════
@router.get("/ind-autobot", response_model=ApiResponse)
async def get_autobot_signals(
    request: Request,
    symbolId: str = "BTCUSDT",
    timeframe: str = "5m",
    limit: int = 2000,
    mode: str = "balanced",  # 'conservative' | 'balanced' | 'custom'
):
    """자동매매 가상 시뮬레이션 (GET — 기본 모드).
    
    지표 9개 조합으로 진입/청산 신호 계산 후 차트에 표시.
    실제 주문은 실행되지 않음 (Paper Trading).
    
    - mode='conservative': 9개 지표 중 6개 이상 일치 시 진입
    - mode='balanced': 5개 이상 일치 시 진입
    - mode='custom': POST /ind-autobot 로 커스텀 가중치 전달
    """
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    if not await _check_purchase(request, "darak"):
        return ApiResponse(data={"_access": "purchase_required", "indicator_code": "darak"})
    
    if mode not in ("conservative", "balanced"):
        mode = "balanced"
    
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles or len(candles) < 200:
        return ApiResponse(data={"actions": [], "summary": {}, "positions_log": []})
    
    from src.services.strategy_autobot import compute_autobot_signals
    result = compute_autobot_signals(candles, timeframe=timeframe, mode=mode)
    return ApiResponse(data=result)


@router.post("/ind-autobot", response_model=ApiResponse)
async def post_autobot_signals(request: Request):
    """자동매매 커스텀 설정 (POST).
    
    Body:
    {
        "symbolId": "BTCUSDT",
        "timeframe": "5m",
        "limit": 500,
        "weights": {
            "ultra": 2.0,     # BEOM AI 캔들
            "master": 2.0,    # 종합매매
            "darak": 1.0,     # 범온MA
            "vwap": 1.0,      # VWAP
            "imacd": 1.0,     # IMACD
            "uprsi": 1.5,     # 강도측정
            "udstoch": 1.5,   # 과열분석
            "ob": 1.0,        # 거래밀집구간
            "fib": 0          # 피보나치 (0 = 비활성)
        },
        "threshold": 5.0      # 진입 임계값 (합계 X 이상)
    }
    """
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    
    try:
        body = await request.json()
    except Exception:
        body = {}
    
    symbolId = body.get("symbolId", "BTCUSDT")
    timeframe = body.get("timeframe", "5m")
    limit = int(body.get("limit", 500))
    weights = body.get("weights") or {}
    threshold = body.get("threshold")
    
    # 검증
    if limit > 2000:
        limit = 2000
    if limit < 200:
        limit = 200
    
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles or len(candles) < 200:
        return ApiResponse(data={"actions": [], "summary": {}, "positions_log": []})
    
    from src.services.strategy_autobot import compute_autobot_signals
    result = compute_autobot_signals(
        candles, timeframe=timeframe, mode="custom",
        weights=weights, threshold=threshold,
    )
    return ApiResponse(data=result)



@router.get("/ind-beomauto2", response_model=ApiResponse)
async def get_beom_auto2_events(symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 200, mode: str = "retest"):
    """범온 자동매매 2 (OB autotrade) 봇의 실시간 거래 이벤트.

    봇이 기록한 이벤트 파일을 읽어 반환.
    mode: 'retest' (정석 되돌림 진입) | 'instant' (돌파 즉시 진입)
    이벤트: open, tp1, tp2, close_tp3, close_sl, opp_close
    """
    import json as _json
    from pathlib import Path as _Path
    from src.utils.validators import is_valid_symbol, is_valid_timeframe

    # Path traversal 차단: symbolId, timeframe 검증
    if not is_valid_symbol(symbolId.upper()):
        return ApiResponse(data={"events": []})
    if not is_valid_timeframe(timeframe):
        return ApiResponse(data={"events": []})

    _dir = "beomauto2_events_instant" if mode == "instant" else "beomauto2_events"
    p = _Path(f"data/{_dir}/{symbolId}_{timeframe}.json").resolve()

    # 추가 안전장치: 해석된 경로가 data 디렉토리 하위인지 확인
    _data_root = _Path("data").resolve()
    if not str(p).startswith(str(_data_root)):
        return ApiResponse(data={"events": []})
    if not p.exists():
        return ApiResponse(data={"events": []})
    try:
        events = _json.loads(p.read_text())
    except Exception:
        return ApiResponse(data={"events": []})
    if not isinstance(events, list):
        return ApiResponse(data={"events": []})
    # 최근 limit개만
    events = events[-limit:] if len(events) > limit else events
    return ApiResponse(data={"events": events})
