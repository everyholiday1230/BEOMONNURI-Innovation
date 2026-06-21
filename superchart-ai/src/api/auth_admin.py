"""관리자 전용 엔드포인트.

src/api/auth.py에서 분리:
- 사용자 관리: users, user-detail, set-tier, block-user,
                reset-user-password, revoke-referral
- 모니터링: access-logs
- 세션 관리: login, logout, force-logout

모든 엔드포인트는 auth_admin_check (세션 쿠키 or 헤더) 인증 필수.
거래소 인증 승인(approve/reject/pending-verifications)은 auth_exchange.py에 별도.
"""
from __future__ import annotations

import os as _os
import secrets as _secrets
import time
from datetime import datetime, timezone

import bcrypt as _admin_bcrypt
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import asc, desc, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import JSONResponse

from src.db.session import get_db
from src.models.schemas import (
    ApiResponse,
    AdminLoginRequest, AdminUserIdRequest, AdminBlockUserRequest,
)
from src.models.tables import AccessLog, AdminAuditLog, User
from src.services.admin_helpers import (
    ADMIN_COOKIE,
    ADMIN_COOKIE_MAX_AGE,
    ADMIN_LOCK_SECONDS,
    ADMIN_MAX_FAILS,
    admin_audit,
    admin_login_fails,
    auth_admin_check,
    get_admin_cookie_sid,
    register_session,
    revoke_session,
    sign_admin_cookie,
)
from src.services.auth import hash_password

logger = structlog.get_logger(__name__)

router = APIRouter()


async def _safe_audit(db, **kwargs) -> None:
    """관리자 감사 로그 기록 — 실패해도 본 작업이 503으로 막히지 않도록 격리.

    admin_audit_logs 테이블 미존재/스키마 불일치 등에서도 회원 관리(등급/차단/닉네임/
    강제로그아웃 등)는 정상 동작해야 하므로 try/except 로 감싼다.
    """
    try:
        db.add(AdminAuditLog(**kwargs))
        await db.commit()
    except Exception as e:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.warning("admin.audit_skip", action=kwargs.get("action"), error=str(e)[:120])


# ══════════════════════════════════════════════
# 사용자 관리
# ══════════════════════════════════════════════

@router.get("/admin/users", response_model=ApiResponse)
async def admin_users(
    request: Request,
    q: str = "",
    page: int = 1,
    tier_filter: str = "",
    status_filter: str = "",
    sort: str = "created_desc",
    db: AsyncSession = Depends(get_db),
):
    """사용자 목록 (필터/정렬/페이징)."""
    await auth_admin_check(request)

    # 전체 등급 집계 (필터 무관)
    tier_counts = {}
    for row in (await db.execute(select(User.tier, func.count(User.id)).group_by(User.tier))).all():
        tier_counts[row[0]] = row[1]
    total_users = sum(tier_counts.values())

    # 필터링
    base = select(User)
    if q:
        q_safe = q.replace("%", "\\%")
        base = base.where(
            or_(
                User.email.ilike(f"%{q_safe}%"),
                User.nickname.ilike(f"%{q_safe}%"),
                User.referral_code.ilike(f"%{q_safe}%"),
            )
        )
    if tier_filter:
        base = base.where(User.tier == tier_filter)
    if status_filter == "active":
        base = base.where(User.is_active == True)  # noqa: E712
    elif status_filter == "blocked":
        base = base.where(User.is_active == False)  # noqa: E712
    elif status_filter == "verified":
        base = base.where(User.referral_exchange.isnot(None))
    elif status_filter == "unverified":
        base = base.where(User.referral_exchange.is_(None))
    # 삭제된(익명화된) 회원은 기본 숨김. status_filter='deleted' 로만 조회.
    if status_filter == "deleted":
        base = base.where(User.email.ilike("%\\_deleted\\_%"))
    else:
        base = base.where(~User.email.ilike("%\\_deleted\\_%"))

    # 정렬
    if sort == "created_asc":
        base = base.order_by(asc(User.created_at))
    else:
        base = base.order_by(desc(User.created_at))

    filtered_total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar() or 0
    per_page = 50
    result = await db.execute(base.offset((page - 1) * per_page).limit(per_page))
    users = result.scalars().all()

    # 최근 로그인 정보
    user_ids = [u.id for u in users]
    last_logins = {}
    if user_ids:
        for row in (
            await db.execute(
                select(AccessLog.user_id, func.max(AccessLog.created_at), func.max(AccessLog.ip))
                .where(AccessLog.user_id.in_(user_ids), AccessLog.event_type == "login_ok")
                .group_by(AccessLog.user_id)
            )
        ).all():
            last_logins[str(row[0])] = {"last_login": str(row[1]), "last_ip": row[2]}

    return ApiResponse(
        data={
            "total": total_users,
            "filtered": filtered_total,
            "page": page,
            "per_page": per_page,
            "tiers": tier_counts,
            "users": [
                {
                    "id": str(u.id), "email": u.email, "nickname": u.nickname,
                    "tier": u.tier, "role": u.role, "is_active": u.is_active,
                    "beom_allowed": bool(getattr(u, "beom_allowed", False)),
                    "bitmart_cid": u.bitmart_cid, "referral_code": u.referral_code,
                    "referral_exchange": u.referral_exchange,
                    "referral_verified_at": str(u.referral_verified_at) if u.referral_verified_at else None,
                    "email_verified_at": str(u.email_verified_at) if u.email_verified_at else None,
                    "created_at": str(u.created_at),
                    "last_login": last_logins.get(str(u.id), {}).get("last_login"),
                    "last_ip": last_logins.get(str(u.id), {}).get("last_ip"),
                }
                for u in users
            ],
        }
    )


