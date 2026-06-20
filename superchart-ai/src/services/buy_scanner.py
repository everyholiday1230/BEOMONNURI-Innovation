"""복합 매수 시그널 스캐너.

조건:
1. SMA(5) CrossUp SMA(60)
2. SMA(20) CrossUp SMA(60)
3. MACD(24,52) > EMA(MACD,20)
4. SONAR(13) >= 0
5. Close > EMA(100)
"""
import numpy as np


def _sma(data, period):
    r = np.empty(len(data))
    r[:] = np.nan
    cs = np.cumsum(data)
    r[period - 1:] = (cs[period - 1:] - np.concatenate([[0], cs[:len(data) - period]])) / period
    return r


def _ema(data, span):
    a = 2 / (span + 1)
    r = np.empty_like(data, dtype=float)
    r[0] = data[0]
    for i in range(1, len(data)):
        r[i] = a * data[i] + (1 - a) * r[i - 1]
    return r


def compute_buy_scanner(candles: list[dict], sma_fast: int = 5, sma_slow: int = 90, ema_long: int = 50) -> list[dict]:
    n = len(candles)
    if n < 100:
        return []

    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])

    sma5 = _sma(c, sma_fast)
    sma20 = _sma(c, 20)
    sma60 = _sma(c, sma_slow)
    ema100 = _ema(c, ema_long)

    # MACD(24,52)
    e24 = _ema(c, 24)
    e52 = _ema(c, 52)
    macd = e24 - e52
    macd_ema20 = _ema(macd, 20)

    # SONAR(13): 모멘텀 = close - close[13]
    sonar = np.zeros(n)
    for i in range(13, n):
        sonar[i] = c[i] - c[i - 13]

    LOOKBACK = 20  # 최근 N봉 내 두 크로스 모두 발생 필요
    last_cross5_up = -999
    last_cross20_up = -999
    last_cross5_dn = -999
    last_cross20_dn = -999

    signals = []
    for i in range(1, n):
        if np.isnan(sma5[i]) or np.isnan(sma60[i]) or np.isnan(sma20[i]):
            continue

        # 크로스 발생 기록
        if sma5[i - 1] <= sma60[i - 1] and sma5[i] > sma60[i]: last_cross5_up = i
        if sma20[i - 1] <= sma60[i - 1] and sma20[i] > sma60[i]: last_cross20_up = i
        if sma5[i - 1] >= sma60[i - 1] and sma5[i] < sma60[i]: last_cross5_dn = i
        if sma20[i - 1] >= sma60[i - 1] and sma20[i] < sma60[i]: last_cross20_dn = i

        macd_above = macd[i] > macd_ema20[i]
        macd_below = macd[i] < macd_ema20[i]
        sonar_pos = sonar[i] >= 0
        sonar_neg = sonar[i] <= 0
        above_ema100 = c[i] > ema100[i]
        below_ema100 = c[i] < ema100[i]

        # 매수: 최근 LOOKBACK봉 내 두 크로스업 모두 발생 + 나머지 조건
        both_up = (i - last_cross5_up <= LOOKBACK) and (i - last_cross20_up <= LOOKBACK)
        if both_up and macd_above and sonar_pos and above_ema100:
            trigger = max(last_cross5_up, last_cross20_up)
            if not signals or signals[-1].get('_trigger') != trigger or signals[-1]['type'] != 'buy':
                signals.append({
                    "index": i, "price": float(c[i]), "type": "buy",
                    "cross": "5+20/60",
                    "conditions": 5, "_trigger": trigger,
                })

        # 매도: 최근 LOOKBACK봉 내 두 크로스다운 모두 발생 + 나머지 조건
        both_dn = (i - last_cross5_dn <= LOOKBACK) and (i - last_cross20_dn <= LOOKBACK)
        if both_dn and macd_below and sonar_neg and below_ema100:
            trigger = max(last_cross5_dn, last_cross20_dn)
            if not signals or signals[-1].get('_trigger') != trigger or signals[-1]['type'] != 'sell':
                signals.append({
                    "index": i, "price": float(c[i]), "type": "sell",
                    "cross": "5+20/60",
                    "conditions": 5, "_trigger": trigger,
                })

    # _trigger 제거
    for s in signals:
        s.pop('_trigger', None)
    return signals
