"""PASR+AVG+TRIX+SONAR+PVI+NVI 복합 지표 — Pine Script 완벽 포팅."""
import numpy as np


def _vwma(src, vol, period):
    """Volume Weighted Moving Average."""
    n = len(src)
    r = np.empty(n, dtype=float)
    for i in range(n):
        start = max(0, i - period + 1)
        sv = src[start:i+1] * vol[start:i+1]
        vv = vol[start:i+1]
        vs = np.sum(vv)
        r[i] = np.sum(sv) / vs if vs > 0 else src[i]
    return r


def _sar(high, low, af_start=0.01, af_max=0.15, af_step=0.15):
    """Parabolic SAR (start=0.01, inc=0.15, max=0.15)."""
    n = len(high)
    sar = np.zeros(n)
    direction = np.ones(n, dtype=int)
    af = af_start
    ep = high[0]
    sar[0] = low[0]

    for i in range(1, n):
        prev = sar[i - 1]
        if direction[i - 1] == 1:
            sar[i] = prev + af * (ep - prev)
            sar[i] = min(sar[i], low[i - 1], low[max(0, i - 2)])
            if low[i] < sar[i]:
                direction[i] = -1
                sar[i] = ep
                af = af_start
                ep = low[i]
            else:
                direction[i] = 1
                if high[i] > ep:
                    ep = high[i]
                    af = min(af + af_step, af_max)
        else:
            sar[i] = prev + af * (ep - prev)
            sar[i] = max(sar[i], high[i - 1], high[max(0, i - 2)])
            if high[i] > sar[i]:
                direction[i] = 1
                sar[i] = ep
                af = af_start
                ep = high[i]
            else:
                direction[i] = -1
                if low[i] < ep:
                    ep = low[i]
                    af = min(af + af_step, af_max)
    return sar


def compute_pasr_pvi(candles: list[dict], vwma_period=60, pna_period=240) -> dict:
    """PASR+TRIX+SONAR+PVI+NVI 계산. 서브차트 + 배경색 + 시그널 반환."""
    n = len(candles)
    if n < 30:
        return {"pn": [], "pna": [], "bg": [], "signals": []}
    if n < 300:
        vwma_period = min(vwma_period, max(2, n - 1))
        pna_period = min(pna_period, max(2, n - 1))

    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h", 0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l", 0)) for x in candles])
    v = np.array([float(x.get("volume") or x.get("v", 0)) for x in candles])

    multiplier = 0.000005

    # A = VWMA(close, 60)
    A = _vwma(c, v, vwma_period)
    prevA = np.concatenate([[A[0]], A[:-1]])

    # TRIX = 100 * (vwma3 - vwma3[1]) / vwma3[1]
    e1 = _vwma(c, v, 18)
    e2 = _vwma(e1, v, 18)
    e3 = _vwma(e2, v, 18)
    trix = np.zeros(n)
    for i in range(1, n):
        trix[i] = 100 * (e3[i] - e3[i-1]) / e3[i-1] if e3[i-1] != 0 else 0

    # SONAR = momentum(close, 21)
    sonar = np.zeros(n)
    for i in range(21, n):
        sonar[i] = c[i] - c[i - 21]

    # SAR
    sar = _sar(h, l, 0.01, 0.15, 0.15)

    # 배경색 조건
    bg = []
    for i in range(n):
        up = (A[i] > prevA[i] * (1 + multiplier)) and (trix[i] >= 0) and (sonar[i] >= 0) and (c[i] >= sar[i])
        down = (A[i] < prevA[i] * (1 - multiplier)) and (trix[i] <= 0) and (sonar[i] < 0) and (c[i] < sar[i])
        if up:
            bg.append({"index": i, "color": "up"})
        elif down:
            bg.append({"index": i, "color": "down"})
        else:
            bg.append({"index": i, "color": "sideways"})

    # PVI
    pvi = np.zeros(n)
    pvi[0] = 1000
    for i in range(1, n):
        if v[i] > v[i-1] and c[i-1] != 0:
            pvi[i] = pvi[i-1] + (c[i] - c[i-1]) / c[i-1] * pvi[i-1]
        else:
            pvi[i] = pvi[i-1]

    # NVI
    nvi = np.zeros(n)
    nvi[0] = 1000
    for i in range(1, n):
        if v[i] < v[i-1] and c[i-1] != 0:
            nvi[i] = nvi[i-1] + (c[i] - c[i-1]) / c[i-1] * nvi[i-1]
        else:
            nvi[i] = nvi[i-1]

    # PN = PVI + NVI
    pn = pvi + nvi

    # PNA = VWMA(PVI, pna_period) + VWMA(NVI, pna_period)
    p_avg = _vwma(pvi, v, pna_period)
    n_avg = _vwma(nvi, v, pna_period)
    pna = p_avg + n_avg

    # PN 색상: PN > PNA → green, PN == PNA → purple, PN < PNA → red
    pn_data = []
    for i in range(n):
        if pn[i] > pna[i]:
            color = "#22c55e"
        elif pn[i] < pna[i]:
            color = "#ef4444"
        else:
            color = "#a855f7"
        pn_data.append({"index": i, "value": round(float(pn[i]), 4), "color": color})

    # PNA 색상: PNA > PNA[1] → maroon, else → navy
    pna_data = []
    for i in range(n):
        prev = pna[i-1] if i > 0 else pna[i]
        color = "#991b1b" if pna[i] > prev else "#1e3a5f"
        pna_data.append({"index": i, "value": round(float(pna[i]), 4), "color": color})

    # 시그널
    # 매수: PNA > PNA[1] and PN > PNA
    # 매도: PNA < PNA[1] and PN < PNA
    signals = []
    for i in range(1, n):
        pna_up = pna[i] > pna[i-1]
        pna_down = pna[i] < pna[i-1]
        prev_pna_up = pna[i-1] > pna[i-2] if i > 1 else False
        prev_pna_down = pna[i-1] < pna[i-2] if i > 1 else False

        buy = pna_up and pn[i] > pna[i]
        sell = pna_down and pn[i] < pna[i]
        prev_buy = prev_pna_up and pn[i-1] > pna[i-1]
        prev_sell = prev_pna_down and pn[i-1] < pna[i-1]

        if buy and not prev_buy:
            signals.append({"index": i, "type": "buy", "price": float(l[i])})
        if sell and not prev_sell:
            signals.append({"index": i, "type": "sell", "price": float(h[i])})

    return {
        "pn": pn_data,
        "pna": pna_data,
        "bg": bg,
        "signals": signals,
    }
compute_beom_pasr = compute_pasr_pvi
