"""인증 관련 공용 헬퍼.

auth.py API 라우터에서 사용하던 private 함수들을 추출.
라우터 외부에서도 재사용 가능하도록 서비스 레이어로 승격.

포함:
- set_auth_cookies, clear_auth_cookies: HttpOnly 쿠키 관리 (CSRF 포함)
- effective_tier: premium → pro 통합 변환
- check_bitmart_invite, check_bitget_referral: 거래소 레퍼럴 검증
"""
import hashlib
import hmac
import os
import secrets as _sec
import time

import httpx
import structlog

logger = structlog.get_logger(__name__)


# ── 쿠키 관리 ──

def set_auth_cookies(response, access_token: str, refresh_token: str, request=None) -> None:
    """access/refresh 토큰을 HttpOnly 쿠키로 설정.

    CSRF 토큰도 함께 발급 (httponly=False, JS에서 헤더에 첨부 가능).
    secure: 요청이 HTTPS(프록시 X-Forwarded-Proto 포함)면 True, 아니면 ENV=prod 폴백.
    """
    is_prod = os.getenv("ENV", "").lower() in (("prod", "production"))
    _https = False
    if request is not None:
        try:
            xfp = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
            _https = xfp == "https" or request.url.scheme == "https"
        except Exception:
            _https = False
    _samesite = "lax"
    _secure = _https or is_prod
    response.set_cookie(
        "auth_token", access_token,
        httponly=True, secure=_secure, samesite=_samesite, max_age=86400, path="/",
    )
    response.set_cookie(
        "refresh_token", refresh_token,
        httponly=True, secure=_secure, samesite=_samesite, max_age=30 * 86400, path="/v1/auth",
    )
    csrf_token = _sec.token_urlsafe(32)
    response.set_cookie(
        "csrf_token", csrf_token,
        httponly=False, secure=_secure, samesite=_samesite, max_age=86400, path="/",
    )


def clear_auth_cookies(response) -> None:
    response.delete_cookie("auth_token", path="/")
    response.delete_cookie("refresh_token", path="/v1/auth")
    response.delete_cookie("csrf_token", path="/")


# ── Tier 유틸 ──

def effective_tier(user) -> str:
    """사용자 effective tier. premium은 pro로 통합.

    다른 서비스에서 VIP 권한 체크 시 사용.
    """
    if user.tier in ("pro", "premium"):
        return "pro"
    return user.tier


# ── 거래소 레퍼럴 검증 ──

async def check_bitmart_invite(cid: int) -> bool:
    """BitMart affiliate invite-check API 호출.

    환경변수 BITMART_API_KEY/SECRET/MEMO 필수.
    미설정 또는 API 오류 시 False.
    """
    api_key = os.getenv("BITMART_API_KEY", "")
    api_secret = os.getenv("BITMART_API_SECRET", "")
    api_memo = os.getenv("BITMART_API_MEMO", "")
    if not all([api_key, api_secret, api_memo]):
        return False
    ts = str(int(time.time() * 1000))
    body = ""
    sign = hmac.new(
        api_secret.encode(),
        (ts + "#" + api_memo + "#" + body).encode(),
        hashlib.sha256,
    ).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(
                f"https://api-cloud-v2.bitmart.com/contract/private/affiliate/invite-check?cid={cid}",
                headers={"X-BM-KEY": api_key, "X-BM-SIGN": sign, "X-BM-TIMESTAMP": ts},
            )
            d = r.json()
            return d.get("data", {}).get("isInviteUser", False)
    except Exception as e:
        logger.warning("bitmart.invite_check_fail", cid=cid, error=str(e)[:100])
        return False


async def check_bitget_referral(uid: str) -> bool:
    """Bitget affiliate referral check — 환경변수의 레퍼럴 코드와 매칭.

    Bitget은 공개 API로 레퍼럴 확인이 어려우므로,
    관리자가 설정한 레퍼럴 코드 목록(BITGET_REFERRAL_UIDS)과 매칭.
    향후 Bitget Broker API 연동 시 실시간 확인 가능.
    """
    allowed_codes = os.getenv("BITGET_REFERRAL_UIDS", "").split(",")
    allowed_codes = [c.strip() for c in allowed_codes if c.strip()]
    if not allowed_codes:
        # 환경변수 미설정 시 관리자 수동 승인 필요
        return False
    return uid in allowed_codes


__all__ = [
    "set_auth_cookies",
    "clear_auth_cookies",
    "effective_tier",
    "check_bitmart_invite",
    "check_bitget_referral",
]
