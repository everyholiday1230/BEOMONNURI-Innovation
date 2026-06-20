"""정적 파일 + 일부 GET API 캐시 제어 미들웨어.

/static/ 경로:
- 버전 쿼리(?v=xxx) 있음: 1년 immutable 캐싱
- 버전 쿼리 없음: 5분 단기 캐싱 + 재검증

/v1/symbols, /v1/charts/server-time:
- 30초 public 캐싱 (브라우저 + 프록시)
"""
from fastapi import FastAPI


# 짧은 캐시 적용할 GET endpoint (CDN/브라우저 캐시 활용)
_API_CACHE_PATHS = (
    "/v1/symbols",
    "/v1/charts/server-time",
)


async def _static_cache_control(request, call_next):
    """정적 파일 + 일부 GET API 캐시 헤더 추가."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static/"):
        if request.url.query and "v=" in request.url.query:
            # 버전 쿼리 있음 → 길게 캐싱하되 재검증 허용(immutable 제거).
            # immutable은 강력 새로고침으로도 무시돼 수정이 반영 안 되는 문제가 있어,
            # ETag 기반 재검증이 가능하도록 must-revalidate 사용.
            response.headers["Cache-Control"] = "public, max-age=86400, must-revalidate"
        else:
            # 버전 없음 → 짧은 캐싱 + 재검증
            response.headers["Cache-Control"] = "public, max-age=300, must-revalidate"
    elif request.method == "GET" and any(path.startswith(p) for p in _API_CACHE_PATHS):
        # GET API 30초 public 캐싱 (Authorization 없는 공개 데이터만)
        if "authorization" not in (k.lower() for k in request.headers.keys()):
            # Cache-Control 이미 있으면 유지
            if "cache-control" not in (k.lower() for k in response.headers.keys()):
                response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"
    return response


def register(app: FastAPI) -> None:
    """정적 파일 + API 캐시 미들웨어를 앱에 등록."""
    app.middleware("http")(_static_cache_control)


__all__ = ["register"]
