"""인증 API."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.session import get_db
from src.models.tables import User
from src.models.schemas import (
    ApiResponse, SignupRequest, LoginRequest, UserOut,
    UpdateProfileRequest, DeleteAccountRequest, ForgotPasswordRequest,
    ConfirmResetRequest, FcmTokenRequest,
)
from src.services.auth import hash_password, verify_password, create_access_token, create_refresh_token, get_current_user_id
from src.services.auth_helpers import (
    set_auth_cookies as _set_auth_cookies,
    clear_auth_cookies as _clear_auth_cookies,
    effective_tier as _effective_tier,
)
from datetime import datetime, timezone

router = APIRouter()



@router.post("/signup", response_model=ApiResponse)
async def signup(req: SignupRequest, request: Request, db: AsyncSession = Depends(get_db)):
    from src.models.tables import AccessLog
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")[:500]
    # 이메일 형식 추가 검증
    import re
    if not re.match(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$', req.email):
        raise HTTPException(400, "올바른 이메일 형식이 아닙니다")
    existing = await db.execute(select(User).where(User.email == req.email))
    if existing.scalar():
        raise HTTPException(409, "이미 가입된 이메일입니다")
    user = User(email=req.email, password_hash=hash_password(req.password), nickname=req.nickname,
                phone=req.phone or None,
                gender=(req.gender or None), birthday=(req.birthday or None),
                birth_year=(req.birth_year or None), age_range=(req.age_range or None))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    db.add(AccessLog(ip=ip, path="/v1/auth/signup", method="POST", user_id=user.id, user_agent=ua, event_type="signup"))
    await db.commit()
    # 레퍼럴 코드 자동 발급
    try:
        from src.api.referral import _generate_code
        for _ in range(10):
            code = _generate_code()
            exists = (await db.execute(text("SELECT 1 FROM referral_codes WHERE code = :c"), {"c": code})).fetchone()
            if not exists:
                await db.execute(text("INSERT INTO referral_codes (user_id, code) VALUES (:uid, :c)"), {"uid": str(user.id), "c": code})
                await db.execute(text("UPDATE users SET referral_code = :c WHERE id = :uid"), {"uid": str(user.id), "c": code})
                await db.commit()
                break
    except Exception:
        pass  # 레퍼럴 실패해도 가입은 성공
    access = create_access_token(str(user.id), _effective_tier(user), str(user.created_at.isoformat()), user.role, getattr(user,'token_version',0) or 0)
    refresh = create_refresh_token(str(user.id), getattr(user, 'token_version', 0) or 0)
    from starlette.responses import JSONResponse
    resp = JSONResponse({"success": True, "data": {
        "user": {"id": str(user.id), "email": user.email, "nickname": user.nickname, "role": user.role, "tier": _effective_tier(user)},
        "tokens": {"access_token": access, "refresh_token": refresh, "expires_in": 3600}
    }})
    _set_auth_cookies(resp, access, refresh, request)
    return resp

@router.post("/login", response_model=ApiResponse)
async def login(req: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    from src.services.access_log import is_locked, record_failure, clear_failures, get_lock_remaining
    from src.models.tables import AccessLog
    import asyncio
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")[:500]
    # 잠금 확인 — 5회 실패 시 30분 잠금 (brute-force 방어)
    if is_locked(ip):
        remaining = get_lock_remaining(ip)
        db.add(AccessLog(ip=ip, path="/v1/auth/login", method="POST", user_agent=ua, event_type="locked"))
        await db.commit()
        raise HTTPException(429, f"로그인 시도가 너무 많습니다. {remaining//60}분 후 재시도하시거나 비밀번호 재설정을 이용하세요")
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar()
    if not user or not user.password_hash or not verify_password(req.password, user.password_hash):
        record_failure(ip)
        from src.services.access_log import _login_failures, MAX_FAILURES, LOCK_SECONDS
        import time as _t
        recent = [t for t in _login_failures.get(ip, []) if _t.time() - t < LOCK_SECONDS]
        remaining = MAX_FAILURES - len(recent)
        db.add(AccessLog(ip=ip, path="/v1/auth/login", method="POST", user_agent=ua, event_type="login_fail"))
        await db.commit()
        # 실패당 슬로우다운 — timing attack + brute-force 둘 다 방어
        # 1회: 0.5s, 2회: 1s, 3회: 2s, 4회: 4s 대기
        delay = min(2 ** len(recent) * 0.25, 4.0)
        await asyncio.sleep(delay)
        msg = f"이메일 또는 비밀번호가 틀렸습니다 (남은 시도: {remaining}회)" if remaining > 0 else "로그인 시도 초과"
        raise HTTPException(401, msg)
    clear_failures(ip)
    db.add(AccessLog(ip=ip, path="/v1/auth/login", method="POST", user_id=user.id, user_agent=ua, event_type="login_ok"))
    await db.commit()
    access = create_access_token(str(user.id), _effective_tier(user), str(user.created_at.isoformat()), user.role, getattr(user,'token_version',0) or 0)
    refresh = create_refresh_token(str(user.id), getattr(user, 'token_version', 0) or 0)
    from starlette.responses import JSONResponse
    resp = JSONResponse({"success": True, "data": {
        "user": {"id": str(user.id), "email": user.email, "nickname": user.nickname, "role": user.role, "tier": _effective_tier(user)},
        "tokens": {"access_token": access, "refresh_token": refresh, "expires_in": 3600}
    }})
    _set_auth_cookies(resp, access, refresh, request)
    return resp

@router.get("/referral-stats", response_model=ApiResponse)
async def referral_stats(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import func
    result = await db.execute(
        select(User.referral_code, func.count(User.id)).where(User.referral_code.isnot(None)).group_by(User.referral_code)
    )
    stats = {code: count for code, count in result.all()}
    return ApiResponse(data={"total_referrals": sum(stats.values()), "by_code": stats})

# ═══ 거래소 인증 — src/api/auth_exchange.py 로 분리 ═══
from src.api.auth_exchange import router as _exchange_router
router.include_router(_exchange_router)

@router.get("/me", response_model=ApiResponse)
async def get_me(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "User not found")
    from src.api.purchases import get_purchased_codes
    purchased = await get_purchased_codes(db, str(user.id))
    return ApiResponse(data=UserOut(id=user.id, email=user.email, nickname=user.nickname, role=user.role, tier=user.tier, email_verified=user.email_verified_at is not None, beom_allowed=bool(getattr(user, "beom_allowed", False)) or user.role == "admin", purchased=purchased))

@router.post("/update-profile", response_model=ApiResponse)
async def update_profile(req: UpdateProfileRequest, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "User not found")
    if req.nickname:
        nick = req.nickname.strip()
        if not (2 <= len(nick) <= 20):
            raise HTTPException(400, "닉네임은 2~20자여야 합니다")
        dup = (await db.execute(select(User).where(User.nickname == nick, User.id != user.id))).scalar()
        if dup:
            raise HTTPException(400, "이미 사용 중인 닉네임입니다")
        user.nickname = nick
    password_changed = False
    if req.old_password and req.new_password:
        if not verify_password(req.old_password, user.password_hash):
            raise HTTPException(400, "현재 비밀번호가 틀렸습니다")
        user.password_hash = hash_password(req.new_password)
        user.token_version = (user.token_version or 0) + 1
        password_changed = True
    await db.commit()
    if password_changed:
        from src.services.auth import _tv_cache
        _tv_cache.pop(str(user.id), None)
    return ApiResponse(data={"nickname": user.nickname, "password_changed": password_changed})

@router.post("/delete-account", response_model=ApiResponse)
async def delete_account(req: DeleteAccountRequest, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """회원 탈퇴."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "User not found")
    if not req.password or not verify_password(req.password, user.password_hash):
        raise HTTPException(400, "비밀번호가 틀렸습니다")
    await db.delete(user)
    await db.commit()
    return ApiResponse(data={"deleted": True})

