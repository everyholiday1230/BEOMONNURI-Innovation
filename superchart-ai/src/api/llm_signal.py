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

from sqlalchemy import text
from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id, decode_token
from src.services.market import fetch_candles
from src.services.symbol_resolver import resolve_symbol
from src.services import signal_rules
from src.services.llm_signal import generate_signal_dsl
from src.services.tier_guard import consume_free_quota
from src.api.points import spend, _balance
from src.services.admin_helpers import auth_admin_check

router = APIRouter(prefix="/llm-signal", tags=["LLM Signal"])

FEATURE = "llm_signal"
# 토큰당 포인트 환율 (기본 1토큰=1포인트). 운영 중 env로 조정 가능.
TOKEN_PER_POINT = max(1, int(os.getenv("LLM_TOKEN_PER_POINT", "1")))
CANDLE_LIMIT = 1000

_ensured = False


async def _ensure_tables(db: AsyncSession) -> None:
    """LLM 신호 이력 테이블 멱등 생성 (기존 테이블 미변경)."""
    global _ensured
    if _ensured:
        return
    try:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS llm_signal_log (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                symbol TEXT,
                timeframe TEXT,
                message TEXT,
                signals_json TEXT,
                signal_count INTEGER NOT NULL DEFAULT 0,
                drawing_count INTEGER NOT NULL DEFAULT 0,
                prompt_tokens INTEGER NOT NULL DEFAULT 0,
                completion_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                charged_points INTEGER NOT NULL DEFAULT 0,
                free_used BOOLEAN NOT NULL DEFAULT FALSE,
                tier TEXT,
                status TEXT NOT NULL DEFAULT 'ok',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_llm_signal_log_user ON llm_signal_log(user_id, created_at)"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_llm_signal_log_created ON llm_signal_log(created_at)"
        ))
        await db.commit()
        _ensured = True
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass


