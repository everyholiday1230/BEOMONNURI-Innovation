"""VWAP + 122 MA 클러스터 — Symmetric Market-State Ladder v1.1 확장 필터.

6개 지표: EMA122, SMA122, TEMA122, WMA122, HMA122, VWAP
단일 MA가 아닌 클러스터 합의 방식으로 방향 판정.
"""
import numpy as np


def _ema(src, period):
    a = 2.0 / (period + 1)
    r = np.empty_like(src, dtype=float)
    r[0] = src[0]
    for i in range(1, len(src)):
        r[i] = a * src[i] + (1 - a) * r[i - 1]
    return r


def _sma(src, period):
    n = len(src)
    r = np.empty(n, dtype=float)
    cs = np.cumsum(src)
    r[:period - 1] = cs[:period - 1] / np.arange(1, period)
    r[period - 1:] = (cs[period - 1:] - np.concatenate([[0], cs[:n - period]])) / period
    return r


def _wma(src, period):
    """가중이동평균 — 최근 가격에 더 높은 가중치."""
    n = len(src)
    r = np.empty(n, dtype=float)
    weights = np.arange(1, period + 1, dtype=float)
    w_sum = weights.sum()
    for i in range(n):
        if i < period - 1:
            w = np.arange(1, i + 2, dtype=float)
            r[i] = np.dot(src[:i + 1], w) / w.sum()
        else:
            r[i] = np.dot(src[i - period + 1:i + 1], weights) / w_sum
    return r


