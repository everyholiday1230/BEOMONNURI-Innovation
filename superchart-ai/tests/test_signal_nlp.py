"""signal_nlp 규칙 파서 테스트 — 자연어 → DSL, 그리고 signal_rules 검증 통과."""
from src.services import signal_nlp as nlp
from src.services import signal_rules as sr


def _first(dsl):
    assert dsl["signals"], f"expected at least one signal, got {dsl}"
    return dsl["signals"][0]


def test_rsi_below_buy():
    dsl = nlp.parse("RSI가 30 아래로 내려가면 매수 표시해줘")
    sig = _first(dsl)
    assert sig["indicator"] == "rsi"
    assert sig["op"] == "below"
    assert sig["value"] == 30
    assert sig["action"] == "buy"
    # signal_rules 검증도 통과해야 한다
    assert sr.validate_dsl(dsl)


def test_ma_golden_cross():
    dsl = nlp.parse("20일선이 50일선을 위로 뚫으면 매수")
    sig = _first(dsl)
    assert sig["indicator"] in ("sma", "ema")
    assert sig["op"] == "cross_up"
    assert sig["period"] == 20
    assert sig["target"]["period"] == 50
    assert sig["action"] == "buy"
    assert sr.validate_dsl(dsl)


def test_price_above_sell():
    dsl = nlp.parse("가격이 70000 위로 가면 매도 표시")
    sig = _first(dsl)
    assert sig["indicator"] == "price"
    assert sig["op"] == "above"
    assert sig["value"] == 70000
    assert sig["action"] == "sell"
    assert sr.validate_dsl(dsl)


def test_price_with_comma():
    dsl = nlp.parse("가격이 70,000 위로 가면 매도")
    sig = _first(dsl)
    assert sig["value"] == 70000


def test_macd_below_sell():
    dsl = nlp.parse("MACD가 0 아래로 가면 매도")
    sig = _first(dsl)
    assert sig["indicator"] == "macd"
    assert sig["op"] == "below"
    assert sig["action"] == "sell"


def test_multiple_clauses():
    dsl = nlp.parse("RSI 30 이하 매수, RSI 70 이상 매도")
    assert len(dsl["signals"]) == 2
    assert dsl["signals"][0]["action"] == "buy"
    assert dsl["signals"][1]["action"] == "sell"


def test_greeting_yields_no_signal():
    dsl = nlp.parse("안녕?")
    assert dsl["signals"] == []


def test_empty_input():
    assert nlp.parse("")["signals"] == []
    assert nlp.parse("   ")["signals"] == []


def test_english_rsi():
    dsl = nlp.parse("buy when rsi below 30")
    sig = _first(dsl)
    assert sig["indicator"] == "rsi"
    assert sig["op"] == "below"
    assert sig["action"] == "buy"


def test_no_beomonnuri_indicator():
    # 범온 고유 지표명은 인식되지 않아야 한다 (표준 지표만).
    dsl = nlp.parse("qsignal이 1 위로 가면 매수")
    # qsignal은 지표로 인식 안 됨 → 신호 없음
    assert dsl["signals"] == []


# ── 지표탭 확장 지표 (추세/모멘텀/변동성/거래량/가격구조) ──
def test_momentum_indicators():
    cases = {
        "CCI가 100 위로 가면 매도": "cci",
        "윌리엄스가 -20 위로 가면 매도": "willr",
        "변화율이 0 아래로 가면 매도": "roc",
        "스토캐스틱RSI가 20 아래로 가면 매수": "stochrsi",
        "TRIX가 0 위로 가면 매수": "trix",
        "AO가 0 위로 가면 매수": "ao",
        "TSI가 0 아래로 가면 매도": "tsi",
        "모멘텀이 0 위로 가면 매수": "mom",
    }
    for text, expect in cases.items():
        dsl = nlp.parse(text)
        assert dsl["signals"], text
        assert dsl["signals"][0]["indicator"] == expect, text
        assert sr.validate_dsl(dsl)


def test_volatility_indicators():
    for text, expect in {"ATR이 500 위로 가면 관심구간": "atr"}.items():
        dsl = nlp.parse(text)
        assert dsl["signals"][0]["indicator"] == expect
        assert sr.validate_dsl(dsl)


def test_volume_indicators():
    cases = {
        "OBV가 0 아래로 가면 매도": "obv",
        "CMF가 0 위로 가면 매수": "cmf",
        "MFI가 80 이상이면 매도": "mfi",
        "거래량이 1000 위로 가면 매수": "volume",
    }
    for text, expect in cases.items():
        dsl = nlp.parse(text)
        assert dsl["signals"][0]["indicator"] == expect, text
        assert sr.validate_dsl(dsl)


def test_trend_ma_variants():
    for text, expect in {"HMA 20이 60000 위로 가면 매수": "hma"}.items():
        dsl = nlp.parse(text)
        assert dsl["signals"][0]["indicator"] == expect
        assert sr.validate_dsl(dsl)


def test_price_vs_vwap_crossover():
    # 지표-대-지표 교차 (가격구조): "가격이 VWAP 위로 가면 매수"
    dsl = nlp.parse("가격이 VWAP 위로 가면 매수")
    sig = dsl["signals"][0]
    assert sig["indicator"] == "price"
    assert sig["op"] == "cross_up"
    assert sig["target"]["indicator"] == "vwap"
    assert sig["action"] == "buy"
    assert sr.validate_dsl(dsl)


def test_beomonnuri_candle_ignored():
    # 범온 캔들 등 고유 지표는 신호로 만들지 않는다.
    assert nlp.parse("범온캔들 위로 가면 매수")["signals"] == []
    assert nlp.parse("슈퍼트렌드가 매수로 바뀌면 매수")["signals"] == []

