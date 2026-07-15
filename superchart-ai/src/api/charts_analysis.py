"""차트 분석 API — 백테스트, 학습 데이터."""
import re
from fastapi import APIRouter, Depends, HTTPException
from src.models.schemas import ApiResponse
from src.services.market import fetch_candles
from src.services.symbol_resolver import resolve_symbol
from src.services.redis_cache import _get_cached, _set_cached
from src.services.auth import get_current_user_id

router = APIRouter()

_SAFE_TOKEN_RE = re.compile(r"[^A-Za-z0-9_-]")


def _safe_filename_token(value: str, default: str = "na", max_len: int = 40) -> str:
    """파일명에 삽입할 값에서 경로 조작(../, /, 특수문자)에 쓰일 수 있는 문자를 제거.

    analyze_checked/save_train 이 symbol/tf 를 검증 없이 f-string으로 파일 경로에
    직접 삽입해, 예: symbol='../../../etc/cron.d/evil' 로 data/results/ 밖에
    임의 경로에 파일을 쓸 수 있었다(Path Traversal). 영문/숫자/'_'/'-' 만 남기고
    나머지는 제거, 빈 값이면 안전한 기본값으로 대체.
    """
    cleaned = _SAFE_TOKEN_RE.sub("", str(value or ""))[:max_len]
    return cleaned or default

