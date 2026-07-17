"""UUID 백도어 제거 검증 테스트.

확인 사항:
1. 하드코딩된 UUID가 boot-ID 검증을 우회하지 못한다.
2. 해당 UUID가 프리미엄 tier를 자동 부여받지 않는다.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from datetime import datetime, timedelta, timezone
from jose import jwt

# ──────────────────────────────────────────────────────
# 설정 — 테스트용 시크릿 주입
# ──────────────────────────────────────────────────────
TEST_SECRET = "test-secret-for-unit-tests-min-32chars!"
BACKDOOR_UUID = "8f99c39e-a043-4182-ada5-30e6e8aecc2e"


@pytest.fixture(autouse=True)
def _patch_settings(monkeypatch):
    """테스트 환경에서 jwt_secret 설정을 직접 패치."""
    monkeypatch.setenv("JWT_SECRET", TEST_SECRET)
    monkeypatch.setenv("SECRET_KEY", TEST_SECRET)
    monkeypatch.setenv("DATABASE_URL", "sqlite+aiosqlite:///test.db")
    # settings 인스턴스를 직접 패치 (모듈 로드 이후에도 반영되도록)
    from src.config import settings
    monkeypatch.setattr(settings, "jwt_secret", TEST_SECRET)


def _make_token(sub: str, bid: str = "wrong-bid", tv: int = 0) -> str:
    """테스트용 JWT 생성."""
    exp = datetime.now(timezone.utc) + timedelta(hours=1)
    payload = {"sub": sub, "tier": "free", "role": "user", "exp": exp, "tv": tv, "bid": bid}
    return jwt.encode(payload, TEST_SECRET, algorithm="HS256")


# ──────────────────────────────────────────────────────
# Test 1: boot-ID 불일치 시 백도어 UUID도 거부됨
# ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_backdoor_uuid_rejected_on_boot_id_mismatch():
    """이전에 예외 처리되던 UUID가 boot-ID 불일치로 정상 거부되는지 확인."""
    token = _make_token(BACKDOOR_UUID, bid="mismatched-boot-id")

    from fastapi.security import HTTPAuthorizationCredentials
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    with patch("src.services.auth._check_token_version", new_callable=AsyncMock, return_value=True):
        from src.services.auth import get_current_user_id
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as exc_info:
            await get_current_user_id(creds)
        assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_backdoor_uuid_rejected_on_optional_endpoint():
    """get_optional_user_id도 백도어 UUID를 우회시키지 않는다."""
    token = _make_token(BACKDOOR_UUID, bid="mismatched-boot-id")

    from fastapi.security import HTTPAuthorizationCredentials
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    with patch("src.services.auth._check_token_version", new_callable=AsyncMock, return_value=True):
        from src.services.auth import get_optional_user_id
        result = await get_optional_user_id(creds)
        assert result is None


# ──────────────────────────────────────────────────────
# Test 2: 정상 사용자는 올바른 boot-ID로 통과
# ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_valid_user_with_correct_boot_id_passes():
    """정상 boot-ID를 가진 일반 사용자는 인증 통과."""
    from src.services.auth import SERVER_BOOT_ID, get_current_user_id

    normal_user_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    token = _make_token(normal_user_id, bid=SERVER_BOOT_ID)

    from fastapi.security import HTTPAuthorizationCredentials
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)

    with patch("src.services.auth._check_token_version", new_callable=AsyncMock, return_value=True):
        result = await get_current_user_id(creds)
        assert result == normal_user_id


# ──────────────────────────────────────────────────────
# Test 3: beom_free의 get_user_tier가 백도어 UUID에 프리미엄 미부여
# ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_backdoor_uuid_no_auto_premium(monkeypatch):
    """백도어 UUID가 더 이상 자동으로 'premium' tier를 받지 않는다.

    캐시에 'free'를 주입하여 DB 접근 없이 검증.
    핵심: 이전에는 decode_token 직후 백도어 UUID면 바로 'premium'을 반환했으나,
    이제는 정상 tier 조회 경로를 타야 한다.
    """
    import time as _time
    import src.services.beom_free as _bf

    # FREE_TRIAL_MODE 비활성
    monkeypatch.delenv("FREE_TRIAL_MODE", raising=False)

    token = _make_token(BACKDOOR_UUID, bid="any")

    # 캐시에 해당 사용자를 'free'로 설정 (TTL 충분히 미래)
    _bf._TIER_CACHE[BACKDOOR_UUID] = ("free", _time.time() + 300)

    # Request 모킹
    mock_request = MagicMock()
    mock_request.headers.get = lambda key, default="": (
        f"Bearer {token}" if key == "authorization" else default
    )
    mock_request.cookies.get = lambda key, default="": default

    tier = await _bf.get_user_tier(mock_request)
    assert tier == "free", f"Expected 'free' but got '{tier}'"

    # 정리
    _bf._TIER_CACHE.pop(BACKDOOR_UUID, None)
