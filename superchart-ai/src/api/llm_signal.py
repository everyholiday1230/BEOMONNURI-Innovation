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
from src.services import signal_nlp
from src.services.llm_signal import generate_signal_dsl
from src.services.admin_helpers import auth_admin_check

router = APIRouter(prefix="/llm-signal", tags=["LLM Signal"])

FEATURE = "llm_signal"
# 토큰당 포인트 환율 (기본 1토큰=1포인트). 운영 중 env로 조정 가능.
TOKEN_PER_POINT = max(1, int(os.getenv("LLM_TOKEN_PER_POINT", "1")))
CANDLE_LIMIT = 1000

# 규칙 파서가 실패했을 때만 외부 LLM(Ollama 등) 폴백을 쓸지 여부.
# 기본 비활성 → 완전 무료(규칙 파서)만으로 동작. 외부 LLM 구성 시 "1"로 켠다.
_LLM_FALLBACK_ENABLED = os.getenv("LLM_SIGNAL_USE_OLLAMA", "0") == "1"

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

    # ── 1차: 규칙 기반 파서 (무료·즉시·외부 의존 없음) ──
    # 대부분의 표준 조건("RSI 30 아래 매수", "20/50 골든크로스" 등)을 LLM 없이 처리.
    # 규칙 파서로 신호를 만들면 토큰/포인트 과금 없이 무료로 제공한다.
    dsl = signal_nlp.parse(message)
    source = "rule"
    total_tokens = 0
    llm_pt = llm_ct = 0

    # ── 2차(폴백): 규칙 파서가 실패한 경우에만 LLM 시도(선택 기능) ──
    # 기본 비활성(LLM_SIGNAL_USE_OLLAMA != "1"). 외부 LLM 미구성 시 규칙 파서만으로 동작.
    if not dsl.get("signals") and _LLM_FALLBACK_ENABLED:
        llm = await generate_signal_dsl(message, symbol=symbol, timeframe=timeframe, user_id=user_id)
        err0 = llm.get("error")
        if err0 == "busy_user":
            raise HTTPException(429, detail={"code": "BUSY_USER", "message": "이전 요청을 처리 중입니다. 완료 후 다시 시도해주세요."})
        if err0 == "busy":
            raise HTTPException(429, detail={"code": "BUSY", "message": "AI 신호 요청이 많아 잠시 대기 중입니다. 잠시 후 다시 시도해주세요."})
        if llm.get("ok") and llm.get("dsl"):
            dsl = llm["dsl"]
            source = "llm"
            total_tokens = int(llm.get("total_tokens", 0) or 0)
            llm_pt = int(llm.get("prompt_tokens", 0) or 0)
            llm_ct = int(llm.get("completion_tokens", 0) or 0)

    # 규칙 파서는 무료 → 무료 한도를 소비하지 않는다. (과금 없음)
    within_free = True
    charged = 0

    # ── 신호를 못 만든 경우 안내 ──
    if not dsl.get("signals"):
        await _log_signal(db, user_id=user_id, symbol=symbol, timeframe=timeframe,
                          message=message, signals=[], drawing_count=0,
                          prompt_tokens=llm_pt, completion_tokens=llm_ct,
                          total_tokens=total_tokens, charged=charged, free_used=False,
                          tier=tier, status="no_signal")
        return ApiResponse(data={
            "reply": ("요청을 신호로 바꾸지 못했습니다. 예: 'RSI가 30 아래로 가면 매수 표시해줘', "
                      "'20일선이 50일선을 위로 뚫으면 매수', '가격이 70000 위로 가면 매도 표시' 처럼 "
                      "지표·숫자·조건·매매를 함께 말씀해주세요."),
            "signals": [], "drawings": [],
            "tokens": total_tokens, "charged": charged, "free_used": False,
            "source": source,
        })

    # ── DSL 검증 + 규칙 평가 ──
    try:
        valid_signals = signal_rules.validate_dsl(dsl)
    except signal_rules.RuleError as e:
        await _log_signal(db, user_id=user_id, symbol=symbol, timeframe=timeframe,
                          message=message, signals=[], drawing_count=0,
                          prompt_tokens=llm_pt, completion_tokens=llm_ct,
                          total_tokens=total_tokens, charged=charged, free_used=False,
                          tier=tier, status="invalid_dsl")
        return ApiResponse(data={
            "reply": "표준 지표(RSI, MACD, 이동평균, 볼린저, 스토캐스틱, 거래량, 가격)로 만들 수 있는 조건으로 다시 말씀해주세요.",
            "signals": [], "drawings": [],
            "tokens": total_tokens, "charged": charged, "free_used": False,
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
                      prompt_tokens=llm_pt, completion_tokens=llm_ct,
                      total_tokens=total_tokens, charged=charged, free_used=False,
                      tier=tier, status="ok")

    return ApiResponse(data={
        "reply": f"{summary}. 차트에 표시했습니다." if drawings else f"{summary}. (표시할 신호 없음)",
        "signals": valid_signals,
        "drawings": drawings,
        "symbol": symbol,
        "timeframe": timeframe,
        "tokens": total_tokens,
        "charged": charged,
        "free_used": False,
        "source": source,
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
    """신호 엔진 상태 점검 (공개). 기본은 규칙 파서(무료·항상 가용)."""
    info = {
        "engine": "rule",              # 1차 엔진: 규칙 기반 파서(무료)
        "rule_parser": True,           # 규칙 파서는 외부 의존 없이 항상 가용
        "llm_fallback_enabled": _LLM_FALLBACK_ENABLED,
    }
    # LLM 폴백이 켜져 있을 때만 Ollama 상태를 함께 진단한다.
    if _LLM_FALLBACK_ENABLED:
        import httpx as _httpx
        from src.services.llm_signal import OLLAMA_URL, OLLAMA_MODEL
        info.update({"model": OLLAMA_MODEL, "url": OLLAMA_URL,
                     "reachable": False, "model_available": None, "models": []})
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
