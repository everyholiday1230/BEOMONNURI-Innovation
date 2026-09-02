"""환경설정 로더.

.env 파일이 있으면 읽어 os.environ 에 채우고(외부 의존 없이 간단 파서),
애플리케이션 전역에서 쓰는 설정값을 한곳에 모은다.
"""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """의존성 없이 .env 를 파싱해 환경변수로 로드한다(이미 설정된 값은 보존)."""
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


_load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).lower() in ("1", "true", "yes", "on")


class Settings:
    # AI
    OPENAI_API_KEY: str = os.environ.get("OPENAI_API_KEY", "").strip()
    OPENAI_MODEL: str = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    # 키가 있으면 openai, 없으면 자동으로 mock 으로 폴백한다.
    AI_PROVIDER: str = (
        os.environ.get("AI_PROVIDER", "").strip().lower()
        or ("openai" if os.environ.get("OPENAI_API_KEY", "").strip() else "mock")
    )

    # 인증
    SECRET_KEY: str = os.environ.get("SECRET_KEY", "dev-only-change-me")
    ADMIN_USERNAME: str = os.environ.get("ADMIN_USERNAME", "admin")
    ADMIN_PASSWORD: str = os.environ.get("ADMIN_PASSWORD", "change-this-admin-pw")
    JWT_ALG: str = "HS256"
    JWT_TTL_HOURS: int = 24 * 7

    # 저장소
    DB_PATH: str = os.environ.get("DB_PATH", str(BASE_DIR / "data" / "edu.db"))

    # 비용 방어
    STUDENT_DAILY_AI_LIMIT: int = int(os.environ.get("STUDENT_DAILY_AI_LIMIT", "60"))

    # 공개 URL
    PUBLIC_BASE_URL: str = os.environ.get("PUBLIC_BASE_URL", "http://localhost:8010").rstrip("/")


settings = Settings()
