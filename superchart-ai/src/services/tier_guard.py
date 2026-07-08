"""회원 등급 기반 접근 제어 — Redis 기반 일일 사용량 제한."""
import os
from fastapi import HTTPException, Depends
from src.services.auth import decode_token

FREE_LIMITS = {"ai_analysis": 3, "ai_predict": 3, "ai_chat": 5, "llm_signal": 2}

def _get_redis():
    import redis
    # REDIS_URL 기반으로 연결 (host/port 하드코딩 제거, 배포 환경 호환).
    # tier 카운터는 메인(db=0)과 분리된 db=1 사용 → URL의 db 부분만 1로 덮어씀.
    url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    pool = redis.ConnectionPool.from_url(url, decode_responses=True)
    pool.connection_kwargs["db"] = 1
    return redis.Redis(connection_pool=pool)

def _clean_old(user_id: str, feature: str):
    pass  # Redis TTL이 자동 처리

def check_tier_limit(token: str, feature: str) -> str:
    try:
        payload = decode_token(token)
    except Exception as e:
        err_msg = str(e).lower()
        if "expired" in err_msg or "만료" in err_msg:
            raise HTTPException(401, "토큰이 만료되었습니다. 다시 로그인해주세요.")
        raise HTTPException(401, "인증이 필요합니다. 로그인해주세요.")

    user_id = payload.get("sub", "")
    tier = payload.get("tier", "free")

    # ── 무료 체험 기간(FREE_TRIAL_MODE): 로그인만 하면 전 기능 무제한 ──
    # 환경변수로 on/off (영구 코드변경 X). 끄면 즉시 원래 등급제로 복귀.
    if os.getenv("FREE_TRIAL_MODE", "").lower() in ("1", "true", "on", "yes"):
        return user_id

    if tier in ("pro", "premium"):
        return user_id

    limit = FREE_LIMITS.get(feature)
    if limit is None:
        return user_id

    try:
        r = _get_redis()
        key = f"usage:{user_id}:{feature}"
        used = r.incr(key)
        if used == 1:
            r.expire(key, 86400)  # 24시간 TTL
        if used > limit:
            raise HTTPException(429, f"무료 사용자는 {feature} 기능을 하루 {limit}회까지 사용할 수 있습니다. "
                                     f"레퍼럴 인증으로 무제한 이용하세요.")
    except HTTPException:
        raise
    except Exception:
        pass  # Redis 장애 시 메모리 폴백 없이 허용

    return user_id


def get_usage_info(user_id: str) -> dict:
    result = {}
    try:
        r = _get_redis()
        for feature, limit in FREE_LIMITS.items():
            key = f"usage:{user_id}:{feature}"
            used = int(r.get(key) or 0)
            result[feature] = {"used": used, "limit": limit, "remaining": max(0, limit - used)}
    except Exception:
        for feature, limit in FREE_LIMITS.items():
            result[feature] = {"used": 0, "limit": limit, "remaining": limit}
    return result


def require_tier(feature: str):
    from fastapi import Request
    async def _check(request: Request) -> str:
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            raise HTTPException(401, "인증이 필요합니다.")
        return check_tier_limit(auth[7:], feature)
    return Depends(_check)


def consume_free_quota(user_id: str, feature: str) -> bool:
    """무료 일일 한도 소비 시도.

    반환:
        True  → 이번 호출이 무료 한도 내 (포인트 차감 불필요)
        False → 무료 한도 초과 (호출자가 포인트로 과금해야 함)

    check_tier_limit 과 달리 초과 시 예외를 던지지 않고 False 를 반환하여,
    "무료 소진 후에는 포인트 차감" 정책을 구현할 수 있게 한다.
    pro/premium 및 FREE_TRIAL_MODE 는 항상 무료(True).
    """
    if os.getenv("FREE_TRIAL_MODE", "").lower() in ("1", "true", "on", "yes"):
        return True
    limit = FREE_LIMITS.get(feature)
    if limit is None:
        return True  # 한도 미설정 기능은 무료 취급
    try:
        r = _get_redis()
        key = f"usage:{user_id}:{feature}"
        used = r.incr(key)
        if used == 1:
            r.expire(key, 86400)  # 24시간 TTL
        return used <= limit
    except Exception:
        # Redis 장애 시: 안전하게 무료 처리(과금하지 않음)
        return True
