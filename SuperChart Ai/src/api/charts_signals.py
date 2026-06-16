"""차트 시그널 API — TTR, 매수스캐너, 정렬, 패턴, 매물대, 추세선."""
from fastapi import APIRouter, Request
from src.models.schemas import ApiResponse
from src.services.market import fetch_candles
from src.services.symbol_resolver import resolve_symbol
from src.services.redis_cache import _get_cached, _set_cached
from src.services.beom_free import get_user_tier

router = APIRouter()

async def _require_pro(request: Request):
    """PRO 미만이면 pro_only 응답 반환, PRO면 None."""
    tier = await get_user_tier(request)
    if not tier:  # 로그인만 하면 사용 가능
        return ApiResponse(data={"_access": "pro_only"})
    return None

from src.services.pvi_nvi import compute_pvi_nvi_signals

@router.get("/orderblocks", response_model=ApiResponse)
async def get_order_blocks(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    blocked = await _require_pro(request)
    if blocked: return blocked
    """매물대(Order Block) 분석 — 강세/약세 블록 + 진입 시그널 반환."""
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"bull": [], "bear": [], "entry_signals": []})
    from src.services.snapshot import get_snapshot
    ob_data = await get_snapshot(symbolId, timeframe, candles, "order_blocks")
    # 진입 시그널은 캐시되지 않은 실시간 계산 (캔들과 함께 항상 재평가)
    from src.services.trade_zone import compute_ob_entry_signals
    try:
        signals = compute_ob_entry_signals(candles, ob_data)
    except Exception:
        signals = []
    return ApiResponse(data={**ob_data, "entry_signals": signals})


@router.get("/trendlines", response_model=ApiResponse)
async def get_trendlines(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    tier = await get_user_tier(request)
    if tier == "guest":
        return ApiResponse(data={"_access": "login_required"})
    """추세선 자동 감지 — 지지/저항 추세선 반환."""
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data=[])
    from src.services.snapshot import get_snapshot
    return ApiResponse(data=await get_snapshot(symbolId, timeframe, candles, "trendlines"))

