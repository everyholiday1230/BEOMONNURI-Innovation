"""표준 기술지표 기반 신호 규칙 평가 엔진.

⚠️ 격리 원칙 (절대 규칙):
    - 이 모듈은 범온 고유 지표(beom_candle, qsignal, bimaco, beom_* 등)를
      **절대 import 하거나 참조하지 않는다.**
    - 오직 공개된 표준 기술지표(RSI/MACD/EMA/SMA/Bollinger/Stochastic/Volume)만
      OHLCV 캔들로 직접 계산한다.
    - LLM이 생성한 신호 DSL(JSON)을 화이트리스트로 엄격 검증한 뒤 평가한다.

DSL 스키마:
    {
      "signals": [
        {"indicator":"rsi","period":14,"op":"below","value":30,"action":"buy","label":"..."},
        {"indicator":"ema","period":20,"op":"cross_up",
         "target":{"indicator":"ema","period":50},"action":"buy"},
        {"indicator":"price","op":"above","value":70000,"action":"sell"}
      ]
    }
"""
from __future__ import annotations

import math
import numpy as np

# ── 화이트리스트 (이 밖의 값은 전부 거부) ───────────────────────────
# 우리 "지표탭"의 공개 표준 지표만 포함한다 (범온 고유 지표는 제외).
#   추세: ema, sma, wma, hma, dema, tema  (일목/PSAR/슈퍼트렌드는 밴드/방향형이라 임계·교차 신호에서 제외)
#   모멘텀: rsi, macd, stochastic, cci, roc, willr, stochrsi, mom, tsi, trix, ao
#   변동성: bollinger, keltner, envelope, atr
#   거래량: volume, obv, mfi, cmf
#   가격구조: vwap, price
ALLOWED_INDICATORS = {
    # 추세 (이동평균 계열 — 종가 기준 값 시계열)
    "ema", "sma", "wma", "hma", "dema", "tema",
    # 모멘텀 (오실레이터)
    "rsi", "macd", "stochastic", "cci", "roc", "willr", "stochrsi",
    "mom", "tsi", "trix", "ao",
    # 변동성
    "bollinger", "keltner", "envelope", "atr",
    # 거래량
    "volume", "obv", "mfi", "cmf",
    # 가격구조
    "vwap", "price",
}
ALLOWED_OPS = {"above", "below", "cross_up", "cross_down"}
ALLOWED_ACTIONS = {"buy", "sell", "line", "zone"}

# 안전 한계
MAX_SIGNALS = 10          # 한 번에 허용하는 규칙 수
MIN_PERIOD = 1
MAX_PERIOD = 500
MAX_MARKERS_PER_SIGNAL = 200  # 규칙당 차트에 그릴 최대 마커 수 (과밀/메모리 방지)


class RuleError(ValueError):
    """DSL 검증 실패."""


# ══════════════════════════════════════════════════════════════════
#  캔들 → numpy 배열
# ══════════════════════════════════════════════════════════════════
def _extract_ohlcv(candles: list[dict]) -> dict:
    def col(*keys):
        out = []
        for c in candles:
            v = None
            for k in keys:
                if k in c and c[k] is not None:
                    v = c[k]
                    break
            try:
                out.append(float(v))
            except (TypeError, ValueError):
                out.append(0.0)
        return np.asarray(out, dtype=float)

    return {
        "open": col("open", "o"),
        "high": col("high", "h"),
        "low": col("low", "l"),
        "close": col("close", "c"),
        "volume": col("volume", "v"),
    }


# ══════════════════════════════════════════════════════════════════
#  표준 지표 (공개 정의 — 범온 고유 로직 아님)
# ══════════════════════════════════════════════════════════════════
def _ema(data: np.ndarray, period: int) -> np.ndarray:
    if len(data) == 0:
        return data
    alpha = 2.0 / (period + 1.0)
    out = np.empty_like(data)
    out[0] = data[0]
    for i in range(1, len(data)):
        out[i] = alpha * data[i] + (1 - alpha) * out[i - 1]
    return out


def _sma(data: np.ndarray, period: int) -> np.ndarray:
    n = len(data)
    out = np.full(n, np.nan)
    if n == 0:
        return out
    csum = np.cumsum(data)
    for i in range(n):
        if i + 1 < period:
            out[i] = csum[i] / (i + 1)
        else:
            out[i] = (csum[i] - (csum[i - period] if i - period >= 0 else 0.0)) / period
    return out


