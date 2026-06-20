"""자동매매 전략 엔진 (Paper Trading — 차트 신호만).

사용자 명세 (2026-05-08):
- 지표 9개: BEOM AI 캔들, 거래밀집구간, 과열분석, 강도측정, 종합매매, 범온MA, IMACD, VWAP, 피보나치
- 진입 수량: 자금의 10%
- 레버리지: 5x
- 초기 손절: AI목표(bimaco_tp) 알고리즘의 stop 가격 사용
- TP: AI목표의 tp1/tp2/tp3 사용
- 행동 우선순위: 손절 > 전체청산 > TP3 > TP2 > TP1 > 트레일링 > 진입 > 관망
- 트레일링: 보수적(A) — 진입후 SL=초기, TP1→SL=진입가, TP2→SL=TP1
- 2가지 모드:
    · conservative (보수적): 9개 중 6개 이상 일치 시 진입
    · balanced (절충): 9개 중 5개 이상 일치 시 진입

출력:
    compute_autobot_signals(candles, tf, mode) -> list[Signal]
    각 Signal: {
        index, time, action, dir,
        entry, stop, tp1, tp2, tp3,
        confidence, reasons: [...]
    }

주의:
- 이 엔진은 순수 계산만 수행. 실제 주문 실행 금지.
- 프론트가 signals를 받아 차트에 마커로 표시.
"""
from __future__ import annotations
from enum import Enum
from typing import Any
import numpy as np


class Action(str, Enum):
    HOLD = "HOLD"
    ENTER_LONG = "ENTER_LONG"
    ENTER_SHORT = "ENTER_SHORT"
    LONG_TP1 = "LONG_TP1"
    LONG_TP2 = "LONG_TP2"
    LONG_TP3 = "LONG_TP3"
    SHORT_TP1 = "SHORT_TP1"
    SHORT_TP2 = "SHORT_TP2"
    SHORT_TP3 = "SHORT_TP3"
    EXIT_ALL = "EXIT_ALL"
    STOP_LOSS = "STOP_LOSS"
    UPDATE_TRAILING_STOP = "UPDATE_TRAILING_STOP"


class Position:
    """단일 포지션 상태."""
    __slots__ = ("dir", "entry_price", "entry_idx", "stop_price",
                 "tp1_price", "tp2_price", "tp3_price",
                 "tp1_done", "tp2_done", "tp3_done",
                 "entry_qty", "remaining_qty")

    def __init__(self, dir: str, entry_price: float, entry_idx: int,
                 stop: float, tp1: float, tp2: float, tp3: float,
                 qty: float):
        self.dir = dir  # 'long' or 'short'
        self.entry_price = entry_price
        self.entry_idx = entry_idx
        self.stop_price = stop
        self.tp1_price = tp1
        self.tp2_price = tp2
        self.tp3_price = tp3
        self.tp1_done = False
        self.tp2_done = False
        self.tp3_done = False
        self.entry_qty = qty
        self.remaining_qty = qty

    def update_trailing_after_tp(self):
        """TP 도달 시 SL 끌어올리기 (보수적 A안)."""
        if self.tp3_done:
            return  # 전체 청산됨
        if self.tp2_done:
            self.stop_price = self.tp1_price  # SL → TP1
        elif self.tp1_done:
            self.stop_price = self.entry_price  # SL → 진입가


