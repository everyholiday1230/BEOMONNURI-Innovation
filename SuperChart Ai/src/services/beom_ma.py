"""DARAK MA — Adaptive Unified Regime-Aware Moving Average.
9개 이동평균 합성 + VWMA + 시장 상태 적응형 가중치.
PRO 전용 지표.
"""
import numpy as np


def _nanmean_stack(arrays, fallback):
    """NaN 안전 평균 — 경고 없이 처리"""
    stacked = np.vstack(arrays)
    valid_count = np.sum(~np.isnan(stacked), axis=0)
    summed = np.nansum(stacked, axis=0)
    return np.where(valid_count > 0, summed / valid_count, fallback)


def _sma(src, length):
    src = np.asarray(src, dtype=float)
    out = np.full(len(src), np.nan, dtype=float)
    for i in range(length - 1, len(src)):
        window = src[i - length + 1:i + 1]
        if not np.isnan(window).any():
            out[i] = np.mean(window)
    return out


def _ema(src, length):
    """NaN 안전 EMA — DEMA/TEMA 연쇄 계산에서도 정상 동작"""
    src = np.asarray(src, dtype=float)
    out = np.full(len(src), np.nan, dtype=float)
    if len(src) < length:
        return out
    k = 2 / (length + 1)
    start = None
    for i in range(length - 1, len(src)):
        window = src[i - length + 1:i + 1]
        if not np.isnan(window).any():
            start = i
            out[i] = np.mean(window)
            break
    if start is None:
        return out
    for i in range(start + 1, len(src)):
        if np.isnan(src[i]):
            out[i] = out[i - 1]
        else:
            out[i] = src[i] * k + out[i - 1] * (1 - k)
    return out


def _wma(src, length):
    src = np.asarray(src, dtype=float)
    weights = np.arange(1, length + 1, dtype=float)
    out = np.full(len(src), np.nan, dtype=float)
    for i in range(length - 1, len(src)):
        window = src[i - length + 1:i + 1]
        if not np.isnan(window).any():
            out[i] = np.dot(window, weights) / weights.sum()
    return out


def _rma(src, length):
    """NaN 안전 RMA"""
    src = np.asarray(src, dtype=float)
    out = np.full(len(src), np.nan, dtype=float)
    if len(src) < length:
        return out
    alpha = 1 / length
    start = None
    for i in range(length - 1, len(src)):
        window = src[i - length + 1:i + 1]
        if not np.isnan(window).any():
            start = i
            out[i] = np.mean(window)
            break
    if start is None:
        return out
    for i in range(start + 1, len(src)):
        if np.isnan(src[i]):
            out[i] = out[i - 1]
        else:
            out[i] = src[i] * alpha + out[i - 1] * (1 - alpha)
    return out


def _dema(src, length):
    e1 = _ema(src, length)
    e2 = _ema(e1, length)
    return 2 * e1 - e2


def _tema(src, length):
    e1 = _ema(src, length)
    e2 = _ema(e1, length)
    e3 = _ema(e2, length)
    return 3 * e1 - 3 * e2 + e3


def _zlema(src, length):
    lag = (length - 1) // 2
    adjusted = np.copy(src).astype(float)
    for i in range(lag, len(src)):
        adjusted[i] = src[i] + (src[i] - src[i - lag])
    return _ema(adjusted, length)