def _rsi(close: np.ndarray, period: int = 14) -> np.ndarray:
    n = len(close)
    out = np.full(n, 50.0)
    if n < 2:
        return out
    delta = np.diff(close)
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)
    avg_gain = 0.0
    avg_loss = 0.0
    for i in range(1, n):
        g = gain[i - 1]
        l = loss[i - 1]
        if i <= period:
            avg_gain += g / period
            avg_loss += l / period
        else:
            avg_gain = (avg_gain * (period - 1) + g) / period
            avg_loss = (avg_loss * (period - 1) + l) / period
        if avg_loss == 0:
            out[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            out[i] = 100.0 - (100.0 / (1.0 + rs))
    return out


def _macd(close: np.ndarray, fast: int = 12, slow: int = 26, signal: int = 9):
    macd_line = _ema(close, fast) - _ema(close, slow)
    signal_line = _ema(macd_line, signal)
    return macd_line, signal_line


def _bollinger(close: np.ndarray, period: int = 20, mult: float = 2.0):
    mid = _sma(close, period)
    std = np.full(len(close), np.nan)
    for i in range(len(close)):
        start = max(0, i - period + 1)
        window = close[start:i + 1]
        std[i] = np.std(window) if len(window) > 0 else 0.0
    upper = mid + mult * std
    lower = mid - mult * std
    return upper, mid, lower


def _stochastic(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14):
    n = len(close)
    k = np.full(n, 50.0)
    for i in range(n):
        start = max(0, i - period + 1)
        hh = np.max(high[start:i + 1]) if i >= start else high[i]
        ll = np.min(low[start:i + 1]) if i >= start else low[i]
        if hh - ll > 1e-12:
            k[i] = (close[i] - ll) / (hh - ll) * 100.0
        else:
            k[i] = 50.0
    return k


# ── 추세: 추가 이동평균 계열 (공개 표준) ─────────────────────────────
def _wma(data: np.ndarray, period: int) -> np.ndarray:
    """가중이동평균 (최근값에 선형 가중치)."""
    n = len(data)
    out = np.full(n, np.nan)
    if n == 0:
        return out
    weights = np.arange(1, period + 1, dtype=float)
    wsum = weights.sum()
    for i in range(n):
        if i + 1 < period:
            w = np.arange(1, i + 2, dtype=float)
            out[i] = float(np.dot(data[:i + 1], w) / w.sum())
        else:
            out[i] = float(np.dot(data[i - period + 1:i + 1], weights) / wsum)
    return out


def _hma(data: np.ndarray, period: int) -> np.ndarray:
    """헐 이동평균 (지연 최소화): WMA(2*WMA(n/2) - WMA(n), sqrt(n))."""
    if len(data) == 0 or period < 2:
        return data.astype(float)
    half = max(1, period // 2)
    sqrt_p = max(1, int(round(math.sqrt(period))))
    raw = 2.0 * _wma(data, half) - _wma(data, period)
    raw = np.nan_to_num(raw, nan=0.0)
    return _wma(raw, sqrt_p)


def _dema(data: np.ndarray, period: int) -> np.ndarray:
    """이중지수이동평균: 2*EMA - EMA(EMA)."""
    e1 = _ema(data, period)
    e2 = _ema(e1, period)
    return 2.0 * e1 - e2


def _tema(data: np.ndarray, period: int) -> np.ndarray:
    """삼중지수이동평균: 3*EMA - 3*EMA(EMA) + EMA(EMA(EMA))."""
    e1 = _ema(data, period)
    e2 = _ema(e1, period)
    e3 = _ema(e2, period)
    return 3.0 * e1 - 3.0 * e2 + e3


# ── 모멘텀: 추가 오실레이터 (공개 표준) ──────────────────────────────
def _cci(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 20) -> np.ndarray:
    """상품채널지수 (CCI)."""
    tp = (high + low + close) / 3.0
    n = len(tp)
    out = np.full(n, 0.0)
    sma_tp = _sma(tp, period)
    for i in range(n):
        start = max(0, i - period + 1)
        window = tp[start:i + 1]
        mad = float(np.mean(np.abs(window - sma_tp[i]))) if len(window) else 0.0
        if mad > 1e-12:
            out[i] = (tp[i] - sma_tp[i]) / (0.015 * mad)
        else:
            out[i] = 0.0
    return out


def _roc(close: np.ndarray, period: int = 12) -> np.ndarray:
    """변화율 (Rate of Change, %)."""
    n = len(close)
    out = np.full(n, 0.0)
    for i in range(n):
        if i >= period and close[i - period] != 0:
            out[i] = (close[i] - close[i - period]) / close[i - period] * 100.0
    return out


def _willr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """윌리엄스 %R (-100 ~ 0)."""
    n = len(close)
    out = np.full(n, -50.0)
    for i in range(n):
        start = max(0, i - period + 1)
        hh = np.max(high[start:i + 1])
        ll = np.min(low[start:i + 1])
        if hh - ll > 1e-12:
            out[i] = (hh - close[i]) / (hh - ll) * -100.0
        else:
            out[i] = -50.0
    return out


def _stochrsi(close: np.ndarray, period: int = 14) -> np.ndarray:
    """스토캐스틱 RSI (0 ~ 100)."""
    rsi = _rsi(close, period)
    n = len(rsi)
    out = np.full(n, 50.0)
    for i in range(n):
        start = max(0, i - period + 1)
        window = rsi[start:i + 1]
        lo = float(np.min(window))
        hi = float(np.max(window))
        if hi - lo > 1e-12:
            out[i] = (rsi[i] - lo) / (hi - lo) * 100.0
        else:
            out[i] = 50.0
    return out


def _mom(close: np.ndarray, period: int = 10) -> np.ndarray:
    """모멘텀 (가격 차이)."""
    n = len(close)
    out = np.full(n, 0.0)
    for i in range(n):
        if i >= period:
            out[i] = close[i] - close[i - period]
    return out


def _tsi(close: np.ndarray, long: int = 25, short: int = 13) -> np.ndarray:
    """참strength지수 (TSI, -100 ~ 100)."""
    if len(close) < 2:
        return np.zeros(len(close))
    momentum = np.diff(close, prepend=close[0])
    ema1 = _ema(momentum, long)
    ema2 = _ema(ema1, short)
    abs_ema1 = _ema(np.abs(momentum), long)
    abs_ema2 = _ema(abs_ema1, short)
    out = np.zeros(len(close))
    for i in range(len(close)):
        if abs_ema2[i] > 1e-12:
            out[i] = 100.0 * ema2[i] / abs_ema2[i]
    return out


def _trix(close: np.ndarray, period: int = 15) -> np.ndarray:
    """TRIX (삼중평활 EMA의 변화율, %)."""
    e1 = _ema(close, period)
    e2 = _ema(e1, period)
    e3 = _ema(e2, period)
    n = len(close)
    out = np.full(n, 0.0)
    for i in range(1, n):
        if e3[i - 1] != 0:
            out[i] = (e3[i] - e3[i - 1]) / e3[i - 1] * 100.0
    return out


def _ao(high: np.ndarray, low: np.ndarray) -> np.ndarray:
    """오썸 오실레이터 (AO): SMA5(중간가) - SMA34(중간가)."""
    median = (high + low) / 2.0
    return _sma(median, 5) - _sma(median, 34)


# ── 변동성 (공개 표준) ───────────────────────────────────────────────
def _atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """평균진폭 (ATR)."""
    n = len(close)
    tr = np.zeros(n)
    for i in range(n):
        if i == 0:
            tr[i] = high[i] - low[i]
        else:
            tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))
    return _ema(tr, period)


