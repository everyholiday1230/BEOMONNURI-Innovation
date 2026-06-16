"""Pydantic 스키마 패키지.

기존 src/models/schemas.py 단일 파일에서 도메인별로 분리.
하위 호환을 위해 모든 심볼을 re-export합니다.

사용 (권장):
    from src.models.schemas.auth import SignupRequest, LoginRequest
    from src.models.schemas.common import ApiResponse

사용 (하위 호환):
    from src.models.schemas import SignupRequest  # 여전히 동작
"""
# Re-export for backward compatibility
from src.models.schemas.common import (
    ApiError,
    ApiResponse,
    ErrorDetail,
    Meta,
    PagedData,
)
from src.models.schemas.auth import (
    LoginRequest,
    SignupRequest,
    TokenPair,
    UserOut,
    UpdateProfileRequest,
    DeleteAccountRequest,
    ForgotPasswordRequest,
    ConfirmResetRequest,
    FcmTokenRequest,
    AdminLoginRequest,
    AdminUserIdRequest,
    AdminBlockUserRequest,
)
from src.models.schemas.symbols import SymbolOut
from src.models.schemas.charts import CandleOut
from src.models.schemas.alerts import AlertCreateRequest
from src.models.schemas.ai import AnalysisRequest

__all__ = [
    # common
    "Meta", "ApiResponse", "ErrorDetail", "ApiError", "PagedData",
    # auth
    "SignupRequest", "LoginRequest", "TokenPair", "UserOut",
    "UpdateProfileRequest", "DeleteAccountRequest", "ForgotPasswordRequest",
    "ConfirmResetRequest", "FcmTokenRequest",
    "AdminLoginRequest", "AdminUserIdRequest", "AdminBlockUserRequest",
    # symbols
    "SymbolOut",
    # charts
    "CandleOut",
    # alerts
    "AlertCreateRequest",
    # ai
    "AnalysisRequest",
]
