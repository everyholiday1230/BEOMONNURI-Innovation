"""자동매매 API — 현재 비활성화 (차트 서비스 전용)."""
from fastapi import APIRouter

router = APIRouter()


@router.get("/all-markers/{symbol}/{tf}")
async def all_markers(symbol: str, tf: str):
    """전체 전략 마커 통합 — 현재 비활성화."""
    return {"live": []}


# ── V2/V3/V4/데모/실전 — 비활성화 (파일 보존) ──
# 필요 시 src/services/live_trader_v2.py, multi_strategies.py 등 복원
