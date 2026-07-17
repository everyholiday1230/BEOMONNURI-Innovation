"""Regression checks for the additive startup schema bootstrap."""

from pathlib import Path


SCHEMA_PATH = Path(__file__).resolve().parents[1] / "scripts" / "db" / "ensure_schema.sql"


def test_llm_signal_log_table_is_created_before_its_indexes():
    sql = SCHEMA_PATH.read_text(encoding="utf-8")

    create_table = sql.index("CREATE TABLE IF NOT EXISTS llm_signal_log")
    indexes = (
        "idx_llm_signal_log_user_created",
        "idx_llm_signal_log_created",
        "idx_llm_signal_log_status",
    )

    assert all(create_table < sql.index(index_name) for index_name in indexes)


def test_llm_signal_log_startup_schema_matches_runtime_columns():
    sql = SCHEMA_PATH.read_text(encoding="utf-8")
    table_sql = sql.split("CREATE TABLE IF NOT EXISTS llm_signal_log", 1)[1].split(");", 1)[0]

    runtime_columns = {
        "user_id",
        "symbol",
        "timeframe",
        "message",
        "signals_json",
        "signal_count",
        "drawing_count",
        "prompt_tokens",
        "completion_tokens",
        "total_tokens",
        "charged_points",
        "free_used",
        "tier",
        "status",
        "created_at",
    }

    assert all(column in table_sql for column in runtime_columns)