def _compute_indicator_votes(idx: int,
                              c: np.ndarray,
                              h: np.ndarray,
                              l: np.ndarray,
                              ut_dir: np.ndarray,
                              ms_score: np.ndarray,
                              darak_ma: np.ndarray,
                              vwap: np.ndarray,
                              imacd_hist: np.ndarray,
                              uprsi_val: np.ndarray,
                              udstoch_val: np.ndarray,
                              ob_support: float | None,
                              ob_resistance: float | None,
                              fib_levels: dict | None,
                              weights: dict | None = None) -> tuple[float, float, list[str]]:
    """9개 지표의 진입 투표 수 반환 (가중치 지원).
    
    weights: {'ultra': 1.0, 'master': 1.0, 'darak': 1.0, 'vwap': 1.0,
              'imacd': 1.0, 'uprsi': 1.0, 'udstoch': 1.0, 'ob': 1.0, 'fib': 1.0}
             None 이면 모두 1.0
             0 으로 설정하면 해당 지표 비활성화
    
    Returns:
        (long_votes, short_votes, reasons)
    """
    w = weights or {}
    def _w(key: str) -> float:
        v = w.get(key, 1.0)
        return float(v) if v is not None else 1.0

    long_votes = 0.0
    short_votes = 0.0
    reasons: list[str] = []
    px = c[idx]

    # 1. BEOM AI 캔들 (ultra_trend 방향)
    if _w("ultra") > 0 and idx < len(ut_dir):
        d = ut_dir[idx]
        if d > 0:
            long_votes += _w("ultra")
            reasons.append("ultra_long")
        elif d < 0:
            short_votes += _w("ultra")
            reasons.append("ultra_short")

    # 2. 종합매매 (master_signal_v2 score)
    if _w("master") > 0 and idx < len(ms_score):
        ms = ms_score[idx]
        if ms > 50:
            long_votes += _w("master")
            reasons.append("master_bull")
        elif ms < -50:
            short_votes += _w("master")
            reasons.append("master_bear")

    # 3. 범온MA (darak_ma): 가격 > MA면 롱 / 아래면 숏
    if _w("darak") > 0 and idx < len(darak_ma) and darak_ma[idx] > 0:
        if px > darak_ma[idx]:
            long_votes += _w("darak")
            reasons.append("darak_above")
        elif px < darak_ma[idx]:
            short_votes += _w("darak")
            reasons.append("darak_below")

    # 4. VWAP: 가격 > VWAP이면 롱
    if _w("vwap") > 0 and idx < len(vwap) and vwap[idx] > 0:
        if px > vwap[idx]:
            long_votes += _w("vwap")
            reasons.append("vwap_above")
        elif px < vwap[idx]:
            short_votes += _w("vwap")
            reasons.append("vwap_below")

    # 5. IMACD: 히스토그램 양수면 롱
    if _w("imacd") > 0 and idx < len(imacd_hist):
        if imacd_hist[idx] > 0 and (idx == 0 or imacd_hist[idx] > imacd_hist[idx-1]):
            long_votes += _w("imacd")
            reasons.append("imacd_bull")
        elif imacd_hist[idx] < 0 and (idx == 0 or imacd_hist[idx] < imacd_hist[idx-1]):
            short_votes += _w("imacd")
            reasons.append("imacd_bear")

    # 6. 강도측정 (uprsi): 50 기준선 상향 교차 = 롱 강도
    if _w("uprsi") > 0 and idx < len(uprsi_val) and uprsi_val[idx] > 0:
        if uprsi_val[idx] > 55:
            long_votes += _w("uprsi")
            reasons.append("uprsi_strong_long")
        elif uprsi_val[idx] < 45:
            short_votes += _w("uprsi")
            reasons.append("uprsi_strong_short")

    # 7. 과열분석 (udstoch): 과매도(<20)에서 반등 = 롱, 과매수(>80) 하락 = 숏
    if _w("udstoch") > 0 and idx < len(udstoch_val) and udstoch_val[idx] > 0:
        if udstoch_val[idx] < 25:
            long_votes += _w("udstoch")
            reasons.append("udstoch_oversold")
        elif udstoch_val[idx] > 75:
            short_votes += _w("udstoch")
            reasons.append("udstoch_overbought")

    # 8. 거래밀집구간 (ob): 지지 근처면 롱, 저항 근처면 숏
    if _w("ob") > 0:
        if ob_support and px <= ob_support * 1.005:
            long_votes += _w("ob")
            reasons.append("ob_support_bounce")
        if ob_resistance and px >= ob_resistance * 0.995:
            short_votes += _w("ob")
            reasons.append("ob_resistance_rejection")

    # 9. 피보나치: 0.618 레벨 근처 반등
    if _w("fib") > 0 and fib_levels:
        f618 = fib_levels.get("0.618")
        if f618 and abs(px - f618) / px < 0.003:
            if px < (fib_levels.get("1.0", px) + fib_levels.get("0.0", px)) / 2:
                long_votes += _w("fib")
                reasons.append("fib_618_long")
            else:
                short_votes += _w("fib")
                reasons.append("fib_618_short")

    return long_votes, short_votes, reasons


