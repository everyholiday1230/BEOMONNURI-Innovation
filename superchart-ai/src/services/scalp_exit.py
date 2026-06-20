"""Trend Trader Remastered (TTR) — Pine Script 포팅.

Parabolic SAR (lagging) + BW Fractals 기반 Entry/Exit/TP/RE 시그널.
"""
import numpy as np


def _parabolic_sar(high, low, start=0.02, inc=0.02, maximum=0.025):
    """표준 PSAR + lagging PSAR 계산."""
    n = len(high)
    psar = np.zeros(n)
    psar_lag = np.zeros(n)
    direction = np.ones(n, dtype=int)  # 1=up, -1=down

    af = start
    ep = high[0]
    psar[0] = low[0]

    for i in range(1, n):
        prev = psar[i - 1]
        if direction[i - 1] == 1:
            psar[i] = prev + af * (ep - prev)
            psar[i] = min(psar[i], low[i - 1], low[max(0, i - 2)])
            if low[i] < psar[i]:
                direction[i] = -1
                psar[i] = ep
                af = start
                ep = low[i]
            else:
                direction[i] = 1
                if high[i] > ep:
                    ep = high[i]
                    af = min(af + inc, maximum)
        else:
            psar[i] = prev + af * (ep - prev)
            psar[i] = max(psar[i], high[i - 1], high[max(0, i - 2)])
            if high[i] > psar[i]:
                direction[i] = 1
                psar[i] = ep
                af = start
                ep = high[i]
            else:
                direction[i] = -1
                if low[i] < ep:
                    ep = low[i]
                    af = min(af + inc, maximum)

    # Lagging PSAR: 1봉 지연
    psar_lag[0] = psar[0]
    psar_lag[1:] = psar[:-1]

    return psar, psar_lag


def _bw_fractals(src_high, src_low, n):
    """Bill Williams Fractals — 피봇 하이/로우 감지."""
    length = len(src_high)
    highs = []  # (index, price)
    lows = []

    for i in range(2, length - 2):
        if all(src_high[i] > src_high[i + d] for d in [-2, -1, 1, 2]):
            highs.append((i, float(src_high[i])))
        if all(src_low[i] < src_low[i + d] for d in [-2, -1, 1, 2]):
            lows.append((i, float(src_low[i])))

    return highs, lows


