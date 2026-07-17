"""앱 설정 (config 패키지).

src/config.py 모듈도 존재하나, Python은 패키지를 우선 사용하므로
이 __init__.py가 모든 기능을 노출해야 함.
"""
import os
import re


class _Settings:
    database_url: str = os.environ.get("DATABASE_URL", "postgresql+asyncpg://chart:chart@localhost:5432/chart_os")
    redis_url: str = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
    secret_key: str = os.environ.get("SECRET_KEY", "")
    jwt_secret: str = os.environ.get("JWT_SECRET", os.environ.get("SECRET_KEY", ""))
    jwt_expire_minutes: int = int(os.environ.get("JWT_EXPIRE_MINUTES", "1440"))
    jwt_refresh_expire_days: int = int(os.environ.get("JWT_REFRESH_EXPIRE_DAYS", "30"))
    public_base_url: str = os.environ.get("PUBLIC_BASE_URL", "https://chart.beomonnuri.com")


settings = _Settings()


def _normalize_db_url(url: str) -> str:
    """DB URL 정규화 — SQLAlchemy async engine은 명시적 async 드라이버 필수.

    - postgres:// (Heroku legacy) → postgresql+asyncpg://
    - postgresql:// (no driver) → postgresql+asyncpg://
    - postgresql+asyncpg:// (이미 정확) → 그대로
    - postgresql+psycopg2:// 등 (다른 드라이버 명시) → 그대로
    - 기타 (sqlite, mysql, redis 등) → 그대로
    - 빈 문자열 → 빈 문자열
    """
    if not url:
        return url
    # Heroku legacy postgres:// → postgresql+asyncpg://
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    # postgresql://... 에 드라이버 표기 없으면 +asyncpg 추가
    if re.match(r"^postgresql://", url):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


# 시작 시 settings.database_url 정규화
settings.database_url = _normalize_db_url(settings.database_url)

# 보안: 약한 JWT_SECRET 검사 — 모든 환경에서 fail-fast
_WEAK_SECRETS = {"change-me-in-production", "change-me", "secret", "dev", "test", "beomon-secret-2026", ""}
_env_name = os.getenv("ENV", os.getenv("ENVIRONMENT", "")).lower()
_is_testing = _env_name == "test" or os.getenv("TESTING", "").lower() in ("1", "true")
if not _is_testing and (settings.jwt_secret.strip() in _WEAK_SECRETS or len(settings.jwt_secret) < 32):
    raise SystemExit(
        "[SECURITY] JWT_SECRET 환경변수가 설정되지 않았거나 32자 미만입니다. "
        "서버를 시작하려면 강력한 랜덤 값(최소 32자)을 설정하세요. "
        "예: export JWT_SECRET=$(python -c \"import secrets;print(secrets.token_urlsafe(64))\")"
    )
