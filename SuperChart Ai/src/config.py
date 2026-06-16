"""설정."""
import os
import sys
import warnings
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://chart:chart@localhost:5432/chart_os"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str  # 반드시 .env 에서 설정 필요
    jwt_expire_minutes: int = 1440  # 24시간
    jwt_refresh_expire_days: int = 30


# ── DATABASE_URL 정규화 ──────────────────────────────────────────
# Render Managed Postgres는 connectionString을 `postgresql://...` 형식으로 주입한다.
# SQLAlchemy asyncio 엔진은 명시적으로 `postgresql+asyncpg://...` 드라이버를 요구하므로
# 접두사를 자동 교체한다. 이미 asyncpg가 지정된 경우 변경하지 않는다.
# 이 정규화는 로컬/EC2의 기존 값(`postgresql+asyncpg://...`)과도 호환된다.
def _normalize_db_url(url: str) -> str:
    if url.startswith("postgresql+"):
        return url  # 이미 드라이버 명시됨 (asyncpg, psycopg 등)
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url[len("postgresql://"):]
    if url.startswith("postgres://"):  # Heroku/legacy 호환
        return "postgresql+asyncpg://" + url[len("postgres://"):]
    return url

settings = Settings()
settings.database_url = _normalize_db_url(settings.database_url)

# ── 운영 보안 가드 ──────────────────────────────────────────────
# JWT_SECRET 검증: 기본값/짧은 값은 프로덕션에서 위험 → 경고 + 비프로덕션은 계속
_WEAK_SECRETS = {"change-me-in-production", "change-me", "secret", "dev", "test", ""}
_env_name = os.getenv("ENV", os.getenv("ENVIRONMENT", "")).lower()
if settings.jwt_secret.strip() in _WEAK_SECRETS or len(settings.jwt_secret) < 32:
    _msg = (
        "[SECURITY] JWT_SECRET 가 기본값이거나 32자 미만입니다. "
        "운영 환경에서는 반드시 강력한 랜덤 값(최소 32자)으로 교체하세요. "
        "예: `python -c \"import secrets;print(secrets.token_urlsafe(64))\"` → .env 의 JWT_SECRET"
    )
    if _env_name in ("prod", "production", "live"):
        # 프로덕션에서는 즉시 기동 중단
        print(_msg, file=sys.stderr, flush=True)
        raise RuntimeError("Refusing to start with weak JWT_SECRET in production.")
    else:
        warnings.warn(_msg, stacklevel=1)
