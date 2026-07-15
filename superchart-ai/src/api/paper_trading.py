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


# ─── 대회 순위(리더보드) ───
# 실현손익(balance - INITIAL_BALANCE) 기준. 미실현 포지션 평가손익은 실시간 가격이
# 필요해 서버에서 매 조회마다 계산하기엔 부담이 크므로, "확정된 성과" 기준으로
# 순위를 매긴다(대회 취지상 실현 성과 기준이 일관되고 공정함).
LEADERBOARD_MIN_TRADES = 1  # 최소 거래(청산 완료) 1건 이상만 순위 노출 — 미참여자 제외


@router.get("/leaderboard", response_model=ApiResponse)
async def get_leaderboard(
    request: Request,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(_get_user_id_optional),
):
    """모의투자 대회 순위 — 실현손익(수익률) 기준 상위 사용자.

    개인정보 보호: 이메일 등 민감정보 없이 닉네임만 노출.
    """
    limit = max(1, min(limit, 100))
    await _ensure_table(db)

    try:
        rows = (await db.execute(text("""
            SELECT p.user_id, u.nickname,
                   p.balance,
                   (p.balance - :init) AS pnl,
                   ((p.balance - :init) / :init * 100) AS pnl_pct,
                   jsonb_array_length(p.history) AS trade_count
            FROM paper_trading_state p
            JOIN users u ON u.id::text = p.user_id
            WHERE jsonb_array_length(p.history) >= :min_trades
            ORDER BY pnl DESC
            LIMIT :lim
        """), {"init": INITIAL_BALANCE, "min_trades": LEADERBOARD_MIN_TRADES, "lim": limit})).fetchall()
    except Exception:
        rows = []

    items = [{
        "rank": i + 1,
        "userId": str(r[0]),
        "nickname": r[1] or "익명",
        "balance": float(r[2] or 0),
        "pnl": float(r[3] or 0),
        "pnlPct": round(float(r[4] or 0), 2),
        "tradeCount": int(r[5] or 0),
        "isMe": (user_id is not None and str(r[0]) == user_id),
    } for i, r in enumerate(rows)]

    my_rank = None
    if user_id:
        found = next((it for it in items if it["isMe"]), None)
        if found:
            my_rank = found
        else:
            # 상위 목록에 없으면 별도로 내 순위 계산
            try:
                row = (await db.execute(text("""
                    WITH ranked AS (
                        SELECT user_id, balance,
                               (balance - :init) AS pnl,
                               ROW_NUMBER() OVER (ORDER BY (balance - :init) DESC) AS rnk
                        FROM paper_trading_state
                        WHERE jsonb_array_length(history) >= :min_trades
                    )
                    SELECT r.rnk, r.balance, r.pnl, u.nickname,
                           jsonb_array_length(p.history) AS trade_count
                    FROM ranked r
                    JOIN users u ON u.id::text = r.user_id
                    JOIN paper_trading_state p ON p.user_id = r.user_id
                    WHERE r.user_id = :uid
                """), {"init": INITIAL_BALANCE, "min_trades": LEADERBOARD_MIN_TRADES, "uid": user_id})).first()
                if row:
                    my_rank = {
                        "rank": int(row[0]), "userId": user_id, "nickname": row[3] or "익명",
                        "balance": float(row[1] or 0), "pnl": float(row[2] or 0),
                        "pnlPct": round(float(row[2] or 0) / INITIAL_BALANCE * 100, 2),
                        "tradeCount": int(row[4] or 0), "isMe": True,
                    }
            except Exception:
                my_rank = None

    return ApiResponse(data={
        "items": items,
        "myRank": my_rank,
        "totalParticipants": len(items) if len(items) < limit else None,
        "initialBalance": INITIAL_BALANCE,
    })
