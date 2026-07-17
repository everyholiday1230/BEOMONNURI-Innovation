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
from typing import Any

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

# ── 역할/권한 정책 ──
# NOTE: 메뉴/액션 권한의 단일 출처. admin_roles.py UI 정책과 동기화 대상.
ADMIN_ROLE_POLICIES: dict[str, dict[str, Any]] = {
    "super": {
        "label": "최고 관리자",
        "menus": "*",
        "permissions": ["*"],
    },
    "ops": {
        "label": "운영 관리자",
        "menus": ["overview", "users", "subscriptions", "tickets", "content", "system", "metrics", "symdata", "aiusage", "superchart"],
        "permissions": [
            "overview.read", "users.read", "users.write",
            "subscriptions.read", "subscriptions.write", "subscriptions.refund",
            "referrals.read", "referrals.write",
            "tickets.read", "tickets.write",
            "content.read", "content.write",
            "metrics.read", "logs.read", "symdata.read", "aiusage.read",
            "superchart.read", "superchart.write",
            "system.read", "system.ops",
        ],
    },
    "support": {
        "label": "고객지원 관리자",
        "menus": ["overview", "tickets", "users", "content"],
        "permissions": ["overview.read", "users.read", "tickets.read", "tickets.write", "content.read"],
    },
    "content": {
        "label": "콘텐츠 관리자",
        "menus": ["overview", "content", "plans"],
        "permissions": ["overview.read", "content.read", "content.write", "plans.read", "plans.write"],
    },
    "billing": {
        "label": "결제 관리자",
        "menus": ["overview", "subscriptions", "points", "plans"],
        "permissions": [
            "overview.read", "subscriptions.read", "subscriptions.write", "subscriptions.refund",
            "points.read", "points.write", "referrals.read", "referrals.write",
            "plans.read", "plans.write",
        ],
    },
    "data": {
        "label": "데이터 관리자",
        "menus": ["overview", "symdata", "symbols", "metrics", "aiusage", "superchart"],
        "permissions": ["overview.read", "symdata.read", "symdata.write", "symbols.read", "symbols.write", "metrics.read", "aiusage.read", "superchart.read", "superchart.write"],
    },
    "readonly": {
        "label": "읽기 전용 관리자",
        "menus": ["overview", "metrics", "system"],
        "permissions": ["overview.read", "metrics.read", "system.read"],
    },
}


# ── 공통 관리자 API 경로별 세부 권한 ──
# auth_admin_check()만 호출하는 기존 라우트에도 최소권한을 적용한다.
# 더 구체적인 prefix를 먼저 비교해야 한다.
_ADMIN_PATH_PERMISSIONS: tuple[tuple[str, str, str | None], ...] = (
    # 운영 시스템
    ("/v1/ops/restart-server", "system.ops", "POST"),
    ("/v1/ops/restart-bots", "system.ops", "POST"),
    ("/v1/ops/clear-cache", "system.ops", "POST"),
    ("/v1/ops/backup-db", "system.ops", "POST"),
    ("/v1/ops/delete-user", "users.write", "POST"),
    ("/v1/ops/toggle-symbol", "symbols.write", "POST"),
    ("/v1/ops/push-notice", "content.write", "POST"),
    ("/v1/ops/user-logs", "logs.read", "GET"),
    ("/v1/ops/revenue-stats", "subscriptions.read", "GET"),
    ("/v1/ops/", "system.read", "GET"),
    ("/v1/debug/", "system.read", "GET"),
    ("/v1/stats/visits", "metrics.read", "GET"),
    # 구매/결제
    ("/v1/purchases/admin/refund", "subscriptions.refund", "POST"),
    ("/v1/purchases/admin/payments", "subscriptions.read", "GET"),
    ("/v1/purchases/admin/duplicate-payments", "subscriptions.read", "GET"),
    ("/v1/purchases/admin/", "subscriptions.write", "POST"),
    ("/v1/purchases/admin/", "subscriptions.read", "GET"),
    # 포인트/레퍼럴
    ("/v1/points/admin/", "points.write", "POST"),
    ("/v1/points/admin/", "points.read", "GET"),
    ("/v1/points/policy", "points.read", "GET"),
    ("/v1/referral/admin/", "referrals.write", "POST"),
    ("/v1/referral/admin/", "referrals.read", "GET"),
    # 거래소 가입 인증 승인/반려
    ("/v1/auth/admin/approve-verification", "subscriptions.write", "POST"),
    ("/v1/auth/admin/reject-verification", "subscriptions.write", "POST"),
    ("/v1/auth/admin/pending-verifications", "subscriptions.read", "GET"),
    # 콘텐츠/사이트 설정
    ("/v1/site/notices/admin", "content.read", "GET"),
    ("/v1/site/notices", "content.write", None),
    ("/v1/site/faqs", "content.write", None),
    ("/v1/site/settings", "system.ops", "POST"),
    ("/v1/site/settings", "content.read", "GET"),
    # 요금제
    ("/v1/plans", "plans.write", "POST"),
    ("/v1/plans", "plans.read", "GET"),
)


