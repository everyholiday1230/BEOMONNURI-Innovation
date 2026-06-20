"""모의주문(Paper Trading) API.

로그인 사용자의 가상 잔고/포지션/히스토리를 DB에 영구 저장.
브라우저 localStorage와 양방향 동기화.

엔드포인트:
- GET  /v1/paper/state    — 사용자 모의주문 상태 조회
- POST /v1/paper/sync     — 클라이언트에서 서버로 동기화
- POST /v1/paper/reset    — 초기화 ($1,000으로 리셋)
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.auth import decode_token

router = APIRouter(prefix="/v1/paper", tags=["PaperTrading"])

INITIAL_BALANCE = 1000.0
MAX_HISTORY = 200  # 최근 200건만 유지
MAX_POSITIONS = 50

_bearer_optional = HTTPBearer(auto_error=False)


async def _get_user_id_optional(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer_optional),
) -> str | None:
    """선택적 인증 — 토큰 있으면 user_id 반환, 없거나 무효면 None.

    cookie 인증도 지원 (auth_token).
    """
    token = None
    if creds:
        token = creds.credentials
    else:
        token = request.cookies.get("auth_token")

    if not token:
        return None

    try:
        payload = decode_token(token)
        if payload.get("type") == "refresh":
            return None
        sub = payload.get("sub")
        if not sub:
            return None
        return str(sub)
    except Exception:
        return None


async def _ensure_table(db: AsyncSession) -> None:
    """paper_trading 테이블 자동 생성 (alembic 미사용 환경 대응)."""
    try:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS paper_trading_state (
                user_id TEXT PRIMARY KEY,
                balance DOUBLE PRECISION NOT NULL DEFAULT 1000,
                positions JSONB NOT NULL DEFAULT '[]'::jsonb,
                history JSONB NOT NULL DEFAULT '[]'::jsonb,
                pending_orders JSONB NOT NULL DEFAULT '[]'::jsonb,
                settings JSONB NOT NULL DEFAULT '{"leverage":5,"marginMode":"isolated"}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass


@router.get("/state", response_model=ApiResponse)
async def get_paper_state(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(_get_user_id_optional),
):
    """사용자 모의주문 상태 조회. 비로그인은 None 반환 (클라이언트는 localStorage 사용)."""
    if not user_id:
        return ApiResponse(data=None)

    await _ensure_table(db)

    try:
        row = (await db.execute(text("""
            SELECT balance, positions, history, pending_orders, settings
            FROM paper_trading_state WHERE user_id = :uid
        """), {"uid": user_id})).first()
    except Exception:
        return ApiResponse(data=None)

    if not row:
        # 신규 사용자 — 기본 상태
        try:
            await db.execute(text("""
                INSERT INTO paper_trading_state (user_id, balance)
                VALUES (:uid, :bal)
                ON CONFLICT DO NOTHING
            """), {"uid": user_id, "bal": INITIAL_BALANCE})
            await db.commit()
        except Exception:
            try:
                await db.rollback()
            except Exception:
                pass
        return ApiResponse(data={
            "balance": INITIAL_BALANCE,
            "positions": [],
            "history": [],
            "pendingOrders": [],
            "settings": {"leverage": 5, "marginMode": "isolated"},
        })

    return ApiResponse(data={
        "balance": float(row.balance or INITIAL_BALANCE),
        "positions": row.positions or [],
        "history": row.history or [],
        "pendingOrders": row.pending_orders or [],
        "settings": row.settings or {"leverage": 5, "marginMode": "isolated"},
    })


@router.post("/sync", response_model=ApiResponse)
async def sync_paper_state(
    request: Request,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(_get_user_id_optional),
):
    """클라이언트 → 서버 동기화. 비로그인은 무시 (클라이언트는 localStorage만 사용)."""
    if not user_id:
        return ApiResponse(data={"synced": False, "reason": "not_authenticated"})

    await _ensure_table(db)

    # 입력 검증
    try:
        balance = float(payload.get("balance", INITIAL_BALANCE))
    except (ValueError, TypeError):
        balance = INITIAL_BALANCE
    if not (-100000 < balance < 1_000_000_000):
        balance = INITIAL_BALANCE

    positions = payload.get("positions") or []
    if not isinstance(positions, list):
        positions = []
    positions = positions[:MAX_POSITIONS]

    history = payload.get("history") or []
    if not isinstance(history, list):
        history = []
    history = history[-MAX_HISTORY:]

    pending = payload.get("pendingOrders") or []
    if not isinstance(pending, list):
        pending = []
    pending = pending[:50]

    settings = payload.get("settings") or {}
    if not isinstance(settings, dict):
        settings = {}
    try:
        lev = max(1, min(125, int(settings.get("leverage", 5))))
    except (ValueError, TypeError):
        lev = 5
    mode = settings.get("marginMode", "isolated")
    if mode not in ("isolated", "cross"):
        mode = "isolated"
    settings = {"leverage": lev, "marginMode": mode}

    try:
        await db.execute(text("""
            INSERT INTO paper_trading_state (user_id, balance, positions, history, pending_orders, settings, updated_at)
            VALUES (:uid, :bal, CAST(:pos AS JSONB), CAST(:hist AS JSONB), CAST(:pend AS JSONB), CAST(:set AS JSONB), now())
            ON CONFLICT (user_id) DO UPDATE SET
                balance = EXCLUDED.balance,
                positions = EXCLUDED.positions,
                history = EXCLUDED.history,
                pending_orders = EXCLUDED.pending_orders,
                settings = EXCLUDED.settings,
                updated_at = now()
        """), {
            "uid": user_id,
            "bal": balance,
            "pos": json.dumps(positions),
            "hist": json.dumps(history),
            "pend": json.dumps(pending),
            "set": json.dumps(settings),
        })
        await db.commit()
        return ApiResponse(data={"synced": True})
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        return ApiResponse(data={"synced": False, "reason": str(e)[:100]})


@router.post("/reset", response_model=ApiResponse)
async def reset_paper_state(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(_get_user_id_optional),
):
    """모의주문 초기화 ($1,000 리셋)."""
    if not user_id:
        return ApiResponse(data={"reset": False, "reason": "not_authenticated"})

    await _ensure_table(db)

    try:
        await db.execute(text("""
            INSERT INTO paper_trading_state (user_id, balance, positions, history, pending_orders, settings, updated_at)
            VALUES (:uid, :bal, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{"leverage":5,"marginMode":"isolated"}'::jsonb, now())
            ON CONFLICT (user_id) DO UPDATE SET
                balance = EXCLUDED.balance,
                positions = '[]'::jsonb,
                history = '[]'::jsonb,
                pending_orders = '[]'::jsonb,
                updated_at = now()
        """), {"uid": user_id, "bal": INITIAL_BALANCE})
        await db.commit()
        return ApiResponse(data={"reset": True})
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        return ApiResponse(data={"reset": False, "reason": str(e)[:100]})