async def _log_signal(db: AsyncSession, *, user_id: str, symbol: str, timeframe: str,
                      message: str, signals: list, drawing_count: int,
                      prompt_tokens: int, completion_tokens: int, total_tokens: int,
                      charged: int, free_used: bool, tier: str, status: str) -> None:
    """LLM 신호 요청 1건을 이력 테이블에 저장 (실패해도 본 요청에 영향 없음)."""
    import json as _json
    try:
        await _ensure_tables(db)
        await db.execute(text("""
            INSERT INTO llm_signal_log
              (user_id, symbol, timeframe, message, signals_json, signal_count,
               drawing_count, prompt_tokens, completion_tokens, total_tokens,
               charged_points, free_used, tier, status)
            VALUES
              (:u,:sym,:tf,:msg,:sig,:sc,:dc,:pt,:ct,:tt,:cp,:fu,:tier,:st)
        """), {
            "u": user_id, "sym": symbol, "tf": timeframe, "msg": message[:1000],
            "sig": _json.dumps(signals, ensure_ascii=False)[:4000],
            "sc": len(signals), "dc": drawing_count,
            "pt": prompt_tokens, "ct": completion_tokens, "tt": total_tokens,
            "cp": charged, "fu": free_used, "tier": tier, "st": status,
        })
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass


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

    # ── LLM 호출: 자연어 → DSL (실제 토큰 카운트 포함) ──
    # 서버 보호: 동시 실행 세마포어 + 사용자당 중복요청 방지.
    llm = await generate_signal_dsl(message, symbol=symbol, timeframe=timeframe, user_id=user_id)
    err0 = llm.get("error")
    if err0 == "busy_user":
        raise HTTPException(429, detail={"code": "BUSY_USER", "message": "이전 요청을 처리 중입니다. 완료 후 다시 시도해주세요."})
    if err0 == "busy":
        raise HTTPException(429, detail={"code": "BUSY", "message": "AI 신호 요청이 많아 잠시 대기 중입니다. 잠시 후 다시 시도해주세요."})
    total_tokens = int(llm.get("total_tokens", 0) or 0)

    # ── 무료 한도 소비 (pro/premium은 항상 무료) ──
    # busy 로 조기 반환된 경우에는 여기까지 오지 않으므로 무료 횟수를 낭비하지 않는다.
    within_free = True if is_unlimited else consume_free_quota(user_id, FEATURE)

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
        await _log_signal(db, user_id=user_id, symbol=symbol, timeframe=timeframe,
                          message=message, signals=[], drawing_count=0,
                          prompt_tokens=llm.get("prompt_tokens", 0), completion_tokens=llm.get("completion_tokens", 0),
                          total_tokens=total_tokens, charged=charged, free_used=not within_free,
                          tier=tier, status="llm_fail")
        err = llm.get("error")
        if err in ("llm_unavailable", "llm_http_404", "llm_http_500", "llm_http_502", "llm_http_503"):
            reply = "AI 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요. (관리자: Ollama 서버/모델 설정을 확인하세요)"
        else:
            reply = "요청을 신호로 바꾸지 못했습니다. 예: 'RSI가 30 아래로 가면 매수 표시해줘' 처럼 조건을 구체적으로 적어주세요."
        return ApiResponse(data={
            "reply": reply,
            "signals": [], "drawings": [],
            "tokens": total_tokens, "charged": charged,
            "free_used": not within_free,
            "error": err,
        })

    # ── DSL 검증 + 규칙 평가 ──
    try:
        valid_signals = signal_rules.validate_dsl(llm["dsl"])
    except signal_rules.RuleError as e:
        await _log_signal(db, user_id=user_id, symbol=symbol, timeframe=timeframe,
                          message=message, signals=[], drawing_count=0,
                          prompt_tokens=llm.get("prompt_tokens", 0), completion_tokens=llm.get("completion_tokens", 0),
                          total_tokens=total_tokens, charged=charged, free_used=not within_free,
                          tier=tier, status="invalid_dsl")
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

    await _log_signal(db, user_id=user_id, symbol=symbol, timeframe=timeframe,
                      message=message, signals=valid_signals, drawing_count=len(drawings),
                      prompt_tokens=llm.get("prompt_tokens", 0), completion_tokens=llm.get("completion_tokens", 0),
                      total_tokens=total_tokens, charged=charged, free_used=not within_free,
                      tier=tier, status="ok")

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


@router.post("/preview", response_model=ApiResponse)
async def preview(req: dict):
    """DSL을 직접 평가해 드로잉을 반환한다 (LLM 미사용·과금 없음).

    - LLM 호출 없이 규칙→차트 신호 파이프라인만 검증/사용하는 경로.
    - 인증/과금 불필요 (공개 시세로 표준 지표만 계산).
    - 잘못된 DSL은 검증에서 걸러진다.
    """
    dsl = req.get("dsl") or req
    symbol = str(req.get("symbol", "") or "").strip() or "BTCUSDT"
    timeframe = str(req.get("timeframe", "") or "").strip() or "1h"
    try:
        valid_signals = signal_rules.validate_dsl(dsl)
    except signal_rules.RuleError as e:
        return ApiResponse(data={"reply": "유효한 신호 규칙이 없습니다.", "signals": [], "drawings": [], "detail": str(e)})
    try:
        api_sym, exchange_id = resolve_symbol(symbol)
        candles = await fetch_candles(api_sym, exchange_id, timeframe, CANDLE_LIMIT)
    except Exception:
        candles = []
    drawings = signal_rules.evaluate(candles, valid_signals) if candles else []
    return ApiResponse(data={
        "reply": signal_rules.summarize(valid_signals, drawings),
        "signals": valid_signals, "drawings": drawings,
        "symbol": symbol, "timeframe": timeframe,
    })


