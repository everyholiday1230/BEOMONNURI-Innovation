from src.config import _normalize_db_url


def test_normalize_db_url_for_postgres_legacy_scheme():
    assert _normalize_db_url("postgres://user:pw@localhost:5432/db") == "postgresql+asyncpg://user:pw@localhost:5432/db"


def test_normalize_db_url_for_plain_postgresql_scheme():
    assert _normalize_db_url("postgresql://user:pw@localhost:5432/db") == "postgresql+asyncpg://user:pw@localhost:5432/db"


def test_normalize_db_url_keeps_other_schemes():
    assert _normalize_db_url("sqlite:///tmp/a.db") == "sqlite:///tmp/a.db"


def test_jwt_secret_missing_raises_system_exit(monkeypatch):
    """JWT_SECRET 미설정 + 비테스트 환경 → SystemExit."""
    import subprocess, sys
    result = subprocess.run(
        [sys.executable, "-c", "from src.config import settings"],
        env={"PATH": "/usr/bin", "HOME": "/tmp"},
        capture_output=True, text=True,
        cwd="/home/test1/BEOMONNURI-Innovation/superchart-ai",
    )
    assert result.returncode != 0
    assert "JWT_SECRET" in result.stdout or "JWT_SECRET" in result.stderr


def test_jwt_secret_weak_value_raises_system_exit(monkeypatch):
    """알려진 약한 시크릿 → SystemExit."""
    import subprocess, sys
    result = subprocess.run(
        [sys.executable, "-c", "from src.config import settings"],
        env={"PATH": "/usr/bin", "HOME": "/tmp", "JWT_SECRET": "beomon-secret-2026"},
        capture_output=True, text=True,
        cwd="/home/test1/BEOMONNURI-Innovation/superchart-ai",
    )
    assert result.returncode != 0


def test_jwt_secret_strong_value_boots_ok(monkeypatch):
    """32자 이상 강력한 시크릿 → 정상 부팅."""
    import subprocess, sys
    result = subprocess.run(
        [sys.executable, "-c", "from src.config import settings; print(len(settings.jwt_secret))"],
        env={"PATH": "/usr/bin", "HOME": "/tmp", "JWT_SECRET": "x" * 64},
        capture_output=True, text=True,
        cwd="/home/test1/BEOMONNURI-Innovation/superchart-ai",
    )
    assert result.returncode == 0
    assert "64" in result.stdout
