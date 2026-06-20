"""관리자 세션/인증 헬퍼.

auth.py에서 추출한 관리자 인증 관련 로직 모음:
- JWT 쿠키 발급/검증
- Redis 세션 레지스트리
- Rate limit 상태 (IP별 로그인 실패 카운트)
- 감사 로그

관리자 엔드포인트는 여전히 auth.py에 있고,
여기는 재사용 가능한 헬퍼만 제공합니다.

외부 모듈에서 재사용하려면:
    from src.services.admin_helpers import verify_admin_cookie_async, auth_admin_check
"""
import os as _os
import secrets as _secrets
from datetime import datetime, timezone, timedelta

import bcrypt as _admin_bcrypt
import structlog
from fastapi import HTTPException, Request
from jose import jwt as _admin_jwt

from src.config import settings as _admin_settings

logger = structlog.get_logger(__name__)


# ── 상수 ──
ADMIN_COOKIE = "admin_session"
ADMIN_COOKIE_MAX_AGE = 3600 * 2  # 2시간
ADMIN_SESSION_PREFIX = "admin_sess:"

# Rate limit (ENV=test 이면 관대)
ADMIN_MAX_FAILS = 50 if _os.getenv("ENV") == "test" else 5
ADMIN_LOCK_SECONDS = 5 if _os.getenv("ENV") == "test" else 900


# ── 전역 Rate Limit 상태 ──
# ip -> {"count": int, "locked_until": float}
# 참고: 단일 워커 가정. 다중 워커 시 Redis 기반으로 이전 필요.
admin_login_fails: dict = {}


# ── 감사 로그 ──

def admin_audit(action: str, request=None, **extra) -> None:
    """관리자 감사 로그. structlog로 'admin_audit' 이벤트 기록."""
    info = {"action": action}
    if request:
        info["ip"] = request.client.host if request.client else "unknown"
        info["ua"] = request.headers.get("user-agent", "")[:80]
    info.update(extra)
    logger.info("admin_audit", **info)


# ── JWT 쿠키 서명/검증 ──

def sign_admin_cookie(sid: str = ""):
    """admin 세션 JWT 발급. 반환: (token, sid)."""
    sid = sid or _secrets.token_hex(16)
    token = _admin_jwt.encode(
        {
            "purpose": "admin_session",
            "sid": sid,
            "exp": datetime.now(timezone.utc) + timedelta(seconds=ADMIN_COOKIE_MAX_AGE),
        },
        _admin_settings.jwt_secret,
        algorithm="HS256",
    )
    return token, sid


def verify_admin_cookie(request) -> bool:
    """동기 JWT 검증 (fallback). async 경로에서는 verify_admin_cookie_async 사용."""
    cookie = request.cookies.get(ADMIN_COOKIE, "")
    if not cookie:
        return False
    try:
        payload = _admin_jwt.decode(cookie, _admin_settings.jwt_secret, algorithms=["HS256"])
        return payload.get("purpose") == "admin_session" and bool(payload.get("sid"))
    except Exception:
        return False


async def verify_admin_cookie_async(request) -> bool:
    """JWT + Redis 세션 검증."""
    cookie = request.cookies.get(ADMIN_COOKIE, "")
    if not cookie:
        return False
    try:
        payload = _admin_jwt.decode(cookie, _admin_settings.jwt_secret, algorithms=["HS256"])
        if payload.get("purpose") != "admin_session":
            return False
        sid = payload.get("sid", "")
        if not sid:
            return False
        return await is_session_valid(sid)
    except Exception:
        return False


def get_admin_cookie_sid(request) -> str:
    cookie = request.cookies.get(ADMIN_COOKIE, "")
    if not cookie:
        return ""
    try:
        payload = _admin_jwt.decode(cookie, _admin_settings.jwt_secret, algorithms=["HS256"])
        return payload.get("sid", "")
    except Exception:
        return ""


# ── Redis 세션 레지스트리 ──

async def register_session(sid: str) -> None:
    """Redis에 세션 등록."""
    try:
        from src.db.redis import redis_client
        r = await redis_client()
        if r:
            await r.setex(f"{ADMIN_SESSION_PREFIX}{sid}", ADMIN_COOKIE_MAX_AGE, "1")
    except Exception as e:
        logger.debug("admin.register_session_fail", error=str(e)[:100])


async def is_session_valid(sid: str) -> bool:
    """Redis에서 세션 유효성 확인.
    
    정책:
    - ENV=prod/production/live: fail-closed (Redis 장애 시 거부)
    - 그 외 (dev/local): fail-open (개발 편의)
    """
    try:
        from src.db.redis import redis_client
        r = await redis_client()
        if r:
            return await r.exists(f"{ADMIN_SESSION_PREFIX}{sid}")
    except Exception as e:
        logger.debug("admin.is_session_valid_fail", error=str(e)[:100])
    # fallback: 환경별 정책
    import os as _os
    _env = _os.getenv("ENV", "").lower()
    if _env in ("prod", "production", "live"):
        return False  # fail-closed (보안 우선)
    return True  # dev/local: fail-open


async def revoke_session(sid: str) -> None:
    """Redis에서 세션 삭제."""
    try:
        from src.db.redis import redis_client
        r = await redis_client()
        if r:
            await r.delete(f"{ADMIN_SESSION_PREFIX}{sid}")
    except Exception as e:
        logger.debug("admin.revoke_session_fail", error=str(e)[:100])


async def revoke_all_admin_sessions() -> None:
    """모든 admin 세션 폐기."""
    try:
        from src.db.redis import redis_client
        r = await redis_client()
        if r:
            keys = []
            async for k in r.scan_iter(f"{ADMIN_SESSION_PREFIX}*"):
                keys.append(k)
            if keys:
                await r.delete(*keys)
    except Exception as e:
        logger.debug("admin.revoke_all_fail", error=str(e)[:100])


# ── 통합 인증 체크 (엔드포인트에서 호출) ──

async def auth_admin_check(request: Request) -> None:
    """관리자 권한 검증 — 실패 시 403 raise.

    검증 순서:
    1. Admin session cookie (브라우저) — Redis 검증
    2. X-Admin-Key + X-Admin-Password 헤더 (내부 스크립트)
    """
    # 1. Admin session cookie
    if await verify_admin_cookie_async(request):
        return
    # 2. 헤더 조합 (내부 스크립트용)
    admin_key = _os.getenv("ADMIN_KEY", "")
    pw_hash = _os.getenv("ADMIN_PASSWORD_HASH", "")
    hk = request.headers.get("x-admin-key", "")
    hp = request.headers.get("x-admin-password", "")
    if admin_key and pw_hash and hk == admin_key and hp:
        try:
            if _admin_bcrypt.checkpw(hp.encode(), pw_hash.encode()):
                return
        except Exception as e:
            logger.debug("admin.header_check_fail", error=str(e)[:100])
    raise HTTPException(403, "Forbidden")


__all__ = [
    # constants
    "ADMIN_COOKIE", "ADMIN_COOKIE_MAX_AGE", "ADMIN_SESSION_PREFIX",
    "ADMIN_MAX_FAILS", "ADMIN_LOCK_SECONDS",
    # state
    "admin_login_fails",
    # JWT
    "sign_admin_cookie", "verify_admin_cookie", "verify_admin_cookie_async",
    "get_admin_cookie_sid",
    # session registry
    "register_session", "is_session_valid", "revoke_session", "revoke_all_admin_sessions",
    # check
    "auth_admin_check",
    # audit
    "admin_audit",
]
