"""범온캔들 VIP (BIMACO3) — 범온캔들 PRO 업그레이드.

적응형 EMA + 변동성 히스테리시스 밴드 + 감쇠 속도 + 거리 Z-Score + 거래량 확인
+ 레짐 분류 + bias/confidence 스코어 + 소진(exhaustion) + 동적 손절/트레일 레벨.
멀티TF 자동매매(1H 레짐 → 15m 셋업 → 5m 트리거)용 신호 일체 제공.
"""
import numpy as np


DEFAULT_BIMACO3_PARAMS = {
    # warmup
    "min_bars": 300,
    # adaptive ema
    "min_len": 8,
    "max_len": 42,
    "er_len": 10,
    "alpha_boost": 0.15,
    # volatility / hysteresis
    "vol_len": 14,
    "hyst_mult": 0.60,
    # speed
    "body_len": 10,
    "speed_decay": 0.92,
    "speed_norm_len": 55,
    # distance z-score
    "z_len": 24,
    "z_threshold": 1.00,
    "z_consecutive": 2,
    # volume
    "vol_avg_len": 20,
    "rel_vol_th": 1.35,
    "vol_z_th": 0.70,
    # regime
    "band_width_len": 30,
    "squeeze_bw_factor": 0.85,
    "expansion_bw_factor": 1.20,
    # levels
    "stop_mult": 1.20,
    "trail_mult": 1.40,
    "trail_mult_strong": 1.80,
}


def _safe_div(a, b, eps=1e-10):
    return a / np.where(np.abs(b) < eps, eps, b)


def _rma(d, p):
    n = len(d)
    r = np.empty(n, dtype=float)
    r[0] = d[0]
    a = 1.0 / max(1, p)
    for i in range(1, n):
        r[i] = a * d[i] + (1.0 - a) * r[i - 1]
    return r


def _sma(d, p):
    n = len(d)
    p = max(1, int(p))
    r = np.empty(n, dtype=float)
    csum = 0.0
    for i in range(n):
        csum += d[i]
        if i < p:
            r[i] = csum / (i + 1)
        else:
            csum -= d[i - p]
            r[i] = csum / p
    return r


def _wma(d, p):
    n = len(d)
    p = max(1, int(p))
    r = np.empty(n, dtype=float)
    full_weights = np.arange(1, p + 1, dtype=float)
    for i in range(n):
        start = max(0, i - p + 1)
        seg = d[start:i + 1]
        w = full_weights[-len(seg):]
        r[i] = np.sum(seg * w) / np.sum(w)
    return r


def _rolling_max(d, p):
    n = len(d)
    p = max(1, int(p))
    r = np.empty(n, dtype=float)
    for i in range(n):
        r[i] = np.max(d[max(0, i - p + 1):i + 1])
    return r


def _rolling_min(d, p):
    n = len(d)
    p = max(1, int(p))
    r = np.empty(n, dtype=float)
    for i in range(n):
        r[i] = np.min(d[max(0, i - p + 1):i + 1])
    return r


def _rolling_std(d, p):
    n = len(d)
    p = max(1, int(p))
    r = np.empty(n, dtype=float)
    for i in range(n):
        seg = d[max(0, i - p + 1):i + 1]
        r[i] = np.std(seg) if len(seg) > 1 else 0.0
    return r


def _true_range(h, l, c):
    n = len(c)
    tr = np.empty(n, dtype=float)
    tr[0] = h[0] - l[0]
    for i in range(1, n):
        tr[i] = max(
            h[i] - l[i],
            abs(h[i] - c[i - 1]),
            abs(l[i] - c[i - 1]),
        )
    return tr


def _efficiency_ratio(c, p):
    n = len(c)
    p = max(1, int(p))
    er = np.zeros(n, dtype=float)
    for i in range(p, n):
        direction = abs(c[i] - c[i - p])
        volatility = np.sum(np.abs(np.diff(c[i - p:i + 1])))
        er[i] = direction / volatility if volatility != 0 else 0.0
    return er