def _compute_ai_target(idx: int,
                        c: np.ndarray, h: np.ndarray, l: np.ndarray,
                        direction: str) -> dict | None:
    """AI목표 (bimaco_tp) 알고리즘으로 entry/stop/tp1~3 계산.
    
    charts_indicators.py의 bimaco_tp 로직을 복제.
    """
    n = len(c)
    if idx >= n or idx < 10:
        return None

    # ATR 200
    tr = np.maximum(h[1:]-l[1:], np.maximum(np.abs(h[1:]-c[:-1]), np.abs(l[1:]-c[:-1])))
    if len(tr) < 2:
        return None
    # idx 기준 ATR
    lookback = min(200, idx)
    if lookback < 10:
        return None
    atr_at = float(np.mean(tr[max(0, idx-lookback):idx])) if idx > 0 else 0
    atr_val = atr_at * 0.5

    # SMA high/low length=10
    lh = min(10, idx)
    sma_h = float(np.mean(h[max(0, idx-lh+1):idx+1])) + atr_val
    sma_l = float(np.mean(l[max(0, idx-lh+1):idx+1])) - atr_val

    entry = float(c[idx])

    # 가격대에 따라 반올림 자릿수 자동 조정 (저가 심볼 정밀도 보존)
    # 예: BTC 80000 → 2자리 / ETH 3000 → 2자리 / DOGE 0.1 → 5자리 / PEPE 0.00001 → 8자리
    if entry >= 100:
        prec = 2
    elif entry >= 1:
        prec = 4
    elif entry >= 0.01:
        prec = 5
    elif entry >= 0.0001:
        prec = 7
    else:
        prec = 8

    if direction == "long":
        return {
            "entry": round(entry, prec),
            "stop": round(sma_l, prec),
            "tp1": round(entry + atr_val * 5, prec),
            "tp2": round(entry + atr_val * 10, prec),
            "tp3": round(entry + atr_val * 15, prec),
        }
    else:  # short
        return {
            "entry": round(entry, prec),
            "stop": round(sma_h, prec),
            "tp1": round(entry - atr_val * 5, prec),
            "tp2": round(entry - atr_val * 10, prec),
            "tp3": round(entry - atr_val * 15, prec),
        }


