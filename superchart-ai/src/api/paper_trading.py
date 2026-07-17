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
import math
import re
import time

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

_SYMBOL_RE = re.compile(r"^[A-Z0-9-]{2,30}$")
_ALLOWED_DIRECTIONS = {"long", "short"}
_ALLOWED_CLOSE_STATUSES = {"target", "stop", "manual", "expired"}
_MAX_TRADE_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000
_MAX_PRICE_MOVE_RATIO = 100.0
_MAX_NOTIONAL = 100_000_000.0
_PNL_TOLERANCE_ABS = 0.05
_PNL_TOLERANCE_RATIO = 0.01


def _finite_number(value, *, positive: bool = False) -> float | None:
    """Return a finite float while rejecting booleans and invalid numeric input."""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or (positive and number <= 0):
        return None
    return number


def _validate_trade_record(record: object, *, now_ms: int | None = None) -> dict | None:
    """Validate one closed trade and recompute its realized PnL server-side.

    The client-provided ``pnl`` is never used as the leaderboard score. A small
    tolerance comparison is retained as a tamper/corruption check so records
    with contradictory values do not silently enter the ranking.
    """
    if not isinstance(record, dict):
        return None
    trade_id = str(record.get("id", "")).strip()[:100]
    symbol = str(record.get("sym", "")).strip().upper()
    direction = str(record.get("direction", "")).strip().lower()
    status = str(record.get("status", "manual")).strip().lower()
    if not trade_id or not _SYMBOL_RE.fullmatch(symbol):
        return None
    if direction not in _ALLOWED_DIRECTIONS or status not in _ALLOWED_CLOSE_STATUSES:
        return None

    entry = _finite_number(record.get("entry"), positive=True)
    exit_price = _finite_number(record.get("exit"), positive=True)
    qty = _finite_number(record.get("qty"), positive=True)
    margin = _finite_number(record.get("margin"), positive=True)
    leverage = _finite_number(record.get("leverage", 1), positive=True)
    created_at = _finite_number(record.get("createdAt"), positive=True)
    closed_at = _finite_number(record.get("closedAt"), positive=True)
    if None in (entry, exit_price, qty, margin, leverage, created_at, closed_at):
        return None
    if closed_at < created_at or closed_at - created_at > _MAX_TRADE_AGE_MS:
        return None
    clock = now_ms if now_ms is not None else int(time.time() * 1000)
    if closed_at > clock + 5 * 60 * 1000:
        return None
    if leverage > 125 or entry * qty > _MAX_NOTIONAL:
        return None
    move_ratio = max(entry, exit_price) / min(entry, exit_price)
    if move_ratio > _MAX_PRICE_MOVE_RATIO:
        return None

    direction_sign = 1.0 if direction == "long" else -1.0
    computed_pnl = (exit_price - entry) * qty * direction_sign
    supplied_pnl = _finite_number(record.get("pnl"))
    if supplied_pnl is None:
        return None
    tolerance = max(_PNL_TOLERANCE_ABS, abs(computed_pnl) * _PNL_TOLERANCE_RATIO)
    if abs(supplied_pnl - computed_pnl) > tolerance:
        return None

    normalized = dict(record)
    normalized.update({
        "id": trade_id,
        "sym": symbol,
        "direction": direction,
        "entry": entry,
        "exit": exit_price,
        "qty": qty,
        "margin": margin,
        "leverage": leverage,
        "status": status,
        "createdAt": int(created_at),
        "closedAt": int(closed_at),
        "holdMs": max(0, int(closed_at - created_at)),
        "pnl": round(computed_pnl, 8),
        "pct": round(((exit_price - entry) / entry) * 100 * direction_sign, 8),
        "serverVerified": True,
    })
    return normalized