@router.get("/signals/ttr", response_model=ApiResponse)
async def get_ttr(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    blocked = await _require_pro(request)
    if blocked: return blocked
    """TTR(Trend-Trigger-Reversal) 시그널 분석."""
    key = f"{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("ttr", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"signals": [], "psar_lagging": []})
    from src.services.scalp_exit import compute_ttr
    result = compute_ttr(candles)
    await _set_cached("ttr", key, result, 120)
    return ApiResponse(data=result)

@router.get("/signals/buy-scanner", response_model=ApiResponse)
async def get_buy_scanner(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, sma_fast: int = 5, sma_slow: int = 90, ema_long: int = 50, _t: str = "", ver: str = ""):
    blocked = await _require_pro(request)
    if blocked: return blocked
    key = f"{symbolId}:{timeframe}:{limit}:{sma_fast}:{sma_slow}:{ema_long}:{_t}:{ver}"
    cached = await _get_cached("bs", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data=[])
    from src.services.buy_scanner import compute_buy_scanner
    _bs_params = {"orig":(5,60,100),"1m":(5,90,100),"1y_old":(8,30,100),"1y":(5,120,100)}
    if ver in _bs_params: sma_fast,sma_slow,ema_long=_bs_params[ver]
    result = compute_buy_scanner(candles, sma_fast=sma_fast, sma_slow=sma_slow, ema_long=ema_long)
    await _set_cached("bs", key, result, 120)
    return ApiResponse(data=result)

@router.get("/signals/alignment", response_model=ApiResponse)
async def get_alignment(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000, con2: float = -1, con3: int = 30, _t: str = "", ver: str = ""):
    blocked = await _require_pro(request)
    if blocked: return blocked
    key = f"{symbolId}:{timeframe}:{limit}:{con2}:{con3}:{_t}:{ver}"
    cached = await _get_cached("al", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data=[])
    from src.services.ma_align import compute_alignment
    _align_params = {"orig":(-5,30),"1m":(-1,50),"1y_old":(0,30),"1y":(-30,5)}
    if ver in _align_params: con2,con3=_align_params[ver]
    result = compute_alignment(candles, con2=con2, con3=con3)
    await _set_cached("al", key, result, 120)
    return ApiResponse(data=result)

@router.get("/signals/ttr-opt", response_model=ApiResponse)
async def get_ttr_opt(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    blocked = await _require_pro(request)
    if blocked: return blocked
    key = f"{symbolId}:{timeframe}:{limit}:ttr_opt"
    cached = await _get_cached("ttr_opt", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data={"signals": [], "psar_lagging": []})
    from src.services.scalp_exit import compute_ttr
    result = compute_ttr(candles, psar_start=0.01, psar_inc=0.02, psar_max=0.05)
    await _set_cached("ttr_opt", key, result, 120)
    return ApiResponse(data=result)

@router.get("/signals/pvi-nvi", response_model=ApiResponse)
async def get_pvi_nvi(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    blocked = await _require_pro(request)
    if blocked: return blocked
    key = f"{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("pvinvi", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data=[])
    result = compute_pvi_nvi_signals(candles)
    await _set_cached("pvinvi", key, result, 120)
    return ApiResponse(data=result)

@router.get("/signals/patterns", response_model=ApiResponse)
async def get_patterns(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    blocked = await _require_pro(request)
    if blocked: return blocked
    key = f"{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("patterns", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles:
        return ApiResponse(data=[])
    from src.services.patterns import detect_patterns
    result = detect_patterns(candles)
    await _set_cached("patterns", key, result, 120)
    return ApiResponse(data=result)



# ═══════════════════════════════════════════
# Ladder v1.1 전략 신호 API
# ═══════════════════════════════════════════

@router.get("/ladder-signal", response_model=ApiResponse)
async def get_ladder_signal(request: Request, symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 2000):
    blocked = await _require_pro(request)
    if blocked: return blocked
    """Symmetric Market-State Ladder v1.1 전략 신호."""
    key = f"ladder:{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("ladder", key, 120)
    if cached is not None:
        return ApiResponse(data=cached)

    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles or len(candles) < 200:
        return ApiResponse(data={"regime": "BLOCKED", "action": "none", "reason": "insufficient_data"})

    import numpy as np
    from src.services.strategy_ultimate import calc_imacd
    from src.services.strategy_ladder import decide_ladder
    from src.services.beom_sub import _ema, _rsi, _stoch, _sma, _mfi, _rolling_min, _rolling_max

    c = np.array([float(x.get('close') or x.get('c', 0)) for x in candles])
    h = np.array([float(x.get('high') or x.get('h', 0)) for x in candles])
    l = np.array([float(x.get('low') or x.get('l', 0)) for x in candles])
    v = np.array([float(x.get('volume') or x.get('v', 0)) for x in candles])
    n = len(c); price = c[-1]

    # UltraTrend
    from src.services.snapshot import get_snapshot
    ut = await get_snapshot(symbolId, timeframe, candles, "ultra_trend")
    bars = ut.get('bars', [])
    ss = bars[-1].get('signal_sum', 0) if bars else 0
    ultra_dir = 1 if ss >= 5 else (-1 if ss <= -5 else 0)

    # Order Blocks + Trendlines
    obs_raw = await get_snapshot(symbolId, timeframe, candles, "order_blocks")
    tl_raw = await get_snapshot(symbolId, timeframe, candles, "trendlines")
    obs = []
    for b in obs_raw.get('bull', []):
        obs.append({'type': 'bull', 'top': b['top'], 'bottom': b['bottom']})
    for b in obs_raw.get('bear', []):
        obs.append({'type': 'bear', 'top': b['top'], 'bottom': b['bottom']})
    trendlines = tl_raw if isinstance(tl_raw, list) else []

    # 구조 근접 판정
    near_support = any(t.get('type') == 'support' and abs(price - t.get('price', 0)) / price < 0.01 for t in trendlines)
    near_resistance = any(t.get('type') == 'resistance' and abs(price - t.get('price', 0)) / price < 0.01 for t in trendlines)
    near_bull_zone = any(o['type'] == 'bull' and o['bottom'] <= price <= o['top'] * 1.005 for o in obs)
    near_bear_zone = any(o['type'] == 'bear' and o['bottom'] * 0.995 <= price <= o['top'] for o in obs)

    # VWAP + 122 MA 클러스터
    cluster = await get_snapshot(symbolId, timeframe, candles, "vwap_cluster")

    # Trade Pressure + Capital Flow
    tp = await get_snapshot(symbolId, timeframe, candles, "trade_pressure")
    cf = await get_snapshot(symbolId, timeframe, candles, "capital_flow")

    # iMACD
    md, sig, hist = calc_imacd(h, l, c)

    # ATR
    tr = np.maximum(h[1:]-l[1:], np.maximum(np.abs(h[1:]-c[:-1]), np.abs(l[1:]-c[:-1])))
    atr = np.mean(tr[-14:]) if len(tr) >= 14 else np.mean(tr) if len(tr) > 0 else 1

    # 과열/강도 (scaled_rsi, scaled_mfi, uprsi, upstoch)
    rsi_val = _ema(_rsi(c, 60), 3)
    lo_r = _rolling_min(rsi_val, 300); hi_r = _rolling_max(rsi_val, 300)
    uprsi = ((rsi_val - lo_r) / np.maximum(hi_r - lo_r, 1e-10) - 0.5)
    raw_stoch = _stoch(c, h, l, 14); k_stoch = _sma(raw_stoch, 9)
    lo_st = _rolling_min(k_stoch, 240); hi_st = _rolling_max(k_stoch, 240)
    upstoch = ((k_stoch - lo_st) / np.maximum(hi_st - lo_st, 1e-10) - 0.5)
    scaled_rsi = _rsi(c, 60) / 100 - 0.5
    scaled_mfi = _mfi(h, l, c, v, 60) / 100 - 0.5

    # STC (trend change 대용)
    d3 = _ema(c, 12) - _ema(c, 26)
    l3 = _rolling_min(d3, 60); h3 = _rolling_max(d3, 60)
    stn = (d3 - l3) / np.maximum(h3 - l3, 1e-10) - 0.5

    # 거래량
    vol_sma = _sma(v, 20)
    vol_ratio = float(v[-1] / vol_sma[-1]) if vol_sma[-1] > 0 else 1.0

    # Overheat 상태
    overheat = 0
    if scaled_rsi[-1] > 0.3 and scaled_mfi[-1] > 0.3: overheat = 1
    elif scaled_rsi[-1] < -0.3 and scaled_mfi[-1] < -0.3: overheat = -1

    # Master signal 방향 (범온 기반 간이)
    master_dir = 1 if ss >= 3 else (-1 if ss <= -3 else 0)

    # Trend change 방향
    tc_dir = 1 if stn[-1] > 0 and stn[-2] <= 0 else (-1 if stn[-1] < 0 and stn[-2] >= 0 else 0)

    # Alignment
    alignment = 'bull' if ultra_dir == 1 else ('bear' if ultra_dir == -1 else 'neutral')

    # 스냅샷 조립
    state = {
        'price': float(price), 'atr': float(atr),
        'bimaco_ss': int(ss), 'ultra_dir': ultra_dir, 'alignment': alignment,
        'stn': float(stn[-1]), 'stn_prev': float(stn[-2]),
        'scaled_rsi': float(scaled_rsi[-1]), 'scaled_mfi': float(scaled_mfi[-1]),
        'uprsi': float(uprsi[-1]), 'upstoch': float(upstoch[-1]),
        'uprsi_prev': float(uprsi[-2]), 'upstoch_prev': float(upstoch[-2]),
        'volume_ratio': vol_ratio, 'is_breakout': vol_ratio > 1.5,
        'imacd_md': float(md[-1]), 'imacd_md_prev': float(md[-2]),
        'imacd_hist': float(hist[-1]), 'imacd_hist_prev': float(hist[-2]),
        'imacd_sig': float(sig[-1]),
        'imacd_cross_up': bool(md[-1] > sig[-1] and md[-2] <= sig[-2]),
        'imacd_cross_down': bool(md[-1] < sig[-1] and md[-2] >= sig[-2]),
        'ai_target_pct': 2.0, 'sl_pct': 1.0,
        'trendlines': trendlines, 'obs': obs,
        'cluster_state': cluster['cluster_state'],
        'vwap_state': cluster['vwap_state'],
        'pressure_dir': tp['dir'], 'capital_flow_dir': cf['dir'],
        'ultra_high_dir': ultra_dir, 'master_high_dir': master_dir,
        'bimaco_high_abs': abs(ss),
        'overheat_state': overheat, 'trend_change_dir': tc_dir,
        'near_support': near_support, 'near_resistance': near_resistance,
        'near_bull_zone': near_bull_zone, 'near_bear_zone': near_bear_zone,
        'is_first_shock_bar': False,
        'risk': {},
    }

    result = decide_ladder(state, None, '5m/15m')

    # 과거 봉 신호 계산 — 모든 행동(enter/close/partial/hold/block/gate)
    signals = []
    scan_start = 300  # 전체 봉 스캔 (지표 warmup 이후)
    sim_pos = None  # 시뮬레이션 포지션 추적

    for i in range(scan_start, n):
        if i < 2: continue
        bar_ss = bars[i].get('signal_sum', 0) if i < len(bars) else 0
        bar_dir = 1 if bar_ss >= 5 else (-1 if bar_ss <= -5 else 0)

        # iMACD 크로스
        cross_up = bool(md[i] > sig[i] and md[i-1] <= sig[i-1])
        cross_down = bool(md[i] < sig[i] and md[i-1] >= sig[i-1])

        # 클러스터 (해당 봉)
        bar_above = sum(1 for m in [cluster['ema122'][i], cluster['sma122'][i], cluster['tema122'][i], cluster['wma122'][i], cluster['hma122'][i]] if c[i] > m)
        bar_bull = bar_above >= 3
        bar_bear = bar_above <= 2

        # VWAP 상태
        vwap_above = c[i] > cluster['vwap'][i]
        vwap_prev_above = c[i-1] > cluster['vwap'][i-1] if i > 0 else vwap_above
        bar_vwap = 'RECLAIM_UP' if vwap_above and not vwap_prev_above else ('REJECT_DOWN' if not vwap_above and vwap_prev_above else ('ABOVE' if vwap_above else 'BELOW'))

        # 과열
        bar_rsi = float(scaled_rsi[i]) if i < len(scaled_rsi) else 0
        bar_mfi = float(scaled_mfi[i]) if i < len(scaled_mfi) else 0
        bar_overheat = 1 if bar_rsi > 0.3 and bar_mfi > 0.3 else (-1 if bar_rsi < -0.3 and bar_mfi < -0.3 else 0)

        # 거래량
        bar_vol_ratio = float(v[i] / np.mean(v[max(0,i-20):i])) if i > 20 and np.mean(v[max(0,i-20):i]) > 0 else 1.0

        # ── 포지션 있을 때: 청산 판정 ──
        if sim_pos is not None:
            sd = sim_pos['dir']
            entry = sim_pos['entry']
            pnl = (c[i] - entry) / entry * sd
            side_str = 'long' if sd == 1 else 'short'
            bar_atr = abs(h[i] - l[i]) if abs(h[i] - l[i]) > 0 else 1

            # 비상 손절 (ATR 기반)
            if sd == 1 and c[i] < entry - bar_atr * 3:
                signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': 'emergency_sl', 'side': side_str})
                sim_pos = None; continue
            if sd == -1 and c[i] > entry + bar_atr * 3:
                signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': 'emergency_sl', 'side': side_str})
                sim_pos = None; continue

            # 범온 반전
            if sd == 1 and bar_ss <= -8:
                signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': 'bimaco_reverse', 'side': side_str})
                sim_pos = None; continue
            if sd == -1 and bar_ss >= 8:
                signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': 'bimaco_reverse', 'side': side_str})
                sim_pos = None; continue

            # VWAP 실패
            if sd == 1 and bar_vwap == 'REJECT_DOWN' and cross_down:
                signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': 'vwap_fail', 'side': side_str})
                sim_pos = None; continue
            if sd == -1 and bar_vwap == 'RECLAIM_UP' and cross_up:
                signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': 'vwap_fail', 'side': side_str})
                sim_pos = None; continue

            # iMACD 반전 크로스
            if sd == 1 and cross_down:
                r = 'imacd_cross' if pnl > 0 else 'imacd_sl'
                signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': r, 'side': side_str})
                sim_pos = None; continue
            if sd == -1 and cross_up:
                r = 'imacd_cross' if pnl > 0 else 'imacd_sl'
                signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': r, 'side': side_str})
                sim_pos = None; continue

            # 추세 전환
            if sd == 1 and bar_dir == -1 and bar_ss <= -5:
                signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': 'trend_reverse', 'side': side_str})
                sim_pos = None; continue
            if sd == -1 and bar_dir == 1 and bar_ss >= 5:
                signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': 'trend_reverse', 'side': side_str})
                sim_pos = None; continue

            # 과열 부분청산
            if pnl > 0.005 and ((sd == 1 and bar_overheat == 1) or (sd == -1 and bar_overheat == -1)):
                signals.append({'index': i, 'type': 'partial', 'price': float(c[i]), 'reason': 'heat_tp1', 'side': side_str})

            # 강도 둔화 부분청산
            bar_uprsi = float(uprsi[i]) if i < len(uprsi) else 0
            bar_upstoch = float(upstoch[i]) if i < len(upstoch) else 0
            if pnl > 0.003 and ((sd == 1 and bar_uprsi < -0.1 and bar_upstoch < -0.1) or (sd == -1 and bar_uprsi > 0.1 and bar_upstoch > 0.1)):
                signals.append({'index': i, 'type': 'partial', 'price': float(c[i]), 'reason': 'strength_fade', 'side': side_str})

            # 모멘텀 소진
            if pnl > 0.01:
                imacd_weak = (sd == 1 and hist[i] < hist[i-1]) or (sd == -1 and hist[i] > hist[i-1])
                if imacd_weak and bar_uprsi * sd < 0:
                    signals.append({'index': i, 'type': 'close', 'price': float(c[i]), 'reason': 'momentum_fade', 'side': side_str})
                    sim_pos = None; continue

            continue

        # ── 포지션 없을 때: 진입/보류/차단 판정 ──
        # 게이트 체크
        gate_fails = []
        if bar_overheat == 1: gate_fails.append('overheat')
        if bar_overheat == -1: gate_fails.append('oversold')

        # 롱 진입
        if cross_up and bar_dir >= 0 and bar_bull and bar_vwap in ('ABOVE','RECLAIM_UP'):
            if gate_fails:
                signals.append({'index': i, 'type': 'gate', 'price': float(l[i]), 'reason': ','.join(gate_fails), 'side': 'long'})
            else:
                signals.append({'index': i, 'type': 'enter_long', 'price': float(l[i]), 'score': int(bar_ss)})
                sim_pos = {'dir': 1, 'entry': float(c[i])}
        # 숏 진입
        elif cross_down and bar_dir <= 0 and bar_bear and bar_vwap in ('BELOW','REJECT_DOWN'):
            if gate_fails:
                signals.append({'index': i, 'type': 'gate', 'price': float(h[i]), 'reason': ','.join(gate_fails), 'side': 'short'})
            else:
                signals.append({'index': i, 'type': 'enter_short', 'price': float(h[i]), 'score': int(bar_ss)})
                sim_pos = {'dir': -1, 'entry': float(c[i])}
        # iMACD 크로스는 있지만 다른 조건 불일치 → hold
        elif cross_up or cross_down:
            reasons = []
            if cross_up:
                if bar_dir < 0: reasons.append('bimaco_oppose')
                if not bar_bull: reasons.append('cluster_bear')
                if bar_vwap not in ('ABOVE','RECLAIM_UP'): reasons.append('vwap_below')
            else:
                if bar_dir > 0: reasons.append('bimaco_oppose')
                if not bar_bear: reasons.append('cluster_bull')
                if bar_vwap not in ('BELOW','REJECT_DOWN'): reasons.append('vwap_above')
            if reasons:
                signals.append({'index': i, 'type': 'hold', 'price': float(c[i]), 'reason': ','.join(reasons), 'side': 'long' if cross_up else 'short'})

    # 프론트엔드용 요약
    output = {
        'regime': result.get('regime', 'RANGE'),
        'regime_confidence': result.get('regime_confidence', 0),
        'engine': result.get('engine', 'none'),
        'mode': result.get('mode', ''),
        'action': result.get('action', 'none'),
        'side': result.get('side', ''),
        'reason': result.get('reason', ''),
        'total': result.get('total', 0),
        'grade': result.get('grade', 'F'),
        'threshold': result.get('threshold', 0),
        'gates_pass': result.get('gates_pass', False),
        'gates': result.get('gates', []),
        'scores': result.get('scores', {}),
        'cluster_state': cluster['cluster_state'],
        'vwap_state': cluster['vwap_state'],
        'pressure': {'dir': tp['dir'], 'value': tp['value']},
        'capital_flow': {'dir': cf['dir'], 'value': cf['value']},
        'bimaco_ss': int(ss),
        'ultra_dir': ultra_dir,
        'signals': signals,
    }

    await _set_cached("ladder", key, output, 60)
    return ApiResponse(data=output)


@router.get("/entry-signal", response_model=ApiResponse)
async def get_entry_signal(symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 500):
    """복합 진입 시그널 — 볼린저+IMACD+강도+과열+압력+자금+범온."""
    from src.services.redis_cache import _get_cached, _set_cached
    key = f"entry_sig:{symbolId}:{timeframe}:{limit}"
    cached = await _get_cached("entry_sig", key, 60)
    if cached is not None:
        return ApiResponse(data=cached)

    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit)
    if not candles or len(candles) < 100:
        return ApiResponse(data={"signals": [], "candle_count": len(candles) if candles else 0})
    if False:
        return ApiResponse(data={"signals": []})

    from src.services.signal_entry import compute_entry_signals
    try:
        signals = compute_entry_signals(candles)
    except Exception as e:
        return ApiResponse(data={"signals": [], "error": str(e)})

    data = {"signals": signals[-20:]}  # 최근 20개만
    await _set_cached("entry_sig", key, data, 60)
    return ApiResponse(data=data)
