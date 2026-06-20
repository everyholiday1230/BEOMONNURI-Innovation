"""쿠키 → Authorization 헤더 변환 미들웨어.

브라우저에서 HttpOnly 쿠키로 인증 토큰을 저장하고,
FastAPI의 OAuth2PasswordBearer 의존성은 Authorization 헤더를 기대합니다.
이 미들웨어가 중간 다리 역할:
- auth_token 쿠키가 있고 Authorization 헤더가 없으면 자동 변환
- Authorization 헤더가 이미 있으면 그대로 통과 (API 클라이언트 우선)

보안:
- auth_token은 HttpOnly=True로 발급되어 JS 탈취 불가
- 이 미들웨어는 서버 내부에서만 헤더를 덧붙임 (응답엔 노출 안 됨)
"""
from fastapi import FastAPI


async def _cookie_to_auth_header(request, call_next):
    """auth_token 쿠키가 있고 Authorization 헤더가 없으면 자동 변환."""
    if not request.headers.get("authorization") and request.cookies.get("auth_token"):
        token = request.cookies["auth_token"]
        # 기존 헤더 그대로 보존 + Authorization 추가 (소문자 key)
        new_headers = [(k, v) for k, v in request.scope["headers"]] + [
            (b"authorization", f"Bearer {token}".encode()),
        ]
        request.scope["headers"] = new_headers
    return await call_next(request)


def register(app: FastAPI) -> None:
    """쿠키→Bearer 변환 미들웨어를 앱에 등록."""
    app.middleware("http")(_cookie_to_auth_header)


__all__ = ["register"]