def _validated_history(history: object, *, now_ms: int | None = None) -> list[dict]:
    """Return valid unique records, preserving the latest bounded history order."""
    if not isinstance(history, list):
        return []
    valid: list[dict] = []
    seen_ids: set[str] = set()
    for record in history[-MAX_HISTORY:]:
        normalized = _validate_trade_record(record, now_ms=now_ms)
        if not normalized or normalized["id"] in seen_ids:
            continue
        seen_ids.add(normalized["id"])
        valid.append(normalized)
    return valid


def _leaderboard_stats(history: object) -> dict:
    """Compute leaderboard metrics exclusively from server-validated records."""
    trades = _validated_history(history)
    pnl = sum(float(trade["pnl"]) for trade in trades)
    wins = sum(1 for trade in trades if float(trade["pnl"]) > 0)
    return {
        "pnl": round(pnl, 8),
        "tradeCount": len(trades),
        "winCount": wins,
        "winRate": round((wins / len(trades) * 100), 2) if trades else 0.0,
    }


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
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS paper_trade_records (
                user_id TEXT NOT NULL,
                trade_id VARCHAR(100) NOT NULL,
                symbol VARCHAR(30) NOT NULL,
                direction VARCHAR(10) NOT NULL,
                entry_price DOUBLE PRECISION NOT NULL,
                exit_price DOUBLE PRECISION NOT NULL,
                quantity DOUBLE PRECISION NOT NULL,
                margin DOUBLE PRECISION NOT NULL,
                leverage DOUBLE PRECISION NOT NULL,
                status VARCHAR(20) NOT NULL,
                realized_pnl DOUBLE PRECISION NOT NULL,
                pnl_pct DOUBLE PRECISION NOT NULL,
                opened_at TIMESTAMPTZ NOT NULL,
                closed_at TIMESTAMPTZ NOT NULL,
                trade_json JSONB NOT NULL,
                recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (user_id, trade_id)
            )
        """))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_paper_trade_records_rank "
            "ON paper_trade_records(user_id, closed_at DESC)"
        ))
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass


async def _append_trade_records(db: AsyncSession, user_id: str, history: object) -> int:
    """Append verified closed trades to the immutable leaderboard ledger.

    Existing ``(user_id, trade_id)`` rows are never updated. This makes the
    first verified version authoritative and prevents later client edits or
    deletes from rewriting leaderboard history.
    """
    inserted = 0
    for trade in _validated_history(history):
        result = await db.execute(text("""
            INSERT INTO paper_trade_records
                (user_id, trade_id, symbol, direction, entry_price, exit_price,
                 quantity, margin, leverage, status, realized_pnl, pnl_pct,
                 opened_at, closed_at, trade_json)
            VALUES
                (:uid, :trade_id, :symbol, :direction, :entry, :exit, :qty,
                 :margin, :leverage, :status, :pnl, :pct,
                 to_timestamp(:opened_ms / 1000.0),
                 to_timestamp(:closed_ms / 1000.0), CAST(:trade_json AS JSONB))
            ON CONFLICT (user_id, trade_id) DO NOTHING
            RETURNING trade_id
        """), {
            "uid": user_id,
            "trade_id": trade["id"],
            "symbol": trade["sym"],
            "direction": trade["direction"],
            "entry": trade["entry"],
            "exit": trade["exit"],
            "qty": trade["qty"],
            "margin": trade["margin"],
            "leverage": trade["leverage"],
            "status": trade["status"],
            "pnl": trade["pnl"],
            "pct": trade["pct"],
            "opened_ms": trade["createdAt"],
            "closed_ms": trade["closedAt"],
            "trade_json": json.dumps(trade, ensure_ascii=False),
        })
        if result.scalar() is not None:
            inserted += 1
    return inserted


async def _backfill_trade_records(db: AsyncSession) -> int:
    """One-way backfill of valid legacy state histories into the ledger."""
    rows = (await db.execute(text("""
        SELECT user_id, history FROM paper_trading_state
        WHERE jsonb_array_length(history) > 0
    """))).fetchall()
    inserted = 0
    for row in rows:
        inserted += await _append_trade_records(db, str(row[0]), row[1] or [])
    if inserted:
        await db.commit()
    return inserted


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

    history = _validated_history(payload.get("history") or [])

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
        ledger_inserted = await _append_trade_records(db, user_id, history)
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
        return ApiResponse(data={
            "synced": True,
            "verifiedTrades": len(history),
            "ledgerInserted": ledger_inserted,
        })
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

    try:
        # One-way migration of valid legacy JSON histories. Existing ledger rows
        # are immutable because the append helper uses ON CONFLICT DO NOTHING.
        await _backfill_trade_records(db)
        rows = (await db.execute(text("""
            WITH agg AS (
                SELECT r.user_id,
                       SUM(r.realized_pnl) AS realized_pnl,
                       COUNT(*) AS trade_count,
                       COUNT(*) FILTER (WHERE r.realized_pnl > 0) AS win_count
                FROM paper_trade_records r
                GROUP BY r.user_id
            ), ranked AS (
                SELECT a.*,
                       ROW_NUMBER() OVER (
                           ORDER BY a.realized_pnl DESC, a.win_count DESC,
                                    a.trade_count DESC, a.user_id
                       ) AS rank
                FROM agg a
                WHERE a.trade_count >= :min_trades
            )
            SELECT r.rank, r.user_id, u.nickname, r.realized_pnl,
                   r.trade_count, r.win_count
            FROM ranked r
            JOIN users u ON u.id::text = r.user_id
            ORDER BY r.rank
            LIMIT :lim
        """), {"min_trades": LEADERBOARD_MIN_TRADES, "lim": limit})).fetchall()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        rows = []

    def make_item(row, *, mine: bool) -> dict:
        pnl = float(row[3] or 0)
        trades = int(row[4] or 0)
        wins = int(row[5] or 0)
        return {
            "rank": int(row[0]),
            "userId": str(row[1]),
            "nickname": row[2] or "익명",
            "pnl": round(pnl, 8),
            "pnlPct": round(pnl / INITIAL_BALANCE * 100, 2),
            "tradeCount": trades,
            "winCount": wins,
            "winRate": round(wins / trades * 100, 2) if trades else 0.0,
            "serverVerified": True,
            "isMe": mine,
        }

    items = [make_item(row, mine=(user_id is not None and str(row[1]) == user_id)) for row in rows]

    my_rank = next((item for item in items if item["isMe"]), None)
    if user_id and my_rank is None:
        try:
            row = (await db.execute(text("""
                WITH agg AS (
                    SELECT r.user_id,
                           SUM(r.realized_pnl) AS realized_pnl,
                           COUNT(*) AS trade_count,
                           COUNT(*) FILTER (WHERE r.realized_pnl > 0) AS win_count
                    FROM paper_trade_records r
                    GROUP BY r.user_id
                ), ranked AS (
                    SELECT a.*,
                           ROW_NUMBER() OVER (
                               ORDER BY a.realized_pnl DESC, a.win_count DESC,
                                        a.trade_count DESC, a.user_id
                           ) AS rank
                    FROM agg a
                    WHERE a.trade_count >= :min_trades
                )
                SELECT r.rank, r.user_id, u.nickname, r.realized_pnl,
                       r.trade_count, r.win_count
                FROM ranked r
                JOIN users u ON u.id::text = r.user_id
                WHERE r.user_id = :uid
            """), {"min_trades": LEADERBOARD_MIN_TRADES, "uid": user_id})).first()
            if row:
                my_rank = make_item(row, mine=True)
        except Exception:
            try:
                await db.rollback()
            except Exception:
                pass

    return ApiResponse(data={
        "items": items,
        "myRank": my_rank,
        "maxRank": LEADERBOARD_MAX_RESULTS,
        "initialBalance": INITIAL_BALANCE,
        "rankingBasis": "server_verified_realized_pnl",
    })