def required_admin_permission(path: str, method: str) -> str | None:
    """요청 경로/메서드에 필요한 세부 관리자 권한을 반환한다."""
    method = (method or "").upper()
    for prefix, permission, required_method in _ADMIN_PATH_PERMISSIONS:
        if path.startswith(prefix) and (required_method is None or method == required_method):
            return permission
    return None


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

def sign_admin_cookie(sid: str = "", admin_email: str = "", admin_role: str = "super"):
    """admin 세션 JWT 발급. 반환: (token, sid)."""
    sid = sid or _secrets.token_hex(16)
    token = _admin_jwt.encode(
        {
            "purpose": "admin_session",
            "sid": sid,
            "adm": (admin_email or "").strip().lower()[:200],
            "role": admin_role if admin_role in ADMIN_ROLE_POLICIES else "super",
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


def get_admin_cookie_claims(request) -> dict:
    """admin JWT claims 추출(검증 실패 시 빈 dict)."""
    cookie = request.cookies.get(ADMIN_COOKIE, "")
    if not cookie:
        return {}
    try:
        return _admin_jwt.decode(cookie, _admin_settings.jwt_secret, algorithms=["HS256"])
    except Exception:
        return {}


def _role_permissions(role: str) -> list[str]:
    pol = ADMIN_ROLE_POLICIES.get(role, ADMIN_ROLE_POLICIES["readonly"])
    perms = pol.get("permissions") or []
    return perms if isinstance(perms, list) else []


async def resolve_admin_context(request: Request, db=None, *, fail_closed: bool = False) -> dict[str, Any]:
    """현재 관리자 컨텍스트(이메일/역할/권한/메뉴) 계산.

    기본 정책:
    - 세션/헤더 인증 성공 + 식별 정보 없으면 super(하위 호환)
    - 이메일이 있으면 admin_accounts를 조회해 role/active 반영
    """
    claims = get_admin_cookie_claims(request)
    role = (claims.get("role") or "").strip().lower() or "super"
    admin_email = (claims.get("adm") or request.headers.get("x-admin-email") or "").strip().lower()

    # x-admin-key 헤더 인증만 사용하는 기존 경로(식별 불가)는 super로 하위 호환
    if not admin_email:
        role = role if role in ADMIN_ROLE_POLICIES else "super"
        pol = ADMIN_ROLE_POLICIES.get(role, ADMIN_ROLE_POLICIES["super"])
        return {
            "admin_email": "",
            "role": role,
            "role_label": pol.get("label", role),
            "menus": pol.get("menus", "*"),
            "permissions": _role_permissions(role),
            "source": "legacy_key",
        }

    if db is not None:
        try:
            from sqlalchemy import text as _text
            row = (await db.execute(_text(
                "SELECT role, active FROM admin_accounts WHERE email=:e LIMIT 1"
            ), {"e": admin_email})).fetchone()
            if row:
                if row[1] is False:
                    raise HTTPException(403, "비활성 관리자 계정")
                role = (row[0] or "readonly").strip().lower()
            else:
                # 등록되지 않은 이메일은 최소권한으로 제한
                role = "readonly"
        except HTTPException:
            raise
        except Exception as e:
            if fail_closed:
                logger.warning(
                    "admin.role_lookup_fail_closed",
                    admin_email=admin_email,
                    error=str(e)[:100],
                )
                role = "readonly"
            # 초기/비민감 경로는 기존 claim 역할 호환 유지
            elif role not in ADMIN_ROLE_POLICIES:
                role = "super"

    if role not in ADMIN_ROLE_POLICIES:
        role = "readonly"
    pol = ADMIN_ROLE_POLICIES.get(role, ADMIN_ROLE_POLICIES["readonly"])
    return {
        "admin_email": admin_email,
        "role": role,
        "role_label": pol.get("label", role),
        "menus": pol.get("menus", []),
        "permissions": _role_permissions(role),
        "source": "admin_account" if admin_email else "legacy_key",
    }


def is_admin_allowed(ctx: dict[str, Any], permission: str) -> bool:
    perms = ctx.get("permissions") or []
    if "*" in perms:
        return True
    return permission in perms


async def require_admin_permission(request: Request, db, permission: str) -> dict[str, Any]:
    """관리자 인증 + permission 체크. 실패 시 403."""
    await auth_admin_check(request)
    ctx = await resolve_admin_context(request, db=db)
    if not is_admin_allowed(ctx, permission):
        raise HTTPException(403, f"권한 부족: {permission}")
    return ctx


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

    Redis가 세션 키의 존재를 명시적으로 확인한 경우에만 유효하다.
    미설정, 연결 오류, 응답 없음은 환경과 관계없이 fail-closed 처리한다.
    """
    if not sid:
        return False
    try:
        from src.db.redis import redis_client
        r = await redis_client()
        if not r:
            return False
        return bool(await r.exists(f"{ADMIN_SESSION_PREFIX}{sid}"))
    except Exception as e:
        logger.warning("admin.is_session_valid_fail_closed", error=str(e)[:100])
        return False


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

async def _enforce_mapped_admin_permission(request: Request) -> None:
    """공통 인증만 사용하던 관리자 API에 경로 기반 최소권한을 적용한다."""
    permission = required_admin_permission(request.url.path, request.method)
    if not permission:
        return

    # 이메일 기반 관리자 세션은 DB의 현재 role/active를 다시 조회한다.
    # 역할 하향/비활성화가 기존 JWT 만료까지 지연되지 않도록 하고,
    # 조회 실패 시 민감 경로는 readonly로 강등(fail-closed)한다.
    claims = get_admin_cookie_claims(request)
    admin_email = (claims.get("adm") or request.headers.get("x-admin-email") or "").strip().lower()
    if admin_email:
        try:
            from src.db.session import get_db_context
            async with get_db_context() as db:
                ctx = await resolve_admin_context(request, db=db, fail_closed=True)
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("admin.permission_db_fail_closed", error=str(e)[:100])
            pol = ADMIN_ROLE_POLICIES["readonly"]
            ctx = {"role": "readonly", "permissions": pol["permissions"]}
    else:
        # 레거시 내부 헤더 인증은 식별 가능한 계정이 없어 기존 super 정책 유지.
        ctx = await resolve_admin_context(request)

    if not is_admin_allowed(ctx, permission):
        admin_audit(
            "admin_permission_denied",
            request,
            role=ctx.get("role", "unknown"),
            permission=permission,
            path=request.url.path,
        )
        raise HTTPException(403, f"권한 부족: {permission}")


async def auth_admin_check(request: Request) -> None:
    """관리자 인증 및 경로별 세부 권한 검증 — 실패 시 403 raise.

    검증 순서:
    1. Admin session cookie (브라우저) — Redis 검증
    2. X-Admin-Key + X-Admin-Password 헤더 (내부 스크립트)
    3. 보호 경로에 매핑된 세부 권한 검사
    """
    # 1. Admin session cookie
    if await verify_admin_cookie_async(request):
        await _enforce_mapped_admin_permission(request)
        return
    # 2. 헤더 조합 (내부 스크립트용)
    admin_key = _os.getenv("ADMIN_KEY", "")
    pw_hash = _os.getenv("ADMIN_PASSWORD_HASH", "")
    hk = request.headers.get("x-admin-key", "")
    hp = request.headers.get("x-admin-password", "")
    if admin_key and pw_hash and hk == admin_key and hp:
        try:
            if _admin_bcrypt.checkpw(hp.encode(), pw_hash.encode()):
                await _enforce_mapped_admin_permission(request)
                return
        except HTTPException:
            raise
        except Exception as e:
            logger.debug("admin.header_check_fail", error=str(e)[:100])
    raise HTTPException(403, "Forbidden")


__all__ = [
    # constants
    "ADMIN_COOKIE", "ADMIN_COOKIE_MAX_AGE", "ADMIN_SESSION_PREFIX",
    "ADMIN_MAX_FAILS", "ADMIN_LOCK_SECONDS",
    # policies
    "ADMIN_ROLE_POLICIES",
    # state
    "admin_login_fails",
    # JWT
    "sign_admin_cookie", "verify_admin_cookie", "verify_admin_cookie_async",
    "get_admin_cookie_sid", "get_admin_cookie_claims",
    # session registry
    "register_session", "is_session_valid", "revoke_session", "revoke_all_admin_sessions",
    # check
    "auth_admin_check", "resolve_admin_context", "is_admin_allowed", "require_admin_permission",
    "required_admin_permission",
    # audit
    "admin_audit",
]
