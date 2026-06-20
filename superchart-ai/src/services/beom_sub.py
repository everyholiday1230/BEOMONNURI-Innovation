"""UpDownRSI + Stoch + MFI + RSI + STC 복합 지표."""
import numpy as np


def _rma(d, p):
    r = np.empty(len(d), dtype=float); r[0] = d[0]; a = 1/p
    for i in range(1, len(d)): r[i] = a*d[i] + (1-a)*r[i-1]
    return r

def _ema(d, p):
    a = 2/(p+1); r = np.empty(len(d), dtype=float); r[0] = d[0]
    for i in range(1, len(d)): r[i] = a*d[i] + (1-a)*r[i-1]
    return r

def _sma(d, p):
    r = np.empty(len(d), dtype=float)
    cs = np.cumsum(d)
    r[:p-1] = cs[:p-1] / np.arange(1, p)
    r[p-1:] = (cs[p-1:] - np.concatenate([[0], cs[:len(d)-p]])) / p
    return r

def _rsi(close, period):
    dl = np.diff(close, prepend=close[0])
    gn = _rma(np.where(dl > 0, dl, 0), period)
    ls = _rma(np.where(dl < 0, -dl, 0), period)
    return 100 - 100 / (1 + gn / np.maximum(ls, 1e-10))

def _stoch(close, high, low, length):
    n = len(close)
    r = np.zeros(n)
    for i in range(length-1, n):
        lo = np.min(low[i-length+1:i+1])
        hi = np.max(high[i-length+1:i+1])
        r[i] = (close[i] - lo) / max(hi - lo, 1e-10) * 100
    return r

def _mfi(high, low, close, volume, length):
    tp = (high + low + close) / 3
    mf = tp * volume
    n = len(close)
    r = np.zeros(n)
    for i in range(length, n):
        pos = neg = 0.0
        for j in range(i-length+1, i+1):
            if tp[j] > tp[j-1]: pos += mf[j]
            else: neg += mf[j]
        r[i] = 100 - 100 / (1 + pos / max(neg, 1e-10))
    return r

def _rolling_min(d, p):
    from collections import deque
    n = len(d); r = np.empty(n); q = deque()
    for i in range(n):
        while q and q[0] < i-p+1: q.popleft()
        while q and d[q[-1]] >= d[i]: q.pop()
        q.append(i)
        r[i] = d[q[0]]
    return r

def _rolling_max(d, p):
    from collections import deque
    n = len(d); r = np.empty(n); q = deque()
    for i in range(n):
        while q and q[0] < i-p+1: q.popleft()
        while q and d[q[-1]] <= d[i]: q.pop()
        q.append(i)
        r[i] = d[q[0]]
    return r