def _hma(src, period):
    """Hull Moving Average — 전환 감지에 유리."""
    half = max(1, period // 2)
    sqrt_p = max(1, int(np.sqrt(period)))
    wma_half = _wma(src, half)
    wma_full = _wma(src, period)
    diff = 2 * wma_half - wma_full
    return _wma(diff, sqrt_p)


def _tema(src, period):
    """Triple EMA — 빠른 복귀 감지."""
    e1 = _ema(src, period)
    e2 = _ema(e1, period)
    e3 = _ema(e2, period)
    return 3 * e1 - 3 * e2 + e3


def _vwap_session(close, high, low, volume):
    """Session VWAP — UTC 일간 기준. 캔들 데이터에서 계산."""
    n = len(close)
    tp = (high + low + close) / 3.0
    cum_tp_vol = np.cumsum(tp * volume)
    cum_vol = np.cumsum(volume)
    vwap = np.where(cum_vol > 0, cum_tp_vol / cum_vol, close)
    return vwap


def _slope(arr, lookback=3):
    """최근 lookback 봉 기울기 방향. +1 상승, -1 하락, 0 중립."""
    n = len(arr)
    slopes = np.zeros(n, dtype=float)
    for i in range(lookback, n):
        slopes[i] = arr[i] - arr[i - lookback]
    return slopes


def compute_vwap_ma_cluster(candles, period=122):
    """VWAP + 122 MA 클러스터 계산.

    Returns: {
        'ema122': array, 'sma122': array, 'tema122': array,
        'wma122': array, 'hma122': array, 'vwap': array,
        'above_count': int,      # close > 각 MA 개수 (최신 봉)
        'below_count': int,
        'slope_up_count': int,   # 기울기 상승 MA 개수
        'slope_down_count': int,
        'cluster_state': str,    # STRONG_BULL/WEAK_BULL/NEUTRAL/WEAK_BEAR/STRONG_BEAR
        'vwap_state': str,       # ABOVE/BELOW/RECLAIM_UP/REJECT_DOWN/NEUTRAL
        'vwap_distance_pct': float,
    }
    """
    n = len(candles)
    if n < period + 10:
        return _empty_result(n)

    c = np.array([float(x.get('close') or x.get('c', 0)) for x in candles])
    h = np.array([float(x.get('high') or x.get('h', 0)) for x in candles])
    l = np.array([float(x.get('low') or x.get('l', 0)) for x in candles])
    v = np.array([float(x.get('volume') or x.get('v', 0)) for x in candles])

    # 6개 MA 계산
    ema122 = _ema(c, period)
    sma122 = _sma(c, period)
    tema122 = _tema(c, period)
    wma122 = _wma(c, period)
    hma122 = _hma(c, period)
    vwap = _vwap_session(c, h, l, v)

    # 최신 봉 기준 클러스터 상태
    price = c[-1]
    mas = [ema122[-1], sma122[-1], tema122[-1], wma122[-1], hma122[-1]]

    above_count = sum(1 for m in mas if price > m)
    below_count = sum(1 for m in mas if price < m)

    # 기울기 (최근 3봉)
    slopes = [
        _slope(ema122, 3)[-1],
        _slope(sma122, 3)[-1],
        _slope(tema122, 3)[-1],
        _slope(wma122, 3)[-1],
        _slope(hma122, 3)[-1],
    ]
    slope_up_count = sum(1 for s in slopes if s > 0)
    slope_down_count = sum(1 for s in slopes if s < 0)

    # 클러스터 상태 판정
    if above_count >= 4 and slope_up_count >= 3:
        cluster_state = 'STRONG_BULL'
    elif above_count >= 3 and slope_up_count >= 2:
        cluster_state = 'WEAK_BULL'
    elif below_count >= 4 and slope_down_count >= 3:
        cluster_state = 'STRONG_BEAR'
    elif below_count >= 3 and slope_down_count >= 2:
        cluster_state = 'WEAK_BEAR'
    else:
        cluster_state = 'NEUTRAL'

    # VWAP 상태 판정
    vwap_val = vwap[-1]
    vwap_prev = vwap[-2] if n > 1 else vwap_val
    price_prev = c[-2] if n > 1 else price
    vwap_distance_pct = (price - vwap_val) / vwap_val * 100 if vwap_val > 0 else 0

    if price > vwap_val and price_prev > vwap_prev:
        vwap_state = 'ABOVE'
    elif price < vwap_val and price_prev < vwap_prev:
        vwap_state = 'BELOW'
    elif price > vwap_val and price_prev <= vwap_prev:
        vwap_state = 'RECLAIM_UP'
    elif price < vwap_val and price_prev >= vwap_prev:
        vwap_state = 'REJECT_DOWN'
    else:
        vwap_state = 'NEUTRAL'

    # 시계열 데이터 (프론트엔드 표시용)
    ma_data = []
    for i in range(n):
        ma_data.append({
            'index': i,
            'ema122': round(float(ema122[i]), 2),
            'sma122': round(float(sma122[i]), 2),
            'tema122': round(float(tema122[i]), 2),
            'wma122': round(float(wma122[i]), 2),
            'hma122': round(float(hma122[i]), 2),
            'vwap': round(float(vwap[i]), 2),
        })

    return {
        'ma_data': ma_data,
        'ema122': ema122,
        'sma122': sma122,
        'tema122': tema122,
        'wma122': wma122,
        'hma122': hma122,
        'vwap': vwap,
        'above_count': above_count,
        'below_count': below_count,
        'slope_up_count': slope_up_count,
        'slope_down_count': slope_down_count,
        'cluster_state': cluster_state,
        'vwap_state': vwap_state,
        'vwap_distance_pct': round(vwap_distance_pct, 3),
    }


def _empty_result(n):
    return {
        'ma_data': [],
        'ema122': np.zeros(n), 'sma122': np.zeros(n), 'tema122': np.zeros(n),
        'wma122': np.zeros(n), 'hma122': np.zeros(n), 'vwap': np.zeros(n),
        'above_count': 0, 'below_count': 0,
        'slope_up_count': 0, 'slope_down_count': 0,
        'cluster_state': 'NEUTRAL', 'vwap_state': 'NEUTRAL', 'vwap_distance_pct': 0,
    }
