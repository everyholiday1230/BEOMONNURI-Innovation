"""알림 API — DB 영속화 + 사용자별 소유권."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.models.tables import Symbol
from src.services.alert_engine import alert_engine

router = APIRouter()

async def _get_uid_from_request(request: Request) -> str | None:
    """쿠키/Bearer에서 user_id 추출. 실패 시 None."""
    token = request.cookies.get("auth_token") or ""
    auth_h = request.headers.get("authorization", "")
    if not token and auth_h.startswith("Bearer "):
        token = auth_h[7:]
    if not token:
        return None
    try:
        from src.services.auth import decode_token
        payload = decode_token(token)
        return payload.get("sub")
    except Exception:
        return None



class AlertCreate(BaseModel):
    # symbol 은 심볼 코드(예: BTCUSDT) 또는 UUID 를 모두 허용
    symbol: str = Field(..., min_length=2, max_length=50)
    rule_type: str = Field(..., pattern=r"^(PRICE_CROSS_UP|PRICE_CROSS_DOWN|RSI_ABOVE|RSI_BELOW|BEOM_SIGNAL)$")
    target_price: float = Field(0, ge=0)
    threshold: float = Field(0, ge=0, le=100)
    cooldown_sec: int = Field(300, ge=10, le=86400)
    timeframe: str | None = Field(None, max_length=10)


async def _resolve_symbol(db: AsyncSession, symbol: str) -> tuple[str, str]:
    """프론트에서 넘긴 symbol(코드 혹은 UUID)을 (symbol_id, symbol_code)로 변환."""
    # UUID 인지 확인
    import uuid as _uuid

    try:
        sym_uuid = _uuid.UUID(symbol)
        res = await db.execute(select(Symbol).where(Symbol.id == sym_uuid))
        s = res.scalar()
        if s:
            return str(s.id), s.symbol_code
    except ValueError:
        pass
    # 코드 기준 조회
    res = await db.execute(select(Symbol).where(Symbol.symbol_code == symbol.upper()))
    s = res.scalar()
    if not s:
        raise HTTPException(404, f"Unknown symbol: {symbol}")
    return str(s.id), s.symbol_code


@router.get("", response_model=ApiResponse)
async def list_alerts(request: Request):
    """본인 알림 목록만 반환."""
    token = request.cookies.get("auth_token") or (request.headers.get("authorization","")[7:] if request.headers.get("authorization","").startswith("Bearer ") else "")
    if not token:
        return ApiResponse(data={"items": []})
    try:
        from src.services.auth import decode_token
        payload = decode_token(token)
        user_id = payload.get("sub","")
    except Exception:
        return ApiResponse(data={"items": []})
    return ApiResponse(data={"items": alert_engine.list_user_rules(user_id)})


@router.get("/history", response_model=ApiResponse)
async def alert_history(request: Request, db: AsyncSession = Depends(get_db), limit: int = 30):
    """내 알림 트리거 히스토리 — 최근 발동된 내역.

    일반 알림(PRICE_CROSS_*, RSI_*)의 last_triggered_at 기준 + BEOM_SIGNAL 이력.
    """
    token = request.cookies.get("auth_token") or (request.headers.get("authorization","")[7:] if request.headers.get("authorization","").startswith("Bearer ") else "")
    if not token:
        return ApiResponse(data={"items": []})
    try:
        from src.services.auth import decode_token
        payload = decode_token(token)
        user_id = payload.get("sub", "")
    except Exception:
        return ApiResponse(data={"items": []})

    from sqlalchemy import text as _t
    # 본인 알림 중 트리거된 적 있는 것만
    rows = (await db.execute(
        _t("""
            SELECT id, symbol, rule_type, timeframe, target_price, last_triggered_at
            FROM alert_rules
            WHERE user_id = :uid AND last_triggered_at IS NOT NULL
            ORDER BY last_triggered_at DESC
            LIMIT :lim
        """),
        {"uid": user_id, "lim": limit}
    )).fetchall()

    items = [
        {
            "id": str(r[0]),
            "symbol": r[1],
            "rule_type": r[2],
            "timeframe": r[3],
            "target_price": float(r[4] or 0),
            "triggered_at": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]
    return ApiResponse(data={"items": items, "total": len(items)})


@router.post("", response_model=ApiResponse)
async def create_alert(req: AlertCreate, request: Request, db: AsyncSession = Depends(get_db)):
    user_id = await _get_uid_from_request(request)
    if not user_id:
        raise HTTPException(401, "로그인이 필요합니다")
    # BEOM_SIGNAL은 VIP 이상만
    if req.rule_type == "BEOM_SIGNAL":
        from src.services.beom_free import get_user_tier
        tier = await get_user_tier(request)
        if tier not in ("pro", "premium"):
            raise HTTPException(403, "VIP회원 전용 기능입니다")
    symbol_id, symbol_code = await _resolve_symbol(db, req.symbol)
    try:
        rec = await alert_engine.create_rule(
            user_id=user_id,
            symbol_id=symbol_id,
            symbol_code=symbol_code,
            rule_type=req.rule_type,
            target_price=req.target_price,
            threshold=req.threshold,
            cooldown_sec=req.cooldown_sec,
            timeframe=req.timeframe,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return ApiResponse(data={
        "id": rec["id"],
        "symbol": rec["symbol"],
        "ruleType": rec["rule_type"],
        "targetPrice": rec["target_price"],
        "threshold": rec["threshold"],
        "cooldownSec": rec["cooldown_sec"],
    })


@router.delete("/{alert_id}", response_model=ApiResponse)
async def delete_alert(alert_id: str, request: Request):
    """본인 소유 알림만 삭제 허용."""
    user_id = await _get_uid_from_request(request)
    if not user_id:
        raise HTTPException(401, "로그인이 필요합니다")
    ok = await alert_engine.delete_rule(user_id=user_id, rule_id=alert_id)
    if not ok:
        raise HTTPException(404, "Alert not found or not owned by user")
    return ApiResponse(data={"deleted": True})


@router.post("/beom-signal-trigger")
async def trigger_beom_signal(request: Request, body: dict, db: AsyncSession = Depends(get_db)):
    """BEOM AI 시그널 발생 시 → 이력 저장 + 구독자 알림."""
    from src.services.alert_engine import alert_engine
    user_id = await _get_uid_from_request(request)
    if not user_id:
        return {"success": False, "error": "VIP only"}
    # tier 확인
    from src.services.beom_free import get_user_tier
    tier = await get_user_tier(request)
    if tier not in ("pro", "premium"):
        return {"success": False, "error": "VIP only"}
    symbol = body.get("symbol", "")
    timeframe = body.get("timeframe", "")
    signal_type = body.get("signal_type", "")
    price = body.get("price", 0)
    if not symbol or not signal_type:
        return {"success": False, "error": "Missing params"}
    # 이력 저장
    await db.execute(
        __import__("sqlalchemy").text(
            "INSERT INTO beom_signal_history (symbol, timeframe, signal_type, price) VALUES (:s, :tf, :st, :p)"
        ), {"s": symbol, "tf": timeframe, "st": signal_type, "p": price}
    )
    await db.commit()
    # 구독자 알림
    await alert_engine.evaluate_beom(symbol, timeframe, signal_type)
    return {"success": True}


@router.get("/beom-signals")
async def get_beom_signals(request: Request, db: AsyncSession = Depends(get_db), limit: int = 50):
    """BEOM 시그널 이력 조회 — VIP: 구독 종목만 / VVIP: 전체."""
    from src.api.charts_indicators import get_user_tier
    tier = await get_user_tier(request)
    if tier not in ("pro", "premium"):
        return {"success": False, "data": {"_access": "pro_only"}}
    result = await db.execute(
        __import__("sqlalchemy").text(
            "SELECT symbol, timeframe, signal_type, price, created_at FROM beom_signal_history ORDER BY created_at DESC LIMIT :lim"
        ), {"lim": limit}
    )
    rows = [{"symbol": r[0], "timeframe": r[1], "signal_type": r[2], "price": float(r[3] or 0), "time": r[4].isoformat()} for r in result.fetchall()]
    return {"success": True, "data": {"signals": rows, "tier": tier}}


@router.get("/beom-signal-slots")
async def get_beom_signal_slots(request: Request, db: AsyncSession = Depends(get_db)):
    """VIP 시그널 알림 슬롯 확인 — VIP: 3개 / VVIP: 무제한."""
    from src.api.charts_indicators import get_user_tier
    tier = await get_user_tier(request)
    if tier not in ("pro", "premium"):
        return {"success": False, "data": {"_access": "pro_only"}}
    user_id = await _get_uid_from_request(request)
    if not user_id:
        return {"success": False, "data": {"_access": "login_required"}}
    count_result = await db.execute(
        __import__("sqlalchemy").text(
            "SELECT count(*) FROM alert_rules WHERE user_id=:uid AND rule_type='BEOM_SIGNAL' AND is_active=true"
        ), {"uid": user_id}
    )
    current = count_result.scalar() or 0
    max_slots = 999 if tier == "premium" else 3
    return {"success": True, "data": {"current": current, "max": max_slots, "tier": tier}}
