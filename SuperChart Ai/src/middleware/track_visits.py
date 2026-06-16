"""방문 추적 + Rate Limit 미들웨어.

두 가지 일을 합니다:
1. /v1/ 경로에 대한 IP Rate Limit 체크 (access_log.is_rate_limited)
2. / 경로 방문을 visit_tracker에 기록 (파일 주기 저장)

의존성:
- src.services.access_log.is_rate_limited
- src.services.visit_tracker
"""
from fastapi import FastAPI
from starlette.responses import JSONResponse


# 방문으로 카운트할 경로 (홈페이지만)
_VISIT_PATHS = frozenset({"/", "/static/index.html"})


async def _track_visits(request, call_next):
    from src.services.access_log import is_rate_limited
    from src.services.visit_tracker import record_visit, save_if_due

    ip = request.client.host if request.client else "unknown"

    # Rate Limit 체크 (API 경로만)
    if request.url.path.startswith("/v1/") and is_rate_limited(ip):
        return JSONResponse(status_code=429, content={"detail": "Too many requests"})

    # 홈페이지 방문 기록
    if request.url.path in _VISIT_PATHS:
        record_visit(ip)
        save_if_due()

    return await call_next(request)


def register(app: FastAPI) -> None:
    """방문 추적 미들웨어를 앱에 등록."""
    app.middleware("http")(_track_visits)


__all__ = ["register"]
