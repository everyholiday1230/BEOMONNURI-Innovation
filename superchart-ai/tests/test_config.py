from src.config import _normalize_db_url


def test_normalize_db_url_for_postgres_legacy_scheme():
    assert _normalize_db_url("postgres://user:pw@localhost:5432/db") == "postgresql+asyncpg://user:pw@localhost:5432/db"


def test_normalize_db_url_for_plain_postgresql_scheme():
    assert _normalize_db_url("postgresql://user:pw@localhost:5432/db") == "postgresql+asyncpg://user:pw@localhost:5432/db"


def test_normalize_db_url_keeps_other_schemes():
    assert _normalize_db_url("sqlite:///tmp/a.db") == "sqlite:///tmp/a.db"
