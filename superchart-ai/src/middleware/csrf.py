"""CSRF Double Submit Cookie 검증 미들웨어.

방식:
- 로그인 시 서버가 csrf_token 쿠키 발급 (HttpOnly=False — JS 읽기 가능)
- 클라이언트가 상태 변경 요청(POST/PUT/DELETE/PATCH)에 X-CSRF-Token 헤더 첨부
- 서버가 쿠키와 헤더 값이 일치하는지 검증 (불일치 시 403)

제외 규칙:
- 안전 메서드 (GET/HEAD/OPTIONS): 검증 불필요
- WebSocket/정적파일/health: 상태 변경 아님
- 인증 시작 엔드포인트(signup/login 등): 아직 쿠키 없음
- 비로그인 요청(auth_token도 csrf_token도 없음): 통과 (보호할 세션이 없음)
- 인증된 요청(auth_token 있음)인데 csrf_token 없음: 거부 (쿠키 삭제 공격 방지)
"""
from fastapi import FastAPI
from starlette.responses import JSONResponse


# CSRF 검증 제외 경로 (정확히 일치)
CSRF_EXEMPT_PATHS = frozenset({
    "/v1/auth/signup",
    "/v1/auth/login",
    "/v1/auth/refresh",
    "/v1/auth/admin/login",
    "/v1/auth/forgot-password",
    "/v1/auth/confirm-reset",
    "/v1/auth/google/callback",
    "/v1/auth/verify-email",
})

# CSRF 검증 제외 경로 (startswith)
CSRF_EXEMPT_PREFIXES = (
    "/ws",
    "/v1/ws",
    "/static",
    "/health",
    "/health/",
)

# 안전 메서드 (CSRF 불필요)
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


async def _csrf_protection(request, call_next):
    """CSRF Double Submit Cookie 검증 — 상태 변경 요청만.

    제외: GET/HEAD/OPTIONS, 로그인/회원가입 (쿠키 없는 상태), WebSocket, admin 로그인
    """
    method = request.method
    path = request.url.path
    # 안전 메서드는 CSRF 불필요
    if method in _SAFE_METHODS:
        return await call_next(request)
    # WebSocket/정적파일/health 제외
    if path.startswith(CSRF_EXEMPT_PREFIXES):
        return await call_next(request)
    # 인증 시작 엔드포인트 제외 (쿠키 없음)
    if path in CSRF_EXEMPT_PATHS:
        return await call_next(request)
    # CSRF 토큰 검증
    csrf_cookie = request.cookies.get("csrf_token")
    auth_cookie = request.cookies.get("auth_token")

    if csrf_cookie:
        # 쿠키와 헤더 일치 검증
        csrf_header = request.headers.get("x-csrf-token", "")
        if csrf_header != csrf_cookie:
            return JSONResponse(
                {"success": False, "error": {"code": "CSRF_INVALID", "message": "CSRF token mismatch"}},
                status_code=403,
            )
    elif auth_cookie:
        # 인증된 상태(auth_token 존재)인데 csrf_token이 없으면 거부
        # 공격자가 csrf_token 쿠키를 제거/덮어쓴 경우 방어
        return JSONResponse(
            {"success": False, "error": {"code": "CSRF_MISSING", "message": "CSRF token cookie required for authenticated requests"}},
            status_code=403,
        )
    return await call_next(request)


def register(app: FastAPI) -> None:
    """CSRF 검증 미들웨어를 앱에 등록."""
    app.middleware("http")(_csrf_protection)


__all__ = ["register", "CSRF_EXEMPT_PATHS", "CSRF_EXEMPT_PREFIXES"]
