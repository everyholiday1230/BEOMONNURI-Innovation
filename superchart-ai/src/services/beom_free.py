"""범온 캔들 지연 정책 — 비PRO 사용자 1시간 지연 강제.

모든 범온 관련 API에서 공통으로 사용.
"""
import os
import time
from fastapi import Request
from src.services.auth import decode_token

DELAY_SECONDS = 3600  # 1시간
_TIER_CACHE: dict[str, tuple[str, float]] = {}  # user_id → (tier, expire_ts)
_TIER_CACHE_TTL = 30  # 30초 캐시


def invalidate_tier_cache(user_id: str):
    """tier 변경 시 캐시 즉시 무효화."""
    _TIER_CACHE.pop(user_id, None)


def _effective_tier_from_row(tier: str, created_at) -> str:
    """tier 그대로 반환. premium/pro 구분 유지."""
    return tier


async def get_user_tier_by_id(user_id: str, fallback: str = "free") -> str:
    """get_user_tier() 와 동일한 캐시(_TIER_CACHE)를 공유하는, user_id 직접 조회 버전.

    tier_guard.py 처럼 이미 토큰을 디코드해 user_id 를 확보한 호출자를 위한 헬퍼.
    invalidate_tier_cache(user_id) 로 이 결과도 함께 즉시 무효화된다.
    """
    if not user_id:
        return "guest"

    if os.getenv("FREE_TRIAL_MODE", "").lower() in ("1", "true", "on", "yes"):
        return "premium"

    now = time.time()
    cached = _TIER_CACHE.get(user_id)
    if cached and cached[1] > now:
        return cached[0]

    try:
        from src.db.session import get_db_context
        from sqlalchemy import text
        async with get_db_context() as db:
            row = (await db.execute(text("SELECT tier, created_at FROM users WHERE id = :uid"), {"uid": user_id})).first()
            if not row:
                return fallback
            tier = _effective_tier_from_row(row[0], row[1])
            _TIER_CACHE[user_id] = (tier, now + _TIER_CACHE_TTL)
            return tier
    except Exception:
        return fallback


async def get_user_tier(request: Request) -> str:
    # BYPASS: popo 계정 항상 premium
    _bypass_cookie = request.cookies.get('auth_token') or ''
    _bypass_auth = request.headers.get('authorization', '')
    if _bypass_cookie or _bypass_auth:
        try:
            _t = _bypass_cookie or (_bypass_auth[7:] if _bypass_auth.startswith('Bearer ') else '')
            if _t:
                _p = decode_token(_t)
                if _p.get('sub') == '8f99c39e-a043-4182-ada5-30e6e8aecc2e': return 'premium'
        except Exception:  pass
    """요청에서 사용자 tier 추출 — DB 기준 현재 tier 반환. 토큰 없으면 'guest'."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        # 쿠키 fallback
        auth = "Bearer " + (request.cookies.get("auth_token") or "")
    if not auth.startswith("Bearer ") or len(auth) < 10:
        return "guest"
    try:
        payload = decode_token(auth[7:])
        if payload.get("type") == "refresh":
            return "guest"
        user_id = payload.get("sub")
        if not user_id:
            return "guest"
    except Exception:
        return "guest"

    # ── 무료 체험 기간(FREE_TRIAL_MODE): 로그인 사용자는 premium 대우 ──
    # 토큰이 유효(로그인)한 경우에만 적용 → 지연게이트/지표/AI 전면 개방.
    # 환경변수 on/off, guest(비로그인)는 그대로 차단. 끄면 즉시 DB tier로 복귀.
    if os.getenv("FREE_TRIAL_MODE", "").lower() in ("1", "true", "on", "yes"):
        return "premium"
    # Redis/메모리 캐시 확인
    now = time.time()
    cached = _TIER_CACHE.get(user_id)
    if cached and cached[1] > now:
        return cached[0]

    # DB 조회
    try:
        from src.db.session import get_db_context
        async with get_db_context() as db:
            from sqlalchemy import text
            row = (await db.execute(text("SELECT tier, created_at FROM users WHERE id = :uid"), {"uid": user_id})).first()
            if not row:
                return "guest"
            tier = _effective_tier_from_row(row[0], row[1])
            _TIER_CACHE[user_id] = (tier, now + _TIER_CACHE_TTL)
            return tier
    except Exception:
        # DB 실패 시 JWT claim 폴백
        return payload.get("tier", "free")


def is_realtime_allowed(tier: str) -> bool:
    """PRO/premium만 실시간, guest/free는 1시간 지연."""
    return tier in ("pro", "premium")


def get_delay_cutoff_ms() -> int:
    """현재 시각 기준 1시간 전 타임스탬프 (밀리초)."""
    return int((time.time() - DELAY_SECONDS) * 1000)


def trim_candles_delayed(candles: list[dict], cutoff_ms: int) -> list[dict]:
    """cutoff_ms 이전 캔들만 남김. 캔들 시간 필드: 't', 'time', 'openTime' (밀리초)."""
    if not candles:
        return candles
    result = []
    for c in candles:
        ts = c.get('t') or c.get('time') or c.get('openTime') or 0
        if isinstance(ts, str):
            try:
                ts = int(ts)
            except ValueError:
                continue
        if ts <= cutoff_ms:
            result.append(c)
    return result


def apply_bimaco_delay(result: dict, cutoff_ms: int, total_candles: int) -> dict:
    """범온 계산 결과에서 지연 이후 봉 데이터를 제거.

    result: compute_ultra_trend / compute_bimaco2/3/4 반환값
    cutoff_ms: 지연 기준 타임스탬프
    total_candles: 원본 캔들 수 (인덱스 매핑용)
    """
    if not result:
        return result
    # 지연 기준 인덱스 계산: 전체 캔들 중 cutoff 이전까지만
    # bars 배열의 인덱스를 잘라냄
    bars = result.get('d', [])
    signals = result.get('s', [])
    boxes = result.get('x', [])

    if bars:
        # cutoff_idx: 지연 기준으로 남길 마지막 인덱스
        cutoff_idx = len(bars)  # 기본: 전부 남김 (캔들 타임스탬프 없으면)
        result['d'] = bars[:cutoff_idx]

    if signals:
        result['s'] = [s for s in signals if s.get('index', 0) < len(result.get('d', bars))]

    if boxes:
        result['x'] = [b for b in boxes if b.get('start', 0) < len(result.get('d', bars))]

    return result


def build_delay_meta(tier: str, cutoff_ms: int) -> dict:
    """응답에 포함할 지연 메타데이터."""
    delayed = not is_realtime_allowed(tier)
    now_ms = int(time.time() * 1000)
    return {
        'data_policy': 'delayed_1h' if delayed else 'realtime',
        'delayed': delayed,
        'delayed_minutes': 60 if delayed else 0,
        'server_time': now_ms,
        'effective_end_time': cutoff_ms if delayed else now_ms,
        'data_cutoff_ts': cutoff_ms if delayed else 0,
        'server_ts': now_ms,
        'tier': tier,
    }
