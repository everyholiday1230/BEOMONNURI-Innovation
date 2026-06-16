"""종합매매 시그널 v2 — 레짐 기반 조건부 구조.

핵심 변경:
- 단순 합산 → 3단계 필터 (추세확인 → 모멘텀확인 → 트리거)
- 시장 레짐 분류 (추세/횡보) → 레짐별 다른 진입 조건
- 청산도 조건부 (추적손절 + 반전 감지)
"""
import numpy as np
import pandas as pd


def _ema(d, p):
    a = 2 / (p + 1); r = [float(d[0])]
    for i in range(1, len(d)): r.append(a * d[i] + (1 - a) * r[-1])
    return np.array(r)


def _rsi(c, p=14):
    d = np.diff(c, prepend=c[0])
    g = np.where(d > 0, d, 0); l = np.where(d < 0, -d, 0)
    ag = _ema(g, p); al = _ema(l, p)
    return 100 - 100 / (1 + ag / np.maximum(al, 1e-10))


def _atr(h, l, c, p=14):
    tr = np.maximum(h - l, np.maximum(np.abs(h - np.roll(c, 1)), np.abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    return _ema(tr, p)


def _adx(h, l, c, p=14):
    """ADX — 추세 강도."""
    n = len(c)
    dp = np.zeros(n); dm = np.zeros(n)
    for i in range(1, n):
        up = h[i] - h[i-1]; dn = l[i-1] - l[i]
        dp[i] = up if up > dn and up > 0 else 0
        dm[i] = dn if dn > up and dn > 0 else 0
    atr = _atr(h, l, c, p)
    dip = _ema(dp, p) / np.maximum(atr, 1e-10) * 100
    dim = _ema(dm, p) / np.maximum(atr, 1e-10) * 100
    dx = np.abs(dip - dim) / np.maximum(dip + dim, 1e-10) * 100
    return _ema(dx, p), dip, dim


def compute_master_signal_v2(candles: list[dict], tf_minutes: int = 60) -> dict:
    n = len(candles)
    if n < 200:
        return {"signals": [], "score": [], "t": {}}

    # 타임프레임 적응형 파라미터
    if tf_minutes <= 5:
        atr_mult = 3.5; cooldown = 30; adx_th = 25
    elif tf_minutes <= 15:
        atr_mult = 3.0; cooldown = 20; adx_th = 22
    else:
        atr_mult = 2.0; cooldown = 10; adx_th = 20

    o = np.array([float(x.get("open", 0)) for x in candles])
    h = np.array([float(x.get("high", 0)) for x in candles])
    l = np.array([float(x.get("low", 0)) for x in candles])
    c = np.array([float(x.get("close", 0)) for x in candles])
    v = np.array([float(x.get("volume", 0)) for x in candles])

    # 기본 지표
    atr = _atr(h, l, c, 14)
    rsi = _rsi(c, 14)
    e20 = _ema(c, 20); e50 = _ema(c, 50)
    adx, dip, dim = _adx(h, l, c, 14)
    vol_ma = pd.Series(v).rolling(20, min_periods=1).mean().to_numpy()

    # KVO
    hlc3 = (h + l + c) / 3; dm_hl = h - l
    trend = np.zeros(n)
    for i in range(1, n): trend[i] = 1 if hlc3[i] > hlc3[i-1] else -1
    cm = np.zeros(n); cm[0] = dm_hl[0]
    for i in range(1, n): cm[i] = cm[i-1] + dm_hl[i] if trend[i] == trend[i-1] else dm_hl[i-1] + dm_hl[i]
    vf = np.where(np.abs(cm) > 0, v * np.abs(2 * dm_hl / np.maximum(np.abs(cm), 1e-10) * 100 - 1) * trend, 0)
    kvo = _ema(vf, 34) - _ema(vf, 55)
    kvo_sig = _ema(kvo, 13)

    signals = []
    scores = np.zeros(n)
    last_entry_idx = -999
    last_entry_side = ''
    trail_stop = 0.0
    peak_pnl = 0.0

    for i in range(50, n):
        # ═══ STEP 1: 레짐 분류 ═══
        is_trending = adx[i] > adx_th
        trend_bull = e20[i] > e50[i]
        trend_bear = e20[i] < e50[i]

        # ═══ STEP 2: 조건 플래그 ═══
        # 추세 확인
        ema_bull = c[i] > e20[i] and e20[i] > e50[i]
        ema_bear = c[i] < e20[i] and e20[i] < e50[i]

        # 모멘텀 확인
        rsi_bull = 40 < rsi[i] < 70  # 과매수 아닌 상승 모멘텀
        rsi_bear = 30 < rsi[i] < 60  # 과매도 아닌 하락 모멘텀
        rsi_oversold = rsi[i] < 30
        rsi_overbought = rsi[i] > 70

        # 거래량 확인
        vol_surge = v[i] > vol_ma[i] * 1.3

        # KVO 확인
        kvo_bull = kvo[i] > kvo_sig[i]
        kvo_bear = kvo[i] < kvo_sig[i]
        kvo_cross_up = i > 0 and kvo[i] > kvo_sig[i] and kvo[i-1] <= kvo_sig[i-1]
        kvo_cross_dn = i > 0 and kvo[i] < kvo_sig[i] and kvo[i-1] >= kvo_sig[i-1]

        # DI 확인
        di_bull = dip[i] > dim[i]
        di_bear = dim[i] > dip[i]

        # 캔들 패턴
        body = c[i] - o[i]
        bull_candle = body > atr[i] * 0.3  # 의미있는 양봉
        bear_candle = body < -atr[i] * 0.3

        # ═══ STEP 3: 점수 (시각화용) ═══
        sc = 0
        if ema_bull: sc += 1
        elif ema_bear: sc -= 1
        if di_bull: sc += 1
        elif di_bear: sc -= 1
        if kvo_bull: sc += 1
        elif kvo_bear: sc -= 1
        if rsi_oversold: sc += 1
        elif rsi_overbought: sc -= 1
        if vol_surge and bull_candle: sc += 1
        elif vol_surge and bear_candle: sc -= 1
        scores[i] = sc

        # ═══ STEP 4: 진입 (3단계 필터) ═══
        cooldown_ok = i - last_entry_idx > cooldown

        if cooldown_ok and not last_entry_side:
            # 추세장 매수: 추세확인 + 모멘텀 + 트리거
            vol_req = vol_surge if tf_minutes <= 15 else True  # 짧은 TF는 거래량 필수
            if is_trending and ema_bull and di_bull and rsi_bull and vol_req and (kvo_cross_up or (vol_surge and bull_candle)):
                signals.append({"index": i, "type": "buy", "score": float(sc), "price": float(c[i])})
                last_entry_idx = i; last_entry_side = 'long'
                trail_stop = float(c[i] - atr[i] * atr_mult); peak_pnl = 0

            # 추세장 매도
            elif is_trending and ema_bear and di_bear and rsi_bear and vol_req and (kvo_cross_dn or (vol_surge and bear_candle)):
                signals.append({"index": i, "type": "sell", "score": float(sc), "price": float(c[i])})
                last_entry_idx = i; last_entry_side = 'short'
                trail_stop = float(c[i] + atr[i] * atr_mult); peak_pnl = 0

            # 횡보장 반전 매수: 과매도 + KVO 크로스 + 거래량
            elif not is_trending and rsi_oversold and kvo_cross_up and vol_surge:
                signals.append({"index": i, "type": "buy", "score": float(sc), "price": float(c[i])})
                last_entry_idx = i; last_entry_side = 'long'
                trail_stop = float(c[i] - atr[i] * (atr_mult * 0.75)); peak_pnl = 0

            # 횡보장 반전 매도
            elif not is_trending and rsi_overbought and kvo_cross_dn and vol_surge:
                signals.append({"index": i, "type": "sell", "score": float(sc), "price": float(c[i])})
                last_entry_idx = i; last_entry_side = 'short'
                trail_stop = float(c[i] + atr[i] * (atr_mult * 0.75)); peak_pnl = 0

        # ═══ STEP 5: 청산 (추적손절 + 반전) ═══
        elif last_entry_side:
            entry_price = signals[-1]["price"] if signals else c[i]
            if last_entry_side == 'long':
                pnl = (c[i] - entry_price) / entry_price
                if pnl > peak_pnl: peak_pnl = pnl
                # 추적손절 업데이트
                new_stop = float(c[i] - atr[i] * atr_mult)
                if new_stop > trail_stop: trail_stop = new_stop
                # 청산 조건
                if c[i] < trail_stop:  # 추적손절
                    signals.append({"index": i, "type": "close_long", "score": float(sc), "price": float(c[i])})
                    last_entry_side = ''
                elif ema_bear and di_bear and kvo_cross_dn:  # 추세 반전
                    signals.append({"index": i, "type": "close_long", "score": float(sc), "price": float(c[i])})
                    last_entry_side = ''
            else:  # short
                pnl = (entry_price - c[i]) / entry_price
                if pnl > peak_pnl: peak_pnl = pnl
                new_stop = float(c[i] + atr[i] * atr_mult)
                if new_stop < trail_stop: trail_stop = new_stop
                if c[i] > trail_stop:
                    signals.append({"index": i, "type": "close_short", "score": float(sc), "price": float(c[i])})
                    last_entry_side = ''
                elif ema_bull and di_bull and kvo_cross_up:
                    signals.append({"index": i, "type": "close_short", "score": float(sc), "price": float(c[i])})
                    last_entry_side = ''

    last_sc = float(scores[-1]) if n > 0 else 0
    regime = "추세" if adx[-1] > 20 else "횡보"
    direction = "매수" if e20[-1] > e50[-1] else "매도"
    return {
        "score": [{"index": i, "value": float(scores[i])} for i in range(n)],
        "signals": signals,
        "t": {"score": last_sc, "regime": regime, "dir": direction}
    }
