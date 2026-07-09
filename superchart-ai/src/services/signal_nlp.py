"""자연어 → 신호 DSL 규칙 기반 파서 (LLM 불필요·무료·즉시).

목적:
    사용자의 한국어/영어 문장을 표준 지표 신호 DSL(JSON)로 변환한다.
    Ollama/외부 LLM 없이 정규식 + 키워드 매칭만으로 동작하므로
    비용 0원, 응답 즉시, 외부 데이터 유출 없음.

지원 예시:
    - "RSI가 30 아래로 내려가면 매수 표시해줘"
    - "20일선이 50일선을 위로 뚫으면 매수"
    - "가격이 70000 위로 가면 매도 표시"
    - "MACD가 0 아래로 가면 매도"
    - "볼린저 상단 위로 가면 매도, 하단 아래로 가면 매수"

⚠️ 격리 원칙:
    - 이 모듈은 범온 고유 지표(beom_candle, qsignal, bimaco 등)를 인식하지 않는다.
    - 오직 공개 표준 지표(rsi/macd/ema/sma/bollinger/stochastic/volume/price)만
      DSL로 만든다. 최종 결과는 signal_rules.validate_dsl 로 다시 검증된다.

출력 DSL 스키마는 signal_rules.py 와 동일:
    {"signals": [
        {"indicator":"rsi","period":14,"op":"below","value":30,"action":"buy","label":"..."},
        {"indicator":"ema","period":20,"op":"cross_up",
         "target":{"indicator":"ema","period":50},"action":"buy","label":"..."},
        {"indicator":"price","op":"above","value":70000,"action":"sell","label":"..."}
    ]}
"""
from __future__ import annotations

import re

# ── 지표 키워드 → 표준 지표명 ────────────────────────────────────────
# 우리 "지표탭"에 있는 공개 표준 지표만 매핑한다 (범온 고유 지표 제외).
# 긴 키워드를 먼저 매칭하기 위해 사용 시점에 길이 내림차순으로 처리.
_INDICATOR_KEYWORDS: list[tuple[str, str]] = [
    # ── 모멘텀 ──
    ("stochrsi", "stochrsi"), ("stoch rsi", "stochrsi"),
    ("스토캐스틱rsi", "stochrsi"), ("스토캐스틱 rsi", "stochrsi"),
    ("스토rsi", "stochrsi"),
    ("rsi", "rsi"), ("relative strength", "rsi"), ("상대강도", "rsi"),
    ("macd", "macd"), ("맥디", "macd"),
    ("stochastic", "stochastic"), ("스토캐스틱", "stochastic"),
    ("스토케스틱", "stochastic"), ("스토", "stochastic"),
    ("cci", "cci"),
    ("roc", "roc"), ("변화율", "roc"), ("rate of change", "roc"),
    ("williams", "willr"), ("willr", "willr"), ("윌리엄스", "willr"), ("%r", "willr"),
    ("모멘텀", "mom"), ("momentum", "mom"), ("mom", "mom"),
    ("tsi", "tsi"),
    ("trix", "trix"),
    ("ao", "ao"), ("오썸", "ao"), ("awesome", "ao"),
    # ── 변동성 ──
    ("bollinger", "bollinger"), ("볼린저밴드", "bollinger"), ("볼린저 밴드", "bollinger"),
    ("볼린저", "bollinger"), ("볼밴", "bollinger"), ("bb", "bollinger"),
    ("keltner", "keltner"), ("켈트너", "keltner"),
    ("envelope", "envelope"), ("엔벨로프", "envelope"), ("엔빌로프", "envelope"),
    ("atr", "atr"), ("평균진폭", "atr"), ("변동폭", "atr"),
    # ── 거래량 ──
    ("obv", "obv"),
    ("mfi", "mfi"), ("자금흐름지수", "mfi"),
    ("cmf", "cmf"), ("차이킨", "cmf"),
    ("volume", "volume"), ("거래량", "volume"),
    # ── 가격구조 ──
    ("vwap", "vwap"), ("거래량가중", "vwap"),
    # ── 추세 (이동평균 계열) ──
    ("지수이동평균", "ema"), ("지수 이동평균", "ema"), ("ema", "ema"),
    ("단순이동평균", "sma"), ("단순 이동평균", "sma"), ("sma", "sma"),
    ("가중이동평균", "wma"), ("wma", "wma"),
    ("hull", "hma"), ("hma", "hma"), ("헐이동평균", "hma"), ("헐 이동평균", "hma"),
    ("dema", "dema"), ("이중지수", "dema"),
    ("tema", "tema"), ("삼중지수", "tema"),
    ("이동평균선", "ma"), ("이동평균", "ma"), ("이평선", "ma"), ("이평", "ma"),
    ("moving average", "ma"), ("ma", "ma"), ("일선", "ma"), ("일 이평", "ma"),
    # ── 가격 ──
    ("종가", "price"), ("가격", "price"), ("현재가", "price"),
    ("price", "price"), ("close", "price"), ("시세", "price"),
]

