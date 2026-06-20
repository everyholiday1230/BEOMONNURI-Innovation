"""알림 관련 스키마."""
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class AlertCreateRequest(BaseModel):
    symbol_id: UUID
    timeframe: str | None = None
    rule_type: str
    rule_json: dict
    delivery_channel: str = "inapp"


__all__ = ["AlertCreateRequest"]
