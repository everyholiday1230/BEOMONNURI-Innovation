"""앱 전역 상수.

여러 모듈에서 공통으로 참조하는 상수를 중앙화합니다.
도메인별 상수는 각 도메인 모듈에 두고, 이 파일은 공통 상수만 포함합니다.
"""


# ══════════════════════════════════════════════
# 등급 (Tier)
# ══════════════════════════════════════════════
# DB에 저장되는 실제 값 (UI 표시명과 다름)
TIER_GUEST = "guest"      # 비로그인 (DB에 저장 안 됨)
TIER_FREE = "free"        # 일반 회원
TIER_VIP = "pro"          # VIP (UI 표시: VIP)
TIER_VVIP = "premium"     # VVIP (UI 표시: VVIP)

# VIP 이상 체크용 (기존 코드 패턴 통합)
#   기존: `if tier in ("pro", "premium"):`
#   신규: `if tier in PRO_TIERS:`
PRO_TIERS = (TIER_VIP, TIER_VVIP)

# 모든 로그인 회원 (guest 제외)
LOGGED_IN_TIERS = (TIER_FREE, TIER_VIP, TIER_VVIP)

# UI 표시명 매핑
TIER_DISPLAY_KO = {
    TIER_FREE: "일반",
    TIER_VIP: "VIP",
    TIER_VVIP: "VVIP",
}


# ══════════════════════════════════════════════
# 역할 (Role)
# ══════════════════════════════════════════════
ROLE_USER = "user"
ROLE_ADMIN = "admin"


# ══════════════════════════════════════════════
# 타임프레임
# ══════════════════════════════════════════════
DEFAULT_TIMEFRAME = "5m"

SUPPORTED_TIMEFRAMES = (
    "1m", "3m", "5m", "15m", "30m",
    "1h", "2h", "4h", "6h", "12h",
    "1d", "3d", "1w",
)


# ══════════════════════════════════════════════
# 차트/캔들
# ══════════════════════════════════════════════
MAX_CANDLES_LIMIT = 10000       # 단일 요청 최대 캔들 수
DEFAULT_CANDLES_LIMIT = 500     # 기본값


# ══════════════════════════════════════════════
# 알림
# ══════════════════════════════════════════════
# BEOM 시그널 알림 슬롯
MAX_BEOM_ALERTS_VIP = 3          # VIP 최대 등록 가능
MAX_BEOM_ALERTS_VVIP = 999       # VVIP (사실상 무제한)

# 쓰로틀 (같은 종목+TF 재계산 방지)
BEOM_CHECK_THROTTLE_SEC = 60

# 알림 재발송 쿨다운 기본값
DEFAULT_ALERT_COOLDOWN_SEC = 300    # 5분


# ══════════════════════════════════════════════
# 이메일/인증
# ══════════════════════════════════════════════
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 72        # bcrypt 제한


# ══════════════════════════════════════════════
# Rate Limit
# ══════════════════════════════════════════════
ADMIN_LOGIN_MAX_FAILS = 5
ADMIN_LOGIN_LOCK_SEC = 600       # 10분


__all__ = [
    # Tier
    "TIER_GUEST", "TIER_FREE", "TIER_VIP", "TIER_VVIP",
    "PRO_TIERS", "LOGGED_IN_TIERS", "TIER_DISPLAY_KO",
    # Role
    "ROLE_USER", "ROLE_ADMIN",
    # Timeframe
    "DEFAULT_TIMEFRAME", "SUPPORTED_TIMEFRAMES",
    # Chart
    "MAX_CANDLES_LIMIT", "DEFAULT_CANDLES_LIMIT",
    # Alert
    "MAX_BEOM_ALERTS_VIP", "MAX_BEOM_ALERTS_VVIP",
    "BEOM_CHECK_THROTTLE_SEC", "DEFAULT_ALERT_COOLDOWN_SEC",
    # Auth
    "PASSWORD_MIN_LENGTH", "PASSWORD_MAX_LENGTH",
    # Rate
    "ADMIN_LOGIN_MAX_FAILS", "ADMIN_LOGIN_LOCK_SEC",
]