# ── 조건(op) 키워드 ──────────────────────────────────────────────────
# 돌파(교차) 표현
_CROSS_UP_WORDS = ["위로 뚫", "위로 돌파", "상향 돌파", "상향돌파", "골든크로스", "golden cross",
                   "cross up", "crosses above", "위로 교차", "상향 교차"]
_CROSS_DOWN_WORDS = ["아래로 뚫", "아래로 돌파", "하향 돌파", "하향돌파", "데드크로스", "dead cross",
                     "cross down", "crosses below", "아래로 교차", "하향 교차"]
# 단순 임계 비교
_ABOVE_WORDS = ["위로", "이상", "넘으면", "넘어가면", "초과", "올라가면", "상승하면",
                "above", "over", "greater", "높아지면", "위에"]
_BELOW_WORDS = ["아래로", "이하", "밑으로", "미만", "떨어지면", "하락하면", "내려가면",
                "below", "under", "less", "낮아지면", "아래에", "밑에"]

# ── 액션(action) 키워드 ──────────────────────────────────────────────
_BUY_WORDS = ["매수", "buy", "long", "롱", "사자", "매입", "진입"]
_SELL_WORDS = ["매도", "sell", "short", "숏", "팔자", "청산", "매각"]
_LINE_WORDS = ["기준선", "선 그어", "선그어", "수평선", "라인", "line", "선 표시"]
_ZONE_WORDS = ["구간", "영역", "존", "zone", "박스"]

# 기본 기간
_DEFAULT_PERIOD = {"rsi": 14, "ema": 20, "sma": 20, "wma": 20, "hma": 20,
                   "dema": 20, "tema": 20, "ma": 20,
                   "bollinger": 20, "keltner": 20, "envelope": 20, "atr": 14,
                   "stochastic": 14, "stochrsi": 14, "macd": 12, "cci": 20,
                   "roc": 12, "willr": 14, "mom": 10, "tsi": 25, "trix": 15,
                   "ao": 5, "obv": 1, "mfi": 14, "cmf": 20, "vwap": 1}

# 문장 분리 구분자 (여러 규칙을 한 문장에 담은 경우)
_SPLIT_RE = re.compile(r"[,，.、]|그리고|또한|또는|하고|이고|,")

# 숫자 추출 (콤마 포함 정수/소수, 예: 70,000 / 30 / 1.5)
_NUM_RE = re.compile(r"(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)")


def _to_number(s: str) -> float:
    return float(s.replace(",", ""))


def _find_indicator(text: str) -> tuple[str, int | None]:
    """문장에서 지표와 (있으면) 기간을 찾는다.

    반환: (표준지표명 | "", 기간 | None)
      - "20일선", "20 이평" → ("ma", 20)  (이후 ema/sma 미지정 시 sma로 확정)
    """
    lower = text.lower()

    # "N일선 / N일 이평 / N ema" 형태의 이동평균 기간 우선 추출
    ma_period = None
    m = re.search(r"(\d+)\s*(?:일선|일\s*이평|일\s*이동평균|일선을|일)\b", text)
    if m:
        ma_period = int(m.group(1))
    else:
        m2 = re.search(r"(\d+)\s*(?:ema|sma|ma)\b", lower)
        if m2:
            ma_period = int(m2.group(1))

    # 길이 내림차순으로 키워드 매칭 (긴 표현 우선)
    best = ""
    best_pos = len(text) + 1
    for kw, ind in sorted(_INDICATOR_KEYWORDS, key=lambda x: -len(x[0])):
        pos = lower.find(kw)
        if pos != -1 and pos < best_pos:
            best = ind
            best_pos = pos

    if not best:
        return "", None

    # 이동평균 계열 확정: ema/sma 명시 없으면 sma 로 처리
    if best == "ma":
        if "ema" in lower or "지수" in text:
            best = "ema"
        else:
            best = "sma"

    period = ma_period
    if period is None:
        period = _DEFAULT_PERIOD.get(best)
    return best, period


