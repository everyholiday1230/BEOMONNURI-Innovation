"""Regression tests for server-verified paper-trading leaderboard records."""

from src.api.paper_trading import (
    _leaderboard_stats,
    _validate_trade_record,
    _validated_history,
)

NOW_MS = 1_800_000_000_000


def _trade(**overrides):
    item = {
        "id": "trade-1",
        "sym": "BTCUSDT",
        "direction": "long",
        "entry": 100.0,
        "exit": 110.0,
        "qty": 2.0,
        "margin": 100.0,
        "leverage": 2,
        "pnl": 20.0,
        "status": "manual",
        "createdAt": NOW_MS - 60_000,
        "closedAt": NOW_MS,
    }
    item.update(overrides)
    return item


def test_trade_pnl_is_recomputed_server_side():
    trade = _validate_trade_record(_trade(pnl=20.001), now_ms=NOW_MS)

    assert trade is not None
    assert trade["pnl"] == 20.0
    assert trade["pct"] == 10.0
    assert trade["serverVerified"] is True


def test_short_trade_pnl_is_recomputed_with_direction():
    trade = _validate_trade_record(
        _trade(direction="short", exit=90, pnl=20), now_ms=NOW_MS
    )

    assert trade is not None
    assert trade["pnl"] == 20.0
    assert trade["pct"] == 10.0


def test_client_pnl_tampering_is_rejected():
    assert _validate_trade_record(_trade(pnl=999_999), now_ms=NOW_MS) is None


def test_invalid_time_and_future_close_are_rejected():
    assert _validate_trade_record(
        _trade(createdAt=NOW_MS, closedAt=NOW_MS - 1), now_ms=NOW_MS
    ) is None
    assert _validate_trade_record(
        _trade(closedAt=NOW_MS + 6 * 60_000), now_ms=NOW_MS
    ) is None


def test_duplicate_trade_ids_only_count_once():
    first = _trade(id="same-id")
    duplicate = _trade(id="same-id", entry=100, exit=120, pnl=40)

    history = _validated_history([first, duplicate], now_ms=NOW_MS)

    assert len(history) == 1
    assert history[0]["pnl"] == 20.0


def test_leaderboard_stats_use_only_verified_trades(monkeypatch):
    monkeypatch.setattr("src.api.paper_trading.time.time", lambda: NOW_MS / 1000)
    history = [
        _trade(id="win", pnl=20),
        _trade(id="loss", exit=95, pnl=-10),
        _trade(id="tampered", pnl=5000),
    ]

    stats = _leaderboard_stats(history)

    assert stats == {
        "pnl": 10.0,
        "tradeCount": 2,
        "winCount": 1,
        "winRate": 50.0,
    }