def _adaptive_ema(c, min_len, max_len, er_len, alpha_boost=0.0):
    n = len(c)
    min_len = max(1, int(min_len))
    max_len = max(min_len + 1, int(max_len))
    er_len = max(1, int(er_len))

    er = _efficiency_ratio(c, er_len)

    fast_alpha = 2.0 / (min_len + 1.0)
    slow_alpha = 2.0 / (max_len + 1.0)

    alpha = np.empty(n, dtype=float)
    for i in range(n):
        base = (er[i] * (fast_alpha - slow_alpha) + slow_alpha) ** 2
        alpha[i] = min(1.0, base * (1.0 + alpha_boost))

    ema = np.empty(n, dtype=float)
    ema[0] = c[0]
    for i in range(1, n):
        ema[i] = alpha[i] * c[i] + (1.0 - alpha[i]) * ema[i - 1]

    return ema, alpha, er


def _bar_color(trend_change, vol_confirm, perfect_buy, perfect_sell, regime, bias_score):
    if perfect_buy:
        return "lime"
    if perfect_sell:
        return "red_border"
    if trend_change:
        return "orange" if vol_confirm else "yellow"
    if regime == "expansion_up":
        return "red"
    if regime == "trend_up":
        return "maroon"
    if regime == "expansion_down":
        return "blue"
    if regime == "trend_down":
        return "purple"
    if regime == "squeeze":
        return "gray"
    if regime == "chop":
        return "silver"
    return "maroon" if bias_score >= 0 else "navy"


def _wave_stats(speed, trend_change, trend_dir):
    bull_waves = []
    bear_waves = []

    for i in range(1, len(speed)):
        if trend_change[i]:
            prev_dir = trend_dir[i - 1]
            prev_speed = float(speed[i - 1])
            if prev_dir == 1:
                bull_waves.append(prev_speed)
            elif prev_dir == -1:
                bear_waves.append(prev_speed)

    last_bulls = bull_waves[-50:] if bull_waves else []
    last_bears = bear_waves[-50:] if bear_waves else []

    bull_avg = float(np.mean(last_bulls)) if last_bulls else 0.0
    bear_avg = float(np.mean(last_bears)) if last_bears else 0.0
    bull_max = float(np.max(last_bulls)) if last_bulls else 0.0
    bear_min = float(np.min(last_bears)) if last_bears else 0.0

    dominance = "Bullish"
    if abs(bear_avg) > abs(bull_avg):
        dominance = "Bearish"
    elif abs(bear_avg) == abs(bull_avg) == 0:
        dominance = "Neutral"

    return {
        "bull_avg": round(bull_avg, 4),
        "bear_avg": round(bear_avg, 4),
        "bull_max": round(bull_max, 4),
        "bear_min": round(bear_min, 4),
        "dominance": dominance,
        "bull_count": len(bull_waves),
        "bear_count": len(bear_waves),
    }


