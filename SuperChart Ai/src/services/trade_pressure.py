"""Trade Pressure + Capital Flow — 매수/매도 압력 및 자금 유입/유출.

Trade Pressure: 체결 기반 단기 매수/매도 압력 측정
Capital Flow: 거래량 가중 자금 흐름 방향 측정
"""
import numpy as np


def _ema(src, period):
    a = 2.0 / (period + 1)
    r = np.empty_like(src, dtype=float)
    r[0] = src[0]
    for i in range(1, len(src)):
        r[i] = a * src[i] + (1 - a) * r[i - 1]
    return r


def compute_trade_pressure(candles, fast=14, slow=28):
    """매수/매도 압력 계산.

    원리: 각 봉에서 종가가 고가-저가 범위 내 어디에 위치하는지로
    매수 압력(종가가 고가 근처)과 매도 압력(종가가 저가 근처)을 측정.
    거래량을 가중하여 실제 체결 힘을 반영.

    Returns: {
        'pressure': array,          # 양수=매수우위, 음수=매도우위
        'pressure_fast': array,     # 단기 압력 (EMA fast)
        'pressure_slow': array,     # 장기 압력 (EMA slow)
        'dir': int,                 # 최신 방향 1/0/-1
        'value': float,             # 최신 값
        'buy_ratio': float,         # 최신 매수 비율 0~1
        'sell_ratio': float,        # 최신 매도 비율 0~1
    }
    """
    n = len(candles)
    if n < slow + 5:
        return _empty_pressure(n)

    c = np.array([float(x.get('close') or x.get('c', 0)) for x in candles])
    h = np.array([float(x.get('high') or x.get('h', 0)) for x in candles])
    l = np.array([float(x.get('low') or x.get('l', 0)) for x in candles])
    v = np.array([float(x.get('volume') or x.get('v', 0)) for x in candles])

    # 매수/매도 압력 원시값
    hl_range = np.maximum(h - l, 1e-10)
    # 종가 위치 비율: 0(저가)~1(고가)
    close_position = (c - l) / hl_range

    # 매수 압력 = 종가위치 × 거래량, 매도 압력 = (1-종가위치) × 거래량
    buy_pressure = close_position * v
    sell_pressure = (1 - close_position) * v

    # 순 압력 = (매수 - 매도) / 전체
    total_vol = np.maximum(buy_pressure + sell_pressure, 1e-10)
    net_pressure = (buy_pressure - sell_pressure) / total_vol

    # EMA 스무딩
    pressure_fast = _ema(net_pressure, fast)
    pressure_slow = _ema(net_pressure, slow)

    # 최종 압력 = fast - slow (모멘텀 방식)
    pressure = pressure_fast - pressure_slow

    # 최신 값
    val = float(pressure[-1])
    buy_r = float(np.mean(close_position[-fast:]))
    sell_r = 1.0 - buy_r

    if val > 0.02:
        direction = 1
    elif val < -0.02:
        direction = -1
    else:
        direction = 0

    return {
        'pressure': pressure,
        'pressure_fast': pressure_fast,
        'pressure_slow': pressure_slow,
        'dir': direction,
        'value': round(val, 4),
        'buy_ratio': round(buy_r, 3),
        'sell_ratio': round(sell_r, 3),
    }


def compute_capital_flow(candles, period=20, smooth=5):
    """자금 유입/유출 계산.

    원리: MFI(Money Flow Index) 변형 + OBV 기울기 결합.
    가격 상승 시 거래량 = 유입, 가격 하락 시 거래량 = 유출.
    유입/유출 비율의 변화 방향으로 자금 흐름 판단.

    Returns: {
        'flow': array,              # 양수=유입, 음수=유출
        'flow_smooth': array,       # EMA 스무딩
        'dir': int,                 # 최신 방향 1/0/-1
        'value': float,             # 최신 값
        'obv_slope': float,         # OBV 기울기
        'inflow_ratio': float,      # 유입 비율
    }
    """
    n = len(candles)
    if n < period + 10:
        return _empty_flow(n)

    c = np.array([float(x.get('close') or x.get('c', 0)) for x in candles])
    h = np.array([float(x.get('high') or x.get('h', 0)) for x in candles])
    l = np.array([float(x.get('low') or x.get('l', 0)) for x in candles])
    v = np.array([float(x.get('volume') or x.get('v', 0)) for x in candles])

    # Typical Price
    tp = (h + l + c) / 3.0
    raw_mf = tp * v  # Money Flow

    # 양/음 Money Flow
    pos_mf = np.zeros(n)
    neg_mf = np.zeros(n)
    for i in range(1, n):
        if tp[i] > tp[i - 1]:
            pos_mf[i] = raw_mf[i]
        elif tp[i] < tp[i - 1]:
            neg_mf[i] = raw_mf[i]

    # 기간별 합산
    flow = np.zeros(n)
    for i in range(period, n):
        p_sum = np.sum(pos_mf[i - period + 1:i + 1])
        n_sum = np.sum(neg_mf[i - period + 1:i + 1])
        total = p_sum + n_sum
        if total > 0:
            flow[i] = (p_sum - n_sum) / total  # -1 ~ +1
        else:
            flow[i] = 0

    flow_smooth = _ema(flow, smooth)

    # OBV
    obv = np.zeros(n)
    for i in range(1, n):
        if c[i] > c[i - 1]:
            obv[i] = obv[i - 1] + v[i]
        elif c[i] < c[i - 1]:
            obv[i] = obv[i - 1] - v[i]
        else:
            obv[i] = obv[i - 1]

    # OBV 기울기 (최근 10봉)
    lb = min(10, n - 1)
    obv_slope = (obv[-1] - obv[-lb - 1]) / max(abs(obv[-lb - 1]), 1e-10) if lb > 0 else 0

    # 유입 비율
    recent = max(period, 1)
    inflow = np.sum(pos_mf[-recent:])
    outflow = np.sum(neg_mf[-recent:])
    total_flow = inflow + outflow
    inflow_ratio = inflow / total_flow if total_flow > 0 else 0.5

    val = float(flow_smooth[-1])
    if val > 0.05:
        direction = 1
    elif val < -0.05:
        direction = -1
    else:
        direction = 0

    return {
        'flow': flow,
        'flow_smooth': flow_smooth,
        'dir': direction,
        'value': round(val, 4),
        'obv_slope': round(float(obv_slope), 4),
        'inflow_ratio': round(float(inflow_ratio), 3),
    }


def _empty_pressure(n):
    z = np.zeros(n)
    return {'pressure': z, 'pressure_fast': z, 'pressure_slow': z,
            'dir': 0, 'value': 0, 'buy_ratio': 0.5, 'sell_ratio': 0.5}


def _empty_flow(n):
    z = np.zeros(n)
    return {'flow': z, 'flow_smooth': z, 'dir': 0, 'value': 0,
            'obv_slope': 0, 'inflow_ratio': 0.5}