def compute_autobot_signals(candles: list[dict],
                             timeframe: str = "5m",
                             mode: str = "balanced",
                             weights: dict | None = None,
                             threshold: float | None = None) -> dict[str, Any]:
    """자동매매 신호 계산 (Paper Trading 전용).
    
    Args:
        candles: 캔들 리스트 (최소 200개)
        timeframe: '1m'|'5m'|'15m'|'1h'|'4h'|'1d'
        mode: 'conservative' (6표 이상) | 'balanced' (5표 이상) | 'custom'
        weights: 사용자 커스텀 지표 가중치 (mode='custom' 시 사용)
            예: {'ultra': 2.0, 'master': 2.0, 'uprsi': 1.0, 'udstoch': 1.5,
                 'darak': 0, 'vwap': 1.0, 'imacd': 1.0, 'ob': 0, 'fib': 0}
            값 0 은 해당 지표 비활성화
        threshold: 커스텀 진입 임계값 (mode='custom' 시 사용)
    """
    n = len(candles)
    if n < 200:
        return {"actions": [], "summary": {}, "positions_log": []}

    # 모드별 기본값
    if mode == "conservative":
        entry_threshold = 6.0
        active_weights = None  # 전부 1.0
    elif mode == "custom":
        # 사용자 지정
        if weights is None:
            weights = {}
        active_weights = weights
        entry_threshold = float(threshold) if threshold is not None else 5.0
    else:  # balanced
        entry_threshold = 5.0
        active_weights = None

    # 가격 배열
    o = np.array([float(x.get("open") or x.get("o", 0)) for x in candles])
    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h", 0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l", 0)) for x in candles])
    v = np.array([float(x.get("volume") or x.get("v", 0)) for x in candles])
    t = [x.get("time") or x.get("t") or 0 for x in candles]

    # === 지표 계산 ===
    # 1. BEOM AI 캔들 (ultra_trend)
    try:
        from src.services.beom_candle import compute_ultra_trend
        ut = compute_ultra_trend(candles)
        ut_signals = ut.get("s", [])
        ut_dir = np.zeros(n)
        for s in ut_signals:
            si = s.get("index", 0)
            if 0 <= si < n:
                stype = s.get("type", "")
                if stype in ("buy", "ku"):
                    ut_dir[si:] = 1  # 이후 롱 방향
                elif stype in ("sell", "kd"):
                    ut_dir[si:] = -1
    except Exception:
        ut_dir = np.zeros(n)

    # 2. 종합매매 (master_signal_v2)
    try:
        from src.services.master_signal_v2 import compute_master_signal_v2
        tf_map = {'1m':1,'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'2h':120,'4h':240,'1d':1440}
        ms_result = compute_master_signal_v2(candles, tf_minutes=tf_map.get(timeframe, 60))
        # score 는 [{index, value}, ...] 형태 — value 만 추출
        score_items = ms_result.get("score", [])
        if score_items and isinstance(score_items[0], dict):
            ms_score = np.array([s.get("value", 0) for s in score_items])
        else:
            ms_score = np.array(score_items)
        if len(ms_score) < n:
            ms_score = np.pad(ms_score, (n - len(ms_score), 0))
    except Exception:
        ms_score = np.zeros(n)

    # 3. 범온MA (darak_ma)
    try:
        from src.services.beom_ma import compute_darak_ma
        darak_result = compute_darak_ma(candles, mode="balanced")
        # ma 배열은 [None, None, ..., float, ...] 형태 — None 을 0 으로
        raw_ma = darak_result.get("ma", [])
        darak_ma = np.array([0.0 if v is None else float(v) for v in raw_ma])
        if len(darak_ma) < n:
            darak_ma = np.pad(darak_ma, (n - len(darak_ma), 0))
    except Exception:
        darak_ma = np.zeros(n)

    # 4. VWAP (vwap_ma_cluster — vwap 는 numpy array 직접 반환)
    try:
        from src.services.vwap_ma_cluster import compute_vwap_ma_cluster
        vwap_result = compute_vwap_ma_cluster(candles, 122)
        vwap_raw = vwap_result.get("vwap", [])
        # numpy array 이거나 list 일 수 있음 + NaN 대응
        vwap_arr = np.asarray(vwap_raw, dtype=float)
        vwap_arr = np.where(np.isnan(vwap_arr), 0, vwap_arr)
        if len(vwap_arr) < n:
            vwap = np.zeros(n)
            vwap[-len(vwap_arr):] = vwap_arr
        else:
            vwap = vwap_arr[-n:]
    except Exception:
        # fallback: tp * v / v cum
        tp = (h + l + c) / 3
        cum_pv = np.cumsum(tp * v)
        cum_v = np.cumsum(v)
        vwap = np.where(cum_v > 0, cum_pv / cum_v, 0)

    # 5. IMACD (impulse MACD)
    # 간단 버전: EMA12 - EMA26, histogram = macd - signal(9)
    def _ema(x: np.ndarray, period: int) -> np.ndarray:
        out = np.zeros_like(x)
        alpha = 2 / (period + 1)
        out[0] = x[0]
        for i in range(1, len(x)):
            out[i] = alpha * x[i] + (1 - alpha) * out[i-1]
        return out
    ema12 = _ema(c, 12)
    ema26 = _ema(c, 26)
    macd_line = ema12 - ema26
    macd_signal = _ema(macd_line, 9)
    imacd_hist = macd_line - macd_signal

    # 6. 강도측정 (uprsi_stc) — key "a" = uprsi
    us_result = {}
    try:
        from src.services.beom_sub import compute_uprsi_stc
        us_result = compute_uprsi_stc(candles)
        uprsi_raw = us_result.get("a", [])
        uprsi_val = np.array([0.0 if v is None else float(v) for v in uprsi_raw])
        if len(uprsi_val) < n:
            uprsi_val = np.pad(uprsi_val, (n - len(uprsi_val), 0), constant_values=50.0)
    except Exception:
        uprsi_val = np.full(n, 50.0)

    # 7. 과열분석 (udstoch) — key "c" = upstoch
    try:
        udstoch_raw = us_result.get("c", [])
        udstoch_val = np.array([0.0 if v is None else float(v) for v in udstoch_raw])
        if len(udstoch_val) < n:
            udstoch_val = np.pad(udstoch_val, (n - len(udstoch_val), 0), constant_values=50.0)
    except Exception:
        udstoch_val = np.full(n, 50.0)

    # 8/9. 거래밀집구간 / 피보나치는 바별로 계산하지 않고 최신값만 사용
    # (실시간 paper trading이라 최근 100개 캔들 high/low로 간이 계산)
    lookback_pivot = 100
    recent_high = float(np.max(h[-lookback_pivot:]))
    recent_low = float(np.min(l[-lookback_pivot:]))
    fib_range = recent_high - recent_low
    fib_levels = {
        "0.0": recent_low,
        "0.382": recent_low + fib_range * 0.382,
        "0.5": recent_low + fib_range * 0.5,
        "0.618": recent_low + fib_range * 0.618,
        "1.0": recent_high,
    }
    # ob: 최근 저항/지지는 0.618 / 0.382 근사
    ob_support = fib_levels["0.382"]
    ob_resistance = fib_levels["0.618"]

    # === 시뮬레이션 실행 ===
    actions: list[dict] = []
    positions_log: list[dict] = []
    pos: Position | None = None
    # 시뮬 자본 계산용
    initial_capital = 10000.0  # 가상 자본 (USD)
    capital_fraction = 0.10  # 자금의 10%
    leverage = 5
    total_pnl = 0.0
    win_count = 0
    loss_count = 0

    start_idx = max(50, 200)  # 지표 안정화 후

    for i in range(start_idx, n):
        px = c[i]
        high_i = h[i]
        low_i = l[i]

        # === 포지션 없을 때: 진입 판단 ===
        if pos is None:
            long_votes, short_votes, reasons = _compute_indicator_votes(
                i, c, h, l, ut_dir, ms_score, darak_ma, vwap,
                imacd_hist, uprsi_val, udstoch_val,
                ob_support, ob_resistance, fib_levels, active_weights)

            # 충돌(두 방향 동시) → HOLD
            if long_votes >= entry_threshold and short_votes >= entry_threshold:
                continue  # 관망
            if long_votes >= entry_threshold and long_votes > short_votes:
                tgt = _compute_ai_target(i, c, h, l, "long")
                if not tgt:
                    continue
                qty = (initial_capital * capital_fraction * leverage) / px
                pos = Position("long", tgt["entry"], i, tgt["stop"],
                               tgt["tp1"], tgt["tp2"], tgt["tp3"], qty)
                actions.append({
                    "index": i,
                    "time": t[i],
                    "action": Action.ENTER_LONG.value,
                    "dir": "long",
                    "entry": tgt["entry"],
                    "stop": tgt["stop"],
                    "tp1": tgt["tp1"], "tp2": tgt["tp2"], "tp3": tgt["tp3"],
                    "confidence": round(long_votes / max(entry_threshold, 1) * 0.5 + 0.5, 2),
                    "votes": long_votes,
                    "reasons": reasons,
                })
            elif short_votes >= entry_threshold and short_votes > long_votes:
                tgt = _compute_ai_target(i, c, h, l, "short")
                if not tgt:
                    continue
                qty = (initial_capital * capital_fraction * leverage) / px
                pos = Position("short", tgt["entry"], i, tgt["stop"],
                               tgt["tp1"], tgt["tp2"], tgt["tp3"], qty)
                actions.append({
                    "index": i,
                    "time": t[i],
                    "action": Action.ENTER_SHORT.value,
                    "dir": "short",
                    "entry": tgt["entry"],
                    "stop": tgt["stop"],
                    "tp1": tgt["tp1"], "tp2": tgt["tp2"], "tp3": tgt["tp3"],
                    "confidence": round(short_votes / max(entry_threshold, 1) * 0.5 + 0.5, 2),
                    "votes": short_votes,
                    "reasons": reasons,
                })
            continue

        # === 포지션 있을 때: 관리 ===
        if pos.dir == "long":
            # 1순위: 손절 (현재가 <= SL)
            if low_i <= pos.stop_price:
                pnl_pct = (pos.stop_price - pos.entry_price) / pos.entry_price * 100 * leverage
                total_pnl += pnl_pct * capital_fraction
                if pnl_pct > 0:
                    win_count += 1
                else:
                    loss_count += 1
                actions.append({
                    "index": i, "time": t[i],
                    "action": Action.STOP_LOSS.value, "dir": "long",
                    "entry": pos.entry_price, "exit": pos.stop_price,
                    "pnl_pct": round(pnl_pct, 2),
                })
                positions_log.append({
                    "entry_idx": pos.entry_idx, "exit_idx": i,
                    "dir": "long", "entry": pos.entry_price,
                    "exit": pos.stop_price, "pnl_pct": round(pnl_pct, 2),
                    "result": "stop_loss",
                })
                pos = None
                continue

            # 3순위: TP3 (전량 청산)
            if not pos.tp3_done and high_i >= pos.tp3_price and pos.tp2_done:
                pnl_pct = (pos.tp3_price - pos.entry_price) / pos.entry_price * 100 * leverage
                total_pnl += pnl_pct * capital_fraction
                win_count += 1
                actions.append({
                    "index": i, "time": t[i],
                    "action": Action.LONG_TP3.value, "dir": "long",
                    "entry": pos.entry_price, "exit": pos.tp3_price,
                    "pnl_pct": round(pnl_pct, 2),
                })
                positions_log.append({
                    "entry_idx": pos.entry_idx, "exit_idx": i,
                    "dir": "long", "entry": pos.entry_price,
                    "exit": pos.tp3_price, "pnl_pct": round(pnl_pct, 2),
                    "result": "tp3",
                })
                pos = None
                continue

            # 4순위: TP2 (TP1 완료 시에만)
            if pos.tp1_done and not pos.tp2_done and high_i >= pos.tp2_price:
                pos.tp2_done = True
                pos.remaining_qty -= pos.entry_qty / 3
                pos.update_trailing_after_tp()  # SL → TP1
                actions.append({
                    "index": i, "time": t[i],
                    "action": Action.LONG_TP2.value, "dir": "long",
                    "entry": pos.entry_price, "exit": pos.tp2_price,
                    "new_sl": pos.stop_price,
                })
                continue

            # 5순위: TP1
            if not pos.tp1_done and high_i >= pos.tp1_price:
                pos.tp1_done = True
                pos.remaining_qty -= pos.entry_qty / 3
                pos.update_trailing_after_tp()  # SL → 진입가
                actions.append({
                    "index": i, "time": t[i],
                    "action": Action.LONG_TP1.value, "dir": "long",
                    "entry": pos.entry_price, "exit": pos.tp1_price,
                    "new_sl": pos.stop_price,
                })
                continue

        else:  # short
            # 1순위: 손절 (현재가 >= SL)
            if high_i >= pos.stop_price:
                pnl_pct = (pos.entry_price - pos.stop_price) / pos.entry_price * 100 * leverage
                total_pnl += pnl_pct * capital_fraction
                if pnl_pct > 0:
                    win_count += 1
                else:
                    loss_count += 1
                actions.append({
                    "index": i, "time": t[i],
                    "action": Action.STOP_LOSS.value, "dir": "short",
                    "entry": pos.entry_price, "exit": pos.stop_price,
                    "pnl_pct": round(pnl_pct, 2),
                })
                positions_log.append({
                    "entry_idx": pos.entry_idx, "exit_idx": i,
                    "dir": "short", "entry": pos.entry_price,
                    "exit": pos.stop_price, "pnl_pct": round(pnl_pct, 2),
                    "result": "stop_loss",
                })
                pos = None
                continue

            # 3순위: TP3
            if not pos.tp3_done and low_i <= pos.tp3_price and pos.tp2_done:
                pnl_pct = (pos.entry_price - pos.tp3_price) / pos.entry_price * 100 * leverage
                total_pnl += pnl_pct * capital_fraction
                win_count += 1
                actions.append({
                    "index": i, "time": t[i],
                    "action": Action.SHORT_TP3.value, "dir": "short",
                    "entry": pos.entry_price, "exit": pos.tp3_price,
                    "pnl_pct": round(pnl_pct, 2),
                })
                positions_log.append({
                    "entry_idx": pos.entry_idx, "exit_idx": i,
                    "dir": "short", "entry": pos.entry_price,
                    "exit": pos.tp3_price, "pnl_pct": round(pnl_pct, 2),
                    "result": "tp3",
                })
                pos = None
                continue

            # 4순위: TP2
            if pos.tp1_done and not pos.tp2_done and low_i <= pos.tp2_price:
                pos.tp2_done = True
                pos.remaining_qty -= pos.entry_qty / 3
                pos.update_trailing_after_tp()
                actions.append({
                    "index": i, "time": t[i],
                    "action": Action.SHORT_TP2.value, "dir": "short",
                    "entry": pos.entry_price, "exit": pos.tp2_price,
                    "new_sl": pos.stop_price,
                })
                continue

            # 5순위: TP1
            if not pos.tp1_done and low_i <= pos.tp1_price:
                pos.tp1_done = True
                pos.remaining_qty -= pos.entry_qty / 3
                pos.update_trailing_after_tp()
                actions.append({
                    "index": i, "time": t[i],
                    "action": Action.SHORT_TP1.value, "dir": "short",
                    "entry": pos.entry_price, "exit": pos.tp1_price,
                    "new_sl": pos.stop_price,
                })
                continue

    # === 결과 요약 ===
    long_entries = sum(1 for a in actions if a["action"] == Action.ENTER_LONG.value)
    short_entries = sum(1 for a in actions if a["action"] == Action.ENTER_SHORT.value)
    tp_hits = sum(1 for a in actions if "TP" in a["action"])
    stop_losses = sum(1 for a in actions if a["action"] == Action.STOP_LOSS.value)
    total_trades = win_count + loss_count
    win_rate = round(win_count / total_trades * 100, 2) if total_trades > 0 else None

    return {
        "mode": mode,
        "threshold": entry_threshold,
        "actions": actions,
        "summary": {
            "total_signals": len(actions),
            "long_entries": long_entries,
            "short_entries": short_entries,
            "tp_hits": tp_hits,
            "stop_losses": stop_losses,
            "win_count": win_count,
            "loss_count": loss_count,
            "win_rate_pct": win_rate,
            "total_pnl_pct": round(total_pnl, 2),
            "capital_fraction": capital_fraction,
            "leverage": leverage,
        },
        "positions_log": positions_log,
    }


__all__ = ["Action", "Position", "compute_autobot_signals"]
