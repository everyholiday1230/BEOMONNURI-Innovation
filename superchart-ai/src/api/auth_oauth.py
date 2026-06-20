"""Google OAuth 로그인 엔드포인트.

src/api/auth.py에서 분리:
- GET /v1/auth/google/login    — OAuth URL 리다이렉트 + signed state 발급
- GET /v1/auth/google/callback — 콜백 처리 + 계정 생성/로그인

환경변수 필요:
- GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI (선택, 기본: BASE_URL + /v1/auth/google/callback)
"""
from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta

import httpx
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

    # state 검증 (signed JWT)
    if state:
        try:
            payload = _jwt.decode(state, _auth_settings.jwt_secret, algorithms=["HS256"])
            if payload.get("purpose") != "oauth":
                raise HTTPException(400, "Invalid state")
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
    refresh = create_refresh_token(str(user.id))

    resp = RedirectResponse("/")
    set_auth_cookies(resp, access, refresh, request)
    return resp