def compute_uprsi_stc(candles: list[dict], rsi_period=60, rsi_lookback=300, stoch_len=60, stoch_smoothK=9, stoch_lookback=240, rsi_smooth=1, stoch_smooth=1, stc1_period=26, stc_fast=50, stc_slow=100, stc2_period=100) -> dict:
    n = len(candles)
    if n < 30:
        return {"a": [], "b": [], "c": [], "d": [],
                "e": [], "f": [], "g": [], "h": [], "s": []}
    # 봉 수가 적은 TF(주봉/월봉 등)에서도 동작하도록 룩백/기간을 데이터 길이로 클램프
    if n < 300:
        rsi_period = min(rsi_period, max(2, n - 1))
        rsi_lookback = min(rsi_lookback, n)
        stoch_len = min(stoch_len, max(2, n - 1))
        stoch_lookback = min(stoch_lookback, n)
        stc1_period = min(stc1_period, max(2, n - 1))
        stc_fast = min(stc_fast, max(2, n - 1))
        stc_slow = min(stc_slow, max(2, n - 1))
        stc2_period = min(stc2_period, max(2, n - 1))

    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h", 0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l", 0)) for x in candles])
    v = np.array([float(x.get("volume") or x.get("v", 0)) for x in candles])

    # RSI (period=60)
    rsi_val = _rsi(c, rsi_period)

    # RSI 스무딩
    if rsi_smooth > 1: rsi_val = _ema(rsi_val, rsi_smooth)
    # UpDown RSI
    lo_rsi = _rolling_min(rsi_val, rsi_lookback)
    hi_rsi = _rolling_max(rsi_val, rsi_lookback)
    rng = np.maximum(hi_rsi - lo_rsi, 1e-10)
    norm_rsi = (rsi_val - lo_rsi) / rng
    downrsi = norm_rsi * (-1) + 0.5
    uprsi = norm_rsi - 0.5

    # Stochastic (length=60, smoothK=9, smoothD=5, lookback=240)
    raw_stoch = _stoch(c, h, l, stoch_len)
    k = _sma(raw_stoch, stoch_smoothK)
    if stoch_smooth > 1: k = _ema(k, stoch_smooth)
    lo_k = _rolling_min(k, stoch_lookback)
    hi_k = _rolling_max(k, stoch_lookback)
    rng_k = np.maximum(hi_k - lo_k, 1e-10)
    norm_k = (k - lo_k) / rng_k
    downstoch = norm_k * (-1) + 0.5
    upstoch = norm_k - 0.5

    # Scaled RSI
    scaled_rsi = rsi_val / 100 - 0.5

    # Scaled MFI
    mfi_val = _mfi(h, l, c, v, 60)
    scaled_mfi = mfi_val / 100 - 0.5

    # STC (Schaff Trend Cycle)
    def calc_stc(period, fast_len, slow_len, sf=0.4):
        diff = _ema(c, fast_len) - _ema(c, slow_len)
        lo_d = _rolling_min(diff, period)
        hi_d = _rolling_max(diff, period)
        rng_d = np.maximum(hi_d - lo_d, 1e-10)
        cycle = (diff - lo_d) / rng_d * 100

        temp_low = np.zeros(n)
        temp_low[0] = cycle[0]
        for i in range(1, n):
            temp_low[i] = temp_low[i-1] + sf * (cycle[i] - temp_low[i-1])

        lo_tl = _rolling_min(temp_low, period)
        hi_tl = _rolling_max(temp_low, period)
        rng_tl = np.maximum(hi_tl - lo_tl, 1e-10)
        temp_high = (temp_low - lo_tl) / rng_tl * 100

        stc = np.zeros(n)
        stc[0] = temp_high[0]
        for i in range(1, n):
            stc[i] = stc[i-1] + sf * (temp_high[i] - stc[i-1])
        return stc / 100 - 0.5

    stc1 = calc_stc(stc1_period, stc_fast, stc_slow)
    stc2 = calc_stc(stc2_period, stc_fast, stc_slow)

    # STC 색상
    def stc_color1(i):
        if stc1[i] > 0.45: return "red"
        if stc1[i] < -0.45: return "blue"
        if i > 0 and stc1[i] > stc1[i-1]: return "red"
        if i > 0 and stc1[i] < stc1[i-1]: return "blue"
        return "purple"

    def stc_color2(i):
        if stc2[i] > 0.45: return "maroon"
        if stc2[i] < -0.45: return "navy"
        if i > 0 and stc2[i] > stc2[i-1]: return "maroon"
        if i > 0 and stc2[i] < stc2[i-1]: return "navy"
        return "purple"

    # 시그널
    signals = []
    for i in range(1, n):
        sc1 = stc_color1(i)
        sc2 = stc_color2(i)
        buy = uprsi[i] > 0.1 and upstoch[i] > 0.1 and scaled_rsi[i] > 0 and scaled_mfi[i] > 0 and sc1 == "red" and sc2 == "maroon"
        sell = downrsi[i] > 0.1 and downstoch[i] > 0.1 and scaled_rsi[i] < 0 and scaled_mfi[i] < 0 and sc1 == "blue" and sc2 == "navy"

        # 전환 시점만
        if i > 1:
            prev_sc1 = stc_color1(i-1)
            prev_sc2 = stc_color2(i-1)
            prev_buy = uprsi[i-1] > 0.1 and upstoch[i-1] > 0.1 and scaled_rsi[i-1] > 0 and scaled_mfi[i-1] > 0 and prev_sc1 == "red" and prev_sc2 == "maroon"
            prev_sell = downrsi[i-1] > 0.1 and downstoch[i-1] > 0.1 and scaled_rsi[i-1] < 0 and scaled_mfi[i-1] < 0 and prev_sc1 == "blue" and prev_sc2 == "navy"
            if buy and not prev_buy:
                signals.append({"index": i, "type": "buy", "price": float(l[i])})
            if sell and not prev_sell:
                signals.append({"index": i, "type": "sell", "price": float(h[i])})

    # 서브차트 데이터
    def to_list(arr):
        return [{"index": i, "value": round(float(arr[i]), 4)} for i in range(n)]

    return {
        "a": to_list(uprsi),
        "b": to_list(downrsi),
        "c": to_list(upstoch),
        "d": to_list(downstoch),
        "e": to_list(scaled_rsi),
        "f": to_list(scaled_mfi),
        "g": [{"index": i, "value": round(float(stc1[i]), 4), "color": stc_color1(i)} for i in range(n)],
        "h": [{"index": i, "value": round(float(stc2[i]), 4), "color": stc_color2(i)} for i in range(n)],
        "s": signals,
    }
compute_beom_sub = compute_uprsi_stc
