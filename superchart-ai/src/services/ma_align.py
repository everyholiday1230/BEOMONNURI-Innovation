"""정배열/역배열 전환 시그널 스캐너.

정배열(매수): C>SMA5>SMA20>SMA60, O<SMA224, 최근30봉 내 고점/SMA224 조건
역배열(매도): C<SMA5<SMA20<SMA60, O>SMA224, 동일 조건
con1=15000, con2=-1, con3=30
"""
import numpy as np


def _sma(data, period):
    n = len(data)
    r = np.full(n, np.nan)
    cs = np.cumsum(data)
    r[period - 1:] = (cs[period - 1:] - np.concatenate([[0], cs[:n - period]])) / period
    return r


def compute_alignment(candles: list[dict], con2=-1, con3=30) -> list[dict]:
    n = len(candles)
    if n < 224:
        return []

    o = np.array([float(x.get("open") or x.get("o", 0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h", 0)) for x in candles])
    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])

    sma5 = _sma(c, 5)
    sma20 = _sma(c, 20)
    sma60 = _sma(c, 60)
    sma224 = _sma(c, 224)

    # x8: 1봉 전 고점 / 1봉 전 SMA224 비율이 con2% 이상
    x8 = np.zeros(n, dtype=bool)
    for i in range(1, n):
        if not np.isnan(sma224[i - 1]) and sma224[i - 1] > 0:
            x8[i] = ((h[i - 1] / sma224[i - 1]) - 1) * 100 >= con2

    # x9: 최근 con3봉 내 x8이 1번 이상 True
    x9 = np.zeros(n, dtype=bool)
    x8_cum = np.cumsum(x8.astype(int))
    for i in range(con3, n):
        x9[i] = (x8_cum[i] - x8_cum[i - con3]) >= 1

    signals = []
    for i in range(1, n):
        if np.isnan(sma224[i]):
            continue

        # 정배열
        bull = (c[i] > sma5[i] and c[i] > sma20[i] and c[i] > sma60[i]
                and sma5[i] > sma20[i] and sma5[i] > sma60[i]
                and o[i] < sma224[i] and x9[i])
        # 이전 봉은 정배열 아니었을 때만 (전환 시점)
        prev_bull = (i > 0 and not np.isnan(sma224[i-1])
                     and c[i-1] > sma5[i-1] and c[i-1] > sma20[i-1] and c[i-1] > sma60[i-1]
                     and sma5[i-1] > sma20[i-1] and sma5[i-1] > sma60[i-1]
                     and o[i-1] < sma224[i-1] and x9[i-1])

        if bull and not prev_bull:
            signals.append({"index": i, "price": float(c[i]), "type": "bull_align"})

        # 역배열
        bear = (c[i] < sma5[i] and c[i] < sma20[i] and c[i] < sma60[i]
                and sma5[i] < sma20[i] and sma5[i] < sma60[i]
                and o[i] > sma224[i] and x9[i])
        prev_bear = (i > 0 and not np.isnan(sma224[i-1])
                     and c[i-1] < sma5[i-1] and c[i-1] < sma20[i-1] and c[i-1] < sma60[i-1]
                     and sma5[i-1] < sma20[i-1] and sma5[i-1] < sma60[i-1]
                     and o[i-1] > sma224[i-1] and x9[i-1])

        if bear and not prev_bear:
            signals.append({"index": i, "price": float(c[i]), "type": "bear_align"})

    return signals
compute_ma_align = compute_alignment
