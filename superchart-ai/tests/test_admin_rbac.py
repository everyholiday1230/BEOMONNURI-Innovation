"""관리자 위험 API 경로별 RBAC 회귀 테스트."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


def _request(path: str, method: str, role: str):
    request = MagicMock()
    request.url.path = path
    request.method = method
    request.headers.get = lambda key, default="": default
    request.cookies.get = lambda key, default="": "admin-cookie" if key == "admin_session" else default
    request.client.host = "127.0.0.1"
    return request


def test_admin_permission_map_prioritizes_sensitive_routes():
    from src.services.admin_helpers import required_admin_permission

    assert required_admin_permission("/v1/ops/metrics", "GET") == "system.read"
    assert required_admin_permission("/v1/ops/restart-server", "POST") == "system.ops"
    assert required_admin_permission("/v1/purchases/admin/payments", "GET") == "subscriptions.read"
    assert required_admin_permission("/v1/purchases/admin/refund", "POST") == "subscriptions.refund"
    assert required_admin_permission("/v1/points/admin/grant", "POST") == "points.write"
    assert required_admin_permission("/v1/referral/admin/integrity-check", "GET") == "referrals.read"
    assert required_admin_permission("/v1/site/settings", "POST") == "system.ops"


@pytest.mark.asyncio
async def test_readonly_admin_cannot_restart_server():
    from src.services.admin_helpers import auth_admin_check

    request = _request("/v1/ops/restart-server", "POST", "readonly")
    with (
        patch("src.services.admin_helpers.verify_admin_cookie_async", new_callable=AsyncMock, return_value=True),
        patch(
            "src.services.admin_helpers.resolve_admin_context",
            new_callable=AsyncMock,
            return_value={"role": "readonly", "permissions": ["system.read"]},
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await auth_admin_check(request)

    assert exc_info.value.status_code == 403
    assert "system.ops" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_ops_admin_can_restart_server():
    from src.services.admin_helpers import ADMIN_ROLE_POLICIES, auth_admin_check

    request = _request("/v1/ops/restart-server", "POST", "ops")
    with (
        patch("src.services.admin_helpers.verify_admin_cookie_async", new_callable=AsyncMock, return_value=True),
        patch(
            "src.services.admin_helpers.resolve_admin_context",
            new_callable=AsyncMock,
            return_value={"role": "ops", "permissions": ADMIN_ROLE_POLICIES["ops"]["permissions"]},
        ),
    ):
        await auth_admin_check(request)


@pytest.mark.asyncio
async def test_billing_admin_can_refund_but_readonly_cannot():
    from src.services.admin_helpers import ADMIN_ROLE_POLICIES, auth_admin_check

    request = _request("/v1/purchases/admin/refund", "POST", "billing")
    with (
        patch("src.services.admin_helpers.verify_admin_cookie_async", new_callable=AsyncMock, return_value=True),
        patch(
            "src.services.admin_helpers.resolve_admin_context",
            new_callable=AsyncMock,
            return_value={"role": "billing", "permissions": ADMIN_ROLE_POLICIES["billing"]["permissions"]},
        ),
    ):
        await auth_admin_check(request)

    with (
        patch("src.services.admin_helpers.verify_admin_cookie_async", new_callable=AsyncMock, return_value=True),
        patch(
            "src.services.admin_helpers.resolve_admin_context",
            new_callable=AsyncMock,
            return_value={"role": "readonly", "permissions": ADMIN_ROLE_POLICIES["readonly"]["permissions"]},
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await auth_admin_check(request)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_content_admin_cannot_change_system_settings():
    from src.services.admin_helpers import ADMIN_ROLE_POLICIES, auth_admin_check

    request = _request("/v1/site/settings", "POST", "content")
    with (
        patch("src.services.admin_helpers.verify_admin_cookie_async", new_callable=AsyncMock, return_value=True),
        patch(
            "src.services.admin_helpers.resolve_admin_context",
            new_callable=AsyncMock,
            return_value={"role": "content", "permissions": ADMIN_ROLE_POLICIES["content"]["permissions"]},
        ),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await auth_admin_check(request)
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_sensitive_role_lookup_failure_downgrades_to_readonly():
    """민감 경로에서 관리자 role DB 조회 실패 시 JWT role을 신뢰하지 않는다."""
    from src.services.admin_helpers import resolve_admin_context

    request = _request("/v1/ops/restart-server", "POST", "ops")
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=ConnectionError("database unavailable"))

    with patch(
        "src.services.admin_helpers.get_admin_cookie_claims",
        return_value={"adm": "ops@example.com", "role": "ops"},
    ):
        ctx = await resolve_admin_context(request, db=db, fail_closed=True)

    assert ctx["role"] == "readonly"
    assert "system.ops" not in ctx["permissions"]


@pytest.mark.asyncio
async def test_sensitive_role_lookup_uses_current_database_role():
    """JWT claim보다 DB의 현재 역할을 우선해 역할 하향을 즉시 반영한다."""
    from src.services.admin_helpers import resolve_admin_context

    request = _request("/v1/ops/restart-server", "POST", "ops")
    row_result = MagicMock()
    row_result.fetchone.return_value = ("readonly", True)
    db = AsyncMock()
    db.execute = AsyncMock(return_value=row_result)

    with patch(
        "src.services.admin_helpers.get_admin_cookie_claims",
        return_value={"adm": "ops@example.com", "role": "ops"},
    ):
        ctx = await resolve_admin_context(request, db=db, fail_closed=True)

    assert ctx["role"] == "readonly"
    assert "system.ops" not in ctx["permissions"]
