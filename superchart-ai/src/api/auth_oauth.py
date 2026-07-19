"""Google · Naver OAuth 로그인 엔드포인트.

src/api/auth.py에서 분리:
- GET /v1/auth/google/login    — Google OAuth URL 리다이렉트 + signed state 발급
- GET /v1/auth/google/callback — 콜백 처리 + 계정 생성/로그인
- GET /v1/auth/naver/login     — Naver OAuth URL 리다이렉트 + signed state 발급
- GET /v1/auth/naver/callback  — 콜백 처리 + 계정 생성/로그인

환경변수 필요:
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI (선택, 기본: BASE_URL + /v1/auth/google/callback)
- NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
- NAVER_REDIRECT_URI (선택, 기본: BASE_URL + /v1/auth/naver/callback)
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta

import httpx
import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from jose import jwt as _jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import HTMLResponse, RedirectResponse

from src.db.session import get_db
from src.models.tables import User
from src.services.auth import (
    create_access_token,
    create_refresh_token,
    hash_password,
    settings as _auth_settings,
)
from src.services.auth_helpers import effective_tier, set_auth_cookies

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/google/login")
async def google_login():
    """Google OAuth 로그인 URL 생성 — signed state."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    redirect_uri = os.getenv(
        "GOOGLE_REDIRECT_URI",
        os.getenv("BASE_URL", "http://localhost:8000") + "/v1/auth/google/callback",
    )
    if not client_id:
        raise HTTPException(503, "Google 로그인이 설정되지 않았습니다")

    # signed state (JWT 기반 — Redis 불필요)
    state = _jwt.encode(
        {
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
            "purpose": "oauth",
        },
        _auth_settings.jwt_secret,
        algorithm="HS256",
    )
    url = (
        f"https://accounts.google.com/o/oauth2/v2/auth?"
        f"client_id={client_id}&redirect_uri={redirect_uri}"
        f"&response_type=code&scope=openid%20email%20profile"
        f"&state={state}&access_type=offline&prompt=select_account"
    )
    return RedirectResponse(url)


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
    db: AsyncSession = Depends(get_db),
):
    """Google OAuth 콜백 — state 검증 + 토큰 교환 + 사용자 생성/로그인."""
    if error:
        return HTMLResponse(
            '<html><body><script>alert("Google 로그인 취소");window.location.href="/";</script></body></html>'
        )

    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
    redirect_uri = os.getenv(
        "GOOGLE_REDIRECT_URI",
        os.getenv("BASE_URL", "http://localhost:8000") + "/v1/auth/google/callback",
    )
    if not all([client_id, client_secret, code]):
        raise HTTPException(400, "인증 실패")

    # state 검증 (signed JWT) — 반드시 존재해야 함. 빈 값으로 검증을 건너뛸 수
    # 있으면 공격자가 state 없이 직접 callback URL을 피해자에게 열게 해
    # Login CSRF(피해자를 공격자 의도의 계정으로 로그인시키는 공격)가 가능하다.
    if not state:
        raise HTTPException(400, "Invalid state")
    try:
        payload = _jwt.decode(state, _auth_settings.jwt_secret, algorithms=["HS256"])
        if payload.get("purpose") != "oauth":
            raise HTTPException(400, "Invalid state")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Invalid or expired state")

    # 토큰 교환
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        if r.status_code != 200:
            logger.warning(
                "oauth.google.token_exchange_failed",
                status=r.status_code,
                body=r.text[:300],
                redirect_uri=redirect_uri,
                client_id_tail=client_id[-12:] if client_id else "",
            )
            raise HTTPException(400, "Google 인증 실패")
        tokens = r.json()

        r2 = await c.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {tokens['access_token']}"},
        )
        if r2.status_code != 200:
            raise HTTPException(400, "사용자 정보 조회 실패")
        info = r2.json()

    email = info.get("email", "")
    name = info.get("name", email.split("@")[0] if email else "User")
    if not email:
        raise HTTPException(400, "이메일 정보 없음")

    # 기존 사용자 확인 (이메일 기준)
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar()
    if not user:
        # 신규 가입
        import secrets as _sec
        user = User(
            email=email,
            password_hash=hash_password(_sec.token_urlsafe(16)),
            nickname=name[:80],
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    # JWT 발급 — effective_tier 적용
    tier = effective_tier(user)
    access = create_access_token(
        str(user.id),
        tier,
        str(user.created_at.isoformat()),
        user.role,
        getattr(user, "token_version", 0) or 0,
    )
    refresh = create_refresh_token(str(user.id), getattr(user, 'token_version', 0) or 0)

    resp = RedirectResponse("/")
    set_auth_cookies(resp, access, refresh, request)
    return resp


# ═══════════════════════════ 네이버 OAuth ═══════════════════════════
# 환경변수 필요:
# - NAVER_CLIENT_ID, NAVER_CLIENT_SECRET
# - NAVER_REDIRECT_URI (선택, 기본: BASE_URL + /v1/auth/naver/callback)


@router.get("/naver/login")
async def naver_login():
    """네이버 OAuth 로그인 URL 생성 — signed state(CSRF 방지)."""
    client_id = os.getenv("NAVER_CLIENT_ID", "")
    redirect_uri = os.getenv(
        "NAVER_REDIRECT_URI",
        os.getenv("BASE_URL", "http://localhost:8000") + "/v1/auth/naver/callback",
    )
    if not client_id:
        raise HTTPException(503, "네이버 로그인이 설정되지 않았습니다")

    # signed state (JWT 기반 — Redis 불필요). 네이버는 state 필수.
    state = _jwt.encode(
        {
            "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
            "purpose": "oauth",
        },
        _auth_settings.jwt_secret,
        algorithm="HS256",
    )
    from urllib.parse import quote as _q
    url = (
        f"https://nid.naver.com/oauth2.0/authorize?"
        f"response_type=code&client_id={client_id}"
        f"&redirect_uri={_q(redirect_uri, safe='')}"
        f"&state={state}"
    )
    return RedirectResponse(url)


@router.get("/naver/callback")
async def naver_callback(
    request: Request,
    code: str = "",
    state: str = "",
    error: str = "",
    db: AsyncSession = Depends(get_db),
):
    """네이버 OAuth 콜백 — state 검증 + 토큰 교환 + 사용자 생성/로그인."""
    if error:
        return HTMLResponse(
            '<html><body><script>alert("네이버 로그인 취소");window.location.href="/";</script></body></html>'
        )

    client_id = os.getenv("NAVER_CLIENT_ID", "")
    client_secret = os.getenv("NAVER_CLIENT_SECRET", "")
    redirect_uri = os.getenv(
        "NAVER_REDIRECT_URI",
        os.getenv("BASE_URL", "http://localhost:8000") + "/v1/auth/naver/callback",
    )
    if not all([client_id, client_secret, code]):
        raise HTTPException(400, "인증 실패")

    # state 검증 (signed JWT) — Login CSRF 방지. 빈 값 금지.
    if not state:
        raise HTTPException(400, "Invalid state")
    try:
        payload = _jwt.decode(state, _auth_settings.jwt_secret, algorithms=["HS256"])
        if payload.get("purpose") != "oauth":
            raise HTTPException(400, "Invalid state")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Invalid or expired state")

    # 토큰 교환
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.post(
            "https://nid.naver.com/oauth2.0/token",
            data={
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "state": state,
            },
        )
        if r.status_code != 200:
            logger.warning(
                "oauth.naver.token_exchange_failed",
                status=r.status_code,
                body=r.text[:300],
                redirect_uri=redirect_uri,
                client_id_tail=client_id[-8:] if client_id else "",
            )
            raise HTTPException(400, "네이버 인증 실패")
        tokens = r.json()
        access_token = tokens.get("access_token")
        if not access_token:
            logger.warning("oauth.naver.no_access_token", body=r.text[:300])
            raise HTTPException(400, "네이버 인증 실패")

        r2 = await c.get(
            "https://openapi.naver.com/v1/nid/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if r2.status_code != 200:
            raise HTTPException(400, "사용자 정보 조회 실패")
        body = r2.json()

    # 네이버 응답: { "resultcode": "00", "message": "success", "response": {...} }
    info = (body or {}).get("response", {}) if isinstance(body, dict) else {}
    email = info.get("email", "")
    name = info.get("name") or info.get("nickname") or (email.split("@")[0] if email else "User")
    if not email:
        raise HTTPException(400, "이메일 정보 없음 (네이버 계정에서 이메일 제공 동의가 필요합니다)")

    # 네이버가 제공하는 추가 정보(권한 승인 항목만 채워짐)
    gender = (info.get("gender") or "")[:10] or None            # M / F / U
    birthday = (info.get("birthday") or "")[:10] or None         # MM-DD
    birth_year = (info.get("birthyear") or "")[:4] or None       # YYYY
    age_range = (info.get("age") or "")[:20] or None             # 예: 20-29
    phone = (info.get("mobile") or info.get("mobile_e164") or "")[:20] or None

    # 기존 사용자 확인 (이메일 기준) — 구글/네이버/일반가입 계정을 이메일로 통합
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar()
    if not user:
        import secrets as _sec
        user = User(
            email=email,
            password_hash=hash_password(_sec.token_urlsafe(16)),
            nickname=name[:80],
            gender=gender, birthday=birthday, birth_year=birth_year,
            age_range=age_range, phone=phone,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    else:
        # 기존 계정: 비어 있는 프로필 정보만 네이버 값으로 보강(기존 값 덮어쓰지 않음)
        changed = False
        for attr, val in (("gender", gender), ("birthday", birthday), ("birth_year", birth_year),
                          ("age_range", age_range), ("phone", phone)):
            if val and not getattr(user, attr, None):
                setattr(user, attr, val); changed = True
        if changed:
            await db.commit()

    # JWT 발급 — effective_tier 적용
    tier = effective_tier(user)
    access = create_access_token(
        str(user.id),
        tier,
        str(user.created_at.isoformat()),
        user.role,
        getattr(user, "token_version", 0) or 0,
    )
    refresh = create_refresh_token(str(user.id), getattr(user, "token_version", 0) or 0)

    resp = RedirectResponse("/")
    set_auth_cookies(resp, access, refresh, request)
    return resp
