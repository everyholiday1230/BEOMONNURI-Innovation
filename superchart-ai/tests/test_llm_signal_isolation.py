"""LLM 폴백(대화형 신호) 격리·안전성 정적 점검 — AI 모델 없이 검증.

모델(Ollama) 없이도 검증 가능한 항목:
  1) 시스템 프롬프트에 범온 고유 지표가 절대 노출되지 않음
  2) 모듈이 범온 지표 모듈을 import 하지 않음
  3) LLM이 범온 지표를 반환해도 validate_dsl 화이트리스트가 제거(2차 방어)
  4) _extract_json 이 코드펜스/산문 섞인 출력에서도 JSON 을 견고히 파싱
"""
import inspect

import pytest

from src.services import llm_signal as ls
from src.services import signal_rules as sr

# 프롬프트/소스에 절대 등장하면 안 되는 범온 고유 용어
BANNED = [
    "beom", "beom_candle", "qsignal", "bimaco", "범온",
    "trade_zone", "ma_align", "master_signal", "오더블럭", "order_block",
]


def test_system_prompt_has_no_proprietary_terms():
    p = ls.SYSTEM_PROMPT.lower()
    for term in BANNED:
        assert term.lower() not in p, f"prompt leaks proprietary term: {term}"


def test_system_prompt_lists_only_standard_indicators():
    p = ls.SYSTEM_PROMPT.lower()
    for ind in ["rsi", "macd", "ema", "sma", "bollinger", "stochastic", "volume", "price"]:
        assert ind in p


def test_module_does_not_import_proprietary():
    src = inspect.getsource(ls)
    for banned in ("beom_candle", "qsignal", "bimaco", "trade_zone", "ma_align", "master_signal"):
        assert f"from src.services.{banned}" not in src
        assert f"import {banned}" not in src


def test_llm_output_with_proprietary_is_stripped_by_validation():
    # LLM 이 (가정) 범온 지표를 반환해도 2차 검증이 표준 지표만 남긴다.
    dsl = {"signals": [
        {"indicator": "beom_candle", "op": "above", "value": 1, "action": "buy"},
        {"indicator": "qsignal", "op": "below", "value": 0, "action": "sell"},
        {"indicator": "rsi", "period": 14, "op": "below", "value": 30, "action": "buy"},
    ]}
    sigs = sr.validate_dsl(dsl)
    assert len(sigs) == 1 and sigs[0]["indicator"] == "rsi"


def test_extract_json_variants():
    assert ls._extract_json('```json\n{"signals": []}\n```') == {"signals": []}
    d = ls._extract_json('Here is your spec: {"signals": [{"indicator":"rsi"}]} thanks')
    assert d["signals"][0]["indicator"] == "rsi"
    assert ls._extract_json('{"a":1}') == {"a": 1}


def test_extract_json_empty_raises():
    with pytest.raises(Exception):
        ls._extract_json("")
