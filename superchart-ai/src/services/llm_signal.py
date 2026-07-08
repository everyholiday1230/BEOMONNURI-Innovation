"""LLM 대화형 신호 생성 — 자연어 → 안전한 신호 DSL 변환 (Ollama).

⚠️ 격리 원칙 (절대 규칙):
    - LLM 프롬프트에는 범온 고유 지표(beom_candle, qsignal, bimaco 등)의
      이름·수식·코드·출력을 **절대 포함하지 않는다.**
    - LLM은 오직 공개 표준 지표(RSI/MACD/EMA/SMA/Bollinger/Stochastic/Volume/price)
      화이트리스트 안에서만 신호 규칙을 만들 수 있다.
    - 이 모듈은 범온 지표 모듈을 import 하지 않는다.
"""
from __future__ import annotations

import json
import os
import re

import httpx
import structlog

logger = structlog.get_logger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
# 신호 생성 전용 모델 — 표준 Ollama 모델 사용(기본 llama3). llm_commentary와 독립.
OLLAMA_MODEL = os.getenv("LLM_SIGNAL_MODEL", os.getenv("OLLAMA_MODEL", "llama3"))
OLLAMA_TIMEOUT = float(os.getenv("LLM_SIGNAL_TIMEOUT", "40"))

# 표준 지표만 노출하는 시스템 프롬프트 (범온 지표 언급 전혀 없음)
SYSTEM_PROMPT = """You convert a user's trading idea into a strict JSON signal specification.

You ONLY know these standard public indicators:
- rsi (Relative Strength Index)
- macd (Moving Average Convergence Divergence)
- ema (Exponential Moving Average)
- sma (Simple Moving Average)
- bollinger (Bollinger Bands)
- stochastic (Stochastic oscillator)
- volume
- price (raw close price)

You do NOT know any proprietary or custom indicators. If the user asks for anything
outside the list above, map it to the closest standard indicator or omit it.

Output ONLY valid JSON, no prose, in exactly this schema:
{
  "signals": [
    {"indicator":"rsi","period":14,"op":"below","value":30,"action":"buy","label":"short text"},
    {"indicator":"ema","period":20,"op":"cross_up","target":{"indicator":"ema","period":50},"action":"buy","label":"..."},
    {"indicator":"price","op":"above","value":70000,"action":"sell","label":"..."}
  ]
}

Rules:
- "op" is one of: above, below, cross_up, cross_down
- above/below require a numeric "value"
- cross_up/cross_down require a "target" indicator object
- "action" is one of: buy, sell, line, zone
- "label" is a short human label (<= 8 words), in the user's language
- Max 10 signals. Output JSON only."""


def _extract_json(text: str) -> dict:
    """LLM 출력에서 JSON 객체를 추출/파싱."""
    if not text:
        raise ValueError("empty LLM output")
    # 코드펜스 제거
    text = text.strip()
    text = re.sub(r"^```(?:json)?", "", text).strip()
    text = re.sub(r"```$", "", text).strip()
    # 첫 { ~ 마지막 } 구간 시도
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        candidate = text[start:end + 1]
        return json.loads(candidate)
    return json.loads(text)


async def generate_signal_dsl(user_message: str, symbol: str = "", timeframe: str = "") -> dict:
    """사용자 자연어 → 신호 DSL(dict) + 토큰 사용량.

    반환:
        {
          "dsl": {...} | None,
          "raw": "<llm text>",
          "prompt_tokens": int,
          "completion_tokens": int,
          "total_tokens": int,
          "ok": bool,
          "error": str | None,
        }
    """
    ctx = ""
    if symbol:
        ctx += f" (current symbol: {symbol}"
        if timeframe:
            ctx += f", timeframe: {timeframe}"
        ctx += ")"
    prompt = f"{SYSTEM_PROMPT}\n\nUser request{ctx}:\n{user_message}\n\nJSON:"

    result = {
        "dsl": None, "raw": "", "prompt_tokens": 0, "completion_tokens": 0,
        "total_tokens": 0, "ok": False, "error": None,
    }

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            resp = await client.post(OLLAMA_URL, json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "format": "json",
                "options": {"temperature": 0.2, "num_predict": 400},
            })
        if resp.status_code != 200:
            result["error"] = f"llm_http_{resp.status_code}"
            return result
        data = resp.json()
    except Exception as e:
        logger.warning("llm_signal.ollama_fail", error=str(e)[:160])
        result["error"] = "llm_unavailable"
        return result

    # 실제 토큰 사용량 (Ollama가 반환)
    result["prompt_tokens"] = int(data.get("prompt_eval_count", 0) or 0)
    result["completion_tokens"] = int(data.get("eval_count", 0) or 0)
    result["total_tokens"] = result["prompt_tokens"] + result["completion_tokens"]
    result["raw"] = data.get("response", "") or ""

    try:
        result["dsl"] = _extract_json(result["raw"])
        result["ok"] = True
    except Exception as e:
        logger.info("llm_signal.parse_fail", error=str(e)[:120], raw=result["raw"][:200])
        result["error"] = "parse_failed"

    return result