@router.get("/admin/user-detail/{uid}", response_model=ApiResponse)
async def admin_user_detail(uid: str, request: Request, db: AsyncSession = Depends(get_db)):
    """사용자 상세 정보 (활동 이력 포함)."""
    await auth_admin_check(request)
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "User not found")
    # 최근 접속 로그
    logs = (
        await db.execute(
            select(AccessLog).where(AccessLog.user_id == uid).order_by(AccessLog.created_at.desc()).limit(20)
        )
    ).scalars().all()
    # AI 사용량
    from src.services.tier_guard import get_usage_info
    usage = get_usage_info(str(user.id))
    purchases = (await db.execute(text(
        "SELECT indicator_code, status, price, purchased_at FROM user_purchases WHERE user_id=:u ORDER BY created_at DESC"
    ), {"u": uid})).fetchall()
    return ApiResponse(
        data={
            "id": str(user.id), "email": user.email, "nickname": user.nickname,
            "purchases": [{"code": p[0], "status": p[1], "price": p[2],
                           "at": str(p[3]) if p[3] else None} for p in purchases],
            "tier": user.tier, "role": user.role, "is_active": user.is_active,
            "points": getattr(user, "points", 0) or 0,
            "beom_allowed": bool(getattr(user, "beom_allowed", False)),
            "referral_exchange": user.referral_exchange,
            "referral_verified_at": str(user.referral_verified_at) if user.referral_verified_at else None,
            "email_verified_at": str(user.email_verified_at) if user.email_verified_at else None,
            "created_at": str(user.created_at),
            "usage": usage,
            "recent_logs": [
                {"ip": l.ip, "path": l.path, "event": l.event_type, "at": str(l.created_at)} for l in logs
            ],
        }
    )


