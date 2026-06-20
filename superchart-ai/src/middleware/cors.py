"""CORS 미들웨어.

운영 환경에서는 실제 도메인을 반드시 CORS_ORIGINS 환경변수로 지정해야 합니다.
ENV=prod 이고 CORS_ORIGINS 미설정이면 기동 실패 (실수로 전체 허용 방지).

보안 규칙:
- allow_credentials=True와 allow_origins=["*"] 동시 사용 금지 (스펙 위반)
- 이 미들웨어는 자동으로 와일드카드(*)를 필터링
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def _resolve_origins() -> list[str]:
    """환경변수에서 CORS_ORIGINS를 읽어 파싱. 운영에서 비어 있으면 에러."""
    cors_env = os.getenv("CORS_ORIGINS", "").strip()
    if not cors_env:
        if os.getenv("ENV", "dev").lower() in ("prod", "production", "live"):
            raise RuntimeError(
                "[SECURITY] ENV=prod 인데 CORS_ORIGINS 가 비어 있습니다. "
                "실제 서비스 도메인(예: https://your-domain.com)을 .env 에 설정하세요."
            )
        cors_env = "http://localhost:3000,http://localhost:8000"

    origins = [o.strip() for o in cors_env.split(",") if o.strip()]
    # 안전 검증: 와일드카드(*) 사용 금지 — credentials 허용 시 보안 취약
    origins = [o for o in origins if o != "*"]
    return origins


def register(app: FastAPI, logger=None) -> list[str]:
    """CORS 미들웨어를 앱에 등록. 설정된 origins 목록을 반환 (로깅용)."""
    origins = _resolve_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Admin-Key", "X-CSRF-Token", "Accept"],
        expose_headers=["X-RateLimit-Remaining"],
        max_age=600,
    )
    if logger is not None:
        logger.info("cors.configured", origins=origins)
    return origins


__all__ = ["register"]