# ── 관리자 API ──
@router.post("/reset-password", response_model=ApiResponse)
async def reset_password(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """관리자 비밀번호 재설정 — reset link 발송."""
    await _auth_admin_check(request)
    import secrets as _sec
    email = (req.get("email") or "").strip()
    if not email:
        raise HTTPException(400, "이메일을 입력하세요")
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "등록되지 않은 이메일입니다")
    token = _sec.token_urlsafe(32)
    user.reset_token = token
    user.reset_token_at = datetime.now(timezone.utc)
    await db.commit()
    from src.services.email_service import send_password_reset_email
    sent = send_password_reset_email(user.email, token)
    return ApiResponse(data={"sent": sent, "email": email})

async def _auth_admin_check(request: Request):
    """Alias to src/services/admin_helpers.py:auth_admin_check.

    하위 호환을 위해 유지됨. 새 코드는 admin_helpers에서 직접 import 권장.
    """
    from src.services.admin_helpers import auth_admin_check
    return await auth_admin_check(request)


# ═══ 관리자 엔드포인트 — src/api/auth_admin.py 로 분리 ═══
from src.api.auth_admin import router as _admin_router
router.include_router(_admin_router)



# ═══ 이메일 인증 ═══
@router.post("/send-verification", response_model=ApiResponse)
async def send_verification(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """이메일 인증 메일 발송."""
    import secrets
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar()
    if not user:
        raise HTTPException(404, "User not found")
    if user.email_verified_at:
        return ApiResponse(data={"already_verified": True})
    token = secrets.token_urlsafe(32)
    user.email_token = token
    from datetime import datetime, timezone
    user.updated_at = datetime.now(timezone.utc)  # 토큰 생성 시간 기록
    await db.commit()
    from src.services.email_service import send_verification_email
    ok = send_verification_email(user.email, token)
    if not ok:
        return ApiResponse(data={"sent": False, "reason": "메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요."})
    return ApiResponse(data={"sent": True})

@router.get("/verify-email", response_model=ApiResponse)
async def verify_email(token: str, db: AsyncSession = Depends(get_db)):
    """이메일 인증 토큰 검증."""
    if not token:
        raise HTTPException(400, "토큰이 필요합니다")
    result = await db.execute(select(User).where(User.email_token == token))
    user = result.scalar()
    if not user:
        raise HTTPException(400, "유효하지 않은 인증 링크입니다")
    from datetime import datetime, timezone
    user.email_verified_at = datetime.now(timezone.utc)
    user.email_token = None
    # 추천 보상: 피추천인 이메일 인증 완료 시 추천인에게 1회 지급(멱등). 실패해도 인증은 진행.
    try:
        from src.api.referral import reward_referrer_on_verify
        await reward_referrer_on_verify(db, str(user.id))
    except Exception:
        pass
    await db.commit()
    from starlette.responses import HTMLResponse
    return HTMLResponse('<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#F7F1EA;color:#3D2B1F;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,-apple-system,sans-serif;margin:0"><div style="text-align:center;background:#F3ECE4;padding:40px;border-radius:12px;border:1px solid rgba(216,182,106,0.25);box-shadow:0 4px 16px rgba(146,18,48,0.08);max-width:400px"><div style="font-size:40px;margin-bottom:12px">✅</div><h1 style="color:#921230;font-size:20px;margin:0 0 8px">이메일 인증 완료</h1><p style="color:#8E7D72;font-size:13px;margin:0 0 20px">이메일 인증이 완료되었습니다.</p><a href="/" style="display:inline-block;padding:10px 24px;background:#921230;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px">서비스로 돌아가기</a></div></body></html>')

# ═══ 비밀번호 자가 재설정 ═══
@router.post("/forgot-password", response_model=ApiResponse)
async def forgot_password(req: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """비밀번호 재설정 이메일 발송."""
    import secrets
    email = (req.email or "").strip()
    if not email:
        raise HTTPException(400, "이메일을 입력해주세요")
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar()
    # 사용자 존재 여부와 관계없이 동일 응답 (이메일 열거 방지)
    if user:
        token = secrets.token_urlsafe(32)
        from datetime import datetime, timezone
        user.reset_token = token
        user.reset_token_at = datetime.now(timezone.utc)
        await db.commit()
        from src.services.email_service import send_password_reset_email
        ok = send_password_reset_email(user.email, token)
    return ApiResponse(data={"sent": True, "message": "이메일이 등록되어 있다면 재설정 링크가 발송됩니다."})

@router.get("/reset-password-page")
async def reset_password_page(token: str):
    """비밀번호 재설정 페이지 (HTML)."""
    from starlette.responses import HTMLResponse
    return HTMLResponse(f'''<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#F7F1EA;color:#3D2B1F;display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,-apple-system,sans-serif;margin:0">
    <div style="background:#F3ECE4;padding:30px;border-radius:12px;border:1px solid rgba(216,182,106,0.25);box-shadow:0 4px 16px rgba(146,18,48,0.08);max-width:360px;width:90%">
    <h2 style="color:#921230;text-align:center;margin:0 0 16px">🔑 비밀번호 재설정</h2>
    <input id="pw1" type="password" placeholder="새 비밀번호 (8자 이상)" style="width:100%;padding:10px;margin:6px 0;background:#FFFDF9;border:1px solid rgba(216,182,106,0.3);border-radius:6px;color:#3D2B1F;font-size:13px;box-sizing:border-box">
    <input id="pw2" type="password" placeholder="비밀번호 확인" style="width:100%;padding:10px;margin:6px 0;background:#FFFDF9;border:1px solid rgba(216,182,106,0.3);border-radius:6px;color:#3D2B1F;font-size:13px;box-sizing:border-box">
    <button onclick="resetPw()" style="width:100%;padding:10px;background:#921230;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;margin-top:8px">재설정</button>
    <p id="msg" style="margin-top:12px;font-size:12px;text-align:center"></p>
    <script>
    async function resetPw(){{
      const pw1=document.getElementById("pw1").value;
      const pw2=document.getElementById("pw2").value;
      const msg=document.getElementById("msg");
      if(pw1.length<8){{msg.textContent="8자 이상 입력해주세요";msg.style.color="#C4384B";return}}
      if(pw1!==pw2){{msg.textContent="비밀번호가 일치하지 않습니다";msg.style.color="#C4384B";return}}
      const r=await fetch("/v1/auth/confirm-reset",{{method:"POST",headers:{{"Content-Type":"application/json"}},body:JSON.stringify({{token:"{token}",password:pw1}})}});
      const d=await r.json();
      if(d.success){{msg.textContent="✅ 비밀번호가 변경되었습니다. 로그인해주세요.";msg.style.color="#1f7a4d"}}
      else{{msg.textContent=d.detail||"실패";msg.style.color="#C4384B"}}
    }}
    </script>
    </div></body></html>''')

@router.post("/confirm-reset", response_model=ApiResponse)
async def confirm_reset(req: ConfirmResetRequest, db: AsyncSession = Depends(get_db)):
    """비밀번호 재설정 확인."""
    token = req.token
    password = req.password
    if not token or len(password) < 8 or len(password) > 72:
        raise HTTPException(400, "유효하지 않은 요청입니다")
    result = await db.execute(select(User).where(User.reset_token == token))
    user = result.scalar()
    if not user:
        raise HTTPException(400, "유효하지 않은 링크입니다")
    # 1시간 만료 체크
    from datetime import datetime, timezone, timedelta
    if user.reset_token_at and (datetime.now(timezone.utc) - user.reset_token_at) > timedelta(hours=1):
        raise HTTPException(400, "링크가 만료되었습니다. 다시 요청해주세요.")
    user.password_hash = hash_password(password)
    user.reset_token = None
    user.reset_token_at = None
    user.token_version = (user.token_version or 0) + 1  # 기존 세션 무효화
    await db.commit()
    from src.services.auth import _tv_cache
    _tv_cache.pop(str(user.id), None)
    from src.services.beom_free import invalidate_tier_cache
    invalidate_tier_cache(str(user.id))
    return ApiResponse(data={"reset": True})


@router.post("/refresh", response_model=ApiResponse)
async def refresh_token(request: Request, db: AsyncSession = Depends(get_db)):
    """refresh 쿠키로 access 토큰 재발급 (60분 만료 시 자동 갱신용)."""
    from starlette.responses import JSONResponse
    from src.services.auth import decode_token, create_access_token, create_refresh_token
    rt = request.cookies.get("refresh_token")
    if not rt:
        raise HTTPException(401, "refresh 토큰이 없습니다")
    try:
        payload = decode_token(rt)
        if payload.get("type") != "refresh":
            raise ValueError("not refresh")
        uid = payload.get("sub")
        token_tv = payload.get("tv")
        if not uid or type(token_tv) is not int:
            raise ValueError("refresh token missing token_version")
    except Exception:
        raise HTTPException(401, "유효하지 않은 refresh 토큰입니다")
    user = (await db.execute(select(User).where(User.id == uid))).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(401, "사용자를 찾을 수 없습니다")
    current_tv = getattr(user, "token_version", 0) or 0
    if token_tv != current_tv:
        raise HTTPException(401, "폐기된 refresh 토큰입니다. 다시 로그인해주세요")
    access = create_access_token(str(user.id), _effective_tier(user), str(user.created_at.isoformat()), user.role, current_tv)
    new_refresh = create_refresh_token(str(user.id), current_tv)
    resp = JSONResponse({"success": True, "data": {"expires_in": 3600}})
    _set_auth_cookies(resp, access, new_refresh, request)
    return resp


@router.post("/logout")
async def user_logout():
    """일반 사용자 로그아웃 — auth 쿠키 삭제."""
    from starlette.responses import JSONResponse
    resp = JSONResponse({"success": True})
    _clear_auth_cookies(resp)
    return resp

# ═══ 소셜 로그인 (Google) — src/api/auth_oauth.py 로 분리 ═══
from src.api.auth_oauth import router as _oauth_router
router.include_router(_oauth_router)


# ═══ 관리자 확장 ═══
@router.post("/fcm-token", response_model=ApiResponse)
async def save_fcm_token(req: FcmTokenRequest, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """FCM 푸시 토큰 저장."""
    token = (req.token or "").strip()
    if not token:
        raise HTTPException(400, "token required")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar()
    if user:
        user.fcm_token = token
        await db.commit()
    return ApiResponse(data={"saved": True})


# ═══ 관리자 세션 (HttpOnly cookie) — src/services/admin_helpers.py 로 이전 ═══
# 하위 호환 re-export — 외부 모듈(main.py, analysis.py)이 _verify_admin_cookie_async 참조.
# noqa: F401 — re-export 의도이므로 ruff F401 무시.
from src.services.admin_helpers import (
    verify_admin_cookie as _verify_admin_cookie,  # noqa: F401
    verify_admin_cookie_async as _verify_admin_cookie_async,  # noqa: F401
)

