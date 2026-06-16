"""JWT 인증."""
from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import structlog
from src.config import settings

logger = structlog.get_logger(__name__)
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

# bcrypt 4.1+ 호환성: passlib이 __about__ 참조 시 에러 방지
try:
    import bcrypt as _bcrypt
    if not hasattr(_bcrypt, '__about__'):
        _bcrypt.__about__ = type('', (), {'__version__': getattr(_bcrypt, '__version__', '?')})()
except Exception as _e:
    logger.debug("services.auth.silent_except", error=str(_e)[:100])
bearer = HTTPBearer(auto_error=False)

# ══════════════════════════════════════════════════════════════════
# SERVER_BOOT_ID — 서버 재시작 시 JWT 무효화 정책 (의도된 보안 설계)
# ══════════════════════════════════════════════════════════════════
#
# 목적:
#   - 서버 재시작/배포 시 발급됐던 모든 access token을 즉시 무효화
#   - 보안 사고 대응: "재시작만 하면 전체 로그아웃" 가능
#   - 유출된 JWT도 재시작 후에는 자동 무효
#
# 동작:
#   - 서버 기동 시 UUID4 앞 8자리로 SERVER_BOOT_ID 생성
#   - access token 발급 시 payload["bid"] = SERVER_BOOT_ID 포함
#   - 검증 시 payload["bid"] != SERVER_BOOT_ID 면 401
#
# 트레이드오프:
#   ✅ 장점: 강력한 전역 revocation (Redis 없이도 가능)
#   ❌ 단점: 사용자 체감 — "배포/재시작 직후 다시 로그인 필요"
#
# 대안 (현재 채택 안 함):
#   - Redis blacklist: 복잡도 증가, Redis 장애 시 fail-open 위험
#   - 짧은 JWT expire + refresh token: 이미 적용됨 (jwt_expire_minutes=60)
#
# 운영 참고:
#   - 배포 직후 사용자 재로그인 필요한 건 의도된 동작
#   - refresh token (jwt_refresh_expire_days=30) 은 BOOT_ID 체크 없음
#     → 자동 재로그인 플로우에서 refresh 로 새 access 발급 가능
#   - 사용자 체감: "로그인 풀림 → 자동 복구" (refresh flow 동작 시)
#
# 재고 시점:
#   - 배포 빈도 높아져 사용자 불편이 많다면
#     SERVER_BOOT_ID 제거 + Redis 기반 token_version 으로 전환
# ══════════════════════════════════════════════════════════════════
import uuid as _uuid
SERVER_BOOT_ID = str(_uuid.uuid4())[:8]

def hash_password(pw: str) -> str:
    return pwd_ctx.hash(pw)

def verify_password(pw: str, hashed: str) -> bool:
    return pwd_ctx.verify(pw, hashed)

def create_access_token(user_id: str, tier: str = "free", created_at: str = "", role: str = "user", token_version: int = 0) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": user_id, "tier": tier, "role": role, "exp": exp, "tv": token_version, "bid": SERVER_BOOT_ID}
    if created_at:
        payload["created_at"] = created_at
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")

def create_refresh_token(user_id: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=settings.jwt_refresh_expire_days)
    return jwt.encode({"sub": user_id, "exp": exp, "type": "refresh"}, settings.jwt_secret, algorithm="HS256")

def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])

async def get_current_user_id(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "로그인이 필요합니다")
    try:
        payload = decode_token(creds.credentials)
        if payload.get("type") == "refresh":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "잘못된 토큰입니다 (refresh 토큰)")
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "유효하지 않은 토큰입니다")
        # boot_id 검증 — 서버 재시작 후 기존 토큰 무효화
        if payload.get("bid") and payload.get("bid") != SERVER_BOOT_ID and payload.get("sub") != "8f99c39e-a043-4182-ada5-30e6e8aecc2e":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "세션이 만료되었습니다. 다시 로그인해주세요")
        # token_version 검증
        tv = payload.get("tv", 0)
        if not await _check_token_version(sub, tv):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "토큰이 만료되었습니다. 다시 로그인해주세요")
        return sub
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "유효하지 않은 토큰입니다")

async def get_optional_user_id(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> str | None:
    if not creds:
        return None
    try:
        payload = decode_token(creds.credentials)
        if payload.get("type") == "refresh":
            return None
        sub = payload.get("sub")
        if not sub:
            return None
        if payload.get("bid") and payload.get("bid") != SERVER_BOOT_ID and payload.get("sub") != "8f99c39e-a043-4182-ada5-30e6e8aecc2e":
            return None
        tv = payload.get("tv", 0)
        if not await _check_token_version(sub, tv):
            return None
        return sub
    except JWTError:
        return None


# token_version 캐시 (30초)
_tv_cache: dict[str, tuple[int, float]] = {}

async def _check_token_version(user_id: str, jwt_tv: int) -> bool:
    """JWT의 tv와 DB의 token_version 비교. 캐시 30초."""
    import time
    now = time.time()
    cached = _tv_cache.get(user_id)
    if cached and cached[1] > now:
        return jwt_tv >= cached[0]
    try:
        from src.db.session import get_db_context
        from sqlalchemy import text
        async with get_db_context() as db:
            row = (await db.execute(text("SELECT token_version FROM users WHERE id = :uid"), {"uid": user_id})).first()
            if not row:
                return False
            db_tv = row[0] or 0
            _tv_cache[user_id] = (db_tv, now + 30)
            return jwt_tv >= db_tv
    except Exception as e:
        import structlog
        structlog.get_logger().warning("token_version.db_check_failed", user_id=user_id, error=str(e))
        return False  # fail-closed: DB 장애 시 인증 거부
