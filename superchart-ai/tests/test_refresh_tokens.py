"""Refresh token의 token_version 연동 회귀 테스트."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from jose import jwt

TEST_SECRET = "test-secret-for-refresh-token-tests-32chars!"
USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture(autouse=True)
def _patch_settings(monkeypatch):
    monkeypatch.setenv("ENV", "test")
    from src.config import settings
    monkeypatch.setattr(settings, "jwt_secret", TEST_SECRET)


def _request_with_refresh(token: str):
    request = MagicMock()
    request.cookies.get = lambda key, default=None: token if key == "refresh_token" else default
    return request


def _db_with_user(token_version: int):
    user = SimpleNamespace(
        id=USER_ID,
        is_active=True,
        token_version=token_version,
        tier="free",
        role="user",
        created_at=datetime.now(timezone.utc),
        referral_verified_at=None,
        referral_exchange=None,
    )
    result = MagicMock()
    result.scalar_one_or_none.return_value = user
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    return db, user


def _legacy_refresh_token() -> str:
    return jwt.encode(
        {
            "sub": USER_ID,
            "type": "refresh",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        TEST_SECRET,
        algorithm="HS256",
    )


def test_create_refresh_token_contains_token_version():
    from src.services.auth import create_refresh_token, decode_token

    payload = decode_token(create_refresh_token(USER_ID, token_version=7))
    assert payload["sub"] == USER_ID
    assert payload["type"] == "refresh"
    assert payload["tv"] == 7


@pytest.mark.asyncio
async def test_refresh_rejects_legacy_token_without_token_version():
    from src.api.auth import refresh_token

    db, _ = _db_with_user(token_version=0)
    with pytest.raises(HTTPException) as exc_info:
        await refresh_token(_request_with_refresh(_legacy_refresh_token()), db)

    assert exc_info.value.status_code == 401
    assert "유효하지 않은 refresh" in str(exc_info.value.detail)
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_refresh_rejects_revoked_token_version():
    from src.api.auth import refresh_token
    from src.services.auth import create_refresh_token

    old_refresh = create_refresh_token(USER_ID, token_version=3)
    db, _ = _db_with_user(token_version=4)

    with pytest.raises(HTTPException) as exc_info:
        await refresh_token(_request_with_refresh(old_refresh), db)

    assert exc_info.value.status_code == 401
    assert "폐기된 refresh" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_refresh_rotates_tokens_with_current_token_version():
    from src.api.auth import refresh_token
    from src.services.auth import create_refresh_token, decode_token

    current_refresh = create_refresh_token(USER_ID, token_version=5)
    db, _ = _db_with_user(token_version=5)

    with patch("src.api.auth._set_auth_cookies") as set_cookies:
        response = await refresh_token(_request_with_refresh(current_refresh), db)

    assert response.status_code == 200
    set_cookies.assert_called_once()
    _, access_token, rotated_refresh, _ = set_cookies.call_args.args
    assert decode_token(access_token)["tv"] == 5
    rotated_payload = decode_token(rotated_refresh)
    assert rotated_payload["type"] == "refresh"
    assert rotated_payload["tv"] == 5