@router.get("/backtest", response_model=ApiResponse)
async def get_backtest(symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, mode: str = "B",
                        user_id: str = Depends(get_current_user_id)):
    key = f"{symbolId}:{timeframe}:{limit}:{mode}:v12dual"
    cached = await _get_cached("bt", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles_5m = await fetch_candles(api_sym, exchange_id, "5m", max(limit, 2000))
    candles_1h = await fetch_candles(api_sym, exchange_id, "1h", 2000)
    if not candles_5m or not candles_1h:
        return ApiResponse(data={"markers": [], "stats": {}, "equity": []})
    if mode == "ultimate":
        from src.services.backtest_ultimate import run_backtest_ultimate
        candles_1m = await fetch_candles(api_sym, exchange_id, "1m", max(limit, 2000))
        candles_5m_confirm = await fetch_candles(api_sym, exchange_id, "5m", 2000)
        if not candles_1m or not candles_5m_confirm:
            return ApiResponse(data={"markers": [], "stats": {}, "equity": []})
        result = run_backtest_ultimate(candles_1m, candles_confirm=candles_5m_confirm)
    else:
        from src.services.backtest import run_backtest
        result = run_backtest(candles_5m, candles_1h=candles_1h, mode=mode)
    await _set_cached("bt", key, result, 120)
    return ApiResponse(data=result)

@router.post("/analyze-checked", response_model=ApiResponse)
async def analyze_checked(body: dict, user_id: str = Depends(get_current_user_id)):
    """체크된 봉들 일괄 분석 (Alt+클릭 개발자 도구 — 로그인 필요)."""
    import json
    bars = body.get("bars", [])
    symbol = body.get("symbol", "")
    tf = body.get("tf", "")

    if not isinstance(bars, list):
        raise HTTPException(400, "bars 는 배열이어야 합니다")
    if len(bars) > 500:
        raise HTTPException(400, "한 번에 분석 가능한 봉은 최대 500개입니다")
    if not bars:
        return ApiResponse(data={"summary": "체크된 봉이 없습니다"})

    # 파일 저장 — symbol/tf 를 안전하게 정제해 경로 조작(Path Traversal) 방지
    safe_symbol = _safe_filename_token(symbol)
    safe_tf = _safe_filename_token(tf)
    import time as _t
    fname = f"data/results/checked_{safe_symbol}_{safe_tf}_{int(_t.time())}.json"
    import os; os.makedirs("data/results", exist_ok=True)
    with open(fname, "w") as f:
        json.dump({"symbol": symbol, "tf": tf, "bars": bars, "user_id": user_id}, f, indent=2, ensure_ascii=False)
    
    # 분석
    total = len(bars)
    buy_blocked = {"udrsi":0, "udstoch":0, "stc":0, "rsimfi":0, "false_filter":0}
    sell_blocked = {"udrsi":0, "udstoch":0, "stc":0, "rsimfi":0, "false_filter":0}
    buy_possible = 0
    sell_possible = 0
    
    for b in bars:
        buy = b.get("buy", {})
        sell = b.get("sell", {})
        if buy.get("result"): buy_possible += 1
        if sell.get("result"): sell_possible += 1
        for k in ["udrsi","udstoch","stc","rsimfi"]:
            if not buy.get(k): buy_blocked[k] += 1
            if not sell.get(k): sell_blocked[k] += 1
        if buy.get("false_filter"): buy_blocked["false_filter"] += 1
        if sell.get("false_filter"): sell_blocked["false_filter"] += 1
    
    # 가장 많이 막는 지표
    buy_blocker = max(buy_blocked, key=lambda k: buy_blocked[k] if k != "false_filter" else 0)
    
    return ApiResponse(data={
        "summary": f"{total}개 봉 분석 완료 → {fname}",
        "total": total,
        "buy_possible": buy_possible,
        "sell_possible": sell_possible,
        "buy_blocked_by": {k: f"{v}/{total} ({v/total*100:.0f}%)" for k,v in buy_blocked.items()},
        "sell_blocked_by": {k: f"{v}/{total} ({v/total*100:.0f}%)" for k,v in sell_blocked.items()},
        "main_blocker": f"매수 주요 차단: {buy_blocker} ({buy_blocked[buy_blocker]}/{total})",
        "bars_detail": [{
            "index": b.get("index"),
            "price": b.get("price"),
            "buy": "✅" if b.get("buy",{}).get("result") else "❌ " + ",".join(k for k in ["udrsi","udstoch","stc","rsimfi"] if not b.get("buy",{}).get(k)),
            "sell": "✅" if b.get("sell",{}).get("result") else "❌",
        } for b in bars]
    })

@router.post("/save-train", response_model=ApiResponse)
async def save_train(body: dict, user_id: str = Depends(get_current_user_id)):
    import json
    import time as _t
    import os
    if not isinstance(body.get("points", []), list) or len(body.get("points", [])) > 1000:
        raise HTTPException(400, "points 는 배열이며 최대 1000개까지 저장 가능합니다")
    os.makedirs("data/results", exist_ok=True)
    safe_symbol = _safe_filename_token(body.get('symbol', ''))
    safe_tf = _safe_filename_token(body.get('tf', ''))
    fname = f"data/results/train_{safe_symbol}_{safe_tf}_{int(_t.time())}.json"
    with open(fname, "w") as f:
        json.dump(body, f, indent=2, ensure_ascii=False)
    return ApiResponse(data={"file": fname, "count": len(body.get("points", []))})

@router.get("/train-range", response_model=ApiResponse)
async def train_range(symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, startIdx: int = 0, endIdx: int = 0,
                       user_id: str = Depends(get_current_user_id)):
    """진입~청산 구간의 7개 지표값 반환"""
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles or len(candles) < 303:
        return ApiResponse(data={})
    import numpy as np
    from src.services.beom_sub import _ema, _rsi, _mfi, _stoch, _sma, _rolling_min, _rolling_max
    from src.services.beom_candle import compute_ultra_trend
    
    c=np.array([float(x.get("close") or x.get("c",0)) for x in candles])
    h=np.array([float(x.get("high") or x.get("h",0)) for x in candles])
    l=np.array([float(x.get("low") or x.get("l",0)) for x in candles])
    v=np.array([float(x.get("volume") or x.get("v",0)) for x in candles])
    n=len(c)
    
    # 4 분석지표
    d1=_ema(c,23)-_ema(c,80);l1=_rolling_min(d1,100);h1=_rolling_max(d1,100)
    stc_thick=(d1-l1)/np.maximum(h1-l1,1e-10)-0.5
    d3=_ema(c,12)-_ema(c,26);l3=_rolling_min(d3,60);h3=_rolling_max(d3,60)
    stc_thin=(d3-l3)/np.maximum(h3-l3,1e-10)-0.5
    rs=_stoch(c,h,l,14);ks=_sma(rs,9);ls=_rolling_min(ks,240);hs=_rolling_max(ks,240)
    upstoch=(ks-ls)/np.maximum(hs-ls,1e-10)-0.5
    rv=_ema(_rsi(c,60),3);lr=_rolling_min(rv,300);hr=_rolling_max(rv,300)
    uprsi=(rv-lr)/np.maximum(hr-lr,1e-10)-0.5
    s_rsi=_rsi(c,60)/100-0.5;s_mfi=_mfi(h,l,c,v,60)/100-0.5
    
    # TEMA 60/100
    def _tema(d,p):
        e1=_ema(d,p);e2=_ema(e1,p);e3=_ema(e2,p)
        return 3*e1-3*e2+e3
    t60=_tema(c,60);t200=_tema(c,200)
    tema60_color = ["red" if t60[i]>t200[i] else 'blue' for i in range(n)]
    
    # 범온
    try:
        ut = compute_ultra_trend(candles)
        bimaco_bars = ut.get("d", [])
    except Exception:
        bimaco_bars = []
    
    si=max(0,min(startIdx,n-1));ei=max(0,min(endIdx,n-1))
    if si>ei: si,ei=ei,si
    
    result = {
        "entry": {
            "stc_thick":round(float(stc_thick[si]),4),"stc_thin":round(float(stc_thin[si]),4),
            "upstoch":round(float(upstoch[si]),4),"uprsi":round(float(uprsi[si]),4),
            "rsi":round(float(s_rsi[si]),4),"mfi":round(float(s_mfi[si]),4),
            "tema60_color":tema60_color[si] if si<len(tema60_color) else "unknown",
            "bimaco_ss":bimaco_bars[si].get("v",0) if si<len(bimaco_bars) else 0,
        },
        "exit": {
            "stc_thick":round(float(stc_thick[ei]),4),"stc_thin":round(float(stc_thin[ei]),4),
            "upstoch":round(float(upstoch[ei]),4),"uprsi":round(float(uprsi[ei]),4),
            "rsi":round(float(s_rsi[ei]),4),"mfi":round(float(s_mfi[ei]),4),
            "tema60_color":tema60_color[ei] if ei<len(tema60_color) else "unknown",
            "bimaco_ss":bimaco_bars[ei].get("v",0) if ei<len(bimaco_bars) else 0,
        },
        "range": {
            "stc_thick_min":round(float(np.min(stc_thick[si:ei+1])),4),
            "stc_thick_max":round(float(np.max(stc_thick[si:ei+1])),4),
            "upstoch_min":round(float(np.min(upstoch[si:ei+1])),4),
            "upstoch_max":round(float(np.max(upstoch[si:ei+1])),4),
            "uprsi_min":round(float(np.min(uprsi[si:ei+1])),4),
            "uprsi_max":round(float(np.max(uprsi[si:ei+1])),4),
        }
    }
    return ApiResponse(data=result)

