"""비마코3 캔들 — 최적화된 가중치 + 파라미터."""
import json
import numpy as np
from src.services.beom_candle import (
    _ema, _rma, _sma, _kalman, _atr, _adx_dmi, _macd, _smma, _zlema
)
import pandas as pd

PRESETS = {}
for name in ['비마코3-15', '비마코3-60', '비마코3-240']:
    for suffix in ['_final_params', '_v2_params', '_params']:
        try:
            PRESETS[name] = json.load(open(f'data/{name.lower()}{suffix}.json'))
            break
        except Exception:
            continue
    if name not in PRESETS:
        PRESETS[name] = {}


def compute_bimaco3(candles, preset='비마코3-60'):
    n = len(candles)
    if n < 200:
        return {"d": [], "t": {}}
    
    P = PRESETS.get(preset, {})
    weights = [P.get(f'w{i}', 1.0) for i in range(12)]
    kf = int(P.get('kalman_fast', 50)); ks = int(P.get('kalman_slow', 150))
    ce_len = int(P.get('ce_len', 50)); ce_mult = P.get('ce_mult', 5.0)
    adx_len = int(P.get('adx_len', 28))
    macd_f = int(P.get('macd_fast', 24)); macd_s = int(P.get('macd_slow', 52))
    strong_th = int(P.get('strong_th', 7)); medium_th = int(P.get('medium_th', 5))
    
    o = np.array([float(x.get('open') or x.get('o', 0)) for x in candles])
    h = np.array([float(x.get('high') or x.get('h', 0)) for x in candles])
    l = np.array([float(x.get('low') or x.get('l', 0)) for x in candles])
    c = np.array([float(x.get('close') or x.get('c', 0)) for x in candles])

    ha_c = (o+h+l+c)/4
    ha_o = np.empty_like(o); ha_o[0] = (o[0]+c[0])/2
    for i in range(1, n): ha_o[i] = (ha_o[i-1]+ha_c[i-1])/2
    ha_h = np.maximum(h, np.maximum(ha_o, ha_c))
    ha_l = np.minimum(l, np.minimum(ha_o, ha_c))
    cc, oo, hh, ll = ha_c, ha_o, ha_h, ha_l

    sk = _kalman(cc, kf); lk = _kalman(cc, ks)
    kalman_up = sk > lk
    kalman_str = np.zeros(n, dtype=bool); kalman_str[2:] = sk[2:] > sk[:-2]

    atr_v = _atr(hh, ll, cc, ce_len); atr_ce = ce_mult * atr_v
    hc = pd.Series(cc).rolling(ce_len, min_periods=1).max().to_numpy(copy=True)
    lc = pd.Series(cc).rolling(ce_len, min_periods=1).min().to_numpy(copy=True)
    ce_up = cc > np.concatenate([[lc[0]+atr_ce[0]], (lc+atr_ce)[:-1]])
    ce_down = cc < np.concatenate([[hc[0]-atr_ce[0]], (hc-atr_ce)[:-1]])

    di_p, di_m = _adx_dmi(hh, ll, cc, adx_len, 10)
    ml, sl = _macd(cc, macd_f, macd_s, 18)
    adx_up = (di_p > di_m) & (ml > sl); adx_down = (di_m > di_p) & (sl > ml)

    sma75 = _sma(cc, 75)
    std75 = pd.Series(cc).rolling(75, min_periods=1).std().to_numpy(copy=True); std75[std75==0] = 1e-10
    zscore = (cc - sma75) / std75

    te = _ema(cc, 50); rma_c = _rma(cc, 10); rma_o = _rma(oo, 10)
    speed = np.zeros(n)
    for i in range(2, n):
        if te[i] > te[i-1] and te[i-1] <= te[i-2]: speed[i] = rma_c[i] - rma_o[i]
        elif te[i] < te[i-1] and te[i-1] >= te[i-2]: speed[i] = rma_c[i] - rma_o[i]
        else: speed[i] = speed[i-1] + rma_c[i] - rma_o[i]

    hlc3 = (hh+ll+cc)/3
    hi_smma = _smma(hh, 34); lo_smma = _smma(ll, 34); mi_zlema = _zlema(hlc3, 34)
    md = np.where(mi_zlema > hi_smma, mi_zlema - hi_smma, np.where(mi_zlema < lo_smma, mi_zlema - lo_smma, 0))
    sb = _sma(md, 9)
    csi_buy = np.array([(1 if hlc3[i]>mi_zlema[i] else 0)+(1 if md[i]>0 else 0)+(1 if md[i]>sb[i] else 0) for i in range(n)])
    csi_sell = np.array([(1 if hlc3[i]<mi_zlema[i] else 0)+(1 if md[i]<0 else 0)+(1 if md[i]<sb[i] else 0) for i in range(n)])

    sm = _ema(cc, 30); sm_up = np.zeros(n, dtype=bool); sm_up[2:] = sm[2:] > sm[:-2]
    h_roll = pd.Series(hh).rolling(20).max().shift(10).to_numpy(copy=True); m_up = hh > h_roll

    avrng = _ema(np.abs(np.diff(cc, prepend=cc[0])), 100)
    smrng = _ema(avrng, 199) * 3.0
    filt = np.zeros(n); filt[0] = c[0]
    for i in range(1, n): filt[i] = max(filt[i-1], cc[i]-smrng[i]) if cc[i] > filt[i-1] else min(filt[i-1], cc[i]+smrng[i])
    upward = np.zeros(n); downward = np.zeros(n)
    for i in range(1, n):
        if filt[i] > filt[i-1]: upward[i] = upward[i-1]+1
        elif filt[i] < filt[i-1]: downward[i] = downward[i-1]+1

    fe = _ema(hlc3, 10); se = _ema(hlc3, 20); basis = (fe+se)/2
    vs = pd.Series(hlc3).rolling(10, min_periods=1).std().to_numpy(copy=True)
    sv = _ema(vs, 14); ub = basis+sv*2; lb = basis-sv*2
    adaptive_up = np.zeros(n, dtype=bool); ts = 0
    for i in range(1, n):
        if ts == 1 and cc[i] < lb[i]: ts = -1
        elif ts != 1 and cc[i] > ub[i]: ts = 1
        elif ts == 0: ts = 1 if cc[i] > basis[i] else -1
        adaptive_up[i] = ts == 1
    comp_up = sm_up & m_up & (upward > 0) & adaptive_up
    comp_down = (~sm_up) & (~m_up) & (downward > 0) & (~adaptive_up)

    # 가중치 적용 signal_sum
    bars = []
    w = weights
    prev_ss = 0
    streak = 0  # 같은 방향 연속 봉 수
    peak_ss = 0  # 최근 peak signal_sum
    for i in range(n):
        ss = w[0]*(1 if kalman_up[i] else -1) + w[1]*(1 if kalman_str[i] else -1) + \
             w[2]*(1 if ce_up[i] else (-1 if ce_down[i] else 0)) + \
             w[3]*(1 if adx_up[i] else (-1 if adx_down[i] else 0)) + \
             w[4]*(1 if zscore[i] > 0 else -1) + w[5]*(1 if speed[i] > 0 else -1) + \
             w[6]*(1 if csi_buy[i] >= 2 else (-1 if csi_sell[i] >= 2 else 0)) + \
             w[7]*(1 if sm_up[i] else -1) + w[8]*(1 if m_up[i] else -1) + \
             w[9]*(1 if upward[i] > 0 else (-1 if downward[i] > 0 else 0)) + \
             w[10]*(1 if adaptive_up[i] else -1) + \
             w[11]*(1 if comp_up[i] else (-1 if comp_down[i] else 0))
        
        # 추세 상태 판단
        same_dir = (ss > 0 and prev_ss > 0) or (ss < 0 and prev_ss < 0)
        if same_dir:
            streak += 1
        else:
            streak = 1
        
        if abs(ss) > abs(peak_ss) or (ss > 0) != (peak_ss > 0):
            peak_ss = ss
        
        trend_mark = ""
        if streak >= 3 and abs(ss) >= medium_th:
            trend_mark = "hold"  # 추세 유지 ●
        elif abs(ss) < medium_th * 0.5 and abs(prev_ss) >= medium_th:
            trend_mark = "end"   # 추세 종료 ✕
        elif (ss > 0 and prev_ss < 0) or (ss < 0 and prev_ss > 0):
            if abs(ss) < medium_th:
                trend_mark = "fake"  # 거짓 추세 ⚠
        
        abs_ss = abs(ss)
        if abs_ss >= strong_th: alpha = 1.0
        elif abs_ss >= medium_th: alpha = 0.6
        else: alpha = 0.2

        if ss > 0: color = f"rgba(255,26,26,{alpha})"
        elif ss < 0: color = f"rgba(0,102,255,{alpha})"
        else: color = "rgba(128,128,128,0.2)"

        bars.append({"index": i, "v": round(ss, 2), "color": color,
                     "border": abs_ss >= strong_th + 2,
                     "ho": float(ha_o[i]), "hh": float(ha_h[i]),
                     "hl": float(ha_l[i]), "hc": float(ha_c[i])})
        prev_ss = ss

    # 칼만 크로스 + 재테스트 + Buy/Sell 시그널
    atr200 = _atr(hh, ll, cc, 200) * 0.5
    signals = []
    arrow_up = arrow_down = retest_up = retest_down = shown = False
    box_top = box_bot = 0.0
    buy_th = P.get('buy_th', 7.0); sell_th = P.get('sell_th', 7.0)
    
    for i in range(2, n):
        ss_val = bars[i]['v']
        if kalman_up[i] and not kalman_up[i-1]:
            arrow_up=True; arrow_down=False; retest_up=False; shown=False
            box_bot=float(l[i]); box_top=box_bot+float(atr200[i])
            signals.append({"index":i,"type":"ku","price":float(sk[i])})
        if not kalman_up[i] and kalman_up[i-1]:
            arrow_down=True; arrow_up=False; retest_down=False; shown=False
            box_top=float(h[i]); box_bot=box_top-float(atr200[i])
            signals.append({"index":i,"type":"kd","price":float(sk[i])})
        if arrow_up and not retest_up and box_top>0 and l[i]<=box_top*0.998:
            retest_up=True; signals.append({"index":i,"type":"retest_up","price":float(l[i])})
        if arrow_down and not retest_down and box_bot>0 and h[i]>=box_bot/0.998:
            retest_down=True; signals.append({"index":i,"type":"retest_down","price":float(h[i])})
        if arrow_up and retest_up and not shown and ss_val>=buy_th:
            signals.append({"index":i,"type":"buy","price":float(l[i]-atr200[i])}); shown=True
        if arrow_down and retest_down and not shown and ss_val<=-sell_th:
            signals.append({"index":i,"type":"sell","price":float(h[i]+atr200[i])}); shown=True

    return {"d": bars, "s": signals, "t": {"v": round(prev_ss, 2), "max_signals": round(sum(w), 1),
                              "dir": "상승" if kalman_up[-1] else "하락"}}