@router.post("/admin/set-beom-allowed", response_model=ApiResponse)
async def admin_set_beom_allowed(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """범온지표 설정 권한 부여/회수 (운영자 전용)."""
    await auth_admin_check(request)
    uid = req.get("user_id")
    if not uid and (req.get("email") or "").strip():
        row = (await db.execute(select(User).where(User.email == req["email"].strip()))).scalar()
        if not row:
            raise HTTPException(404, "해당 이메일의 회원 없음")
        uid = str(row.id)
    allowed = bool(req.get("allowed"))
    if not uid:
        raise HTTPException(400, "user_id 또는 email 필요")
    user = (await db.execute(select(User).where(User.id == uid))).scalar()
    if not user:
        raise HTTPException(404, "User not found")
    user.beom_allowed = allowed
    await db.commit()
    await _safe_audit(db,
        admin_id="admin_key", action="set_beom_allowed", target_user_id=user.id,
        detail={"allowed": allowed},
        ip=request.client.host if request.client else None,
    )
    return ApiResponse(data={"id": str(user.id), "beom_allowed": user.beom_allowed})


@router.post("/admin/set-tier", response_model=ApiResponse)
async def admin_set_tier(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """사용자 등급 변경."""
    await auth_admin_check(request)
    uid = req.get("user_id")
    tier = req.get("tier")
    if not uid or tier not in ("free", "pro", "premium"):
        raise HTTPException(400, "Invalid params")
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "User not found")
    user.tier = tier
    # tier 변경 시 referral 정보도 관리
    if tier == "free":
        user.referral_verified_at = None
        user.referral_exchange = None
    elif tier in ("pro", "premium") and not user.referral_verified_at:
        user.referral_verified_at = datetime.now(timezone.utc)
        user.referral_exchange = "admin"  # 관리자 수동 승급
    await db.commit()

    from src.services.beom_free import invalidate_tier_cache
    invalidate_tier_cache(str(user.id))

    await _safe_audit(db,
        admin_id="admin_key", action="set_tier", target_user_id=user.id,
        detail={"new_tier": tier, "exchange": user.referral_exchange},
        ip=request.client.host if request.client else None,
    )
    return ApiResponse(
        data={"id": str(user.id), "tier": user.tier, "referral_exchange": user.referral_exchange}
    )


@router.post("/admin/set-nickname", response_model=ApiResponse)
async def admin_set_nickname(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """관리자: 회원 닉네임 변경."""
    await auth_admin_check(request)
    uid = req.get("user_id")
    nickname = (req.get("nickname") or "").strip()
    if not uid or not (2 <= len(nickname) <= 20):
        raise HTTPException(400, "user_id와 2~20자 닉네임 필요")
    user = (await db.execute(select(User).where(User.id == uid))).scalar()
    if not user:
        raise HTTPException(404, "User not found")
    dup = (await db.execute(select(User).where(User.nickname == nickname, User.id != user.id))).scalar()
    if dup:
        raise HTTPException(400, "이미 사용 중인 닉네임")
    old = user.nickname
    user.nickname = nickname
    await db.commit()
    await _safe_audit(db,
        admin_id="admin_key", action="set_nickname", target_user_id=user.id,
        detail={"old": old, "new": nickname},
        ip=request.client.host if request.client else None,
    )
    return ApiResponse(data={"id": str(user.id), "nickname": user.nickname})


@router.post("/admin/reset-user-password", response_model=ApiResponse)
async def admin_reset_user_password(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """관리자가 회원 비밀번호 초기화/변경."""
    await auth_admin_check(request)
    uid = req.get("user_id")
    new_password = req.get("new_password", "")
    if not uid or not new_password or len(new_password) < 6:
        raise HTTPException(400, "user_id와 new_password(6자 이상) 필요")
    import uuid as _uuid
    try:
        _uuid.UUID(uid)
    except Exception:
        raise HTTPException(400, "Invalid user_id")
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "User not found")
    user.password_hash = hash_password(new_password)
    await db.commit()
    return ApiResponse(data={"reset": True, "user_id": uid})


@router.post("/admin/revoke-referral", response_model=ApiResponse)
async def admin_revoke_referral(
    req: AdminUserIdRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _admin: None = Depends(auth_admin_check),
):
    """레퍼럴 인증 취소 → free로 다운그레이드."""
    uid = req.user_id
    if not uid:
        raise HTTPException(400, "user_id required")
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "User not found")
    user.tier = "free"
    user.referral_verified_at = None
    user.referral_exchange = None
    await db.commit()
    logger.info("admin.revoke_referral", target=str(user.id), admin_key="***")
    return ApiResponse(data={"id": str(user.id), "tier": "free", "revoked": True})


@router.post("/admin/block-user", response_model=ApiResponse)
async def admin_block_user(
    req: AdminBlockUserRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _admin: None = Depends(auth_admin_check),
):
    """사용자 차단/해제."""
    uid = req.user_id
    block = req.block
    if not uid:
        raise HTTPException(400, "user_id required")
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "User not found")
    user.is_active = not block
    await db.commit()
    logger.info("admin.block_user", target=str(user.id), blocked=block)
    return ApiResponse(data={"id": str(user.id), "is_active": user.is_active})


