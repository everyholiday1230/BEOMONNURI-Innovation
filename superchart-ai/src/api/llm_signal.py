"""나만의 AI 신호 — LLM 대화형 신호 생성 API.

흐름:
    1. 사용자 자연어 메시지 수신
    2. 무료 일일 한도(하루 2회) 확인 — 초과 시 포인트로 과금(1토큰=1포인트, env 조정)
    3. Ollama로 자연어 → 안전한 신호 DSL 변환 (표준 지표만, 범온지표 격리)
    4. DSL 화이트리스트 검증 → 현재 종목 캔들로 규칙 평가 → 차트 드로잉 좌표 산출
    5. 포인트 차감(무료 초과분) + 결과 반환

⚠️ 범온 고유 지표 격리: 이 모듈과 하위 서비스는 범온 지표를 import/참조하지 않는다.
"""
from __future__ import annotations

import math
import os

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id, decode_token
from src.services.market import fetch_candles
from src.services.symbol_resolver import resolve_symbol
from src.services import signal_rules
from src.services.llm_signal import generate_signal_dsl
from src.services.tier_guard import consume_free_quota
from src.api.points import spend, _balance

router = APIRouter(prefix="/llm-signal", tags=["LLM Signal"])

FEATURE = "llm_signal"
# 토큰당 포인트 환율 (기본 1토큰=1포인트). 운영 중 env로 조정 가능.
TOKEN_PER_POINT = max(1, int(os.getenv("LLM_TOKEN_PER_POINT", "1")))
CANDLE_LIMIT = 1000


def _tier_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        try:
            return decode_token(auth[7:]).get("tier", "free")
        except Exception:
            return "free"
    return "free"


@router.post("/chat", response_model=ApiResponse)
async def chat(
    req: dict,
    request: Request,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """대화 메시지를 신호 규칙으로 변환하고 차트 드로잉을 반환한다."""
    message = str(req.get("message", "")).strip()
    if not message:
        raise HTTPException(400, "메시지를 입력해주세요.")
    if len(message) > 1000:
        message = message[:1000]

    symbol = str(req.get("symbol", "") or "").strip() or "BTCUSDT"
    timeframe = str(req.get("timeframe", "") or "").strip() or "1h"

    tier = _tier_from_request(request)
    is_unlimited = tier in ("pro", "premium")

    # ── 무료 한도 소비 (pro/premium은 항상 무료) ──
    within_free = True if is_unlimited else consume_free_quota(user_id, FEATURE)

    # ── LLM 호출: 자연어 → DSL (실제 토큰 카운트 포함) ──
    llm = await generate_signal_dsl(message, symbol=symbol, timeframe=timeframe)
    total_tokens = int(llm.get("total_tokens", 0) or 0)

    # ── 과금: 무료 한도 초과분만 토큰 비례 차감 ──
    charged = 0
    if not within_free and not is_unlimited and total_tokens > 0:
        charged = math.ceil(total_tokens / TOKEN_PER_POINT)
        bal = await _balance(db, user_id)
        if bal < charged:
            # 무료 소진 + 포인트 부족 → 결제 유도 (402)
            raise HTTPException(
                402,
                detail={
                    "code": "INSUFFICIENT_POINTS",
                    "message": f"무료 횟수를 모두 사용했습니다. 이번 요청에는 {charged}P가 필요하지만 잔액은 {bal}P입니다.",
                    "required": charged,
                    "balance": bal,
                },
            )
        ok = await spend(db, user_id, charged, reason="llm_signal",
                         note=f"tokens={total_tokens}", ref_id=None)
        if not ok:
            raise HTTPException(402, detail={"code": "INSUFFICIENT_POINTS", "message": "포인트가 부족합니다.", "required": charged})
        await db.commit()

    # ── LLM 실패 처리 ──
    if not llm.get("ok") or not llm.get("dsl"):
        return ApiResponse(data={
            "reply": "요청을 신호로 바꾸지 못했습니다. 예: 'RSI가 30 아래로 가면 매수 표시해줘' 처럼 조건을 구체적으로 적어주세요.",
            "signals": [], "drawings": [],
            "tokens": total_tokens, "charged": charged,
            "free_used": not within_free,
            "error": llm.get("error"),
        })

    # ── DSL 검증 + 규칙 평가 ──
    try:
        valid_signals = signal_rules.validate_dsl(llm["dsl"])
    except signal_rules.RuleError as e:
        return ApiResponse(data={
            "reply": "표준 지표(RSI, MACD, 이동평균, 볼린저, 스토캐스틱, 거래량, 가격)로 만들 수 있는 조건으로 다시 말씀해주세요.",
            "signals": [], "drawings": [],
            "tokens": total_tokens, "charged": charged, "free_used": not within_free,
            "detail": str(e),
        })

    # 서버측에서 현재 종목 캔들 조회 후 규칙 평가
    try:
        api_sym, exchange_id = resolve_symbol(symbol)
        candles = await fetch_candles(api_sym, exchange_id, timeframe, CANDLE_LIMIT)
    except Exception:
        candles = []

    drawings = signal_rules.evaluate(candles, valid_signals) if candles else []
    summary = signal_rules.summarize(valid_signals, drawings)

    return ApiResponse(data={
        "reply": f"{summary}. 차트에 표시했습니다." if drawings else f"{summary}. (표시할 신호 없음)",
        "signals": valid_signals,
        "drawings": drawings,
        "symbol": symbol,
        "timeframe": timeframe,
        "tokens": total_tokens,
        "charged": charged,
        "free_used": not within_free,
        "tier": tier,
    })
