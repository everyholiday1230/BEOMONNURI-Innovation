"""초강력 통합 트렌드 시스템 — Pine Script 완벽 포팅.

12개 지표 signal_sum + 칼만 크로스 + 재테스트 + 목표 라인.
"""
import numpy as np
import pandas as pd


def _ema(data, span):
    a = 2 / (span + 1)
    r = np.empty_like(data, dtype=float)
    r[0] = data[0]
    for i in range(1, len(data)):
        r[i] = a * data[i] + (1 - a) * r[i - 1]
    return r


def _rma(data, period):
    """Wilder's RMA (= EMA with alpha=1/period)."""
    a = 1.0 / period
    r = np.empty_like(data, dtype=float)
    r[0] = data[0]
    for i in range(1, len(data)):
        r[i] = a * data[i] + (1 - a) * r[i - 1]
    return r


def _sma(data, period):
    n = len(data)
    if n == 0:
        return np.array([], dtype=float)
    p = max(1, int(period))
    r = np.empty(n, dtype=float)
    head = min(p - 1, n)
    r[:head] = np.asarray(data[:head], dtype=float)
    if n >= p:
        cs = np.cumsum(np.asarray(data, dtype=float))
        r[p - 1:] = (cs[p - 1:] - np.concatenate([[0], cs[:n - p]])) / p
    return r


def _kalman(src, length, R=0.01, Q=0.1):
    n = len(src)
    est = np.zeros(n)
    est[0] = src[0]
    err_est = 1.0
    err_meas = R * length
    for i in range(1, n):
        gain = err_est / (err_est + err_meas)
        est[i] = est[i - 1] + gain * (src[i] - est[i - 1])
        err_est = (1 - gain) * err_est + Q / length
    return est


def _atr(h, l, c, period):
    tr = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    tr = np.concatenate([[h[0] - l[0]], tr])
    return _rma(tr, period)


def _adx_dmi(h, l, c, adx_len, smoothing):
    n = len(c)
    up = h[1:] - h[:-1]
    down = l[:-1] - l[1:]
    plus_dm = np.where((up > down) & (up > 0), up, 0)
    minus_dm = np.where((down > up) & (down > 0), down, 0)
    plus_dm = np.concatenate([[0], plus_dm])
    minus_dm = np.concatenate([[0], minus_dm])
    atr_v = _atr(h, l, c, adx_len)
    atr_v[atr_v == 0] = 1e-10
    di_plus = _rma(plus_dm, adx_len) / atr_v * 100
    di_minus = _rma(minus_dm, adx_len) / atr_v * 100
    return di_plus, di_minus


def _macd(src, fast, slow, signal):
    ef = _ema(src, fast)
    es = _ema(src, slow)
    ml = ef - es
    sl = _ema(ml, signal)
    return ml, sl


def _smma(src, length):
    r = np.zeros_like(src)
    r[0] = src[0]
    for i in range(1, len(src)):
        r[i] = (r[i - 1] * (length - 1) + src[i]) / length
    return r


def _zlema(src, length):
    e1 = _ema(src, length)
    e2 = _ema(e1, length)
    return e1 + (e1 - e2)


