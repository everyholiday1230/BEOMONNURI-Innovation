"""User-created signal storage and selective public sharing.

Signals are private by default. Only the owner can publish, unpublish, or delete
one of their signals. Public board responses expose the creator's nickname, not
email or other account identifiers.
"""
from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services import signal_rules
from src.services.auth import get_current_user_id, get_optional_user_id

router = APIRouter(prefix="/v1/signals", tags=["SignalBoard"])

_ALLOWED_ACTIONS = {"buy", "sell", "zone"}
_ALLOWED_TIMEFRAMES = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M"}
_SYMBOL_RE = re.compile(r"^[A-Z0-9-]{2,30}$")
MAX_PUBLIC_PER_USER = 20


async def _ensure_table(db: AsyncSession) -> None:
    """Create the additive board table for environments without migrations."""
    try:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS signal_posts (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                title VARCHAR(80) NOT NULL,
                description VARCHAR(500) NOT NULL DEFAULT '',
                symbol VARCHAR(30) NOT NULL,
                timeframe VARCHAR(10) NOT NULL,
                action VARCHAR(10) NOT NULL,
                conditions JSONB NOT NULL,
                is_public BOOLEAN NOT NULL DEFAULT FALSE,
                view_count INTEGER NOT NULL DEFAULT 0,
                like_count INTEGER NOT NULL DEFAULT 0,
                favorite_count INTEGER NOT NULL DEFAULT 0,
                published_at TIMESTAMPTZ,
                deleted_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        # Existing installations may already have the first version of signal_posts.
        await db.execute(text("ALTER TABLE signal_posts ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0"))
        await db.execute(text("ALTER TABLE signal_posts ADD COLUMN IF NOT EXISTS like_count INTEGER NOT NULL DEFAULT 0"))
        await db.execute(text("ALTER TABLE signal_posts ADD COLUMN IF NOT EXISTS favorite_count INTEGER NOT NULL DEFAULT 0"))
        await db.execute(text("ALTER TABLE signal_posts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS signal_post_likes (
                signal_id BIGINT NOT NULL REFERENCES signal_posts(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (signal_id, user_id)
            )
        """))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS signal_post_favorites (
                signal_id BIGINT NOT NULL REFERENCES signal_posts(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (signal_id, user_id)
            )
        """))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS signal_post_views (
                signal_id BIGINT NOT NULL REFERENCES signal_posts(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (signal_id, user_id)
            )
        """))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_signal_posts_user_created "
            "ON signal_posts(user_id, created_at DESC)"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_signal_posts_public_published "
            "ON signal_posts(published_at DESC) WHERE is_public = TRUE"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_signal_post_likes_user "
            "ON signal_post_likes(user_id, created_at DESC)"
        ))
        await db.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_signal_post_favorites_user "
            "ON signal_post_favorites(user_id, created_at DESC)"
        ))
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass


def _validate_create_payload(payload: dict) -> dict:
    """Validate and canonicalize a signal-builder payload before persistence."""
    raw_conditions = payload.get("conditions")
    if not isinstance(raw_conditions, list) or not raw_conditions:
        raise HTTPException(400, "조건을 1개 이상 추가해주세요.")
    try:
        conditions = signal_rules.validate_conditions(raw_conditions)
    except signal_rules.RuleError as exc:
        raise HTTPException(400, f"유효한 신호 조건이 아닙니다: {exc}") from exc

    action = str(payload.get("action", "buy") or "buy").strip().lower()
    if action not in _ALLOWED_ACTIONS:
        raise HTTPException(400, "지원하지 않는 신호 종류입니다.")

    symbol = str(payload.get("symbol", "BTCUSDT") or "BTCUSDT").strip().upper()
    if not _SYMBOL_RE.fullmatch(symbol):
        raise HTTPException(400, "잘못된 종목 코드입니다.")

    timeframe = str(payload.get("timeframe", "1h") or "1h").strip()
    if timeframe not in _ALLOWED_TIMEFRAMES:
        raise HTTPException(400, "지원하지 않는 타임프레임입니다.")

    title = str(payload.get("title") or payload.get("label") or "나만의 신호").strip()[:80]
    if not title:
        title = "나만의 신호"
    description = str(payload.get("description", "") or "").strip()[:500]

    return {
        "title": title,
        "description": description,
        "symbol": symbol,
        "timeframe": timeframe,
        "action": action,
        "conditions": conditions,
    }


def _serialize_row(row) -> dict:
    data = dict(row)
    if "id" in data:
        data["id"] = int(data["id"])
    rename = {
        "is_public": "isPublic",
        "is_mine": "isMine",
        "liked_by_me": "likedByMe",
        "favorited_by_me": "favoritedByMe",
        "view_count": "viewCount",
        "like_count": "likeCount",
        "favorite_count": "favoriteCount",
        "popularity_score": "popularityScore",
        "published_at": "publishedAt",
        "created_at": "createdAt",
        "updated_at": "updatedAt",
    }
    for source, target in rename.items():
        if source in data:
            data[target] = data.pop(source)
    for key in ("isPublic", "isMine", "likedByMe", "favoritedByMe"):
        if key in data:
            data[key] = bool(data[key])
    for key in ("viewCount", "likeCount", "favoriteCount"):
        if key in data:
            data[key] = int(data[key] or 0)
    if "popularityScore" in data:
        data["popularityScore"] = float(data["popularityScore"] or 0)
    if "conditions" in data and isinstance(data["conditions"], str):
        try:
            data["conditions"] = json.loads(data["conditions"])
        except (TypeError, ValueError):
            data["conditions"] = []
    return data


def _viewer_columns() -> str:
    """Reusable SQL projection for per-viewer engagement state."""
    return """
        EXISTS (
            SELECT 1 FROM signal_post_likes l
            WHERE l.signal_id = p.id AND l.user_id = :viewer
        ) AS liked_by_me,
        EXISTS (
            SELECT 1 FROM signal_post_favorites f
            WHERE f.signal_id = p.id AND f.user_id = :viewer
        ) AS favorited_by_me
    """


def _popularity_sql() -> str:
    # Favorites represent stronger intent than likes; views have a capped influence.
    return "(p.favorite_count * 8 + p.like_count * 5 + LEAST(p.view_count, 1000) * 0.1)"


@router.post("", response_model=ApiResponse)
async def create_signal(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Save a generated signal privately. Publication always requires a second action."""
    item = _validate_create_payload(payload)
    await _ensure_table(db)
    try:
        row = (await db.execute(text("""
            INSERT INTO signal_posts
                (user_id, title, description, symbol, timeframe, action, conditions, is_public)
            VALUES
                (:uid, :title, :description, :symbol, :timeframe, :action,
                 CAST(:conditions AS JSONB), FALSE)
            RETURNING id, title, description, symbol, timeframe, action, conditions,
                      is_public, view_count, like_count, favorite_count,
                      published_at, created_at, updated_at
        """), {
            "uid": user_id,
            **{key: value for key, value in item.items() if key != "conditions"},
            "conditions": json.dumps(item["conditions"], ensure_ascii=False),
        })).mappings().first()
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(503, "신호를 저장하지 못했습니다.") from exc
    return ApiResponse(data=_serialize_row(row))


@router.get("/my", response_model=ApiResponse)
async def list_my_signals(
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """List the current user's private and public signals."""
    await _ensure_table(db)
    rows = (await db.execute(text(f"""
        SELECT p.id, p.title, p.description, p.symbol, p.timeframe, p.action,
               p.conditions, p.is_public, p.view_count, p.like_count,
               p.favorite_count, p.published_at, p.created_at, p.updated_at,
               TRUE AS is_mine,
               {_viewer_columns()}
        FROM signal_posts p
        WHERE p.user_id = :uid AND p.deleted_at IS NULL
        ORDER BY p.created_at DESC
        LIMIT :lim
    """), {"uid": user_id, "viewer": user_id, "lim": limit})).mappings().all()
    return ApiResponse(data={"items": [_serialize_row(row) for row in rows]})


@router.get("/board", response_model=ApiResponse)
async def list_public_signals(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    symbol: str = "",
    sort: str = Query("popular", pattern="^(popular|newest|likes|favorites)$"),
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """Paginated public board with server-side popularity and engagement sorting."""
    await _ensure_table(db)
    symbol = symbol.strip().upper()
    if symbol and not _SYMBOL_RE.fullmatch(symbol):
        raise HTTPException(400, "잘못된 종목 코드입니다.")
    offset = (page - 1) * page_size
    symbol_clause = "AND p.symbol = :symbol" if symbol else ""
    order_by = {
        "popular": f"{_popularity_sql()} DESC, p.published_at DESC NULLS LAST, p.id DESC",
        "newest": "p.published_at DESC NULLS LAST, p.id DESC",
        "likes": "p.like_count DESC, p.published_at DESC NULLS LAST, p.id DESC",
        "favorites": "p.favorite_count DESC, p.published_at DESC NULLS LAST, p.id DESC",
    }[sort]
    params = {"lim": page_size, "off": offset, "viewer": user_id or "", "symbol": symbol}
    total = int((await db.execute(text(f"""
        SELECT COUNT(*) FROM signal_posts p
        WHERE p.is_public = TRUE AND p.deleted_at IS NULL {symbol_clause}
    """), params)).scalar() or 0)
    rows = (await db.execute(text(f"""
        SELECT p.id, p.title, p.description, p.symbol, p.timeframe, p.action,
               p.conditions, p.is_public, p.view_count, p.like_count,
               p.favorite_count, p.published_at, p.created_at,
               COALESCE(u.nickname, '익명') AS nickname,
               (p.user_id = :viewer) AS is_mine,
               {_viewer_columns()},
               {_popularity_sql()} AS popularity_score
        FROM signal_posts p
        LEFT JOIN users u ON u.id::text = p.user_id
        WHERE p.is_public = TRUE AND p.deleted_at IS NULL {symbol_clause}
        ORDER BY {order_by}
        LIMIT :lim OFFSET :off
    """), params)).mappings().all()
    return ApiResponse(data={
        "items": [_serialize_row(row) for row in rows],
        "page": page,
        "pageSize": page_size,
        "total": total,
        "sort": sort,
        "hasNext": offset + len(rows) < total,
    })


@router.get("/favorites", response_model=ApiResponse)
async def list_favorite_signals(
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """List public signals favorited by the current user."""
    await _ensure_table(db)
    rows = (await db.execute(text(f"""
        SELECT p.id, p.title, p.description, p.symbol, p.timeframe, p.action,
               p.conditions, p.is_public, p.view_count, p.like_count,
               p.favorite_count, p.published_at, p.created_at,
               COALESCE(u.nickname, '익명') AS nickname,
               (p.user_id = :viewer) AS is_mine,
               {_viewer_columns()},
               {_popularity_sql()} AS popularity_score
        FROM signal_post_favorites own
        JOIN signal_posts p ON p.id = own.signal_id
                           AND p.is_public = TRUE
                           AND p.deleted_at IS NULL
        LEFT JOIN users u ON u.id::text = p.user_id
        WHERE own.user_id = :viewer
        ORDER BY own.created_at DESC
        LIMIT :lim
    """), {"viewer": user_id, "lim": limit})).mappings().all()
    return ApiResponse(data={"items": [_serialize_row(row) for row in rows]})


@router.get("/{signal_id}", response_model=ApiResponse)
async def get_signal_detail(
    signal_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: str | None = Depends(get_optional_user_id),
):
    """Read a public signal, or an owned private signal, including full conditions."""
    await _ensure_table(db)
    viewer = user_id or ""
    row = (await db.execute(text(f"""
        SELECT p.id, p.title, p.description, p.symbol, p.timeframe, p.action,
               p.conditions, p.is_public, p.view_count, p.like_count,
               p.favorite_count, p.published_at, p.created_at, p.updated_at,
               COALESCE(u.nickname, '익명') AS nickname,
               (p.user_id = :viewer) AS is_mine,
               {_viewer_columns()},
               {_popularity_sql()} AS popularity_score,
               p.user_id AS owner_id
        FROM signal_posts p
        LEFT JOIN users u ON u.id::text = p.user_id
        WHERE p.id = :id
          AND p.deleted_at IS NULL
          AND (p.is_public = TRUE OR p.user_id = :viewer)
    """), {"id": signal_id, "viewer": viewer})).mappings().first()
    if not row:
        raise HTTPException(404, "공개 신호를 찾을 수 없습니다.")

    item = dict(row)
    owner_id = str(item.pop("owner_id"))
    # Count one view per authenticated non-owner. Anonymous refreshes do not
    # affect popularity because they cannot be deduplicated reliably.
    if user_id and user_id != owner_id and item.get("is_public"):
        inserted = (await db.execute(text("""
            INSERT INTO signal_post_views (signal_id, user_id)
            VALUES (:id, :uid)
            ON CONFLICT DO NOTHING
            RETURNING signal_id
        """), {"id": signal_id, "uid": user_id})).scalar()
        if inserted is not None:
            await db.execute(text(
                "UPDATE signal_posts SET view_count = view_count + 1 WHERE id = :id"
            ), {"id": signal_id})
            item["view_count"] = int(item.get("view_count") or 0) + 1
        await db.commit()
    return ApiResponse(data=_serialize_row(item))


async def _toggle_engagement(
    *, signal_id: int, user_id: str, db: AsyncSession,
    table: str, count_column: str, state_key: str,
) -> dict:
    """Atomically toggle one user engagement and keep the denormalized count exact."""
    await _ensure_table(db)
    try:
        # Lock the post to serialize concurrent toggles and reject private posts.
        post = (await db.execute(text("""
            SELECT id FROM signal_posts
            WHERE id = :id AND is_public = TRUE AND deleted_at IS NULL
            FOR UPDATE
        """), {"id": signal_id})).scalar()
        if post is None:
            raise HTTPException(404, "공개 신호를 찾을 수 없습니다.")

        removed = (await db.execute(text(f"""
            DELETE FROM {table}
            WHERE signal_id = :id AND user_id = :uid
            RETURNING signal_id
        """), {"id": signal_id, "uid": user_id})).scalar()
        active = removed is None
        if active:
            await db.execute(text(f"""
                INSERT INTO {table} (signal_id, user_id)
                VALUES (:id, :uid)
                ON CONFLICT DO NOTHING
            """), {"id": signal_id, "uid": user_id})
        count = int((await db.execute(text(f"""
            SELECT COUNT(*) FROM {table} WHERE signal_id = :id
        """), {"id": signal_id})).scalar() or 0)
        await db.execute(text(f"""
            UPDATE signal_posts SET {count_column} = :count, updated_at = now()
            WHERE id = :id
        """), {"id": signal_id, "count": count})
        await db.commit()
        return {state_key: active, "count": count}
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(503, "게시판 반응을 저장하지 못했습니다.") from exc


@router.post("/{signal_id}/like", response_model=ApiResponse)
async def toggle_signal_like(
    signal_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    data = await _toggle_engagement(
        signal_id=signal_id, user_id=user_id, db=db,
        table="signal_post_likes", count_column="like_count", state_key="liked",
    )
    return ApiResponse(data=data)


@router.post("/{signal_id}/favorite", response_model=ApiResponse)
async def toggle_signal_favorite(
    signal_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    data = await _toggle_engagement(
        signal_id=signal_id, user_id=user_id, db=db,
        table="signal_post_favorites", count_column="favorite_count", state_key="favorited",
    )
    return ApiResponse(data=data)


@router.patch("/{signal_id}/visibility", response_model=ApiResponse)
async def set_signal_visibility(
    signal_id: int,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Publish or unpublish an owned signal. No other user can change it."""
    if not isinstance(payload.get("isPublic"), bool):
        raise HTTPException(400, "isPublic 값이 필요합니다.")
    make_public = payload["isPublic"]
    await _ensure_table(db)
    try:
        if make_public:
            public_count = int((await db.execute(text("""
                SELECT COUNT(*) FROM signal_posts
                WHERE user_id = :uid AND is_public = TRUE
                  AND deleted_at IS NULL AND id <> :id
            """), {"uid": user_id, "id": signal_id})).scalar() or 0)
            if public_count >= MAX_PUBLIC_PER_USER:
                raise HTTPException(409, f"공개 신호는 최대 {MAX_PUBLIC_PER_USER}개까지 유지할 수 있습니다.")

        row = (await db.execute(text("""
            UPDATE signal_posts
            SET is_public = :public,
                published_at = CASE
                    WHEN :public THEN COALESCE(published_at, now())
                    ELSE NULL
                END,
                updated_at = now()
            WHERE id = :id AND user_id = :uid AND deleted_at IS NULL
            RETURNING id, title, description, symbol, timeframe, action, conditions,
                      is_public, view_count, like_count, favorite_count,
                      published_at, created_at, updated_at
        """), {"id": signal_id, "uid": user_id, "public": make_public})).mappings().first()
        if not row:
            await db.rollback()
            raise HTTPException(404, "내 신호를 찾을 수 없습니다.")
        await db.commit()
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(503, "공개 상태를 변경하지 못했습니다.") from exc
    return ApiResponse(data=_serialize_row(row))


@router.delete("/{signal_id}", response_model=ApiResponse)
async def delete_signal(
    signal_id: int,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    """Hide an owned signal from the user and board while preserving its DB record."""
    await _ensure_table(db)
    result = await db.execute(text("""
        UPDATE signal_posts
        SET deleted_at = now(), is_public = FALSE, published_at = NULL, updated_at = now()
        WHERE id = :id AND user_id = :uid AND deleted_at IS NULL
        RETURNING id
    """), {"id": signal_id, "uid": user_id})
    deleted = result.scalar()
    if deleted is None:
        await db.rollback()
        raise HTTPException(404, "내 신호를 찾을 수 없습니다.")
    await db.commit()
    return ApiResponse(data={"deleted": True, "id": int(deleted)})
