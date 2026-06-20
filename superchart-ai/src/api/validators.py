"""API 파라미터 검증 공통 헬퍼."""
import re
from fastapi import HTTPException

# ═══ 상수 ═══
SUPPORTED_TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"]
DEFAULT_SYMBOL = "BTCUSDT"
DEFAULT_TIMEFRAME = "5m"
DEFAULT_LIMIT = 500
MAX_LIMIT = 3000
MIN_LIMIT = 10

# 심볼 정규식: 영문 대문자/숫자, 2~30자
_SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,30}$")


def clamp_int(v: int, min_v: int, max_v: int, default: int = None) -> int:
    """정수를 min~max 범위로 제한."""
    if default is not None and v is None:
        return default
    return min(max(v, min_v), max_v)


def validate_symbol(symbolId: str) -> str:
    """심볼 검증 — 형식 + DB 화이트리스트.

    Args:
        symbolId: 검증할 심볼 코드

    Returns:
        검증 통과한 symbolId

    Raises:
        HTTPException(400): 형식 오류 (SQL/XSS/제어문자 차단)
        HTTPException(404): DB 미등록 심볼
    """
    if not symbolId or not _SYMBOL_RE.match(symbolId):
        raise HTTPException(400, "잘못된 symbolId 형식입니다 (영문 대문자/숫자 2~30자)")
    # 화이트리스트 검증 — DB 캐시 사용
    from src.services.symbol_resolver import SYMBOL_EXCHANGE, SYMBOL_API_MAP
    if symbolId not in SYMBOL_EXCHANGE and symbolId not in SYMBOL_API_MAP.values():
        raise HTTPException(404, f"등록되지 않은 심볼: {symbolId}")
    return symbolId


def validate_timeframe(timeframe: str) -> str:
    """타임프레임 검증.

    Raises:
        HTTPException(400): 미지원 TF
    """
    if timeframe not in SUPPORTED_TIMEFRAMES:
        raise HTTPException(400, f"지원하지 않는 timeframe: {timeframe}. 허용: {SUPPORTED_TIMEFRAMES}")
    return timeframe
