"""PVI/NVI 크로스 시그널 계산."""
import numpy as np


def compute_pvi_nvi_signals(candles: list[dict], avg_period: int = None) -> list[dict]:
    """
    a = PVI(close) + NVI(close)
    b = avg(PVI, period) + avg(NVI, period)
    avg_period auto-adjusts: min(240, len//2) to handle short data (e.g. Upbit 200 limit)
    """
    if len(candles) < 50:
        return []
    if avg_period is None:
        avg_period = min(240, max(20, len(candles) // 4))

    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])
    v = np.array([float(x.get("volume") or x.get("v", 0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h", 0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l", 0)) for x in candles])
    n = len(candles)

    # PVI: 거래량 증가일에만 가격 변화 반영
    pvi = np.zeros(n)
    pvi[0] = 1000
    for i in range(1, n):
        if v[i] > v[i - 1] and c[i - 1] != 0:
            pvi[i] = pvi[i - 1] + (c[i] - c[i - 1]) / c[i - 1] * pvi[i - 1]
        else:
            pvi[i] = pvi[i - 1]

    # NVI: 거래량 감소일에만 가격 변화 반영
    nvi = np.zeros(n)
    nvi[0] = 1000
    for i in range(1, n):
        if v[i] < v[i - 1] and c[i - 1] != 0:
            nvi[i] = nvi[i - 1] + (c[i] - c[i - 1]) / c[i - 1] * nvi[i - 1]
        else:
            nvi[i] = nvi[i - 1]

    # a = PVI + NVI
    a = pvi + nvi

    # b = avg(PVI, 240) + avg(NVI, 240) — SMA
    pvi_avg = np.zeros(n)
    nvi_avg = np.zeros(n)
    for i in range(avg_period - 1, n):
        pvi_avg[i] = np.mean(pvi[i - avg_period + 1:i + 1])
        nvi_avg[i] = np.mean(nvi[i - avg_period + 1:i + 1])
    b = pvi_avg + nvi_avg

    # 크로스 감지
    signals = []
    for i in range(avg_period, n):
        # CrossDown(a, b): a가 b 아래로
        if a[i] < b[i] and a[i - 1] >= b[i - 1]:
            signals.append({
                "index": i,
                "type": "sell",
                "price": float(h[i]),  # 캔들 위에 표시
                "a": float(a[i]),
                "b": float(b[i]),
            })
        # CrossUp(a, b): a가 b 위로
        elif a[i] > b[i] and a[i - 1] <= b[i - 1]:
            signals.append({
                "index": i,
                "type": "buy",
                "price": float(l[i]),  # 캔들 아래에 표시
                "a": float(a[i]),
                "b": float(b[i]),
            })

    return signals
