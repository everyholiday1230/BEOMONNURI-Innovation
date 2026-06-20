"""소스 코드 보호 미들웨어.

- .py, __pycache__, .env, .git 경로 접근을 404로 위장
  · 서버 내부 파일 노출 방지

주의:
- 브라우저의 ES module 로더, 일부 프라이버시 브라우저, 모니터링 도구는
  정적 JS 요청에 Referer를 보내지 않을 수 있다. 따라서 /static/chart-engine/*.js
  같은 실제 프론트엔드 모듈을 Referer 기준으로 차단하면 프로덕션에서
  JSON 403 응답이 JavaScript로 파싱되어 "Unexpected token '{'" 장애가 발생한다.
- 클라이언트 JS는 사용자 브라우저로 전달되는 공개 자산이므로, 보안은 서버
  소스/시크릿 차단에 집중한다.
"""
from fastapi import FastAPI
from starlette.responses import JSONResponse


# 차단할 파일 패턴 (404 반환)
_BLOCKED_PATTERNS = (".py",)
_BLOCKED_SUBSTRINGS = ("/__pycache__", "/.env", "/.git")


async def _protect_source(request, call_next):
    path = request.url.path
    # 서버 파일 접근 차단 (.py, __pycache__, .env, .git)
    if path.endswith(_BLOCKED_PATTERNS) or any(s in path for s in _BLOCKED_SUBSTRINGS):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    return await call_next(request)


def register(app: FastAPI) -> None:
    """소스 보호 미들웨어를 앱에 등록."""
    app.middleware("http")(_protect_source)


__all__ = ["register"]
