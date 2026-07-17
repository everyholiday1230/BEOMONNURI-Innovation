"""Alerts/Paper Trading 공통 인증 정책 회귀 테스트."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

TEST_SECRET = "test-secret-for-api-auth-policy-32chars!"
USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


@pytest.fixture(autouse=True)
def _clear_token_version_cache():
    from src.services.auth import _tv_cache

    _tv_cache.clear()
    yield
    _tv_cache.clear()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ENV", "test")
    from src.config import settings
    monkeypatch.setattr(settings, "jwt_secret", TEST_SECRET)

    from src.api.alerts import router as alerts_router
    from src.api.paper_trading import router as paper_router

    app = FastAPI()
    app.include_router(alerts_router, prefix="/v1/alerts")
    app.include_router(paper_router)
    return TestClient(app)


def _access_token(token_version: int, *, boot_id: str | None = None) -> str:
    from src.services.auth import SERVER_BOOT_ID, create_access_token

    with patch("src.services.auth.SERVER_BOOT_ID", boot_id or SERVER_BOOT_ID):
        return create_access_token(USER_ID, token_version=token_version)


def _mock_db_user(token_version: int):
    row = MagicMock()
    row.__getitem__.side_effect = lambda index: token_version
    result = MagicMock()
    result.first.return_value = row

    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    db.rollback = AsyncMock()

    async_cm = AsyncMock()
    async_cm.__aenter__ = AsyncMock(return_value=db)
    async_cm.__aexit__ = AsyncMock(return_value=False)
    return async_cm


def test_revoked_token_cannot_create_alert(client):
    old_token = _access_token(token_version=1)

    with patch("src.db.session.get_db_context", return_value=_mock_db_user(2)):
        response = client.post(
            "/v1/alerts",
            headers={"Authorization": f"Bearer {old_token}"},
            json={"symbol": "BTCUSDT", "rule_type": "PRICE_CROSS_UP", "target_price": 100},
        )

    assert response.status_code == 401


def test_boot_mismatched_token_cannot_create_alert(client):
    old_token = _access_token(token_version=1, boot_id="old-boot")

    with patch("src.db.session.get_db_context", return_value=_mock_db_user(1)):
        response = client.post(
            "/v1/alerts",
            headers={"Authorization": f"Bearer {old_token}"},
            json={"symbol": "BTCUSDT", "rule_type": "PRICE_CROSS_UP", "target_price": 100},
        )

    assert response.status_code == 401


def test_revoked_token_cannot_sync_paper_state(client):
    old_token = _access_token(token_version=3)

    with patch("src.db.session.get_db_context", return_value=_mock_db_user(4)):
        response = client.post(
            "/v1/paper/sync",
            headers={"Authorization": f"Bearer {old_token}"},
            json={"balance": 999999, "positions": [], "history": []},
        )

    assert response.status_code == 200
    assert response.json()["data"] == {"synced": False, "reason": "not_authenticated"}


def test_guest_paper_state_behavior_is_preserved(client):
    response = client.get("/v1/paper/state")

    assert response.status_code == 200
    assert response.json()["data"] is None
