"""데모매매 거래 내역 API."""
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.session import get_db
from src.models.tables import DemoTrade
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id

router = APIRouter()


@router.post("/trades", response_model=ApiResponse)
async def save_trade(req: dict, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """데모매매 거래 저장."""
    trade = DemoTrade(
        user_id=user_id, symbol=req.get("symbol", ""), side=req.get("side", ""),
        entry_price=req.get("entry_price", 0), exit_price=req.get("exit_price"),
        size=req.get("size", 0), pnl=req.get("pnl"), pnl_pct=req.get("pnl_pct"),
        status=req.get("status", "closed"),
    )
    if req.get("exit_price"):
        from datetime import datetime, timezone
        trade.closed_at = datetime.now(timezone.utc)
    db.add(trade)
    await db.commit()
    return ApiResponse(data={"id": str(trade.id)})


@router.get("/trades", response_model=ApiResponse)
async def get_trades(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """데모매매 거래 내역 조회 (최근 50건)."""
    rows = (await db.execute(
        select(DemoTrade).where(DemoTrade.user_id == user_id).order_by(DemoTrade.opened_at.desc()).limit(50)
    )).scalars().all()
    return ApiResponse(data={"trades": [
        {"id": str(t.id), "symbol": t.symbol, "side": t.side,
         "entry_price": float(t.entry_price), "exit_price": float(t.exit_price) if t.exit_price else None,
         "size": float(t.size), "pnl": float(t.pnl) if t.pnl else None,
         "pnl_pct": float(t.pnl_pct) if t.pnl_pct else None,
         "status": t.status, "opened_at": str(t.opened_at), "closed_at": str(t.closed_at) if t.closed_at else None}
        for t in rows
    ]})


@router.get("/summary", response_model=ApiResponse)
async def get_summary(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """데모매매 요약 (총 손익, 승률)."""
    rows = (await db.execute(select(DemoTrade).where(DemoTrade.user_id == user_id, DemoTrade.status == "closed"))).scalars().all()
    if not rows:
        return ApiResponse(data={"total_trades": 0, "total_pnl": 0, "win_rate": 0})
    wins = sum(1 for t in rows if t.pnl and float(t.pnl) > 0)
    total_pnl = sum(float(t.pnl or 0) for t in rows)
    return ApiResponse(data={
        "total_trades": len(rows), "wins": wins, "losses": len(rows) - wins,
        "win_rate": round(wins / len(rows) * 100, 1), "total_pnl": round(total_pnl, 2)
    })
