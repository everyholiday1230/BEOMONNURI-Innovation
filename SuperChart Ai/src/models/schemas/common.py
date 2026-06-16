"""공통 API 응답 스키마."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class Meta(BaseModel):
    request_id: str | None = None
    timestamp: datetime | None = None


class ApiResponse(BaseModel, Generic[T]):
    success: bool = True
    data: T | None = None
    meta: Meta | None = None


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: dict[str, Any] | None = None


class ApiError(BaseModel):
    success: bool = False
    error: ErrorDetail
    meta: Meta | None = None


class PagedData(BaseModel, Generic[T]):
    items: list[T]
    page: int = 1
    page_size: int = 20
    total: int = 0
    has_next: bool = False


__all__ = ["Meta", "ApiResponse", "ErrorDetail", "ApiError", "PagedData"]