def compute_ultra_trend(candles: list[dict]) -> dict:
    """전체 시스템 계산. 캔들별 결과 반환."""
    n = len(candles)
    if n < 50:
        return {"d": [], "s": [], "x": [], "targets": [], "t": {}}

    o = np.array([float(x.get("open") or x.get("o", 0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h", 0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l", 0)) for x in candles])
    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])
    v = np.array([float(x.get("volume") or x.get("v", 0)) for x in candles])

    # 하이킨아시 변환
    ha_c = (o + h + l + c) / 4
    ha_o = np.empty_like(o)
    ha_o[0] = (o[0] + c[0]) / 2
    for i in range(1, n):
        ha_o[i] = (ha_o[i - 1] + ha_c[i - 1]) / 2
    ha_h = np.maximum(h, np.maximum(ha_o, ha_c))
    ha_l = np.minimum(l, np.minimum(ha_o, ha_c))

    # 지표 계산은 하이킨아시 기반
    c_calc, o_calc, h_calc, l_calc = ha_c, ha_o, ha_h, ha_l

    # ═══ 칼만 필터 ═══
    sk = _kalman(c_calc, 50)
    lk = _kalman(c_calc, 150)
    kalman_up = sk > lk
    kalman_str = np.zeros(n, dtype=bool)
    kalman_str[2:] = sk[2:] > sk[:-2]

    # ═══ CE ═══
    atr50 = _atr(h_calc, l_calc, c_calc, 50)
    atr_ce = 5.0 * atr50
    highest_c = pd.Series(c_calc).rolling(50, min_periods=1).max().to_numpy(copy=True)
    lowest_c = pd.Series(c_calc).rolling(50, min_periods=1).min().to_numpy(copy=True)
    long_stop = highest_c - atr_ce
    short_stop = lowest_c + atr_ce
    prev_short_stop = np.concatenate([[short_stop[0]], short_stop[:-1]])
    prev_long_stop = np.concatenate([[long_stop[0]], long_stop[:-1]])
    ce_up = c_calc > prev_short_stop
    ce_down = c_calc < prev_long_stop

    # ═══ ADX/MACD ═══
    di_p, di_m = _adx_dmi(h_calc, l_calc, c_calc, 28, 10)
    ml, sl = _macd(c_calc, 24, 52, 18)
    adx_up = (di_p > di_m) & (ml > sl)
    adx_down = (di_m > di_p) & (sl > ml)

    # ═══ Z-Score ═══
    sma75 = _sma(c_calc, 75)
    std75 = pd.Series(c_calc).rolling(75, min_periods=1).std().to_numpy(copy=True)
    std75[std75 == 0] = 1e-10
    zscore = (c_calc - sma75) / std75

    # ═══ Trend Speed ═══
    trend_ema = _ema(c_calc, 50)
    rma_c = _rma(c_calc, 10)
    rma_o = _rma(o_calc, 10)
    speed = np.zeros(n)
    for i in range(2, n):
        if trend_ema[i] > trend_ema[i - 1] and trend_ema[i - 1] <= trend_ema[i - 2]:
            speed[i] = rma_c[i] - rma_o[i]
        elif trend_ema[i] < trend_ema[i - 1] and trend_ema[i - 1] >= trend_ema[i - 2]:
            speed[i] = rma_c[i] - rma_o[i]
        else:
            speed[i] = speed[i - 1] + rma_c[i] - rma_o[i]

    # ═══ CSIMACD ═══
    hlc3 = (h_calc + l_calc + c_calc) / 3
    hi_smma = _smma(h_calc, 34)
    lo_smma = _smma(l_calc, 34)
    mi_zlema = _zlema(hlc3, 34)
    md = np.where(mi_zlema > hi_smma, mi_zlema - hi_smma, np.where(mi_zlema < lo_smma, mi_zlema - lo_smma, 0))
    sb = _sma(md, 9)
    csi_buy = np.zeros(n)
    csi_sell = np.zeros(n)
    for i in range(n):
        bc = (1 if (hlc3[i] > mi_zlema[i]) else 0) + (1 if md[i] > 0 else 0) + (1 if md[i] > sb[i] else 0)
        sc = (1 if (hlc3[i] < mi_zlema[i]) else 0) + (1 if md[i] < 0 else 0) + (1 if md[i] < sb[i] else 0)
        csi_buy[i] = bc
        csi_sell[i] = sc

    # ═══ LOWESS (EMA proxy) ═══
    sm = _ema(c_calc, 30)
    sm_up = np.zeros(n, dtype=bool)
    sm_up[2:] = sm[2:] > sm[:-2]

    # ═══ Market Structure ═══
    h_roll = pd.Series(h_calc).rolling(20).max().shift(10).to_numpy(copy=True)
    m_up = h_calc > h_roll

    # ═══ Range Filter ═══
    avrng = _ema(np.abs(np.diff(c_calc, prepend=c_calc[0])), 100)
    smrng = _ema(avrng, 199) * 3.0
    filt = np.zeros(n)
    filt[0] = c[0]
    for i in range(1, n):
        if c_calc[i] > filt[i - 1]:
            filt[i] = max(filt[i - 1], c_calc[i] - smrng[i])
        else:
            filt[i] = min(filt[i - 1], c_calc[i] + smrng[i])
    upward = np.zeros(n)
    downward = np.zeros(n)
    for i in range(1, n):
        if filt[i] > filt[i - 1]:
            upward[i] = upward[i - 1] + 1
        elif filt[i] < filt[i - 1]:
            downward[i] = downward[i - 1] + 1

    # ═══ Adaptive Trend ═══
    typ = hlc3
    fast_e = _ema(typ, 10)
    slow_e = _ema(typ, 20)
    basis = (fast_e + slow_e) / 2
    vol_std = pd.Series(typ).rolling(10, min_periods=1).std().to_numpy(copy=True)
    smooth_vol = _ema(vol_std, 14)
    upper_band = basis + smooth_vol * 2.0
    lower_band = basis - smooth_vol * 2.0
    adaptive_up = np.zeros(n, dtype=bool)
    trend_state = 0
    for i in range(1, n):
        if trend_state == 1 and c_calc[i] < lower_band[i]:
            trend_state = -1
        elif trend_state != 1 and c_calc[i] > upper_band[i]:
            trend_state = 1
        elif trend_state == 0:
            trend_state = 1 if c_calc[i] > basis[i] else -1
        adaptive_up[i] = trend_state == 1

    # ═══ Composite ═══
    composite_up = sm_up & m_up & (upward > 0) & adaptive_up
    composite_down = (~sm_up) & (~m_up) & (downward > 0) & (~adaptive_up)

    # ═══ Signal Sum ═══
    signal_sum = np.zeros(n, dtype=int)
    for i in range(n):
        ss = (1 if kalman_up[i] else -1) + \
             (1 if kalman_str[i] else -1) + \
             (1 if ce_up[i] else (-1 if ce_down[i] else 0)) + \
             (1 if adx_up[i] else (-1 if adx_down[i] else 0)) + \
             (1 if zscore[i] > 0 else -1) + \
             (1 if speed[i] > 0 else -1) + \
             (1 if csi_buy[i] >= 2 else (-1 if csi_sell[i] >= 2 else 0)) + \
             (1 if sm_up[i] else -1) + \
             (1 if m_up[i] else -1) + \
             (1 if upward[i] > 0 else (-1 if downward[i] > 0 else 0)) + \
             (1 if adaptive_up[i] else -1) + \
             (1 if composite_up[i] else (-1 if composite_down[i] else 0))
        signal_sum[i] = ss

    # ═══ 캔들 색상 ═══
    bars = []
    for i in range(n):
        ss = int(signal_sum[i])
        abs_ss = abs(ss)
        if abs_ss <= 4:
            alpha = 0.15
        elif abs_ss <= 6:
            alpha = 0.35
        elif abs_ss <= 8:
            alpha = 0.55
        elif abs_ss <= 10:
            alpha = 0.75
        else:
            alpha = 1.0

        if ss >= 7:
            color = f"rgba(255,26,26,{alpha})"      # 강한 상승 — 진한 빨강
        elif ss <= -7:
            color = f"rgba(0,102,255,{alpha})"       # 강한 하락 — 진한 파랑
        elif ss > 0:
            color = f"rgba(255,120,120,{alpha})"     # 약한 상승 — 연한 빨강
        elif ss < 0:
            color = f"rgba(120,160,255,{alpha})"     # 약한 하락 — 연한 파랑
        else:
            color = "rgba(128,128,128,0.2)"          # 중립 — 회색

        bars.append({"index": i, "v": ss, "color": color, "border": abs_ss >= 10,
                     "ho": float(ha_o[i]), "hh": float(ha_h[i]),
                     "hl": float(ha_l[i]), "hc": float(ha_c[i])})

    # ═══ 칼만 크로스 + 재테스트 + Buy/Sell ═══
    atr200 = _atr(h_calc, l_calc, c_calc, 200) * 0.5
    signals = []
    boxes = []
    arrow_up = False
    arrow_down = False
    retest_up = False
    retest_down = False
    shown = False
    box_top = box_bot = 0.0

    for i in range(2, n):
        # 칼만 크로스 상향
        if kalman_up[i] and not kalman_up[i - 1]:
            arrow_up = True
            arrow_down = False
            retest_up = False
            shown = False
            box_bot = l[i]
            box_top = box_bot + atr200[i]
            signals.append({"index": i, "type": "ku", "price": float(sk[i]), "label": "🡹"})
            boxes.append({"start": i, "top": float(box_top), "bottom": float(box_bot), "side": "bull"})

        # 칼만 크로스 하향
        if not kalman_up[i] and kalman_up[i - 1]:
            arrow_down = True
            arrow_up = False
            retest_down = False
            shown = False
            box_top = h[i]
            box_bot = box_top - atr200[i]
            signals.append({"index": i, "type": "kd", "price": float(sk[i]), "label": "🢃"})
            boxes.append({"start": i, "top": float(box_top), "bottom": float(box_bot), "side": "bear"})

        # 재테스트
        if arrow_up and not retest_up and box_top > 0:
            if l[i] <= box_top * 0.998:
                retest_up = True
                signals.append({"index": i, "type": "retest_up", "price": float(l[i])})

        if arrow_down and not retest_down and box_bot > 0:
            if h[i] >= box_bot / 0.998:
                retest_down = True
                signals.append({"index": i, "type": "retest_down", "price": float(h[i])})

        # Buy/Sell 시그널
        if arrow_up and retest_up and not shown and signal_sum[i] >= 7:
            signals.append({"index": i, "type": "buy", "price": float(l[i] - atr200[i])})
            shown = True

        if arrow_down and retest_down and not shown and signal_sum[i] <= -7:
            signals.append({"index": i, "type": "sell", "price": float(h[i] + atr200[i])})
            shown = True

    # ═══ 통계 ═══
    last_ss = int(signal_sum[-1]) if n > 0 else 0
    stats = {
        "v": last_ss,
        "max_signals": 12,
    }

    return {"d": bars, "s": signals, "x": boxes, "t": stats}

# alias
compute_beom_candle = compute_ultra_trend
