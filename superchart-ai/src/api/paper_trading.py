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
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.auth import get_optional_user_id

router = APIRouter(prefix="/v1/paper", tags=["PaperTrading"])

INITIAL_BALANCE = 1000.0
MAX_HISTORY = 200  # 최근 200건만 유지
MAX_POSITIONS = 50


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
    user_id: str | None = Depends(get_optional_user_id),
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
    user_id: str | None = Depends(get_optional_user_id),
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
    user_id: str | None = Depends(get_optional_user_id),
):
    """모의주문 초기화 — 가상 잔고를 $1,000으로 되돌리고 진행 중인 포지션을 삭제한다.

    거래 기록(history)은 지우지 않는다. 대회 순위(리더보드)는 balance가 아니라
    history 안에 누적된 실현손익(pnl) 합계를 기준으로 매기므로(get_leaderboard
    참고), 잔고를 초기화해도 지금까지 거둔 순위 성과에는 영향이 없다 — 손실이
    난 사용자가 초기화로 순위 반영을 회피하는 것을 방지하면서도, '계좌 초기화'
    라는 이름 그대로 잔고/포지션은 실제로 리셋된다.
    """
    if not user_id:
        return ApiResponse(data={"reset": False, "reason": "not_authenticated"})

    await _ensure_table(db)

    try:
        await db.execute(text("""
            UPDATE paper_trading_state SET
                balance = :bal,
                positions = '[]'::jsonb,
                pending_orders = '[]'::jsonb,
                updated_at = now()
            WHERE user_id = :uid
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
# 실현손익은 history(청산 완료된 거래 배열) 안의 pnl 합계를 기준으로 계산한다.
# balance 컬럼을 직접 쓰지 않는 이유: '계좌 초기화'(/reset)는 사용자가 언제든
# 잔고/진행 포지션을 리셋할 수 있는 정상 기능인데, balance 기준으로 순위를
# 매기면 손실이 난 사용자가 초기화로 순위 페널티를 회피할 수 있어 대회
# 공정성이 깨진다. history 는 초기화 시에도 보존되므로, 잔고를 몇 번을
# 리셋해도 지금까지 거둔 실현손익 합계는 그대로 순위에 반영된다.
LEADERBOARD_MIN_TRADES = 1  # 최소 거래(청산 완료) 1건 이상만 순위 노출 — 미참여자 제외
LEADERBOARD_MAX_RESULTS = 50  # 상위 노출 인원 상한


@router.get("/leaderboard", response_model=ApiResponse)
async def get_leaderboard(
    request: Request,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """모의투자 대회 순위 — 누적 실현손익(history 기준) 상위 사용자.

    상위 최대 50명까지 노출한다. 개인정보 보호를 위해 이메일 등은 노출하지
    않고 닉네임만 표시한다.
    """
    limit = max(1, min(limit, LEADERBOARD_MAX_RESULTS))
    await _ensure_table(db)

    # history 배열 원소의 pnl 합계 + 건수를 서브쿼리로 미리 집계 후 순위 매김.
    # jsonb_array_elements 로 배열을 행으로 풀어 SUM((elem->>'pnl')::numeric).
    agg_cte = """
        WITH agg AS (
            SELECT p.user_id,
                   COALESCE(SUM((h.elem->>'pnl')::numeric), 0) AS realized_pnl,
                   COUNT(h.elem) AS trade_count
            FROM paper_trading_state p
            LEFT JOIN LATERAL jsonb_array_elements(p.history) AS h(elem) ON true
            GROUP BY p.user_id
        )
    """

    try:
        rows = (await db.execute(text(agg_cte + """
            SELECT a.user_id, u.nickname, a.realized_pnl, a.trade_count
            FROM agg a
            JOIN users u ON u.id::text = a.user_id
            WHERE a.trade_count >= :min_trades
            ORDER BY a.realized_pnl DESC
            LIMIT :lim
        """), {"min_trades": LEADERBOARD_MIN_TRADES, "lim": limit})).fetchall()
    except Exception:
        rows = []

    items = [{
        "rank": i + 1,
        "userId": str(r[0]),
        "nickname": r[1] or "익명",
        "pnl": float(r[2] or 0),
        "pnlPct": round(float(r[2] or 0) / INITIAL_BALANCE * 100, 2),
        "tradeCount": int(r[3] or 0),
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
                row = (await db.execute(text(agg_cte + """
                    , ranked AS (
                        SELECT user_id, realized_pnl, trade_count,
                               ROW_NUMBER() OVER (ORDER BY realized_pnl DESC) AS rnk
                        FROM agg
                        WHERE trade_count >= :min_trades
                    )
                    SELECT r.rnk, r.realized_pnl, r.trade_count, u.nickname
                    FROM ranked r
                    JOIN users u ON u.id::text = r.user_id
                    WHERE r.user_id = :uid
                """), {"min_trades": LEADERBOARD_MIN_TRADES, "uid": user_id})).first()
                if row:
                    my_rank = {
                        "rank": int(row[0]), "userId": user_id, "nickname": row[3] or "익명",
                        "pnl": float(row[1] or 0),
                        "pnlPct": round(float(row[1] or 0) / INITIAL_BALANCE * 100, 2),
                        "tradeCount": int(row[2] or 0), "isMe": True,
                    }
            except Exception:
                my_rank = None

    return ApiResponse(data={
        "items": items,
        "myRank": my_rank,
        "maxRank": LEADERBOARD_MAX_RESULTS,
        "initialBalance": INITIAL_BALANCE,
    })
