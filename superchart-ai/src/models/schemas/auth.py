"""인증/계정 관련 스키마."""
from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    nickname: str = Field(min_length=2, max_length=20, pattern=r"^[a-zA-Z0-9가-힣_-]+$")
    phone: str = Field(default="", max_length=20, pattern=r"^[0-9+\-]*$")
    # 추가 수집 정보(선택 입력 허용 — 비어 있어도 가입 가능)
    gender: str = Field(default="", max_length=10)          # M / F / U 등
    birthday: str = Field(default="", max_length=10)        # MM-DD
    birth_year: str = Field(default="", max_length=4, pattern=r"^[0-9]*$")   # YYYY


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int


class UserOut(BaseModel):
    id: UUID
    email: str
    nickname: str
    role: str = "user"
    tier: str = "free"
    email_verified: bool = False
    beom_allowed: bool = False
    purchased: list[str] = []


# ══════════════════════════════════════════════════════
# Profile / Account
# ══════════════════════════════════════════════════════

class UpdateProfileRequest(BaseModel):
    """프로필 수정 — 선택 필드. 값이 있을 때만 해당 필드 반영."""
    nickname: str | None = Field(default=None, min_length=2, max_length=20, pattern=r"^[a-zA-Z0-9가-힣_-]+$")
    old_password: str | None = None
    new_password: str | None = Field(default=None, min_length=8, max_length=72)


class DeleteAccountRequest(BaseModel):
    """회원 탈퇴 — 비밀번호 확인 필수."""
    password: str = Field(min_length=1)


class ForgotPasswordRequest(BaseModel):
    """비밀번호 재설정 메일 발송."""
    email: EmailStr


class ConfirmResetRequest(BaseModel):
    """비밀번호 재설정 — 토큰 + 새 비밀번호.

    필드명은 `password` 유지 (기존 reset 페이지 HTML 과 호환).
    """
    token: str = Field(min_length=10)
    password: str = Field(min_length=8, max_length=72)


class FcmTokenRequest(BaseModel):
    """FCM 푸시 토큰 저장."""
    token: str = Field(min_length=10, max_length=500)


# ══════════════════════════════════════════════════════
# Admin
# ══════════════════════════════════════════════════════

class AdminLoginRequest(BaseModel):
    key: str
    password: str = Field(min_length=1)
    email: EmailStr | None = None


class AdminUserIdRequest(BaseModel):
    """user_id 하나만 필요한 admin 명령용 공통 스키마."""
    user_id: str = Field(min_length=1)


class AdminBlockUserRequest(BaseModel):
    user_id: str = Field(min_length=1)
    block: bool = True
    reason: str = Field(default="", max_length=500)


__all__ = [
    "SignupRequest", "LoginRequest", "TokenPair", "UserOut",
    # profile/account
    "UpdateProfileRequest", "DeleteAccountRequest", "ForgotPasswordRequest",
    "ConfirmResetRequest", "FcmTokenRequest",
    # admin
    "AdminLoginRequest", "AdminUserIdRequest", "AdminBlockUserRequest",
]
