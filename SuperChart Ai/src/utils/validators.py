"""입력 검증 유틸리티.

여러 API 엔드포인트에서 공통으로 사용하는 검증 함수를 제공합니다.
순수 함수로 구성되며, 외부 의존성이 없습니다.
"""
import re
import uuid


# 심볼 코드: 대문자 영숫자 2~20자 (예: BTCUSDT, ETHUSDT)
_RE_SYMBOL = re.compile(r'^[A-Z0-9]{2,20}$')

# 이메일 (RFC 5322 간소화)
_RE_EMAIL = re.compile(r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$')

# 지원 타임프레임
_SUPPORTED_TIMEFRAMES = frozenset((
    '1m', '3m', '5m', '15m', '30m',
    '1h', '2h', '4h', '6h', '12h',
    '1d', '3d', '1w',
))


def is_valid_symbol(s: str) -> bool:
    """암호화폐 심볼 코드 검증.

    >>> is_valid_symbol('BTCUSDT')
    True
    >>> is_valid_symbol('btc')
    False
    >>> is_valid_symbol('')
    False
    >>> is_valid_symbol('<script>')
    False
    """
    if not s or not isinstance(s, str):
        return False
    return bool(_RE_SYMBOL.match(s))


def is_valid_uuid(s: str) -> bool:
    """UUID 문자열 검증.

    >>> is_valid_uuid('12345678-1234-1234-1234-123456789012')
    True
    >>> is_valid_uuid('not-uuid')
    False
    """
    if not s or not isinstance(s, str):
        return False
    try:
        uuid.UUID(s)
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def is_valid_email(s: str) -> bool:
    """이메일 형식 검증 (간단).

    실제 검증은 Pydantic EmailStr을 우선 사용. 이 함수는 빠른 예비 체크용.
    """
    if not s or not isinstance(s, str):
        return False
    if len(s) > 254:  # RFC 5321 제한
        return False
    return bool(_RE_EMAIL.match(s))


def is_valid_timeframe(tf: str) -> bool:
    """타임프레임 문자열 검증.

    >>> is_valid_timeframe('5m')
    True
    >>> is_valid_timeframe('100h')
    False
    """
    return tf in _SUPPORTED_TIMEFRAMES


def normalize_symbol(s: str) -> str:
    """심볼 문자열 정규화 (공백 제거, 대문자 변환).

    검증까지는 하지 않음. 호출 측에서 is_valid_symbol로 추가 체크 필요.
    """
    if not s or not isinstance(s, str):
        return ''
    return s.strip().upper()


__all__ = [
    'is_valid_symbol',
    'is_valid_uuid',
    'is_valid_email',
    'is_valid_timeframe',
    'normalize_symbol',
]
