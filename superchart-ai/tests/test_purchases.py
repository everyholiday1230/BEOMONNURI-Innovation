import hashlib
import hmac

import pytest
from starlette.requests import Request

from src.api.purchases import (
    _normalize_payment_status,
    _payment_lookup_mode,
    _resolve_payment_transition,
    _verify_webhook_signature,
)


@pytest.mark.parametrize(
    ("current", "incoming", "expected"),
    [
        ("pending", "paid", ("paid", True, "applied")),
        ("failed", "paid", ("paid", True, "applied")),
        ("canceled", "paid", ("paid", True, "applied")),
        ("pending", "failed", ("failed", True, "applied")),
        ("pending", "cancelled", ("canceled", True, "applied")),
        ("paid", "failed", ("paid", False, "paid_is_terminal")),
        ("paid", "canceled", ("paid", False, "paid_is_terminal")),
        ("paid", "paid", ("paid", False, "duplicate_status")),
        ("refunded", "paid", ("refunded", False, "refunded_is_terminal")),
        ("refunded", "failed", ("refunded", False, "refunded_is_terminal")),
        ("failed", "pending", ("failed", False, "terminal_failure")),
        ("canceled", "failed", ("canceled", False, "terminal_failure")),
    ],
)
def test_payment_transition_is_monotonic(current, incoming, expected):
    assert _resolve_payment_transition(current, incoming) == expected


def test_payment_status_normalizes_provider_spelling():
    assert _normalize_payment_status(" CANCELLED ") == "canceled"
    assert _normalize_payment_status(None) == ""


def test_order_id_never_falls_back_to_payload_identity():
    assert _payment_lookup_mode("ord_missing", "user-1", "indicator-1") == "order_id"
    assert _payment_lookup_mode("", "user-1", "indicator-1") == "identity"
    assert _payment_lookup_mode("", "user-1", "") is None


def _request_with_signature(signature: str = "") -> Request:
    headers = []
    if signature:
        headers.append((b"x-payment-signature", signature.encode("ascii")))
    return Request({"type": "http", "method": "POST", "path": "/", "headers": headers})


def test_webhook_signature_uses_raw_body(monkeypatch):
    secret = "test-webhook-secret"
    raw = b'{"event_id":"evt-1","status":"paid"}'
    signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    monkeypatch.setenv("PAYMENT_WEBHOOK_SECRET", secret)

    assert _verify_webhook_signature(raw, _request_with_signature(signature)) is True
    assert _verify_webhook_signature(raw + b" ", _request_with_signature(signature)) is False


def test_webhook_signature_rejects_missing_configuration(monkeypatch):
    monkeypatch.delenv("PAYMENT_WEBHOOK_SECRET", raising=False)
    assert _verify_webhook_signature(b"{}", _request_with_signature("not-valid")) is False


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"payload_user_id": "other-user"}, "user_id_mismatch"),
        ({"payload_indicator_code": "other-indicator"}, "indicator_code_mismatch"),
        ({"payload_amount": 9000}, "amount_mismatch"),
        ({"payload_currency": "USD"}, "currency_mismatch"),
    ],
)
def test_payment_order_mismatch_rejects_conflicting_payload(overrides, expected):
    from src.api.purchases import _payment_order_mismatch

    values = {
        "order_user_id": "user-1",
        "order_indicator_code": "indicator-1",
        "order_amount": 10000,
        "order_currency": "KRW",
        "payload_user_id": "user-1",
        "payload_indicator_code": "indicator-1",
        "payload_amount": 10000,
        "payload_currency": "KRW",
        "amount_provided": True,
        "currency_provided": True,
    }
    values.update(overrides)
    assert _payment_order_mismatch(**values) == expected


def test_payment_order_mismatch_allows_omitted_optional_claims():
    from src.api.purchases import _payment_order_mismatch

    assert _payment_order_mismatch(
        order_user_id="user-1",
        order_indicator_code="indicator-1",
        order_amount=10000,
        order_currency="KRW",
        payload_user_id="",
        payload_indicator_code="",
        payload_amount=0,
        payload_currency="KRW",
        amount_provided=False,
        currency_provided=False,
    ) is None
