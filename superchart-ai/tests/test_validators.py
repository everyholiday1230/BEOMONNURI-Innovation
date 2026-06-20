from src.utils.validators import (
    is_valid_symbol,
    is_valid_timeframe,
    is_valid_email,
    normalize_symbol,
)


def test_symbol_validation_blocks_injection_payloads():
    assert is_valid_symbol("BTCUSDT") is True
    assert is_valid_symbol("BTC';DROP") is False
    assert is_valid_symbol("<script>") is False


def test_timeframe_validation():
    assert is_valid_timeframe("1m") is True
    assert is_valid_timeframe("invalid") is False


def test_email_and_normalize_symbol():
    assert is_valid_email("qa@example.com") is True
    assert is_valid_email("not-an-email") is False
    assert normalize_symbol(" btcusdt ") == "BTCUSDT"
