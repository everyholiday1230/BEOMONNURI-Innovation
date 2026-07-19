"""Signal-board validation, privacy, and persistence policy regressions."""

from pathlib import Path

import pytest
from fastapi import HTTPException

from src.api.signal_board import (
    _popularity_sql,
    _validate_create_payload,
)

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = ROOT / "scripts" / "db" / "ensure_schema.sql"
API = ROOT / "src" / "api" / "signal_board.py"
PAPER_API = ROOT / "src" / "api" / "paper_trading.py"


def _payload(**overrides):
    value = {
        "title": "RSI 반등",
        "description": "테스트 설명",
        "symbol": "btcusdt",
        "timeframe": "1h",
        "action": "buy",
        "conditions": [
            {"indicator": "rsi", "period": 14, "op": "below", "value": 30}
        ],
    }
    value.update(overrides)
    return value


def test_signal_payload_is_canonicalized_and_private_by_api_policy():
    data = _validate_create_payload(_payload())

    assert data["symbol"] == "BTCUSDT"
    assert data["action"] == "buy"
    assert data["conditions"][0]["indicator"] == "rsi"
    source = API.read_text(encoding="utf-8")
    assert "CAST(:conditions AS JSONB), FALSE" in source


@pytest.mark.parametrize(
    "override",
    [
        {"conditions": []},
        {"action": "execute"},
        {"symbol": "BTC<script>"},
        {"timeframe": "13h"},
    ],
)
def test_invalid_signal_payload_is_rejected(override):
    with pytest.raises(HTTPException) as exc:
        _validate_create_payload(_payload(**override))
    assert exc.value.status_code == 400


def test_signal_deletion_is_soft_and_visibility_queries_hide_deleted_rows():
    source = API.read_text(encoding="utf-8")

    assert "SET deleted_at = now(), is_public = FALSE" in source
    assert "DELETE FROM signal_posts WHERE id" not in source
    assert source.count("deleted_at IS NULL") >= 5


def test_engagement_and_views_are_unique_per_user_in_postgres_schema():
    sql = SCHEMA.read_text(encoding="utf-8")

    for table in ("signal_post_likes", "signal_post_favorites", "signal_post_views"):
        section = sql.split(f"CREATE TABLE IF NOT EXISTS {table}", 1)[1].split(");", 1)[0]
        assert "PRIMARY KEY (signal_id, user_id)" in section


def test_popularity_weights_favorites_likes_and_deduplicated_views():
    expression = _popularity_sql()

    assert "favorite_count * 8" in expression
    assert "like_count * 5" in expression
    assert "LEAST(p.view_count, 1000) * 0.1" in expression


def test_paper_ledger_is_append_only_and_leaderboard_uses_it():
    source = PAPER_API.read_text(encoding="utf-8")

    assert "ON CONFLICT (user_id, trade_id) DO NOTHING" in source
    assert "DO UPDATE" not in source.split("async def _append_trade_records", 1)[1].split(
        "async def _backfill_trade_records", 1
    )[0]
    leaderboard = source.split("async def get_leaderboard", 1)[1]
    assert "FROM paper_trade_records" in leaderboard
    assert "jsonb_array_elements" not in leaderboard


def test_signal_board_frontend_is_wired_and_publicly_readable():
    index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    board = (ROOT / "static" / "js" / "modules" / "signal-board.js").read_text(encoding="utf-8")
    builder = (ROOT / "static" / "js" / "modules" / "signal-builder.js").read_text(encoding="utf-8")
    guest = (ROOT / "static" / "js" / "modules" / "guest-mode.js").read_text(encoding="utf-8")

    # 신호 게시판은 네비게이션 팝업으로 제공된다(우측 패널 탭에서 이전됨).
    assert 'id="signalsPopup"' in index
    assert 'data-nav="signals"' in index
    assert 'id="sgList"' in index
    assert "/static/js/modules/signal-board.js" in index
    assert "{ id: 'signals'" not in guest
    assert "/v1/signals/board" in board
    assert "toggleReaction(like.dataset.sgLike, 'like')" in board
    assert "toggleReaction(favorite.dataset.sgFavorite, 'favorite')" in board
    assert "`/v1/signals/${id}/${type}`" in board
    assert "/v1/signals" in builder
    assert "applySharedSignal" in builder


def test_signal_board_frontend_exposes_all_server_sort_modes():
    index = (ROOT / "static" / "index.html").read_text(encoding="utf-8")

    for sort in ("popular", "newest", "likes", "favorites"):
        assert f'value="{sort}"' in index
