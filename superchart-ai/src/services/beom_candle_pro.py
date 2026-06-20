"""범온캔들2 — 다이나믹 EMA + 트렌드 속도 + Z-Score + 볼륨 + 웨이브 분석."""
import numpy as np


def _rma(d, p):
    r = np.empty(len(d), dtype=float); r[0] = d[0]; a = 1.0/p
    for i in range(1, len(d)): r[i] = a*d[i] + (1-a)*r[i-1]
    return r


def _sma(d, p):
    n = len(d); r = np.empty(n, dtype=float)
    cs = np.cumsum(d)
    r[:p-1] = cs[:p-1] / np.arange(1, p)
    r[p-1:] = (cs[p-1:] - np.concatenate([[0], cs[:n-p]])) / p
    return r


def _hma(d, p):
    """Hull Moving Average."""
    half = max(1, p // 2)
    sqrt_p = max(1, int(np.sqrt(p)))
    wma1 = _wma(d, half)
    wma2 = _wma(d, p)
    diff = 2 * wma1 - wma2
    return _wma(diff, sqrt_p)


def _wma(d, p):
    n = len(d); r = np.empty(n, dtype=float)
    weights = np.arange(1, p+1, dtype=float)
    wsum = weights.sum()
    for i in range(n):
        start = max(0, i-p+1)
        seg = d[start:i+1]
        w = weights[-(i-start+1):]
        r[i] = np.sum(seg * w) / np.sum(w)
    return r


def _rolling_max(d, p):
    n = len(d); r = np.empty(n, dtype=float)
    for i in range(n):
        r[i] = np.max(d[max(0, i-p+1):i+1])
    return r


def _rolling_min(d, p):
    n = len(d); r = np.empty(n, dtype=float)
    for i in range(n):
        r[i] = np.min(d[max(0, i-p+1):i+1])
    return r


def compute_bimaco2(candles: list[dict]) -> dict:
    """범온캔들2 계산."""
    n = len(candles)
    if n < 300:
        return {"d": [], "de": [], "t": {}, "tb": {}}

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
        ha_o[i] = (ha_o[i-1] + ha_c[i-1]) / 2
    ha_h = np.maximum(h, np.maximum(ha_o, ha_c))
    ha_l = np.minimum(l, np.minimum(ha_o, ha_c))

    # === 파라미터 ===
    max_length = 50
    accel_multiplier = 5.0
    collen = 100
    z_length = 20
    z_threshold = 1.0
    z_consecutive = 2
    vol_threshold = 1.5

    # === 다이나믹 EMA ===
    max_abs = _rolling_max(np.abs(c), 200)
    max_abs[max_abs == 0] = 1
    norm = (c + max_abs) / (2 * max_abs)
    dyn_length = 5 + norm * (max_length - 5)

    # 가속 팩터
    diff = np.zeros(n)
    diff[1:] = c[1:] - c[:-1]
    max_abs_diff = _rolling_max(np.abs(diff), 200)
    max_abs_diff[max_abs_diff == 0] = 1
    accel_factor = np.abs(diff) / max_abs_diff

    alpha = np.minimum(1.0, (2.0 / (dyn_length + 1)) * (1 + accel_factor * accel_multiplier))

    dyn_ema = np.empty(n, dtype=float)
    dyn_ema[0] = c[0]
    for i in range(1, n):
        dyn_ema[i] = alpha[i] * c[i] + (1 - alpha[i]) * dyn_ema[i-1]

    # === 트렌드 속도 ===
    rma_c = _rma(c, 10)
    rma_o = _rma(o, 10)
    speed = np.zeros(n)
    trend_dir = np.zeros(n, dtype=int)
    trend_change = np.zeros(n, dtype=bool)

    pos = 0
    for i in range(1, n):
        # 추세 변환 감지
        if c[i] > dyn_ema[i] and c[i-1] <= dyn_ema[i-1]:
            pos = 1
            speed[i] = rma_c[i] - rma_o[i]
            trend_change[i] = True
            trend_dir[i] = 1
        elif c[i] < dyn_ema[i] and c[i-1] >= dyn_ema[i-1]:
            pos = -1
            speed[i] = rma_c[i] - rma_o[i]
            trend_change[i] = True
            trend_dir[i] = -1
        else:
            speed[i] = speed[i-1] + rma_c[i] - rma_o[i]
            trend_dir[i] = trend_dir[i-1] if i > 0 else 0

    # 정규화
    min_speed = _rolling_min(speed, collen)
    max_speed = _rolling_max(speed, collen)
    rng = max_speed - min_speed
    rng[rng == 0] = 1
    norm_speed = (speed - min_speed) / rng

    # === Z-Score ===
    z_mean = _sma(c, z_length)
    z_std = np.zeros(n)
    for i in range(z_length, n):
        z_std[i] = np.std(c[max(0, i-z_length+1):i+1])
    z_std[z_std == 0] = 1e-10
    z_score = (c - z_mean) / z_std

    # Z-Score 연속성
    z_consec_bull = np.zeros(n, dtype=int)
    z_consec_bear = np.zeros(n, dtype=int)
    for i in range(1, n):
        z_consec_bull[i] = z_consec_bull[i-1] + 1 if z_score[i] > z_threshold else 0
        z_consec_bear[i] = z_consec_bear[i-1] + 1 if z_score[i] < -z_threshold else 0

    z_confirmed_bull = z_consec_bull >= z_consecutive
    z_confirmed_bear = z_consec_bear >= z_consecutive
    z_bullish = z_score > z_threshold
    z_bearish = z_score < -z_threshold

    # === 볼륨 분석 ===
    vol_avg = _sma(v, 20)
    high_volume = v > vol_avg * vol_threshold

    # === 캔들 색상 ===
    # maroon: 약한 상승, red: 강한 상승, purple: 약한 하락, blue: 강한 하락
    # yellow: 추세 변환, orange: 볼륨 증가 + 추세 변환
    bars = []
    for i in range(n):
        if trend_change[i]:
            color = "orange" if high_volume[i] else "yellow"
        elif z_confirmed_bull[i]:
            color = "red"  # 강한 상승
        elif z_confirmed_bear[i]:
            color = "blue"  # 강한 하락
        elif z_bullish[i]:
            color = "maroon"  # 약한 상승
        elif z_bearish[i]:
            color = "purple"  # 약한 하락
        else:
            # 트렌드 속도 기반
            if speed[i] < 0:
                color = "purple" if norm_speed[i] >= 0.25 else "blue"
            else:
                color = "maroon" if norm_speed[i] < 0.75 else "red"

        # perfect signal 테두리
        z_trend_aligned = (trend_dir[i] > 0 and z_score[i] > 0) or (trend_dir[i] < 0 and z_score[i] < 0)
        perfect_buy = z_confirmed_bull[i] and high_volume[i] and trend_dir[i] > 0
        perfect_sell = z_confirmed_bear[i] and high_volume[i] and trend_dir[i] < 0
        border = "lime" if perfect_buy else ("red_border" if perfect_sell else "")

        bars.append({
            "index": i,
            "color": color,
            "border": border,
            "sp": round(float(speed[i]), 2),
            "z": round(float(z_score[i]), 2),
            "ho": float(ha_o[i]),
            "hh": float(ha_h[i]),
            "hl": float(ha_l[i]),
            "hc": float(ha_c[i]),
        })

    # === 다이나믹 EMA 라인 ===
    ema_line = []
    wma2 = _wma(c, 2)
    for i in range(n):
        col = "maroon" if wma2[i] > dyn_ema[i] else "navy"
        ema_line.append({"index": i, "value": round(float(dyn_ema[i]), 5), "color": col})

    # === 웨이브 분석 테이블 ===
    bull_waves = []
    bear_waves = []
    for i in range(1, n):
        if trend_change[i]:
            if trend_dir[i] == 1 and len(bear_waves) < 100:
                bear_waves.append(float(speed[i-1]))
            elif trend_dir[i] == -1 and len(bull_waves) < 100:
                bull_waves.append(float(speed[i-1]))

    table = {}
    if bull_waves and bear_waves:
        bull_avg = np.mean(bull_waves[-50:]) if bull_waves else 0
        bear_avg = np.mean(bear_waves[-50:]) if bear_waves else 0
        bull_max = np.max(bull_waves[-50:]) if bull_waves else 0
        bear_min = np.min(bear_waves[-50:]) if bear_waves else 0

        table = {
            "bull_avg": round(float(bull_avg), 2),
            "bear_avg": round(float(bear_avg), 2),
            "bull_max": round(float(bull_max), 2),
            "bear_min": round(float(bear_min), 2),
            "current_speed": round(float(speed[-1]), 2),
            "z": round(float(z_score[-1]), 2),
            "trend_dir": int(trend_dir[-1]),
            "dominance": "Bullish" if bull_avg > abs(bear_avg) else "Bearish",
        }

    return {"d": bars, "de": ema_line, "tb": table}
compute_beom_candle_pro = compute_bimaco2


def compute_bimaco3(candles: list[dict], mode: str = "reversion") -> dict:
    """범온캔들 PRO 2 — PRO의 미활용 계산(HMA 추세필터·Z/추세 정렬·정규화 속도)을
    전면 활용해 신호 품질을 높인 버전.

    PRO 대비 추가:
    - HMA(Hull) 추세 필터: HMA 기울기로 큰 추세 방향을 확인 → 역추세 신호 억제
    - z_trend_aligned: Z-Score와 추세방향이 정렬될 때만 강신호 인정
    - norm_speed: 신호 강도(strength 0~100) 산출
    - 등급 신호: perfect(완벽) / good(양호) 2단계
    반환 d 각 bar에 strength/aligned/sig(매수=1, 매도=-1, 강매수=2, 강매도=-2) 추가.
    """
    n = len(candles)
    if n < 300:
        return {"d": [], "de": [], "tb": {}}

    o = np.array([float(x.get("open") or x.get("o", 0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h", 0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l", 0)) for x in candles])
    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])
    v = np.array([float(x.get("volume") or x.get("v", 0)) for x in candles])

    ha_c = (o + h + l + c) / 4
    ha_o = np.empty_like(o); ha_o[0] = (o[0] + c[0]) / 2
    for i in range(1, n):
        ha_o[i] = (ha_o[i-1] + ha_c[i-1]) / 2
    ha_h = np.maximum(h, np.maximum(ha_o, ha_c))
    ha_l = np.minimum(l, np.minimum(ha_o, ha_c))

    # === 파라미터 ===
    max_length = 50; accel_multiplier = 5.0; collen = 100
    z_length = 20; z_threshold = 1.0; z_consecutive = 2; vol_threshold = 1.5
    hma_length = 55  # 추세필터용

    # === 다이나믹 EMA (PRO와 동일) ===
    max_abs = _rolling_max(np.abs(c), 200); max_abs[max_abs == 0] = 1
    norm = (c + max_abs) / (2 * max_abs)
    dyn_length = 5 + norm * (max_length - 5)
    diff = np.zeros(n); diff[1:] = c[1:] - c[:-1]
    max_abs_diff = _rolling_max(np.abs(diff), 200); max_abs_diff[max_abs_diff == 0] = 1
    accel_factor = np.abs(diff) / max_abs_diff
    alpha = np.minimum(1.0, (2.0 / (dyn_length + 1)) * (1 + accel_factor * accel_multiplier))
    dyn_ema = np.empty(n, dtype=float); dyn_ema[0] = c[0]
    for i in range(1, n):
        dyn_ema[i] = alpha[i] * c[i] + (1 - alpha[i]) * dyn_ema[i-1]

    # === HMA 추세 필터 (PRO에서 정의만 되고 미사용이던 _hma 활용) ===
    hma = _hma(c, hma_length)
    hma_slope = np.zeros(n)
    hma_slope[1:] = hma[1:] - hma[:-1]
    hma_up = hma_slope > 0   # 큰 추세 상승
    hma_dn = hma_slope < 0   # 큰 추세 하락

    # === 트렌드 속도 (PRO와 동일) ===
    rma_c = _rma(c, 10); rma_o = _rma(o, 10)
    speed = np.zeros(n); trend_dir = np.zeros(n, dtype=int); trend_change = np.zeros(n, dtype=bool)
    for i in range(1, n):
        if c[i] > dyn_ema[i] and c[i-1] <= dyn_ema[i-1]:
            speed[i] = rma_c[i] - rma_o[i]; trend_change[i] = True; trend_dir[i] = 1
        elif c[i] < dyn_ema[i] and c[i-1] >= dyn_ema[i-1]:
            speed[i] = rma_c[i] - rma_o[i]; trend_change[i] = True; trend_dir[i] = -1
        else:
            speed[i] = speed[i-1] + rma_c[i] - rma_o[i]; trend_dir[i] = trend_dir[i-1]
    min_speed = _rolling_min(speed, collen); max_speed = _rolling_max(speed, collen)
    rng = max_speed - min_speed; rng[rng == 0] = 1
    norm_speed = (speed - min_speed) / rng  # 0~1 정규화 속도(강도)

    # === Z-Score (PRO와 동일) ===
    z_mean = _sma(c, z_length); z_std = np.zeros(n)
    for i in range(z_length, n):
        z_std[i] = np.std(c[max(0, i-z_length+1):i+1])
    z_std[z_std == 0] = 1e-10
    z_score = (c - z_mean) / z_std
    z_cb = np.zeros(n, dtype=int); z_cr = np.zeros(n, dtype=int)
    for i in range(1, n):
        z_cb[i] = z_cb[i-1] + 1 if z_score[i] > z_threshold else 0
        z_cr[i] = z_cr[i-1] + 1 if z_score[i] < -z_threshold else 0
    conf_bull = z_cb >= z_consecutive; conf_bear = z_cr >= z_consecutive

    vol_avg = _sma(v, 20); high_volume = v > vol_avg * vol_threshold

    bars = []
    perfect_buys = perfect_sells = good_buys = good_sells = 0
    for i in range(n):
        # PRO에서 계산만 하고 안 쓰던 z_trend_aligned 활용
        z_trend_aligned = (trend_dir[i] > 0 and z_score[i] > 0) or (trend_dir[i] < 0 and z_score[i] < 0)
        # 색상 (PRO와 동일 규칙)
        if trend_change[i]:
            color = "orange" if high_volume[i] else "yellow"
        elif conf_bull[i]:
            color = "red"
        elif conf_bear[i]:
            color = "blue"
        elif z_score[i] > z_threshold:
            color = "maroon"
        elif z_score[i] < -z_threshold:
            color = "purple"
        else:
            color = ("purple" if norm_speed[i] >= 0.25 else "blue") if speed[i] < 0 else ("maroon" if norm_speed[i] < 0.75 else "red")

        # === 등급 신호 (HMA 추세필터 + z정렬 결합) ===
        # 강신호(perfect): Z확정 + 고거래량 + 추세방향 + HMA 큰추세 일치 + z정렬
        perfect_buy = conf_bull[i] and high_volume[i] and trend_dir[i] > 0 and hma_up[i] and z_trend_aligned
        perfect_sell = conf_bear[i] and high_volume[i] and trend_dir[i] < 0 and hma_dn[i] and z_trend_aligned
        # 양호신호(good): 강신호보다 완화 — 고거래량 없이도, 단 HMA추세는 일치해야
        good_buy = (not perfect_buy) and conf_bull[i] and trend_dir[i] > 0 and hma_up[i]
        good_sell = (not perfect_sell) and conf_bear[i] and trend_dir[i] < 0 and hma_dn[i]

        if perfect_buy: raw = 2
        elif perfect_sell: raw = -2
        elif good_buy: raw = 1
        elif good_sell: raw = -1
        else: raw = 0
        # 백테스트 결과: 이 신호는 평균회귀로 쓸 때 승률↑(reversion 기본). trend는 원방향.
        sig = -raw if (mode == "reversion" and raw != 0) else raw
        if sig == 2: border = "lime"; perfect_buys += 1
        elif sig == -2: border = "red_border"; perfect_sells += 1
        elif sig == 1: border = "lime_soft"; good_buys += 1
        elif sig == -1: border = "red_soft"; good_sells += 1
        else: border = ""

        strength = round(float(norm_speed[i] * 100), 1)  # 미활용이던 norm_speed → 강도점수
        bars.append({
            "index": i, "color": color, "border": border, "sig": sig,
            "strength": strength, "aligned": bool(z_trend_aligned),
            "sp": round(float(speed[i]), 2), "z": round(float(z_score[i]), 2),
            "ho": float(ha_o[i]), "hh": float(ha_h[i]), "hl": float(ha_l[i]), "hc": float(ha_c[i]),
        })

    # 다이나믹 EMA + HMA 라인 둘 다 반환
    wma2 = _wma(c, 2)
    ema_line = [{"index": i, "value": round(float(dyn_ema[i]), 5),
                 "color": "maroon" if wma2[i] > dyn_ema[i] else "navy"} for i in range(n)]
    hma_line = [{"index": i, "value": round(float(hma[i]), 5),
                 "color": "lime" if hma_up[i] else "red"} for i in range(n)]

    table = {
        "mode": mode,
        "perfect_buys": perfect_buys, "perfect_sells": perfect_sells,
        "good_buys": good_buys, "good_sells": good_sells,
        "current_speed": round(float(speed[-1]), 2),
        "z": round(float(z_score[-1]), 2),
        "trend_dir": int(trend_dir[-1]),
        "hma_trend": "up" if hma_up[-1] else ("down" if hma_dn[-1] else "flat"),
        "strength": round(float(norm_speed[-1] * 100), 1),
    }
    return {"d": bars, "de": ema_line, "hma": hma_line, "tb": table}
compute_beom_candle_pro2 = compute_bimaco3
