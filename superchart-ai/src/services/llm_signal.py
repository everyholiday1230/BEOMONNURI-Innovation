"""LLM 대화형 신호 생성 — 자연어 → 안전한 신호 DSL 변환 (Ollama).

⚠️ 격리 원칙 (절대 규칙):
    - LLM 프롬프트에는 범온 고유 지표(beom_candle, qsignal, bimaco 등)의
      이름·수식·코드·출력을 **절대 포함하지 않는다.**
    - LLM은 오직 공개 표준 지표(RSI/MACD/EMA/SMA/Bollinger/Stochastic/Volume/price)
      화이트리스트 안에서만 신호 규칙을 만들 수 있다.
    - 이 모듈은 범온 지표 모듈을 import 하지 않는다.
"""
from __future__ import annotations

import asyncio
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

# ── 서버 보호 (512MB 환경) ──
# Ollama 추론은 무거워 동시 요청이 몰리면 메모리/CPU가 급증한다.
# 전역 세마포어로 동시 추론 수를 제한하고, 사용자당 중복 요청을 막는다.
_MAX_CONCURRENCY = max(1, int(os.getenv("LLM_SIGNAL_MAX_CONCURRENCY", "2")))
_ACQUIRE_TIMEOUT = float(os.getenv("LLM_SIGNAL_ACQUIRE_TIMEOUT", "8"))
_semaphore: asyncio.Semaphore | None = None
_inflight_users: set[str] = set()

# 공유 httpx 클라이언트 (요청마다 새로 만들지 않음 — 커넥션/메모리 절약)
_http: httpx.AsyncClient | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)
    return _semaphore


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(
            timeout=OLLAMA_TIMEOUT,
            limits=httpx.Limits(max_connections=max(2, _MAX_CONCURRENCY + 1),
                                max_keepalive_connections=_MAX_CONCURRENCY),
        )
    return _http


async def aclose() -> None:
    """앱 종료 시 공유 클라이언트 정리 (lifespan에서 호출 가능)."""
    global _http
    if _http and not _http.is_closed:
        await _http.aclose()
    _http = None

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


async def generate_signal_dsl(user_message: str, symbol: str = "", timeframe: str = "",
                              user_id: str = "") -> dict:
    """사용자 자연어 → 신호 DSL(dict) + 토큰 사용량.

    서버 보호:
      - 전역 세마포어로 동시 추론 수 제한(_MAX_CONCURRENCY). 대기 시간이
        _ACQUIRE_TIMEOUT 를 넘으면 busy 로 반환(요청 폭주 시 빠른 실패).
      - user_id 가 이미 처리 중이면 중복 요청을 차단(busy_user).

    반환:
        {
          "dsl": {...} | None, "raw": "<llm text>",
          "prompt_tokens": int, "completion_tokens": int, "total_tokens": int,
          "ok": bool, "error": str | None,
        }
    """
    result = {
        "dsl": None, "raw": "", "prompt_tokens": 0, "completion_tokens": 0,
        "total_tokens": 0, "ok": False, "error": None,
    }

    # 사용자당 중복 요청 방지 (동일 사용자가 연타로 여러 추론을 물지 않게)
    if user_id:
        if user_id in _inflight_users:
            result["error"] = "busy_user"
            return result
        _inflight_users.add(user_id)

    try:
        # 전역 동시성 제한 — 대기 초과 시 빠른 실패
        sem = _get_semaphore()
        try:
            await asyncio.wait_for(sem.acquire(), timeout=_ACQUIRE_TIMEOUT)
        except asyncio.TimeoutError:
            result["error"] = "busy"
            return result

        try:
            ctx = ""
            if symbol:
                ctx += f" (current symbol: {symbol}"
                if timeframe:
                    ctx += f", timeframe: {timeframe}"
                ctx += ")"
            prompt = f"{SYSTEM_PROMPT}\n\nUser request{ctx}:\n{user_message}\n\nJSON:"

            try:
                client = _client()
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
        finally:
            sem.release()
    finally:
        if user_id:
            _inflight_users.discard(user_id)
