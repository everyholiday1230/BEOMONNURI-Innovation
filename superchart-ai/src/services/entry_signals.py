"""진입 시그널 지표 — 범온 화살표 방향 + 5개 지표 0선 기준."""
import numpy as np


def compute_entry_signals(candles: list[dict], uprsi_stc: dict, pasr_pvi: dict, ultra: dict) -> dict:
    """
    진입 조건:
      - 범온 화살표가 매수면 매수만, 매도면 매도만 (큰 방향)
      - UD-RSI 빨강선 > 0 (매수) / < 0 (매도)
      - UD-Stoch 빨강선 > 0 / < 0
      - RSI/MFI 둘 다 또는 하나 > 0 / < 0
      - STC > 0 / < 0
      - PVI/NVI 초록 > 빨강 / 초록 < 빨강

    Returns: signals 리스트 + 각 지표 상태
    """
    n = len(candles)
    if n < 50:
        return {"signals": [], "states": []}

    # 지표 값 추출
    uprsi = np.array([x["value"] for x in uprsi_stc.get("a", [])]) if uprsi_stc.get("a") else np.zeros(n)
    upstoch = np.array([x["value"] for x in uprsi_stc.get("c", [])]) if uprsi_stc.get("c") else np.zeros(n)
    scaled_rsi = np.array([x["value"] for x in uprsi_stc.get("e", [])]) if uprsi_stc.get("e") else np.zeros(n)
    scaled_mfi = np.array([x["value"] for x in uprsi_stc.get("f", [])]) if uprsi_stc.get("f") else np.zeros(n)
    stc1 = np.array([x["value"] for x in uprsi_stc.get("g", [])]) if uprsi_stc.get("g") else np.zeros(n)
    stc2 = np.array([x["value"] for x in uprsi_stc.get("h", [])]) if uprsi_stc.get("h") else np.zeros(n)

    pn = np.array([x["value"] for x in pasr_pvi.get("pn", [])]) if pasr_pvi.get("pn") else np.zeros(n)
    pna = np.array([x["value"] for x in pasr_pvi.get("pna", [])]) if pasr_pvi.get("pna") else np.zeros(n)

    # 범온 화살표 방향 추적
    direction = np.zeros(n, dtype=int)
    d = 0
    for s in ultra.get("s", []):
        idx = s.get("index", 0)
        if idx < n:
            if s["type"] in ("buy", "kalman_up"):
                d = 1
            elif s["type"] in ("sell", "kalman_down"):
                d = -1
        # 이후 봉에 방향 적용
    d = 0
    for i in range(n):
        for s in ultra.get("s", []):
            if s.get("index") == i:
                if s["type"] in ("buy", "kalman_up"): d = 1
                elif s["type"] in ("sell", "kalman_down"): d = -1
        direction[i] = d

    # 5개 지표 0선 상태
    bull_rsi = uprsi > 0
    bull_stoch = upstoch > 0
    bull_rmfi = (scaled_rsi > 0) | (scaled_mfi > 0)
    bull_stc = (stc1 > 0) | (stc2 > 0)
    bull_pvi = pn > pna  # 초록 > 빨강 = 매수

    bear_rsi = uprsi < 0
    bear_stoch = upstoch < 0
    bear_rmfi = (scaled_rsi < 0) | (scaled_mfi < 0)
    bear_stc = (stc1 < 0) | (stc2 < 0)
    bear_pvi = pn < pna  # 초록 < 빨강 = 매도

    # 매매 시뮬레이션 (진입 + 익절 + 청산 모두 표시)
    signals = []
    states = []
    side = ""
    tp_stage = 0
    entry_price = 0.0

    for i in range(n):
        bull_count = sum([bull_rsi[i], bull_stoch[i], bull_rmfi[i], bull_stc[i], bull_pvi[i]])
        bear_count = sum([bear_rsi[i], bear_stoch[i], bear_rmfi[i], bear_stc[i], bear_pvi[i]])

        state = {
            "index": i,
            "direction": int(direction[i]),
            "bull_count": int(bull_count),
            "bear_count": int(bear_count),
            "rsi": "▲" if bull_rsi[i] else "▼",
            "stoch": "▲" if bull_stoch[i] else "▼",
            "rmfi": "▲" if bull_rmfi[i] else "▼",
            "stc": "▲" if bull_stc[i] else "▼",
            "pvi": "▲" if bull_pvi[i] else "▼",
        }
        states.append(state)

        price = float(candles[i].get("close") or candles[i].get("c", 0))
        low = float(candles[i].get("low") or candles[i].get("l", 0))
        high = float(candles[i].get("high") or candles[i].get("h", 0))
        prev_dir = direction[i-1] if i > 0 else 0

        if not side:
            # 매수 진입
            prev_bull = sum([bull_rsi[i-1], bull_stoch[i-1], bull_rmfi[i-1], bull_stc[i-1], bull_pvi[i-1]]) if i > 0 else 0
            if direction[i] == 1 and bull_count == 5 and (prev_bull < 5 or prev_dir != 1):
                signals.append({"index": i, "type": "entry_long", "price": low})
                side = "long"; tp_stage = 0; entry_price = price
                continue
            # 매도 진입
            prev_bear = sum([bear_rsi[i-1], bear_stoch[i-1], bear_rmfi[i-1], bear_stc[i-1], bear_pvi[i-1]]) if i > 0 else 0
            if direction[i] == -1 and bear_count == 5 and (prev_bear < 5 or prev_dir != -1):
                signals.append({"index": i, "type": "entry_short", "price": high})
                side = "short"; tp_stage = 0; entry_price = price
                continue
            continue

        # 포지션 있을 때
        my_count = bull_count if side == "long" else bear_count
        kalman_rev = (side == "long" and direction[i] == -1) or (side == "short" and direction[i] == 1)
        opp_count = bear_count if side == "long" else bull_count
        opp_dir = -1 if side == "long" else 1

        # 수익률 계산
        pct = 0.0
        if entry_price > 0:
            if side == "long": pct = round((price - entry_price) / entry_price * 100, 2)
            else: pct = round((entry_price - price) / entry_price * 100, 2)

        # 스위칭 (반대 Entry Signal)
        if opp_count == 5 and direction[i] == opp_dir:
            signals.append({"index": i, "type": "switch", "price": price, "pct": pct})
            side = "short" if side == "long" else "long"
            tp_stage = 0; entry_price = price
            continue

        # 전량청산: 1/5 이하 또는 칼만 반전
        if my_count <= 1 or kalman_rev:
            signals.append({"index": i, "type": "close", "price": price, "pct": pct})
            side = ""; tp_stage = 0; entry_price = 0
            continue

        # TP1: 3/5 이하
        if tp_stage == 0 and my_count <= 3:
            signals.append({"index": i, "type": "tp1", "price": price, "pct": pct})
            tp_stage = 1

        # TP2: 2/5 이하
        if tp_stage == 1 and my_count <= 2:
            signals.append({"index": i, "type": "tp2", "price": price, "pct": pct})
            tp_stage = 2

    return {"signals": signals, "states": states[-50:]}
