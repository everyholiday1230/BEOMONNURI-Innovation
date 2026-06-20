"""관심종목 API."""
import re as _re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.session import get_db
from src.models.tables import Watchlist, WatchlistItem
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id

router = APIRouter()

_UUID_RE = _re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_NAME_RE = _re.compile(r"^[\w\s가-힣\-_().,]{1,50}$")


def _validate_uuid(value: str, field_name: str = "id") -> str:
    if not value or not _UUID_RE.match(value):
        raise HTTPException(400, f"잘못된 {field_name} 형식 (UUID 필요)")
    return value


def _validate_name(value: str) -> str:
    if not value or not _NAME_RE.match(value):
        raise HTTPException(400, "이름은 1~50자, 한글/영문/숫자/공백/일부 특수문자만 허용")
    return value


@router.get("", response_model=ApiResponse)
async def list_watchlists(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Watchlist).where(Watchlist.user_id == user_id))
    return ApiResponse(data={"items": [{"id": str(w.id), "name": w.name, "isDefault": w.is_default} for w in result.scalars()]})

@router.post("", response_model=ApiResponse)
async def create_watchlist(name: str = "관심종목", user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    name = _validate_name(name)
    wl = Watchlist(user_id=user_id, name=name)
    db.add(wl); await db.commit(); await db.refresh(wl)
    return ApiResponse(data={"id": str(wl.id), "name": wl.name})

@router.post("/{watchlist_id}/items", response_model=ApiResponse)
async def add_item(watchlist_id: str, symbol_id: str, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    _validate_uuid(watchlist_id, "watchlist_id")
    _validate_uuid(symbol_id, "symbol_id")
    wl = await db.get(Watchlist, watchlist_id)
    if not wl or str(wl.user_id) != user_id:
        raise HTTPException(403, "Not your watchlist")
    item = WatchlistItem(watchlist_id=watchlist_id, symbol_id=symbol_id)
    db.add(item); await db.commit()
    return ApiResponse(data={"id": str(item.id)})

@router.delete("/{watchlist_id}/items/{item_id}", response_model=ApiResponse)
async def remove_item(watchlist_id: str, item_id: str, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    _validate_uuid(watchlist_id, "watchlist_id")
    _validate_uuid(item_id, "item_id")
    wl = await db.get(Watchlist, watchlist_id)
    if not wl or str(wl.user_id) != user_id:
        raise HTTPException(403, "Not your watchlist")
    item = await db.get(WatchlistItem, item_id)
    if item and str(item.watchlist_id) == watchlist_id:
        await db.delete(item); await db.commit()
    return ApiResponse(data={"deleted": True})
