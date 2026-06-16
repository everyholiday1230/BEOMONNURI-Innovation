"""AI 분석 관련 스키마."""
from __future__ import annotations

from pydantic import BaseModel


class AnalysisRequest(BaseModel):
    symbol_id: str
    timeframe: str = "15m"
    include_indicators: list[str] = []
    context: dict = {}
    lang: str = "ko"


__all__ = ["AnalysisRequest"]