def _hma(src, length):
    half = max(length // 2, 1)
    sqrt_len = max(int(np.sqrt(length)), 1)
    w1 = _wma(src, half)
    w2 = _wma(src, length)
    diff = 2 * w1 - w2
    return _wma(diff, sqrt_len)


def _vwma(src, volume, length):
    """거래량 가중 이동평균"""
    src = np.asarray(src, dtype=float)
    volume = np.asarray(volume, dtype=float)
    out = np.full(len(src), np.nan, dtype=float)
    for i in range(length - 1, len(src)):
        p = src[i - length + 1:i + 1]
        v = volume[i - length + 1:i + 1]
        vsum = np.sum(v)
        if vsum > 0 and not np.isnan(p).any():
            out[i] = np.sum(p * v) / vsum
    return out


def _efficiency_ratio(src, length):
    n = len(src)
    er = np.zeros(n)
    for i in range(length, n):
        change = abs(src[i] - src[i - length])
        volatility = sum(abs(src[j] - src[j - 1]) for j in range(i - length + 1, i + 1))
        er[i] = change / volatility if volatility > 0 else 0
    return np.clip(er, 0, 1)


def _kama(src, er_length=10, fast_len=2, slow_len=30):
    er = _efficiency_ratio(src, er_length)
    fast_sc = 2 / (fast_len + 1)
    slow_sc = 2 / (slow_len + 1)
    sc = (er * (fast_sc - slow_sc) + slow_sc) ** 2
    out = np.copy(src).astype(float)
    for i in range(1, len(src)):
        out[i] = out[i - 1] + sc[i] * (src[i] - out[i - 1])
    return out


def _true_range(highs, lows, closes):
    n = len(closes)
    tr = np.zeros(n)
    tr[0] = highs[0] - lows[0]
    for i in range(1, n):
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
    return tr


def compute_darak_ma(candles: list[dict], mode: str = "balanced", length: int = 20) -> dict:
    """DARAK MA 계산. candles: [{open,high,low,close,volume,...}]"""
    mode = mode.lower().strip()
    if mode not in ("balanced", "fast", "smooth"):
        mode = "balanced"

    n = len(candles)
    if n < length + 10:
        return {"ma": [], "signal": [], "upper": [], "lower": [], "confidence": [], "regime": []}

    highs = np.array([float(c.get("high", c.get("h", 0))) for c in candles])
    lows = np.array([float(c.get("low", c.get("l", 0))) for c in candles])
    closes = np.array([float(c.get("close", c.get("c", 0))) for c in candles])
    volumes = np.array([float(c.get("volume", c.get("v", 0))) for c in candles])

    src = (highs + lows + closes) / 3

    # 10개 MA
    ma_sma = _sma(src, length)
    ma_ema = _ema(src, length)
    ma_wma = _wma(src, length)
    ma_rma = _rma(src, length)
    ma_dema = _dema(src, length)
    ma_tema = _tema(src, length)
    ma_zlema = _zlema(src, length)
    ma_hma = _hma(src, length)
    ma_kama = _kama(src, er_length=10)
    ma_vwma = _vwma(src, volumes, length)

    # 그룹 평균 (NaN 안전)
    basic = _nanmean_stack([ma_sma, ma_ema, ma_wma, ma_rma], src)
    low_lag = _nanmean_stack([ma_dema, ma_tema, ma_zlema, ma_hma], src)
    adaptive = np.where(np.isnan(ma_kama), src, ma_kama)
    vol_group = np.where(np.isnan(ma_vwma), src, ma_vwma)

    # 시장 상태
    er = _efficiency_ratio(src, 10)
    tr = _true_range(highs, lows, closes)
    atr_s = _rma(tr, 14)
    atr_s = np.where(np.isnan(atr_s), 0, atr_s)

    trend_score = np.clip(er, 0, 1)
    chop_score = 1 - trend_score

    # 모드별 가중치 — 모든 모드에서 동적 적응
    if mode == "fast":
        w_basic, w_lowlag, w_adaptive, w_vol = 0.0, 0.75, 0.15, 0.10
        dw_basic = w_basic + 0.05 * chop_score
        dw_lowlag = w_lowlag + 0.10 * trend_score - 0.15 * chop_score
        dw_adaptive = w_adaptive + 0.05 * trend_score
        dw_vol = w_vol
    elif mode == "smooth":
        w_basic, w_lowlag, w_adaptive, w_vol = 0.70, 0.0, 0.15, 0.15
        dw_basic = w_basic + 0.10 * chop_score
        dw_lowlag = w_lowlag + 0.05 * trend_score
        dw_adaptive = w_adaptive + 0.05 * trend_score
        dw_vol = w_vol
    else:  # balanced
        w_basic, w_lowlag, w_adaptive, w_vol = 0.25, 0.30, 0.30, 0.15
        dw_basic = w_basic + 0.1 * chop_score
        dw_lowlag = w_lowlag + 0.2 * trend_score - 0.1 * chop_score
        dw_adaptive = w_adaptive + 0.1 * trend_score
        dw_vol = w_vol

    total = dw_basic + dw_lowlag + dw_adaptive + dw_vol
    dw_basic /= total
    dw_lowlag /= total
    dw_adaptive /= total
    dw_vol /= total

    # 합성
    raw = basic * dw_basic + low_lag * dw_lowlag + adaptive * dw_adaptive + vol_group * dw_vol

    # 적응형 평활
    fast_alpha = 2 / 4
    slow_alpha = 2 / 31
    dynamic_alpha = slow_alpha + (fast_alpha - slow_alpha) * trend_score

    ma = np.copy(raw)
    for i in range(1, n):
        if np.isnan(raw[i]):
            ma[i] = ma[i - 1]
        else:
            ma[i] = ma[i - 1] + dynamic_alpha[i] * (raw[i] - ma[i - 1])

    # Signal + Band
    signal = _ema(ma, 9)
    upper = ma + atr_s * 1.5
    lower = ma - atr_s * 1.5

    # Confidence (개선: trend + agreement + shock)
    dispersion = np.nanstd(np.vstack([basic, low_lag, adaptive]), axis=0)
    atr_safe = np.where(atr_s == 0, 1, atr_s)
    agreement = 1 - np.clip(dispersion / atr_safe, 0, 1)

    shock_score = np.clip((highs - lows) / atr_safe, 0, 3) / 3

    confidence = (
        0.45 * trend_score
        + 0.35 * agreement
        + 0.20 * (1 - shock_score)
    ) * 100
    confidence = np.clip(confidence, 0, 100)

    # Regime
    slope = np.diff(ma, prepend=ma[0])
    regime = []
    for i in range(n):
        if shock_score[i] > 0.70:
            regime.append("volatile")
        elif trend_score[i] > 0.55 and slope[i] > 0:
            regime.append("bull")
        elif trend_score[i] > 0.55 and slope[i] < 0:
            regime.append("bear")
        elif trend_score[i] < 0.35:
            regime.append("chop")
        else:
            regime.append("neutral")

    # NaN → None 변환
    def clean(arr):
        return [None if (isinstance(v, float) and np.isnan(v)) else float(v) for v in arr]

    return {
        "ma": clean(ma),
        "signal": clean(signal),
        "upper": clean(upper),
        "lower": clean(lower),
        "confidence": clean(confidence),
        "regime": regime,
    }
compute_beom_ma = compute_darak_ma