def _keltner_mid(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 20) -> np.ndarray:
    """켈트너 채널 중심선 (EMA)."""
    return _ema(close, period)


def _envelope_mid(close: np.ndarray, period: int = 20) -> np.ndarray:
    """엔벨로프 중심선 (SMA)."""
    return _sma(close, period)


# ── 거래량 (공개 표준) ───────────────────────────────────────────────
def _obv(close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    """온밸런스볼륨 (OBV)."""
    n = len(close)
    out = np.zeros(n)
    for i in range(1, n):
        if close[i] > close[i - 1]:
            out[i] = out[i - 1] + volume[i]
        elif close[i] < close[i - 1]:
            out[i] = out[i - 1] - volume[i]
        else:
            out[i] = out[i - 1]
    return out


def _mfi(high: np.ndarray, low: np.ndarray, close: np.ndarray, volume: np.ndarray,
         period: int = 14) -> np.ndarray:
    """자금흐름지수 (MFI, 0 ~ 100)."""
    tp = (high + low + close) / 3.0
    mf = tp * volume
    n = len(close)
    out = np.full(n, 50.0)
    for i in range(1, n):
        start = max(1, i - period + 1)
        pos = neg = 0.0
        for j in range(start, i + 1):
            if tp[j] > tp[j - 1]:
                pos += mf[j]
            elif tp[j] < tp[j - 1]:
                neg += mf[j]
        if neg > 1e-12:
            mr = pos / neg
            out[i] = 100.0 - (100.0 / (1.0 + mr))
        elif pos > 0:
            out[i] = 100.0
        else:
            out[i] = 50.0
    return out


def _cmf(high: np.ndarray, low: np.ndarray, close: np.ndarray, volume: np.ndarray,
         period: int = 20) -> np.ndarray:
    """차이킨 자금흐름 (CMF, -1 ~ 1)."""
    n = len(close)
    mfv = np.zeros(n)
    for i in range(n):
        rng = high[i] - low[i]
        if rng > 1e-12:
            mfm = ((close[i] - low[i]) - (high[i] - close[i])) / rng
        else:
            mfm = 0.0
        mfv[i] = mfm * volume[i]
    out = np.full(n, 0.0)
    for i in range(n):
        start = max(0, i - period + 1)
        vsum = float(np.sum(volume[start:i + 1]))
        if vsum > 1e-12:
            out[i] = float(np.sum(mfv[start:i + 1])) / vsum
    return out


# ── 가격구조 (공개 표준) ─────────────────────────────────────────────
def _vwap(high: np.ndarray, low: np.ndarray, close: np.ndarray, volume: np.ndarray) -> np.ndarray:
    """거래량가중평균가 (VWAP, 누적)."""
    tp = (high + low + close) / 3.0
    n = len(close)
    out = np.zeros(n)
    cum_pv = 0.0
    cum_v = 0.0
    for i in range(n):
        cum_pv += tp[i] * volume[i]
        cum_v += volume[i]
        out[i] = cum_pv / cum_v if cum_v > 1e-12 else close[i]
    return out


def _series_for(indicator: str, period: int, ohlcv: dict) -> np.ndarray:
    """지표 이름 → 평가에 쓸 대표 시계열 반환 (표준 지표만)."""
    close = ohlcv["close"]
    high = ohlcv["high"]
    low = ohlcv["low"]
    volume = ohlcv["volume"]
    if indicator == "price":
        return close
    if indicator == "volume":
        return volume
    if indicator == "rsi":
        return _rsi(close, period or 14)
    if indicator == "ema":
        return _ema(close, period or 20)
    if indicator == "sma":
        return _sma(close, period or 20)
    if indicator == "wma":
        return _wma(close, period or 20)
    if indicator == "hma":
        return _hma(close, period or 20)
    if indicator == "dema":
        return _dema(close, period or 20)
    if indicator == "tema":
        return _tema(close, period or 20)
    if indicator == "macd":
        macd_line, _sig = _macd(close)
        return macd_line
    if indicator == "bollinger":
        _u, mid, _l = _bollinger(close, period or 20)
        return mid
    if indicator == "stochastic":
        return _stochastic(high, low, close, period or 14)
    if indicator == "cci":
        return _cci(high, low, close, period or 20)
    if indicator == "roc":
        return _roc(close, period or 12)
    if indicator == "willr":
        return _willr(high, low, close, period or 14)
    if indicator == "stochrsi":
        return _stochrsi(close, period or 14)
    if indicator == "mom":
        return _mom(close, period or 10)
    if indicator == "tsi":
        return _tsi(close)
    if indicator == "trix":
        return _trix(close, period or 15)
    if indicator == "ao":
        return _ao(high, low)
    if indicator == "atr":
        return _atr(high, low, close, period or 14)
    if indicator == "keltner":
        return _keltner_mid(high, low, close, period or 20)
    if indicator == "envelope":
        return _envelope_mid(close, period or 20)
    if indicator == "obv":
        return _obv(close, volume)
    if indicator == "mfi":
        return _mfi(high, low, close, volume, period or 14)
    if indicator == "cmf":
        return _cmf(high, low, close, volume, period or 20)
    if indicator == "vwap":
        return _vwap(high, low, close, volume)
    # 도달 불가 (검증에서 이미 걸러짐)
    raise RuleError(f"unsupported indicator: {indicator}")


# ══════════════════════════════════════════════════════════════════
#  DSL 검증 (화이트리스트 엄격 적용)
# ══════════════════════════════════════════════════════════════════
def validate_dsl(dsl: dict) -> list[dict]:
    """LLM이 생성한 DSL을 검증하고 정규화된 signal 리스트 반환.

    검증 실패한 개별 규칙은 조용히 제외한다. 전체가 부적합하면 RuleError.
    """
    if not isinstance(dsl, dict):
        raise RuleError("DSL must be an object")
    signals = dsl.get("signals")
    if not isinstance(signals, list) or not signals:
        raise RuleError("DSL.signals must be a non-empty list")

    clean: list[dict] = []
    for raw in signals[:MAX_SIGNALS]:
        if not isinstance(raw, dict):
            continue
        indicator = str(raw.get("indicator", "")).lower().strip()
        op = str(raw.get("op", "")).lower().strip()
        action = str(raw.get("action", "")).lower().strip()
        if indicator not in ALLOWED_INDICATORS:
            continue
        if op not in ALLOWED_OPS:
            continue
        if action not in ALLOWED_ACTIONS:
            continue

        period = raw.get("period", 14)
        try:
            period = int(period)
        except (TypeError, ValueError):
            period = 14
        period = max(MIN_PERIOD, min(MAX_PERIOD, period))

        sig = {"indicator": indicator, "op": op, "action": action, "period": period}

        label = raw.get("label")
        if isinstance(label, str) and label.strip():
            sig["label"] = label.strip()[:60]

        # cross_up/cross_down은 target 지표 필요, above/below는 value 필요
        if op in ("cross_up", "cross_down"):
            target = raw.get("target")
            if not isinstance(target, dict):
                continue
            t_ind = str(target.get("indicator", "")).lower().strip()
            if t_ind not in ALLOWED_INDICATORS:
                continue
            try:
                t_period = int(target.get("period", 50))
            except (TypeError, ValueError):
                t_period = 50
            t_period = max(MIN_PERIOD, min(MAX_PERIOD, t_period))
            sig["target"] = {"indicator": t_ind, "period": t_period}
        else:  # above / below
            value = raw.get("value")
            try:
                sig["value"] = float(value)
            except (TypeError, ValueError):
                continue

        clean.append(sig)

    if not clean:
        raise RuleError("no valid signal rules after validation")
    return clean


# ══════════════════════════════════════════════════════════════════
#  규칙 평가 → 차트 드로잉 좌표 산출
# ══════════════════════════════════════════════════════════════════
def _crossovers(a: np.ndarray, b: np.ndarray, up: bool) -> list[int]:
    """a가 b를 상향(up=True)/하향 돌파하는 봉 index 리스트."""
    idxs = []
    n = min(len(a), len(b))
    for i in range(1, n):
        if any(math.isnan(x) for x in (a[i], b[i], a[i - 1], b[i - 1])):
            continue
        if up:
            if a[i - 1] <= b[i - 1] and a[i] > b[i]:
                idxs.append(i)
        else:
            if a[i - 1] >= b[i - 1] and a[i] < b[i]:
                idxs.append(i)
    return idxs


def _threshold_events(series: np.ndarray, op: str, value: float) -> list[int]:
    """series가 value를 상향/하향 교차하는 봉 index (연속 구간은 진입점만)."""
    idxs = []
    n = len(series)
    for i in range(1, n):
        prev, cur = series[i - 1], series[i]
        if math.isnan(prev) or math.isnan(cur):
            continue
        if op == "above" and prev <= value < cur:
            idxs.append(i)
        elif op == "below" and prev >= value > cur:
            idxs.append(i)
    return idxs


def _candle_time(candle: dict) -> int | None:
    """캔들의 시작 시각(ms) 추출. 프론트가 index 대신 시간으로 정렬하기 위함."""
    for k in ("openTime", "time", "t", "opentime", "ts"):
        v = candle.get(k)
        if v is not None:
            try:
                return int(float(v))
            except (TypeError, ValueError):
                continue
    return None


def evaluate(candles: list[dict], signals: list[dict]) -> list[dict]:
    """검증된 signal 규칙들을 캔들에 적용해 차트 드로잉 객체 리스트를 만든다.

    반환: overlay-engine.addDrawing()이 이해하는 객체 리스트.
      - action buy/sell → {"type":"signal","index":i,"time":ms,"price":p,"signalType":"ku|kd",...}
      - action line     → {"type":"hline","price":value,...}
      - action zone     → {"type":"box",...} (단순 영역)

    각 마커에는 index 뿐 아니라 "time"(캔들 시작 ms)을 함께 담는다.
    프론트 차트 버퍼 길이가 서버 조회 길이와 달라도 time으로 정확히 정렬할 수 있다.
    """
    if not candles:
        return []
    ohlcv = _extract_ohlcv(candles)
    close = ohlcv["close"]
    n = len(close)
    drawings: list[dict] = []

    for sig in signals:
        indicator = sig["indicator"]
        op = sig["op"]
        action = sig["action"]
        period = sig["period"]
        label = sig.get("label", "")

        # 이벤트 봉 index 계산
        event_idxs: list[int] = []
        if op in ("cross_up", "cross_down"):
            series_a = _series_for(indicator, period, ohlcv)
            tgt = sig["target"]
            series_b = _series_for(tgt["indicator"], tgt["period"], ohlcv)
            event_idxs = _crossovers(series_a, series_b, up=(op == "cross_up"))
        else:
            series = _series_for(indicator, period, ohlcv)
            value = sig["value"]
            # line 액션은 수평선 하나만 그림 (이벤트 무관)
            if action == "line":
                drawings.append({
                    "type": "hline",
                    "price": value,
                    "color": "#D8B66A",
                    "label": label or f"{indicator} {value}",
                    "_llm": True,
                })
                continue
            event_idxs = _threshold_events(series, op, value)

        # 마커/영역 생성
        event_idxs = event_idxs[-MAX_MARKERS_PER_SIGNAL:]
        for i in event_idxs:
            if i < 0 or i >= n:
                continue
            price = float(close[i])
            t = _candle_time(candles[i]) if i < len(candles) else None
            if action == "buy":
                drawings.append({
                    "type": "signal", "index": i, "time": t, "price": price,
                    "signalType": "ku", "color": "#C4384B",
                    "label": label or "매수", "_llm": True,
                })
            elif action == "sell":
                drawings.append({
                    "type": "signal", "index": i, "time": t, "price": price,
                    "signalType": "kd", "color": "#3B82F6",
                    "label": label or "매도", "_llm": True,
                })
            elif action == "zone":
                # 단순 영역: 이벤트 봉 기준 ±0.5% 박스
                end_i = min(i + 10, n - 1)
                drawings.append({
                    "type": "box", "index": i, "time": t, "price": price,
                    "price2": price * 0.995, "endIndex": end_i,
                    "endTime": _candle_time(candles[end_i]) if end_i < len(candles) else None,
                    "color": "rgba(216,182,106,0.2)",
                    "label": label or "관심 구간", "_llm": True,
                })

    return drawings


def summarize(signals: list[dict], drawings: list[dict]) -> str:
    """평가 결과를 사람이 읽을 한 줄 요약으로."""
    n_rules = len(signals)
    n_marks = sum(1 for d in drawings if d.get("type") == "signal")
    n_lines = sum(1 for d in drawings if d.get("type") == "hline")
    n_zones = sum(1 for d in drawings if d.get("type") == "box")
    parts = [f"규칙 {n_rules}개 적용"]
    if n_marks:
        parts.append(f"신호 마커 {n_marks}개")
    if n_lines:
        parts.append(f"기준선 {n_lines}개")
    if n_zones:
        parts.append(f"관심구간 {n_zones}개")
    return " · ".join(parts)
