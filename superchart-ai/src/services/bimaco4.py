"""범온4 캔들 — 14개 지표 signal_sum (범온 12개 + 강도측정 + 과열분석)."""
import numpy as np
from src.services.beom_candle import compute_ultra_trend
from src.services.beom_sub import _rsi, _stoch, _mfi, _sma as _usma, _rolling_min, _rolling_max


def compute_bimaco4(candles: list[dict]) -> dict:
    n = len(candles)
    if n < 300:
        return {"d": [], "s": [], "t": {}}

    o = np.array([float(x.get("open") or x.get("o", 0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h", 0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l", 0)) for x in candles])
    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])
    v = np.array([float(x.get("volume") or x.get("v", 0)) for x in candles])

    # 기존 범온 결과 가져오기
    base = compute_ultra_trend(candles)
    if not base.get("d"):
        return {"d": [], "s": [], "t": {}}

    # 기존 signal_sum 추출
    base_ss = np.array([b.get("v", 0) for b in base["d"]], dtype=int)

    # --- 강도측정 ---
    rsi_val = _rsi(c, 60)
    lo_rsi = _rolling_min(rsi_val, 300); hi_rsi = _rolling_max(rsi_val, 300)
    uprsi = (rsi_val - lo_rsi) / np.maximum(hi_rsi - lo_rsi, 1e-10) - 0.5
    raw_k = _stoch(c, h, l, 60); smooth_k = _usma(raw_k, 9)
    lo_k = _rolling_min(smooth_k, 240); hi_k = _rolling_max(smooth_k, 240)
    upstoch = (smooth_k - lo_k) / np.maximum(hi_k - lo_k, 1e-10) - 0.5
    strength = np.where((uprsi > 0.1) & (upstoch > 0.1), 1,
               np.where((uprsi < -0.1) & (upstoch < -0.1), -1, 0))

    # --- 과열분석 ---
    scaled_rsi = rsi_val / 100 - 0.5
    mfi_val = _mfi(h, l, c, v, 60)
    scaled_mfi = mfi_val / 100 - 0.5
    heat = np.where((scaled_rsi > 0.1) & (scaled_mfi > 0.1), 1,
           np.where((scaled_rsi < -0.1) & (scaled_mfi < -0.1), -1, 0))

    # 14개 signal_sum
    ss14 = base_ss + strength + heat

    # 캔들 색상
    bars = []
    for i in range(n):
        ss = int(ss14[i])
        abs_ss = abs(ss)
        if abs_ss <= 4: alpha = 0.15
        elif abs_ss <= 6: alpha = 0.3
        elif abs_ss <= 8: alpha = 0.45
        elif abs_ss <= 10: alpha = 0.6
        elif abs_ss <= 12: alpha = 0.8
        else: alpha = 1.0

        if ss >= 8: color = f"rgba(255,26,26,{alpha})"
        elif ss <= -8: color = f"rgba(0,102,255,{alpha})"
        elif ss > 0: color = f"rgba(255,120,120,{alpha})"
        elif ss < 0: color = f"rgba(120,160,255,{alpha})"
        else: color = "rgba(128,128,128,0.2)"

        bd = base["d"][i] if i < len(base["d"]) else {}
        bars.append({
            "index": i, "v": ss, "color": color,
            "border": bd.get("border", False),
            "ho": bd.get("ho", float(o[i])),
            "hh": bd.get("hh", float(h[i])),
            "hl": bd.get("hl", float(l[i])),
            "hc": bd.get("hc", float(c[i])),
        })

    last_ss = int(ss14[-1]) if n > 0 else 0
    return {"d": bars, "s": base.get("s", []), "t": {"v": last_ss}, "x": base.get("x", [])}