@router.post("/admin/force-logout", response_model=ApiResponse)
async def admin_force_logout(
    req: AdminUserIdRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _admin: None = Depends(auth_admin_check),
):
    """강제 로그아웃 — token_version 증가로 기존 JWT 즉시 무효화."""
    uid = req.user_id
    if not uid:
        raise HTTPException(400, "user_id required")
    result = await db.execute(select(User).where(User.id == uid))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "User not found")
    new_tv = (user.token_version or 0) + 1
    try:
        user.token_version = new_tv
        await db.commit()
    except Exception as e:
        # token_version 컬럼 부재/스키마 불일치 등 — 강제로그아웃은 best-effort 로 처리
        try:
            await db.rollback()
        except Exception:
            pass
        logger.warning("admin.force_logout_tv_skip", target=str(uid), error=str(e)[:120])
        return ApiResponse(data={"id": str(uid), "forced": False, "note": "토큰 버전 갱신 불가(스키마) — 세션 만료로 대체됩니다."})
    # 캐시 즉시 무효화
    try:
        from src.services.auth import _tv_cache
        _tv_cache.pop(str(user.id), None)
        from src.services.beom_free import invalidate_tier_cache
        invalidate_tier_cache(str(user.id))
    except Exception:
        pass
    await _safe_audit(db,
        admin_id="admin_key", action="force_logout", target_user_id=user.id,
        detail={"old_tv": new_tv - 1},
        ip=request.client.host if request.client else None,
    )
    logger.info("admin.force_logout", target=str(user.id), tv=user.token_version)
    return ApiResponse(
        data={"id": str(user.id), "forced": True, "token_version": user.token_version}
    )


# ══════════════════════════════════════════════
# 로그 조회
# ══════════════════════════════════════════════

@router.get("/admin/access-logs", response_model=ApiResponse)
async def admin_access_logs(
    request: Request,
    page: int = 1,
    event_type: str = "",
    db: AsyncSession = Depends(get_db),
):
    """접속/인증 로그 조회."""
    await auth_admin_check(request)
    q = select(AccessLog).order_by(desc(AccessLog.created_at))
    if event_type:
        q = q.where(AccessLog.event_type == event_type)
    total_q = select(func.count(AccessLog.id))
    if event_type:
        total_q = total_q.where(AccessLog.event_type == event_type)
    total = (await db.execute(total_q)).scalar() or 0
    per_page = 50
    q = q.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(q)
    logs = result.scalars().all()
    return ApiResponse(
        data={
            "total": total, "page": page, "per_page": per_page,
            "logs": [
                {
                    "id": str(l.id), "ip": l.ip, "path": l.path, "method": l.method,
                    "event_type": l.event_type,
                    "user_id": str(l.user_id) if l.user_id else None,
                    "user_agent": l.user_agent, "status_code": l.status_code,
                    "created_at": str(l.created_at),
                }
                for l in logs
            ],
        }
    )


# ══════════════════════════════════════════════
# 세션 관리 (로그인/로그아웃)
# ══════════════════════════════════════════════

