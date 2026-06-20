"""진입 시그널 엔진 — 볼린저(60,2) + IMACD + 강도측정 + 과열분석 + 매매압력 + 자금흐름 + 범온캔들"""
import numpy as np
from src.services.beom_candle import compute_ultra_trend
from src.services.beom_sub import compute_uprsi_stc
from src.services.beom_candle_pro import compute_bimaco2


def compute_entry_signals(candles, bb_period=60, bb_mult=2):
    """5분봉 진입 시그널 계산. 반환: [{index, side, price, score}]"""
    if len(candles) < bb_period + 20:
        return []

    # 문자열→float 변환
    for c in candles:
        for k in ('open','high','low','close','volume'):
            if k in c: c[k] = float(c[k])

    closes = np.array([float(c['close']) for c in candles])
    highs = np.array([float(c['high']) for c in candles])
    lows = np.array([float(c['low']) for c in candles])
    n = len(closes)

    # 1. 볼린저밴드(60,2)
    bb_mid = np.zeros(n)
    bb_up = np.zeros(n)
    bb_lo = np.zeros(n)
    for i in range(bb_period - 1, n):
        w = closes[i - bb_period + 1:i + 1]
        m = np.mean(w)
        s = np.std(w)
        bb_mid[i] = m
        bb_up[i] = m + bb_mult * s
        bb_lo[i] = m - bb_mult * s

    # 2. 범온캔들
    ut = compute_ultra_trend(candles)
    ut_d = ut.get('d', [])
    bimaco = [d.get('v', 0) if isinstance(d, dict) else 0 for d in ut_d]
    bimaco = bimaco + [0] * (n - len(bimaco))

    # 3. 강도측정 + 과열분석 + 매매압력 + 자금흐름
    sub = compute_uprsi_stc(candles)
    def to_arr(key):
        arr = sub.get(key, [])
        vals = []
        for x in arr:
            if isinstance(x, dict):
                vals.append(x.get('value', 0))
            else:
                vals.append(float(x) if x else 0)
        return vals + [0] * (n - len(vals))

    uprsi = to_arr('a')      # 강도측정
    udstoch = to_arr('c')    # 과열분석
    rsimfi = to_arr('h')     # 매매압력
    stc = to_arr('g')        # 자금흐름

    # 4. IMACD
    try:
        b2 = compute_bimaco2(candles)
        imacd = b2.get('imacd', [])
        imacd = [float(x) if x else 0 for x in imacd] + [0] * (n - len(imacd))
    except Exception:
        imacd = [0] * n

    # 5. 시그널 생성
    signals = []
    for i in range(bb_period + 1, n):
        score_long = 0
        score_short = 0

        # 범온캔들
        if bimaco[i] >= 4: score_long += 2
        if bimaco[i] >= 8: score_long += 1
        if bimaco[i] <= -4: score_short += 2
        if bimaco[i] <= -8: score_short += 1

        # 강도측정
        if uprsi[i] > 0.1: score_long += 1
        if uprsi[i] < -0.1: score_short += 1

        # 과열분석
        if udstoch[i] > 0.1: score_long += 1
        if udstoch[i] < -0.1: score_short += 1

        # 매매압력
        if rsimfi[i] > 0: score_long += 1
        if rsimfi[i] < 0: score_short += 1

        # 자금흐름
        if stc[i] > 0: score_long += 1
        if stc[i] < 0: score_short += 1

        # IMACD
        if imacd[i] > 0: score_long += 1
        if imacd[i] < 0: score_short += 1

        # 볼린저 위치
        if closes[i] < bb_mid[i]: score_long += 1  # 중앙 아래 = 매수 유리
        if closes[i] > bb_mid[i]: score_short += 1
        if closes[i] <= bb_lo[i] * 1.002: score_long += 1  # 하단 근처
        if closes[i] >= bb_up[i] * 0.998: score_short += 1  # 상단 근처

        # 최소 7점 이상이면 시그널
        if score_long >= 7:
            signals.append({'index': i, 'side': 'long', 'price': float(closes[i]), 'score': score_long})
        elif score_short >= 7:
            signals.append({'index': i, 'side': 'short', 'price': float(closes[i]), 'score': score_short})

    return signals
