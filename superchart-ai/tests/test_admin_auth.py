"""Admin key 쿼리파라미터 제거 검증.

admin_key가 URL 쿼리스트링으로 전달되면 무시되어야 한다.
헤더(x-admin-key)로만 인증해야 한다.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


VALID_ADMIN_KEY = "a" * 32  # 최소 32자


@pytest.fixture(autouse=True)
def _set_admin_key(monkeypatch):
    monkeypatch.setenv("ADMIN_KEY", VALID_ADMIN_KEY)
    monkeypatch.setenv("TESTING", "1")
    monkeypatch.setenv("JWT_SECRET", "test-secret-for-admin-session-tests-32chars!")


def _make_request(headers: dict = None, query_params: dict = None):
    """FastAPI Request를 모킹."""
    req = MagicMock()
    _h = headers or {}
    _q = query_params or {}

    # MagicMock으로 headers/query_params를 구성
    mock_headers = MagicMock()
    mock_headers.get = lambda key, default="": _h.get(key, default)
    req.headers = mock_headers

    mock_qp = MagicMock()
    mock_qp.get = lambda key, default="": _q.get(key, default)
    req.query_params = mock_qp

    req.client = MagicMock()
    req.client.host = "127.0.0.1"
    return req


def test_admin_key_via_query_param_rejected():
    """쿼리파라미터로 올바른 admin_key를 전달해도 거부되어야 한다."""
    from src.services.admin_auth import verify_admin_key
    from fastapi import HTTPException

    request = _make_request(
        headers={},
        query_params={"admin_key": VALID_ADMIN_KEY},
    )

    with pytest.raises(HTTPException) as exc_info:
        verify_admin_key(request)
    assert exc_info.value.status_code == 403


def test_admin_key_via_header_accepted():
    """헤더로 올바른 admin_key를 전달하면 통과."""
    from src.services.admin_auth import verify_admin_key

    request = _make_request(
        headers={"x-admin-key": VALID_ADMIN_KEY},
    )

    # 예외가 발생하지 않으면 성공
    verify_admin_key(request)


def test_admin_key_wrong_header_rejected():
    """헤더로 잘못된 키를 전달하면 거부."""
    from src.services.admin_auth import verify_admin_key
    from fastapi import HTTPException

    request = _make_request(
        headers={"x-admin-key": "wrong-key-wrong-key-wrong-key-32x"},
    )

    with pytest.raises(HTTPException) as exc_info:
        verify_admin_key(request)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_admin_session_fails_closed_when_redis_unavailable(monkeypatch):
    """개발/스테이징 환경이어도 Redis 장애 시 관리자 세션은 거부한다."""
    monkeypatch.setenv("ENV", "staging")
    from src.services.admin_helpers import is_session_valid

    with patch("src.db.redis.redis_client", new_callable=AsyncMock, side_effect=ConnectionError("redis down")):
        assert await is_session_valid("unregistered-session") is False


@pytest.mark.asyncio
async def test_admin_session_fails_closed_when_redis_client_missing(monkeypatch):
    """Redis 클라이언트를 얻지 못한 경우에도 거부한다."""
    monkeypatch.setenv("ENV", "dev")
    from src.services.admin_helpers import is_session_valid

    with patch("src.db.redis.redis_client", new_callable=AsyncMock, return_value=None):
        assert await is_session_valid("session-id") is False


@pytest.mark.asyncio
async def test_admin_session_rejects_unregistered_sid():
    """Redis에 등록되지 않은 sid는 거부한다."""
    from src.services.admin_helpers import is_session_valid

    redis = AsyncMock()
    redis.exists = AsyncMock(return_value=0)
    with patch("src.db.redis.redis_client", new_callable=AsyncMock, return_value=redis):
        assert await is_session_valid("missing-session") is False


@pytest.mark.asyncio
async def test_admin_session_accepts_registered_sid():
    """Redis에 등록된 sid만 통과한다."""
    from src.services.admin_helpers import ADMIN_SESSION_PREFIX, is_session_valid

    redis = AsyncMock()
    redis.exists = AsyncMock(return_value=1)
    with patch("src.db.redis.redis_client", new_callable=AsyncMock, return_value=redis):
        assert await is_session_valid("valid-session") is True
    redis.exists.assert_awaited_once_with(f"{ADMIN_SESSION_PREFIX}valid-session")