@router.post("/admin/login", response_model=ApiResponse)
async def admin_login(req: AdminLoginRequest, request: Request):
    """관리자 로그인 — key + password 2요소 검증."""
    ip = request.client.host if request.client else "unknown"

    # Rate limit 체크
    state = admin_login_fails.get(ip, {"count": 0, "locked_until": 0})
    if time.time() < state.get("locked_until", 0):
        admin_audit("admin_login_locked", request)
        raise HTTPException(429, "잠금 상태입니다. 잠시 후 다시 시도하세요.")

    admin_key = _os.getenv("ADMIN_KEY", "")
    pw_hash = _os.getenv("ADMIN_PASSWORD_HASH", "")
    input_key = req.key
    input_pw = req.password

    # 2요소 검증
    key_ok = admin_key and input_key == admin_key
    pw_ok = False
    if pw_hash and input_pw:
        try:
            pw_ok = _admin_bcrypt.checkpw(input_pw.encode(), pw_hash.encode())
        except Exception as e:
            logger.debug("admin.login_bcrypt_fail", error=str(e)[:100])

    if not key_ok or not pw_ok:
        state["count"] = state.get("count", 0) + 1
        if state["count"] >= ADMIN_MAX_FAILS:
            state["locked_until"] = time.time() + ADMIN_LOCK_SECONDS
            admin_audit("admin_login_locked", request, fails=state["count"])
        admin_login_fails[ip] = state
        admin_audit("admin_login_fail", request)
        raise HTTPException(403, "인증 실패")

    # 성공 — 실패 카운트 초기화
    admin_login_fails.pop(ip, None)

    token, sid = sign_admin_cookie()
    await register_session(sid)
    admin_audit("admin_login_ok", request)

    resp = JSONResponse({"success": True, "data": {"authenticated": True}})
    is_prod = _os.getenv("ENV", "").lower() in ("prod", "production")
    resp.set_cookie(
        ADMIN_COOKIE, token,
        httponly=True, secure=is_prod, samesite="lax",
        max_age=ADMIN_COOKIE_MAX_AGE, path="/",
    )
    # CSRF 토큰 (admin 세션용)
    csrf_token = _secrets.token_urlsafe(32)
    resp.set_cookie(
        "csrf_token", csrf_token,
        httponly=False, secure=is_prod, samesite="lax",
        max_age=ADMIN_COOKIE_MAX_AGE, path="/",
    )
    resp.headers["Cache-Control"] = "no-store"
    return resp


@router.post("/admin/logout", response_model=ApiResponse)
async def admin_logout(request: Request):
    """관리자 로그아웃 — 세션 쿠키 삭제 + Redis 세션 폐기."""
    sid = get_admin_cookie_sid(request)
    if sid:
        await revoke_session(sid)
    admin_audit("admin_logout", request)
    resp = JSONResponse({"success": True, "data": {"logged_out": True}})
    resp.delete_cookie(ADMIN_COOKIE, path="/")
    return resp


@router.post("/admin/create-user", response_model=ApiResponse)
async def admin_create_user(data: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """관리자 회원 생성."""
    await auth_admin_check(request)
    
    email = data.get("email", "").strip()
    nickname = data.get("nickname", "").strip()
    password = data.get("password", "")
    tier = data.get("tier", "free")
    
    if not email or not nickname or not password:
        return ApiResponse(data={"error": "email, nickname, password 필수"})
    
    # 중복 확인
    existing = (await db.execute(text("SELECT 1 FROM users WHERE email = :e OR nickname = :n"), {"e": email, "n": nickname})).fetchone()
    if existing:
        return ApiResponse(data={"error": "이미 존재하는 이메일 또는 닉네임"})
    
    # 비밀번호 해시
    import bcrypt
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    
    # 생성
    await db.execute(text("""
        INSERT INTO users (id, email, nickname, password_hash, tier, created_at)
        VALUES (gen_random_uuid(), :email, :nick, :pw, :tier, now())
    """), {"email": email, "nick": nickname, "pw": pw_hash, "tier": tier})
    await db.commit()
    
    return ApiResponse(data={"success": True, "message": f"{nickname} 계정 생성 완료"})