def _find_action(text: str) -> str:
    lower = text.lower()
    # line / zone 을 먼저 (buy/sell 과 함께 나오면 매매 우선)
    has_buy = any(w in lower for w in _BUY_WORDS)
    has_sell = any(w in lower for w in _SELL_WORDS)
    if has_buy and not has_sell:
        return "buy"
    if has_sell and not has_buy:
        return "sell"
    if has_buy and has_sell:
        # 한 조각에 둘 다 있으면 앞에 나온 것 우선
        b = min((lower.find(w) for w in _BUY_WORDS if w in lower), default=10**9)
        s = min((lower.find(w) for w in _SELL_WORDS if w in lower), default=10**9)
        return "buy" if b <= s else "sell"
    if any(w in lower for w in _LINE_WORDS):
        return "line"
    if any(w in lower for w in _ZONE_WORDS):
        return "zone"
    return ""


def _find_op(text: str) -> str:
    lower = text.lower()
    # 교차 표현 우선 (임계 표현보다 구체적)
    if any(w in lower for w in _CROSS_UP_WORDS):
        return "cross_up"
    if any(w in lower for w in _CROSS_DOWN_WORDS):
        return "cross_down"
    if any(w in lower for w in _BELOW_WORDS):
        return "below"
    if any(w in lower for w in _ABOVE_WORDS):
        return "above"
    return ""


def _find_indicators_ordered(text: str) -> list[str]:
    """문장에 등장하는 표준 지표를 등장 순서대로 최대 2개 반환.

    "가격이 VWAP 위로" 같은 지표-대-지표 비교를 감지하기 위한 헬퍼.
    같은 지표가 중복되면 하나로 취급한다.
    """
    lower = text.lower()
    hits: list[tuple[int, str]] = []
    for kw, ind in sorted(_INDICATOR_KEYWORDS, key=lambda x: -len(x[0])):
        pos = lower.find(kw)
        if pos != -1:
            # ma 계열은 여기선 확정하지 않음(개별 파서가 처리) → sma로 대표
            resolved = ind
            if resolved == "ma":
                resolved = "ema" if ("ema" in lower or "지수" in text) else "sma"
            hits.append((pos, resolved))
    hits.sort(key=lambda x: x[0])
    ordered: list[str] = []
    for _pos, ind in hits:
        if ind not in ordered:
            ordered.append(ind)
        if len(ordered) >= 2:
            break
    return ordered