@router.get("/health", response_model=ApiResponse)
async def health():
    """Ollama 연결/모델 상태 점검 (공개). 신호 기능 동작 가능 여부 진단용."""
    import httpx as _httpx
    from src.services.llm_signal import OLLAMA_URL, OLLAMA_MODEL
    info = {"model": OLLAMA_MODEL, "url": OLLAMA_URL, "reachable": False, "model_available": None, "models": []}
    # /api/generate → /api/tags 로 변환해 설치된 모델 목록 조회
    tags_url = OLLAMA_URL.rsplit("/api/", 1)[0] + "/api/tags"
    try:
        async with _httpx.AsyncClient(timeout=5) as c:
            r = await c.get(tags_url)
        if r.status_code == 200:
            info["reachable"] = True
            data = r.json()
            names = [m.get("name", "") for m in (data.get("models") or [])]
            info["models"] = names
            base = OLLAMA_MODEL.split(":")[0]
            info["model_available"] = any(n == OLLAMA_MODEL or n.split(":")[0] == base for n in names)
    except Exception as e:
        info["error"] = str(e)[:160]
    return ApiResponse(data=info)


@router.get("/admin/stats", response_model=ApiResponse)
async def admin_stats(request: Request, db: AsyncSession = Depends(get_db),
                      _a: None = Depends(auth_admin_check)):
    """LLM 신호 사용 통계 (관리자)."""
    await _ensure_tables(db)
    try:
        totals = (await db.execute(text("""
            SELECT
              COUNT(*) AS requests,
              COUNT(DISTINCT user_id) AS users,
              COALESCE(SUM(total_tokens),0) AS tokens,
              COALESCE(SUM(charged_points),0) AS charged,
              COALESCE(SUM(CASE WHEN free_used THEN 0 ELSE 1 END),0) AS free_calls,
              COALESCE(SUM(drawing_count),0) AS drawings
            FROM llm_signal_log
        """))).mappings().first() or {}
        today = (await db.execute(text("""
            SELECT COUNT(*) AS requests, COALESCE(SUM(total_tokens),0) AS tokens,
                   COALESCE(SUM(charged_points),0) AS charged
            FROM llm_signal_log WHERE created_at >= date_trunc('day', now())
        """))).mappings().first() or {}
        by_status = (await db.execute(text("""
            SELECT status, COUNT(*) AS cnt FROM llm_signal_log GROUP BY status ORDER BY cnt DESC
        """))).mappings().all()
        top_users = (await db.execute(text("""
            SELECT user_id, COUNT(*) AS requests, COALESCE(SUM(total_tokens),0) AS tokens,
                   COALESCE(SUM(charged_points),0) AS charged
            FROM llm_signal_log GROUP BY user_id ORDER BY requests DESC LIMIT 20
        """))).mappings().all()
        return ApiResponse(data={
            "totals": dict(totals),
            "today": dict(today),
            "by_status": [dict(r) for r in by_status],
            "top_users": [dict(r) for r in top_users],
        })
    except Exception as e:
        return ApiResponse(data={"error": str(e)[:200], "totals": {}, "today": {}, "by_status": [], "top_users": []})


@router.get("/admin/audit", response_model=ApiResponse)
async def admin_audit(request: Request, page: int = 1, page_size: int = 50,
                      db: AsyncSession = Depends(get_db),
                      _a: None = Depends(auth_admin_check)):
    """LLM 신호 요청 감사 로그 (관리자, 페이지네이션)."""
    await _ensure_tables(db)
    page = max(1, int(page))
    page_size = max(1, min(200, int(page_size)))
    offset = (page - 1) * page_size
    try:
        total = int((await db.execute(text("SELECT COUNT(*) FROM llm_signal_log"))).scalar() or 0)
        rows = (await db.execute(text("""
            SELECT id, user_id, symbol, timeframe, message, signal_count, drawing_count,
                   total_tokens, charged_points, free_used, tier, status, created_at
            FROM llm_signal_log ORDER BY created_at DESC LIMIT :lim OFFSET :off
        """), {"lim": page_size, "off": offset})).mappings().all()
        return ApiResponse(data={
            "total": total, "page": page, "page_size": page_size,
            "items": [dict(r) for r in rows],
        })
    except Exception as e:
        return ApiResponse(data={"error": str(e)[:200], "total": 0, "items": []})
