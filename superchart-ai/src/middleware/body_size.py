"""요청 바디 크기 제한 미들웨어.

Content-Length 헤더 기반으로 1MB 초과 요청을 413으로 거부합니다.
업로드 엔드포인트가 생기면 해당 경로 제외 로직을 여기 추가하세요.
"""
from fastapi import FastAPI
from starlette.responses import JSONResponse


# 1MB (1,048,576 바이트)
MAX_BODY_SIZE = 1_048_576


async def _limit_body_size(request, call_next):
    cl = request.headers.get("content-length")
    if cl and int(cl) > MAX_BODY_SIZE:
        return JSONResponse({"detail": "Request too large"}, status_code=413)
    return await call_next(request)


def register(app: FastAPI) -> None:
    """요청 바디 크기 제한 미들웨어를 앱에 등록."""
    app.middleware("http")(_limit_body_size)


__all__ = ["register", "MAX_BODY_SIZE"]
