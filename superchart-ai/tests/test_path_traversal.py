"""Path traversal 차단 검증 — charts_indicators.py ind-beomauto2 엔드포인트."""
import pytest
from unittest.mock import patch, AsyncMock


@pytest.fixture
def client():
    """ASGI TestClient 생성."""
    import os
    os.environ.setdefault("ENV", "test")
    os.environ.setdefault("JWT_SECRET", "test-secret-for-unit-tests-min-32chars!")

    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from src.api.charts_indicators import router
    from src.models.schemas import ApiResponse

    app = FastAPI()
    app.include_router(router, prefix="/v1/charts")
    return TestClient(app)


def test_path_traversal_in_symbol_rejected(client):
    """symbolId에 경로 탐색 문자가 포함되면 빈 이벤트 반환."""
    resp = client.get("/v1/charts/ind-beomauto2", params={
        "symbolId": "../../etc/passwd",
        "timeframe": "5m",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["data"]["events"] == []


def test_path_traversal_in_timeframe_rejected(client):
    """timeframe에 비정상 값이 있으면 빈 이벤트 반환."""
    resp = client.get("/v1/charts/ind-beomauto2", params={
        "symbolId": "BTCUSDT",
        "timeframe": "../../../etc/passwd",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["data"]["events"] == []


def test_valid_symbol_and_timeframe_accepted(client):
    """정상 심볼+타임프레임은 에러 없이 처리 (파일 없으면 빈 이벤트)."""
    resp = client.get("/v1/charts/ind-beomauto2", params={
        "symbolId": "BTCUSDT",
        "timeframe": "5m",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "events" in data["data"]


def test_null_bytes_in_symbol_rejected(client):
    """Null 바이트 주입 시도도 차단."""
    resp = client.get("/v1/charts/ind-beomauto2", params={
        "symbolId": "BTC\x00USDT",
        "timeframe": "5m",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["data"]["events"] == []


def test_dotdot_slash_symbol_rejected(client):
    """다양한 traversal 패턴 차단."""
    payloads = [
        "../secret",
        "..%2f..%2fetc",
        "BTCUSDT/../../etc",
        "..",
    ]
    for payload in payloads:
        resp = client.get("/v1/charts/ind-beomauto2", params={
            "symbolId": payload,
            "timeframe": "5m",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["data"]["events"] == [], f"Failed for symbolId={payload!r}"
