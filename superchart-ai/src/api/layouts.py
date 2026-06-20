"""차트 레이아웃 저장 API."""
import re as _re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.session import get_db
from src.models.tables import ChartLayout
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id
from pydantic import BaseModel, Field, field_validator

router = APIRouter()

_UUID_RE = _re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_TF_ALLOWED = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"}
_CHART_TYPES = {"candles", "line", "area", "bar"}
_THEMES = {"dark", "light"}


class LayoutCreate(BaseModel):
    # 이름: 1~50자, 영문/한글/숫자/공백/일부 특수문자만 허용 (XSS/길이폭탄 차단)
    name: str = Field(..., min_length=1, max_length=50, pattern=r"^[\w\s가-힣\-_().,]+$")
    symbol_id: str = Field(..., max_length=36)
    timeframe: str = Field("5m", max_length=10)
    chart_type: str = Field("candles", max_length=20)
    theme: str = Field("dark", max_length=20)
    layout_json: dict = {}

    @field_validator("symbol_id")
    @classmethod
    def _check_uuid(cls, v: str) -> str:
        if not _UUID_RE.match(v):
            raise ValueError("symbol_id는 UUID 형식이어야 합니다")
        return v

    @field_validator("timeframe")
    @classmethod
    def _check_tf(cls, v: str) -> str:
        if v not in _TF_ALLOWED:
            raise ValueError(f"지원하지 않는 timeframe: {v}")
        return v

    @field_validator("chart_type")
    @classmethod
    def _check_chart_type(cls, v: str) -> str:
        if v not in _CHART_TYPES:
            raise ValueError(f"지원하지 않는 chart_type: {v}")
        return v

    @field_validator("theme")
    @classmethod
    def _check_theme(cls, v: str) -> str:
        if v not in _THEMES:
            raise ValueError(f"지원하지 않는 theme: {v}")
        return v

@router.get("", response_model=ApiResponse)
async def list_layouts(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ChartLayout).where(ChartLayout.user_id == user_id).order_by(ChartLayout.updated_at.desc()))
    return ApiResponse(data={"items": [{"id": str(l.id), "name": l.name, "symbolId": str(l.symbol_id),
                                         "timeframe": l.timeframe} for l in result.scalars()]})

@router.post("", response_model=ApiResponse)
async def create_layout(req: LayoutCreate, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    layout = ChartLayout(user_id=user_id, symbol_id=req.symbol_id, name=req.name, timeframe=req.timeframe,
                         chart_type=req.chart_type, theme=req.theme, layout_json=req.layout_json)
    db.add(layout); await db.commit(); await db.refresh(layout)
    return ApiResponse(data={"id": str(layout.id), "name": layout.name})

@router.put("/{layout_id}", response_model=ApiResponse)
async def update_layout(layout_id: str, req: LayoutCreate, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    layout = await db.get(ChartLayout, layout_id)
    if not layout or str(layout.user_id) != user_id: raise HTTPException(404)
    for k, v in req.model_dump().items(): setattr(layout, k, v)
    await db.commit()
    return ApiResponse(data={"id": str(layout.id)})

@router.delete("/{layout_id}", response_model=ApiResponse)
async def delete_layout(layout_id: str, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    layout = await db.get(ChartLayout, layout_id)
    if layout and str(layout.user_id) == user_id: await db.delete(layout); await db.commit()
    return ApiResponse(data={"deleted": True})
