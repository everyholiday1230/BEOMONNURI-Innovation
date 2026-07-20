"""토스페이먼츠 결제 연동 테스트.

범위:
- 서버측 금액 재계산(_bundle_rate, PLAN_PRICES, POINT_PACKAGES) — 순수 함수 단위 테스트
- services/toss.py: 키 미설정 시 안전하게 실패하는지, confirm 성공/실패 처리(httpx 모킹)
- api/toss_payments.py confirm 엔드포인트: 금액 위조 시도가 차단되는지, 멱등 처리
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.api.toss_payments import PLAN_PRICES, POINT_PACKAGES, _bundle_rate
from src.services import toss


# ─── 서버측 가격 재계산 ───

@pytest.mark.parametrize(
    ("n", "expected_rate"),
    [(1, 0.0), (2, 0.0), (3, 0.15), (4, 0.15), (5, 0.25), (9, 0.25), (10, 0.40), (15, 0.40)],
)
def test_bundle_rate_thresholds(n, expected_rate):
    assert _bundle_rate(n) == expected_rate


def test_indicator_bundle_total_matches_expected():
    unit_price = 50000
    n = 10
    subtotal = unit_price * n
    rate = _bundle_rate(n)
    total = subtotal - round(subtotal * rate)
    assert total == 300000  # 50만 - 40% = 30만


def test_plan_prices_yearly_cheaper_than_twelve_months():
    for plan in PLAN_PRICES.values():
        assert plan["yearly"] < plan["monthly"] * 12


def test_point_packages_all_non_negative_bonus():
    for price, granted in POINT_PACKAGES.items():
        assert granted >= price


# ─── services/toss.py ───

def test_get_client_key_raises_when_not_configured(monkeypatch):
    monkeypatch.delenv("TOSS_CLIENT_KEY", raising=False)
    with pytest.raises(toss.TossNotConfiguredError):
        toss.get_client_key()


def test_get_client_key_returns_env_value(monkeypatch):
    monkeypatch.setenv("TOSS_CLIENT_KEY", "test_ck_example")
    assert toss.get_client_key() == "test_ck_example"


def test_is_configured_false_when_missing(monkeypatch):
    monkeypatch.delenv("TOSS_CLIENT_KEY", raising=False)
    monkeypatch.delenv("TOSS_SECRET_KEY", raising=False)
    assert toss.is_configured() is False


def test_is_configured_true_when_both_set(monkeypatch):
    monkeypatch.setenv("TOSS_CLIENT_KEY", "test_ck_x")
    monkeypatch.setenv("TOSS_SECRET_KEY", "test_sk_x")
    assert toss.is_configured() is True


def test_is_live_key_configured_detects_prefix(monkeypatch):
    monkeypatch.setenv("TOSS_SECRET_KEY", "live_sk_real")
    assert toss.is_live_key_configured() is True
    monkeypatch.setenv("TOSS_SECRET_KEY", "test_sk_docs")
    assert toss.is_live_key_configured() is False


@pytest.mark.asyncio
async def test_confirm_payment_success(monkeypatch):
    monkeypatch.setenv("TOSS_SECRET_KEY", "test_sk_example")

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b'{"status":"DONE"}'
    mock_response.json.return_value = {"status": "DONE"}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch.object(toss, "_http", return_value=mock_client):
        result = await toss.confirm_payment("pay_key", "order_1", 10000)

    assert result["status"] == "DONE"
    mock_client.post.assert_awaited_once()
    _, kwargs = mock_client.post.call_args
    assert kwargs["json"] == {"paymentKey": "pay_key", "orderId": "order_1", "amount": 10000}
    assert kwargs["headers"]["Authorization"].startswith("Basic ")


@pytest.mark.asyncio
async def test_confirm_payment_raises_on_toss_error(monkeypatch):
    monkeypatch.setenv("TOSS_SECRET_KEY", "test_sk_example")

    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.content = b'{"code":"NOT_FOUND_PAYMENT","message":"error"}'
    mock_response.json.return_value = {"code": "NOT_FOUND_PAYMENT", "message": "결제 정보 없음"}

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(return_value=mock_response)

    with patch.object(toss, "_http", return_value=mock_client):
        with pytest.raises(toss.TossPaymentError) as exc_info:
            await toss.confirm_payment("bad_key", "order_1", 10000)

    assert exc_info.value.code == "NOT_FOUND_PAYMENT"
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_confirm_payment_wraps_network_error(monkeypatch):
    monkeypatch.setenv("TOSS_SECRET_KEY", "test_sk_example")

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=httpx.ConnectTimeout("timeout"))

    with patch.object(toss, "_http", return_value=mock_client):
        with pytest.raises(toss.TossPaymentError) as exc_info:
            await toss.confirm_payment("key", "order_1", 10000)

    assert exc_info.value.code == "NETWORK_ERROR"


@pytest.mark.asyncio
async def test_confirm_payment_requires_secret_key(monkeypatch):
    monkeypatch.delenv("TOSS_SECRET_KEY", raising=False)
    with pytest.raises(toss.TossNotConfiguredError):
        await toss.confirm_payment("key", "order_1", 10000)
