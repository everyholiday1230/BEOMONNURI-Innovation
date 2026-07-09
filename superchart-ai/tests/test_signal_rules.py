"""signal_rules 엔진 테스트 — DSL 검증/평가 + 범온지표 격리 확인."""
import math

from src.services import signal_rules as sr


def _candles(n=120):
    out = []
    price = 100.0
    for i in range(n):
        price += math.sin(i / 8) * 2 + (0.3 if i < n // 2 else -0.3)
        out.append({"open": price, "high": price + 1, "low": price - 1,
                    "close": price, "volume": 1000 + i})
    return out


def test_validate_accepts_standard_indicators():
    dsl = {"signals": [
        {"indicator": "rsi", "period": 14, "op": "below", "value": 30, "action": "buy"},
        {"indicator": "ema", "period": 20, "op": "cross_up",
         "target": {"indicator": "ema", "period": 50}, "action": "buy"},
    ]}
    sigs = sr.validate_dsl(dsl)
    assert len(sigs) == 2
    assert sigs[0]["indicator"] == "rsi"


def test_validate_rejects_non_whitelisted_indicator():
    # 범온 고유 지표명이 들어와도 화이트리스트 밖이면 제거되어야 한다.
    dsl = {"signals": [
        {"indicator": "beom_candle", "op": "below", "value": 30, "action": "buy"},
        {"indicator": "qsignal", "op": "above", "value": 1, "action": "sell"},
        {"indicator": "rsi", "period": 14, "op": "below", "value": 30, "action": "buy"},
    ]}
    sigs = sr.validate_dsl(dsl)
    assert len(sigs) == 1
    assert sigs[0]["indicator"] == "rsi"


def test_validate_raises_when_all_invalid():
    try:
        sr.validate_dsl({"signals": [{"indicator": "beom_candle", "op": "x", "action": "y"}]})
        assert False, "should raise"
    except sr.RuleError:
        pass


def test_evaluate_produces_drawings():
    candles = _candles()
    sigs = sr.validate_dsl({"signals": [
        {"indicator": "rsi", "period": 14, "op": "below", "value": 40, "action": "buy"},
        {"indicator": "price", "op": "above", "value": 105, "action": "line", "label": "저항"},
    ]})
    drawings = sr.evaluate(candles, sigs)
    assert isinstance(drawings, list)
    # 모든 드로잉은 _llm 플래그를 가져야 하고, 허용 타입만
    for d in drawings:
        assert d.get("_llm") is True
        assert d["type"] in ("signal", "hline", "box")


def test_isolation_no_beomonnuri_import():
    # signal_rules 소스에 범온 지표 모듈 import 가 없어야 한다.
    import inspect
    src = inspect.getsource(sr)
    for banned in ("import beom", "beom_candle", "qsignal", "bimaco", "trade_zone", "ma_align"):
        # 주석/문서화 문자열 언급은 허용하되, 실제 import 구문은 없어야 함
        assert f"from src.services.{banned}" not in src
        assert f"import {banned}" not in src


# ── AND 다중조건 그룹 (버튼식 빌더) ──
def test_validate_conditions():
    conds = sr.validate_conditions([
        {"indicator": "rsi", "period": 14, "op": "below", "value": 30},
        {"indicator": "price", "op": "cross_up", "target": {"indicator": "ema", "period": 20}},
    ])
    assert len(conds) == 2
    # action 은 조건에서 제거되어야 한다 (그룹 단위 지정)
    assert all("action" not in c for c in conds)


def test_evaluate_group_single_matches_evaluate():
    candles = _candles(150)
    conds = sr.validate_conditions([{"indicator": "rsi", "period": 14, "op": "below", "value": 45}])
    drawings = sr.evaluate_group(candles, conds, "buy", "테스트")
    assert isinstance(drawings, list)
    for d in drawings:
        assert d["type"] == "signal"
        assert d["signalType"] == "ku"
        assert "time" in d
        assert d["_llm"] is True


def test_evaluate_group_and_is_subset():
    # AND 결합 결과는 각 단일 조건보다 신호가 많을 수 없다 (더 엄격).
    candles = _candles(200)
    c1 = sr.validate_conditions([{"indicator": "rsi", "period": 14, "op": "below", "value": 55}])
    c2 = sr.validate_conditions([{"indicator": "rsi", "period": 14, "op": "below", "value": 55},
                                 {"indicator": "price", "op": "above", "value": 0}])
    d1 = sr.evaluate_group(candles, c1, "buy")
    d2 = sr.evaluate_group(candles, c2, "buy")
    # price>0 은 항상 참이므로 두 결과 개수가 같아야 한다
    assert len(d1) == len(d2)


def test_evaluate_group_rejects_beomonnuri():
    # 범온 지표는 validate_conditions 에서 제거된다.
    try:
        sr.validate_conditions([{"indicator": "beom_candle", "op": "above", "value": 1}])
        assert False, "should raise (no valid conditions)"
    except sr.RuleError:
        pass

