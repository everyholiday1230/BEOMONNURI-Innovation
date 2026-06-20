"""차트/캔들 관련 스키마."""
from __future__ import annotations

from pydantic import BaseModel


class CandleOut(BaseModel):
    open_time: str
    close_time: str
    open: str
    high: str
    low: str
    close: str
    volume: str
    is_final: bool


__all__ = ["CandleOut"]
