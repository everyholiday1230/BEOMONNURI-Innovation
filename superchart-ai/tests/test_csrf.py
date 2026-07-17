"""CSRF cookie-absent 시 인증된 요청 거부 검증.

auth_token 쿠키가 있는데 csrf_token 쿠키가 없으면 POST/PUT/DELETE 요청을 차단해야 한다.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock


def _make_request(method: str, path: str, cookies: dict, headers: dict = None):
    """미들웨어 테스트용 Request 모킹."""
    req = MagicMock()
    req.method = method
    url = MagicMock()
    url.path = path
    req.url = url
    req.cookies = cookies
    _h = headers or {}
    mock_headers = MagicMock()
    mock_headers.get = lambda key, default="": _h.get(key, default)
    req.headers = mock_headers
    return req


@pytest.mark.asyncio
async def test_csrf_rejects_authenticated_request_without_csrf_cookie():
    """auth_token 있고 csrf_token 없는 POST → 403 CSRF_MISSING."""
    from src.middleware.csrf import _csrf_protection

    request = _make_request(
        method="POST",
        path="/v1/auth/update-profile",
        cookies={"auth_token": "some-jwt-token"},
        # csrf_token 쿠키 없음
    )

    call_next = AsyncMock(return_value=MagicMock())
    response = await _csrf_protection(request, call_next)

    assert response.status_code == 403
    assert b"CSRF_MISSING" in response.body
    call_next.assert_not_called()


@pytest.mark.asyncio
async def test_csrf_passes_unauthenticated_request_without_csrf_cookie():
    """auth_token도 csrf_token도 없는 POST → 통과 (비로그인)."""
    from src.middleware.csrf import _csrf_protection

    request = _make_request(
        method="POST",
        path="/v1/some-public-endpoint",
        cookies={},
    )

    call_next = AsyncMock(return_value=MagicMock(status_code=200))
    response = await _csrf_protection(request, call_next)

    call_next.assert_called_once()


@pytest.mark.asyncio
async def test_csrf_passes_valid_double_submit():
    """auth_token + csrf_token 쿠키 + x-csrf-token 헤더 일치 → 통과."""
    from src.middleware.csrf import _csrf_protection

    csrf_value = "random-csrf-token-value"
    request = _make_request(
        method="POST",
        path="/v1/auth/update-profile",
        cookies={"auth_token": "some-jwt-token", "csrf_token": csrf_value},
        headers={"x-csrf-token": csrf_value},
    )

    call_next = AsyncMock(return_value=MagicMock(status_code=200))
    response = await _csrf_protection(request, call_next)

    call_next.assert_called_once()


@pytest.mark.asyncio
async def test_csrf_rejects_mismatched_token():
    """csrf_token 쿠키와 x-csrf-token 헤더 불일치 → 403 CSRF_INVALID."""
    from src.middleware.csrf import _csrf_protection

    request = _make_request(
        method="POST",
        path="/v1/auth/update-profile",
        cookies={"auth_token": "jwt", "csrf_token": "correct-value"},
        headers={"x-csrf-token": "wrong-value"},
    )

    call_next = AsyncMock(return_value=MagicMock())
    response = await _csrf_protection(request, call_next)

    assert response.status_code == 403
    assert b"CSRF_INVALID" in response.body
    call_next.assert_not_called()


@pytest.mark.asyncio
async def test_csrf_exempt_paths_bypass():
    """로그인 엔드포인트는 CSRF 검증 제외."""
    from src.middleware.csrf import _csrf_protection

    request = _make_request(
        method="POST",
        path="/v1/auth/login",
        cookies={"auth_token": "some-jwt-token"},
        # csrf_token 없어도 통과해야 함
    )

    call_next = AsyncMock(return_value=MagicMock(status_code=200))
    response = await _csrf_protection(request, call_next)

    call_next.assert_called_once()


@pytest.mark.asyncio
async def test_csrf_safe_methods_bypass():
    """GET 메서드는 항상 CSRF 검증 제외."""
    from src.middleware.csrf import _csrf_protection

    request = _make_request(
        method="GET",
        path="/v1/auth/update-profile",
        cookies={"auth_token": "jwt"},
    )

    call_next = AsyncMock(return_value=MagicMock(status_code=200))
    response = await _csrf_protection(request, call_next)

    call_next.assert_called_once()