def _parse_clause(clause: str) -> dict | None:
    """문장 한 조각 → 신호 규칙 1개 (실패 시 None)."""
    clause = clause.strip()
    if not clause:
        return None

    op = _find_op(clause)
    if not op:
        return None

    action = _find_action(clause)
    if not action:
        # 조건은 있으나 매매 방향이 없으면, 임계 비교는 기본 라인으로 표시
        action = "line" if op in ("above", "below") else "buy"

    if op in ("cross_up", "cross_down"):
        # 두 지표(교차): "20일선이 50일선을 뚫으면" → 앞뒤로 지표 2개
        # 숫자 2개(기간)를 이동평균으로 해석
        periods = [int(_to_number(x)) for x in _NUM_RE.findall(clause)]
        base_ind, base_period = _find_indicator(clause)
        if not base_ind:
            base_ind = "sma"
        # 이동평균 교차가 가장 흔함 → 두 기간이 있으면 sma/sma
        if len(periods) >= 2 and base_ind in ("sma", "ema", "ma"):
            a_ind = "ema" if ("ema" in clause.lower() or "지수" in clause) else "sma"
            sig = {
                "indicator": a_ind, "period": periods[0], "op": op,
                "target": {"indicator": a_ind, "period": periods[1]},
                "action": action,
                "label": f"{periods[0]}·{periods[1]} {'골든' if op == 'cross_up' else '데드'}크로스",
            }
            return sig
        # 지표 하나 + 기준선 교차 (예: MACD가 0을 상향 돌파)
        nums = [x for x in periods]
        target_val = None
        if nums:
            target_val = float(nums[-1])
        if base_ind and target_val is not None:
            # 교차인데 대상이 숫자면 above/below 로 변환
            new_op = "above" if op == "cross_up" else "below"
            return {
                "indicator": base_ind, "period": base_period or _DEFAULT_PERIOD.get(base_ind, 14),
                "op": new_op, "value": target_val, "action": action,
                "label": _default_label(base_ind, new_op, target_val, action),
            }
        return None

    # above / below : 지표 + 값(숫자) 또는 지표 + 지표(교차)
    ind, period = _find_indicator(clause)
    if not ind:
        return None
    nums = _NUM_RE.findall(clause)

    if not nums:
        # 숫자가 없으면 "지표 A가 지표 B 위/아래" (지표간 교차) 시도
        # 예: "가격이 VWAP 위로 가면 매수", "EMA가 VWAP 아래로 가면 매도"
        inds = _find_indicators_ordered(clause)
        if len(inds) >= 2:
            a_ind, b_ind = inds[0], inds[1]
            cross_op = "cross_up" if op == "above" else "cross_down"
            return {
                "indicator": a_ind, "period": _DEFAULT_PERIOD.get(a_ind, 14),
                "op": cross_op,
                "target": {"indicator": b_ind, "period": _DEFAULT_PERIOD.get(b_ind, 14)},
                "action": action,
                "label": f"{_IND_KO.get(a_ind, a_ind)} {_IND_KO.get(b_ind, b_ind)} "
                         f"{'상향' if cross_op == 'cross_up' else '하향'}돌파 {_ACT_KO.get(action, action)}"[:60],
            }
        return None

    # 이동평균 기간으로 이미 소비된 숫자를 값에서 제외하기 위해,
    # 마지막 숫자를 임계값으로 사용(대개 "RSI가 30 아래" → 30이 마지막).
    value = _to_number(nums[-1])
    # 지표 기간과 임계값이 같은 숫자를 가리키는 경우(예: "20일선이 70000 위로")
    # period 는 _find_indicator 가 별도로 뽑았으므로 그대로 둔다.
    return {
        "indicator": ind, "period": period or _DEFAULT_PERIOD.get(ind, 14),
        "op": op, "value": value, "action": action,
        "label": _default_label(ind, op, value, action),
    }


_IND_KO = {"rsi": "RSI", "macd": "MACD", "ema": "지수이평", "sma": "이평",
           "wma": "가중이평", "hma": "헐이평", "dema": "DEMA", "tema": "TEMA",
           "bollinger": "볼린저", "keltner": "켈트너", "envelope": "엔벨로프",
           "atr": "ATR", "stochastic": "스토캐스틱", "stochrsi": "스토캐스틱RSI",
           "cci": "CCI", "roc": "변화율", "willr": "윌리엄스", "mom": "모멘텀",
           "tsi": "TSI", "trix": "TRIX", "ao": "AO",
           "volume": "거래량", "obv": "OBV", "mfi": "MFI", "cmf": "CMF",
           "vwap": "VWAP", "price": "가격"}
_OP_KO = {"above": "위로", "below": "아래로", "cross_up": "상향돌파", "cross_down": "하향돌파"}
_ACT_KO = {"buy": "매수", "sell": "매도", "line": "기준선", "zone": "관심구간"}


def _default_label(ind: str, op: str, value: float, action: str) -> str:
    v = f"{value:,.0f}" if value == int(value) else f"{value:,.2f}"
    return f"{_IND_KO.get(ind, ind)} {v} {_OP_KO.get(op, op)} {_ACT_KO.get(action, action)}"[:60]


def parse(text: str) -> dict:
    """자연어 문장 → 신호 DSL dict.

    반환: {"signals": [...]}  (규칙이 하나도 안 나오면 signals 빈 리스트)
    최종 검증은 호출 측에서 signal_rules.validate_dsl 로 수행한다.
    """
    if not text or not text.strip():
        return {"signals": []}

    # 여러 조건을 한 문장에 담은 경우 분리
    clauses = [c for c in _SPLIT_RE.split(text) if c and c.strip()]
    if not clauses:
        clauses = [text]

    signals: list[dict] = []
    for clause in clauses:
        sig = _parse_clause(clause)
        if sig:
            signals.append(sig)
        if len(signals) >= 10:
            break

    # 아무 조각도 성공 못 했으면 전체 문장으로 1회 더 시도
    if not signals:
        sig = _parse_clause(text)
        if sig:
            signals.append(sig)

    return {"signals": signals}