def compute_ttr(candles: list[dict],
                psar_start=0.02, psar_inc=0.02, psar_max=0.025,
                frac_lb_high=2, frac_lb_low=2,
                re_min_proximity=0.0,
                re_buy_no_tp=False, re_sell_no_tp=False) -> dict:
    """TTR 시그널 계산. 캔들 리스트 → 시그널 + PSAR 라인."""
    n = len(candles)
    if n < 30:
        return {"signals": [], "psar_lagging": []}

    h = np.array([float(c.get("high") or c.get("h", 0)) for c in candles])
    l = np.array([float(c.get("low") or c.get("l", 0)) for c in candles])
    o = np.array([float(c.get("open") or c.get("o", 0)) for c in candles])
    c = np.array([float(c.get("close") or c.get("c", 0)) for c in candles])

    psar, psar_lag = _parabolic_sar(h, l, psar_start, psar_inc, psar_max)

    # BW Fractals
    frac_highs, frac_lows = _bw_fractals(h, l, n)

    # Lagging PSAR cross 감지
    lag_cross = np.zeros(n, dtype=int)
    for i in range(1, n):
        if psar_lag[i - 1] > h[i - 1] and h[i] > psar_lag[i]:
            lag_cross[i] = 1   # 상향 돌파
        elif psar_lag[i - 1] < l[i - 1] and l[i] < psar_lag[i]:
            lag_cross[i] = -1  # 하향 돌파

    # 포지션 추적 + 시그널 생성
    signals = []
    pos_state = None  # 'buy' or 'sell'
    pos_price = 0.0
    pos_since = 0
    tp_list = []   # TP 발생한 프랙탈 인덱스
    re_list = []   # RE 발생한 프랙탈 인덱스
    last_tp_price = None
    last_re_price = None

    for i in range(1, n):
        # Exit 체크
        if pos_state == 'buy' and lag_cross[i] == -1:
            signals.append({"index": i, "type": "exit_buy", "price": float(c[i])})
            pos_state = None
            tp_list = []
            re_list = []
            last_tp_price = None
            last_re_price = None

        elif pos_state == 'sell' and lag_cross[i] == 1:
            signals.append({"index": i, "type": "exit_sell", "price": float(c[i])})
            pos_state = None
            tp_list = []
            re_list = []
            last_tp_price = None
            last_re_price = None

        # Entry 체크
        if lag_cross[i] == 1:
            pos_state = 'buy'
            pos_price = float(psar_lag[i])
            pos_since = i
            tp_list = []
            re_list = []
            last_tp_price = None
            last_re_price = None
            signals.append({"index": i, "type": "entry_buy", "price": float(c[i])})

        elif lag_cross[i] == -1:
            pos_state = 'sell'
            pos_price = float(psar_lag[i])
            pos_since = i
            tp_list = []
            re_list = []
            last_tp_price = None
            last_re_price = None
            signals.append({"index": i, "type": "entry_sell", "price": float(c[i])})

        if pos_state is None:
            continue

        # TP/RE 평가 — 반전 캔들 조건
        up_bo = c[i - 1] > o[i - 1] and c[i] <= o[i]    # 양→음
        down_bo = c[i - 1] < o[i - 1] and c[i] >= o[i]  # 음→양
        proximity = abs(c[i] - psar_lag[i]) / max(psar_lag[i], 1e-10) * 100

        # HH fractals → buy TP / sell RE
        if up_bo and (pos_state == 'buy' or (pos_state == 'sell' and (re_sell_no_tp or last_tp_price is not None))):
            recent_hh = [f for f in frac_highs if f[0] >= pos_since and f[0] <= i]
            recent_hh = recent_hh[-frac_lb_high:] if len(recent_hh) > frac_lb_high else recent_hh
            for fi, fp in recent_hh:
                if pos_state == 'buy' and c[i] > pos_price and fi not in tp_list and (last_tp_price is None or c[i] > last_tp_price):
                    signals.append({"index": i, "type": "tp_buy", "price": float(c[i])})
                    tp_list.append(fi)
                    last_tp_price = float(c[i])
                    break
                if pos_state == 'sell' and proximity > re_min_proximity and fi not in re_list and (last_re_price is None or c[i] > last_re_price):
                    signals.append({"index": i, "type": "re_sell", "price": float(c[i])})
                    re_list.append(fi)
                    last_re_price = float(c[i])
                    break

        # LL fractals → sell TP / buy RE
        if down_bo and (pos_state == 'sell' or (pos_state == 'buy' and (re_buy_no_tp or last_tp_price is not None))):
            recent_ll = [f for f in frac_lows if f[0] >= pos_since and f[0] <= i]
            recent_ll = recent_ll[-frac_lb_low:] if len(recent_ll) > frac_lb_low else recent_ll
            for fi, fp in recent_ll:
                if pos_state == 'sell' and c[i] < pos_price and fi not in tp_list and (last_tp_price is None or c[i] < last_tp_price):
                    signals.append({"index": i, "type": "tp_sell", "price": float(c[i])})
                    tp_list.append(fi)
                    last_tp_price = float(c[i])
                    break
                if pos_state == 'buy' and proximity > re_min_proximity and fi not in re_list and (last_re_price is None or c[i] < last_re_price):
                    signals.append({"index": i, "type": "re_buy", "price": float(c[i])})
                    re_list.append(fi)
                    last_re_price = float(c[i])
                    break

    # PSAR lagging 라인 데이터
    psar_line = [{"index": i, "value": float(psar_lag[i]),
                  "side": "bull" if psar_lag[i] < l[i] else "bear"}
                 for i in range(n)]

    return {"signals": signals, "psar_lagging": psar_line}
compute_scalp_exit = compute_ttr
