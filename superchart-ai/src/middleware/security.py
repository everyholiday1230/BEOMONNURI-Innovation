"""보안 헤더 + 요청 추적 + 점검모드 + 응답시간 미들웨어.

이 미들웨어는 여러 책임을 가지는 것처럼 보이지만, 공통적으로
"모든 응답에 공통 처리를 추가"하는 역할입니다. 추후 분리가 필요하면
아래 역할별로 나눌 수 있습니다:
1. HTTPS 리다이렉트 (프로덕션)
2. 요청 추적 ID (X-Request-ID)
3. 점검모드 체크 (DB + 30초 캐싱)
4. 응답시간 측정 (느린 요청 경고)
5. 메트릭 수집
6. 보안 헤더 (CSP, X-Frame, XSS 등)
7. 정적 리소스 캐싱

레거시 코드를 거의 그대로 이동. 향후 개별 미들웨어로 세분화 예정.
"""
import os
import time as _time

from fastapi import FastAPI
from sqlalchemy import select
from starlette.responses import HTMLResponse, RedirectResponse


# 점검모드 캐시 (30초) — 모듈 레벨 싱글턴
_maintenance_cache = {"value": False, "ts": 0}

# 점검모드에서도 허용할 경로
_MAINTENANCE_EXEMPT_PATHS = frozenset({
    "/admin",
    "/health",
    "/v1/site/settings/public",
})
_MAINTENANCE_EXEMPT_PREFIXES = (
    "/v1/auth/admin",
    "/v1/site/settings",
)

# 느린 요청 임계값
SLOW_REQUEST_MS = 2000

# CSP 정책 — 외부 이미지 CDN 허용 (coingecko, bitget, gstatic)
#
# script-src 'unsafe-inline' 사유:
#   app.js / auth.js / ui.js 의 innerHTML 템플릿에 inline onclick 이 123건
#   박혀있음. 전부 이벤트 위임으로 바꾸기 전까지는 차단 시 UI 동작 불가.
#   admin 페이지는 이미 전부 제거 완료 (P2 #12) — 향후 index 도 정리 후
#   unsafe-inline 제거 예정.
#
# 현재 상태:
#   - admin.html: inline event 0 (data-action 위임 완료)
#   - index.html: inline event 6 (직접 작성된 것)
#   - app.js innerHTML 내부: onclick 37, onchange 3, oninput 1
#   - auth.js innerHTML 내부: onclick 28, onchange 3, oninput 1
#   - ui.js innerHTML 내부: 37 건
#   - drawing.js / favorites.js: 7 건
#
# style-src 'unsafe-inline' 사유:
#   inline style 다수 잔존. 디자인 토큰 전환 진행 중.
_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline' https://js.tosspayments.com; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: https://coin-images.coingecko.com https://img.bitgetimg.com https://www.gstatic.com; "
    "connect-src 'self' ws: wss: https://api.tosspayments.com https://event.tosspayments.com; "
    "frame-src 'self' https://js.tosspayments.com; "
    "font-src 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'self'; "
    "form-action 'self'; "
    "base-uri 'self'; "
    "upgrade-insecure-requests"
)

# 점검 중 HTML
_MAINTENANCE_HTML = (
    '<html><body style="background:#080c14;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif">'
    '<div style="text-align:center"><h1>🔧 점검 중</h1>'
    '<p style="color:#6b7280;margin-top:8px">서비스 점검 중입니다. 잠시 후 다시 접속해주세요.</p>'
    '</div></body></html>'
)


def _is_prod() -> bool:
    return os.getenv("ENV", "").lower() in ("prod", "production", "live")


def _path_exempts_maintenance(path: str) -> bool:
    if path in _MAINTENANCE_EXEMPT_PATHS:
        return True
    return path.startswith(_MAINTENANCE_EXEMPT_PREFIXES)


async def _check_maintenance_mode() -> bool:
    """점검모드 상태를 반환 (30초 캐싱, DB 오류 시 기존 값 유지)."""
    now = _time.time()
    if now - _maintenance_cache["ts"] > 30:
        try:
            from src.db.session import SessionLocal
            from src.models.tables import SiteSetting
            async with SessionLocal() as db:
                r = await db.execute(select(SiteSetting).where(SiteSetting.key == "maintenance_mode"))
                s = r.scalar()
                _maintenance_cache["value"] = s and s.value == "true"
                _maintenance_cache["ts"] = now
        except Exception:
            pass  # DB 오류 시 기존 캐시 값 유지
    return _maintenance_cache["value"]


def create_middleware(generate_request_id, metrics, logger):
    """보안 헤더 미들웨어 함수를 생성 (의존성 주입).

    Args:
        generate_request_id: 요청 ID 생성 함수
        metrics: 메트릭 수집기
        logger: 로거

    Returns:
        미들웨어 함수
    """
    async def _security_headers(request, call_next):
        _start = _time.time()
        # 요청 추적 ID
        request_id = request.headers.get("X-Request-ID") or generate_request_id()
        request.state.request_id = request_id

        # HTTPS 리다이렉트 (프로덕션에서만)
        if _is_prod() and request.headers.get("x-forwarded-proto") == "http":
            url = str(request.url).replace("http://", "https://", 1)
            return RedirectResponse(url, status_code=301)

        path = request.url.path
        # 점검모드 체크 (관리자/health/설정 제외)
        if not _path_exempts_maintenance(path):
            if await _check_maintenance_mode():
                return HTMLResponse(_MAINTENANCE_HTML, status_code=503)

        response = await call_next(request)

        # 요청 추적 ID 응답 헤더
        response.headers["X-Request-ID"] = request_id

        # 응답시간 로그 (API 경로만, 정적 파일 제외)
        elapsed = round((_time.time() - _start) * 1000)
        if path.startswith("/v1/"):
            response.headers["X-Response-Time"] = f"{elapsed}ms"
            if elapsed > SLOW_REQUEST_MS:
                logger.warning("slow_request", path=path, ms=elapsed, rid=request_id)

        # 메트릭 수집
        metrics.record_request(path)
        if response.status_code >= 400:
            metrics.record_error(path, f"HTTP {response.status_code}", request_id)

        # 보안 헤더
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = _CSP
        if request.url.scheme == "https":
            # HSTS — 2년 + preload 등록 가능 (https://hstspreload.org)
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"

        # 정적 리소스 캐싱 — ?v= 쿼리 있으면 장기 캐시
        if path.endswith(".js") or path.endswith(".css"):
            if "v=" in str(request.url.query):
                response.headers["Cache-Control"] = "public, max-age=86400, must-revalidate"
            else:
                response.headers["Cache-Control"] = "no-cache, must-revalidate"

        return response

    return _security_headers


def register(app: FastAPI, generate_request_id, metrics, logger) -> None:
    """보안 헤더 미들웨어를 앱에 등록 (의존성 주입 필요)."""
    mw = create_middleware(generate_request_id, metrics, logger)
    app.middleware("http")(mw)


__all__ = ["register", "create_middleware", "SLOW_REQUEST_MS"]