def compute_bimaco3(candles, params=None):
    p = DEFAULT_BIMACO3_PARAMS.copy()
    if params:
        p.update(params)

    n = len(candles)
    if n < p["min_bars"]:
        return {
            "meta": {"name": "BIMACO3", "bars": n, "params": p},
            "bars": [],
            "last": {},
            "wave_stats": {},
        }

    o = np.array([float(x.get("open", x.get("o", 0)) or 0) for x in candles], dtype=float)
    h = np.array([float(x.get("high", x.get("h", 0)) or 0) for x in candles], dtype=float)
    l = np.array([float(x.get("low", x.get("l", 0)) or 0) for x in candles], dtype=float)
    c = np.array([float(x.get("close", x.get("c", 0)) or 0) for x in candles], dtype=float)
    v = np.array([float(x.get("volume", x.get("v", 0)) or 0) for x in candles], dtype=float)

    o = np.nan_to_num(o, nan=0.0, posinf=0.0, neginf=0.0)
    h = np.nan_to_num(h, nan=0.0, posinf=0.0, neginf=0.0)
    l = np.nan_to_num(l, nan=0.0, posinf=0.0, neginf=0.0)
    c = np.nan_to_num(c, nan=0.0, posinf=0.0, neginf=0.0)
    v = np.nan_to_num(v, nan=0.0, posinf=0.0, neginf=0.0)

    # Heikin Ashi
    ha_c = (o + h + l + c) / 4.0
    ha_o = np.empty_like(o)
    ha_o[0] = (o[0] + c[0]) / 2.0
    for i in range(1, n):
        ha_o[i] = (ha_o[i - 1] + ha_c[i - 1]) / 2.0
    ha_h = np.maximum(h, np.maximum(ha_o, ha_c))
    ha_l = np.minimum(l, np.minimum(ha_o, ha_c))
    ha_bull = ha_c > ha_o
    ha_bear = ha_c < ha_o

    # Adaptive EMA
    dyn_ema, alpha, er = _adaptive_ema(
        c, p["min_len"], p["max_len"], p["er_len"], p["alpha_boost"],
    )

    # Internal volatility unit
    tr = _true_range(h, l, c)
    vol_unit = _rma(tr, p["vol_len"])
    vol_unit = np.where(vol_unit == 0, 1e-10, vol_unit)

    # Hysteresis bands
    upper_band = dyn_ema + p["hyst_mult"] * vol_unit
    lower_band = dyn_ema - p["hyst_mult"] * vol_unit

    # Trend direction / change
    trend_dir = np.zeros(n, dtype=int)
    trend_change = np.zeros(n, dtype=bool)

    for i in range(1, n):
        prev = trend_dir[i - 1]
        if c[i] > upper_band[i]:
            curr = 1
        elif c[i] < lower_band[i]:
            curr = -1
        else:
            if prev != 0:
                curr = prev
            else:
                curr = 1 if c[i] >= dyn_ema[i] else -1
        trend_dir[i] = curr
        trend_change[i] = (prev != 0 and curr != prev)

    trend_dir[0] = 1 if c[0] >= dyn_ema[0] else -1
    trend_change[0] = False

    # Speed (decayed wave energy)
    body = c - o
    body_rma = _rma(body, p["body_len"])
    body_pressure = _safe_div(body_rma, vol_unit)

    speed = np.zeros(n, dtype=float)
    for i in range(1, n):
        if trend_change[i]:
            speed[i] = body_pressure[i]
        else:
            speed[i] = p["speed_decay"] * speed[i - 1] + body_pressure[i]

    speed_mean = _sma(speed, p["speed_norm_len"])
    speed_std = _rolling_std(speed, p["speed_norm_len"])
    speed_std = np.where(speed_std == 0, 1e-10, speed_std)
    speed_z = (speed - speed_mean) / speed_std

    # Distance from adaptive EMA
    dist = c - dyn_ema
    dist_mean = _sma(dist, p["z_len"])
    dist_std = _rolling_std(dist, p["z_len"])
    dist_std = np.where(dist_std == 0, 1e-10, dist_std)
    z_dist = (dist - dist_mean) / dist_std

    # Consecutive distance confirmation
    z_consec_bull = np.zeros(n, dtype=int)
    z_consec_bear = np.zeros(n, dtype=int)
    for i in range(1, n):
        z_consec_bull[i] = z_consec_bull[i - 1] + 1 if z_dist[i] > p["z_threshold"] else 0
        z_consec_bear[i] = z_consec_bear[i - 1] + 1 if z_dist[i] < -p["z_threshold"] else 0

    z_confirmed_bull = z_consec_bull >= p["z_consecutive"]
    z_confirmed_bear = z_consec_bear >= p["z_consecutive"]

    # Volume confirmation
    vol_avg = _sma(v, p["vol_avg_len"])
    vol_std = _rolling_std(v, p["vol_avg_len"])
    vol_std = np.where(vol_std == 0, 1e-10, vol_std)

    rel_vol = _safe_div(v, np.maximum(vol_avg, 1e-10))
    vol_z = (v - vol_avg) / vol_std
    vol_confirm = (rel_vol >= p["rel_vol_th"]) & (vol_z >= p["vol_z_th"])

    # Squeeze / expansion
    band_width = _safe_div(upper_band - lower_band, np.maximum(np.abs(dyn_ema), 1e-10))
    band_width_ma = _sma(band_width, p["band_width_len"])

    squeeze = band_width < (band_width_ma * p["squeeze_bw_factor"])
    expansion = band_width > (band_width_ma * p["expansion_bw_factor"])

    # Bias / confidence
    bias_score = np.zeros(n, dtype=float)
    confidence = np.zeros(n, dtype=float)

    for i in range(n):
        trend_component = 30.0 * trend_dir[i]
        speed_component = 25.0 * (np.clip(speed_z[i], -2.0, 2.0) / 2.0)
        dist_component = 20.0 * (np.clip(z_dist[i], -2.0, 2.0) / 2.0)
        vol_component = 15.0 * (
            1.0 if (vol_confirm[i] and trend_dir[i] > 0) else (-1.0 if (vol_confirm[i] and trend_dir[i] < 0) else 0.0)
        )
        ha_component = 10.0 * (
            1.0 if (ha_bull[i] and trend_dir[i] > 0) else (-1.0 if (ha_bear[i] and trend_dir[i] < 0) else 0.0)
        )

        bias_score[i] = np.clip(
            trend_component + speed_component + dist_component + vol_component + ha_component,
            -100.0, 100.0
        )

        confidence[i] = np.clip(
            30.0 * float(trend_dir[i] != 0)
            + 20.0 * min(abs(speed_z[i]) / 2.0, 1.0)
            + 20.0 * min(abs(z_dist[i]) / 2.0, 1.0)
            + 20.0 * float(vol_confirm[i])
            + 10.0 * float((ha_bull[i] and trend_dir[i] > 0) or (ha_bear[i] and trend_dir[i] < 0)),
            0.0, 100.0
        )

    # Exhaustion
    speed_slope = np.zeros(n, dtype=float)
    speed_slope[1:] = speed_z[1:] - speed_z[:-1]

    exhaustion_up = (trend_dir > 0) & (z_dist >= 1.8) & (speed_slope < 0)
    exhaustion_down = (trend_dir < 0) & (z_dist <= -1.8) & (speed_slope > 0)

    # Regime
    regime = np.empty(n, dtype=object)
    for i in range(n):
        if squeeze[i] and abs(bias_score[i]) < 20:
            regime[i] = "squeeze"
        elif abs(bias_score[i]) < 20 and abs(speed_z[i]) < 0.35 and abs(z_dist[i]) < 0.35:
            regime[i] = "chop"
        elif trend_dir[i] > 0 and expansion[i] and confidence[i] >= 60 and not exhaustion_up[i]:
            regime[i] = "expansion_up"
        elif trend_dir[i] < 0 and expansion[i] and confidence[i] >= 60 and not exhaustion_down[i]:
            regime[i] = "expansion_down"
        elif trend_dir[i] > 0 and bias_score[i] >= 30 and not exhaustion_up[i]:
            regime[i] = "trend_up"
        elif trend_dir[i] < 0 and bias_score[i] <= -30 and not exhaustion_down[i]:
            regime[i] = "trend_down"
        elif exhaustion_up[i]:
            regime[i] = "exhaustion_up"
        elif exhaustion_down[i]:
            regime[i] = "exhaustion_down"
        else:
            regime[i] = "neutral"

    # Perfect signals
    perfect_buy = (
        z_confirmed_bull & vol_confirm & (trend_dir > 0) & ha_bull
        & (c > upper_band) & (bias_score >= 45) & (confidence >= 60)
    )
    perfect_sell = (
        z_confirmed_bear & vol_confirm & (trend_dir < 0) & ha_bear
        & (c < lower_band) & (bias_score <= -45) & (confidence >= 60)
    )

    # Dynamic stop / trailing levels
    trail_mult = np.where(expansion, p["trail_mult_strong"], p["trail_mult"])

    stop_long = np.minimum(lower_band, dyn_ema - p["stop_mult"] * vol_unit)
    stop_short = np.maximum(upper_band, dyn_ema + p["stop_mult"] * vol_unit)

    trail_long = dyn_ema - trail_mult * vol_unit
    trail_short = dyn_ema + trail_mult * vol_unit

    # Entry hints (stop-entry style)
    entry_hint_long = h + 0.10 * vol_unit
    entry_hint_short = l - 0.10 * vol_unit

    # Directional readiness
    long_ready = (
        (trend_dir > 0) & np.isin(regime, ["trend_up", "expansion_up"])
        & (bias_score >= 35) & (confidence >= 55) & (speed_z >= 0.30)
        & (z_dist >= 0.10) & (~squeeze) & (~exhaustion_up)
    )
    short_ready = (
        (trend_dir < 0) & np.isin(regime, ["trend_down", "expansion_down"])
        & (bias_score <= -35) & (confidence >= 55) & (speed_z <= -0.30)
        & (z_dist <= -0.10) & (~squeeze) & (~exhaustion_down)
    )

    bars = []
    for i in range(n):
        color = _bar_color(
            trend_change=bool(trend_change[i]),
            vol_confirm=bool(vol_confirm[i]),
            perfect_buy=bool(perfect_buy[i]),
            perfect_sell=bool(perfect_sell[i]),
            regime=str(regime[i]),
            bias_score=float(bias_score[i]),
        )
        bars.append({
            "index": i,
            "open": float(o[i]), "high": float(h[i]), "low": float(l[i]),
            "close": float(c[i]), "volume": float(v[i]),
            "ho": float(ha_o[i]), "hh": float(ha_h[i]), "hl": float(ha_l[i]), "hc": float(ha_c[i]),
            "trend_dir": int(trend_dir[i]), "trend_change": bool(trend_change[i]),
            "regime": str(regime[i]), "color": color,
            "bias_score": round(float(bias_score[i]), 2), "confidence": round(float(confidence[i]), 2),
            "er": round(float(er[i]), 6), "alpha": round(float(alpha[i]), 6),
            "speed": round(float(speed[i]), 6), "speed_z": round(float(speed_z[i]), 6),
            "speed_slope": round(float(speed_slope[i]), 6),
            "dist": round(float(dist[i]), 6), "z_dist": round(float(z_dist[i]), 6),
            "z_confirmed_bull": bool(z_confirmed_bull[i]), "z_confirmed_bear": bool(z_confirmed_bear[i]),
            "rel_vol": round(float(rel_vol[i]), 6), "vol_z": round(float(vol_z[i]), 6),
            "vol_confirm": bool(vol_confirm[i]),
            "squeeze": bool(squeeze[i]), "expansion": bool(expansion[i]),
            "exhaustion_up": bool(exhaustion_up[i]), "exhaustion_down": bool(exhaustion_down[i]),
            "perfect_buy": bool(perfect_buy[i]), "perfect_sell": bool(perfect_sell[i]),
            "long_ready": bool(long_ready[i]), "short_ready": bool(short_ready[i]),
            "dyn_ema": round(float(dyn_ema[i]), 6),
            "upper_band": round(float(upper_band[i]), 6), "lower_band": round(float(lower_band[i]), 6),
            "vol_unit": round(float(vol_unit[i]), 6),
            "stop_long": round(float(stop_long[i]), 6), "stop_short": round(float(stop_short[i]), 6),
            "trail_long": round(float(trail_long[i]), 6), "trail_short": round(float(trail_short[i]), 6),
            "entry_hint_long": round(float(entry_hint_long[i]), 6),
            "entry_hint_short": round(float(entry_hint_short[i]), 6),
        })

    wave_stats = _wave_stats(speed, trend_change, trend_dir)
    last = bars[-1].copy()
    last["wave_dominance"] = wave_stats.get("dominance", "Neutral")

    return {
        "meta": {"name": "BIMACO3", "bars": n, "params": p},
        "bars": bars,
        "last": last,
        "wave_stats": wave_stats,
    }


compute_beom_candle_vip = compute_bimaco3
