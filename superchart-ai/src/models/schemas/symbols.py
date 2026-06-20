"""심볼/종목 관련 스키마."""
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel


class SymbolOut(BaseModel):
    id: UUID
    symbol_code: str
    display_name_ko: str | None
    display_name_en: str | None
    exchange_code: str | None = None
    asset_class: str
    base_asset: str
    quote_asset: str
    img_url: str | None = None
    api_code: str | None = None


__all__ = ["SymbolOut"]
