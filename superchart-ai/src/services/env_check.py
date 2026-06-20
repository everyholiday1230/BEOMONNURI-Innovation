"""환경변수 상태 점검 유틸리티.

기동 시 기능별 환경변수 상태를 한 번에 요약 로깅합니다.
값은 절대 로깅하지 않고, 설정 여부(True/False)만 표시합니다.

사용:
    from src.services.env_check import log_feature_status
    log_feature_status(logger)

출력 예:
    [info] feature.status admin_2fa=True google_oauth=False smtp=False
           sentry=False bitget=True bitmart=False bitget_referral=False
"""
import os


# 기능별 필수 환경변수 목록
_FEATURES = {
    "admin_2fa": ("ADMIN_KEY", "ADMIN_PASSWORD_HASH"),
    "google_oauth": ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
    "smtp": ("SMTP_HOST", "SMTP_USER", "SMTP_PASS"),
    "sentry": ("SENTRY_DSN",),
    "bitget": ("BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_PASSPHRASE"),
    "bitmart": ("BITMART_API_KEY", "BITMART_API_SECRET", "BITMART_API_MEMO"),
    "bitget_referral": ("BITGET_REFERRAL_UIDS",),
}


def check_feature(keys: tuple[str, ...]) -> bool:
    """모든 키가 설정되어 있으면 True.

    값 자체는 반환하지 않음 (보안상 로그에 찍히지 않도록).
    """
    return all(os.getenv(k, "").strip() for k in keys)


def get_feature_status() -> dict[str, bool]:
    """모든 기능의 활성 상태를 반환. 값 없음."""
    return {name: check_feature(keys) for name, keys in _FEATURES.items()}


def log_feature_status(logger) -> dict[str, bool]:
    """기능별 활성 상태를 로깅하고 dict 반환.

    Args:
        logger: structlog 로거 (info 메서드 지원)

    Returns:
        {feature_name: bool} 형태의 상태 맵
    """
    status = get_feature_status()
    logger.info("feature.status", **status)

    # 핵심 기능이 비활성일 때 명시적 경고
    missing_critical = []
    env = os.getenv("ENV", "").lower()
    is_prod = env in ("prod", "production", "live")

    if is_prod:
        # 프로덕션에서 필수
        if not status.get("admin_2fa"):
            missing_critical.append("admin_2fa (ADMIN_KEY/ADMIN_PASSWORD_HASH)")

    if missing_critical:
        logger.warning(
            "feature.critical_missing",
            features=missing_critical,
            env=env or "dev",
            hint=".env 파일에 해당 환경변수를 설정하세요",
        )

    return status


def require_feature_env(feature: str, logger=None) -> bool:
    """특정 기능 호출 전 환경변수 검증.

    미설정 시 logger.warning 후 False 반환 (호출자가 기능 스킵 가능).

    예:
        if not require_feature_env("smtp", logger):
            return  # 이메일 발송 스킵
    """
    if feature not in _FEATURES:
        return False
    available = check_feature(_FEATURES[feature])
    if not available and logger is not None:
        logger.warning(
            "feature.unavailable",
            feature=feature,
            missing_keys=[k for k in _FEATURES[feature] if not os.getenv(k, "").strip()],
        )
    return available


# 프로덕션에서 반드시 있어야 하는 환경변수
# (없으면 서버가 불안전한 상태로 기동되는 것을 방지)
_PROD_REQUIRED_KEYS = (
    "JWT_SECRET",           # 이미 config.py에서 검증됨 (여기서는 재확인)
    "DATABASE_URL",         # DB 연결 필수
    "ADMIN_KEY",            # 관리자 접근
    "ADMIN_PASSWORD_HASH",  # 관리자 2FA
    "CORS_ORIGINS",         # 이미 middleware/cors.py에서 검증됨
)


def verify_prod_requirements() -> list[str]:
    """프로덕션 환경에서 필수 키 점검. 누락된 키 리스트 반환.

    호출 측에서 빈 리스트가 아니면 RuntimeError 발생시키도록 사용.
    운영에서만 엄격 검증 — dev/test 환경은 경고만.
    """
    env = os.getenv("ENV", os.getenv("ENVIRONMENT", "")).lower()
    is_prod = env in ("prod", "production", "live")
    if not is_prod:
        return []  # 비프로덕션은 스킵

    missing = [k for k in _PROD_REQUIRED_KEYS if not os.getenv(k, "").strip()]

    # 추가 보안 검증 — 약한 값 차단
    weak = []
    admin_key = os.getenv("ADMIN_KEY", "")
    if admin_key and (len(admin_key) < 16 or admin_key.lower() in ("admin", "password", "test", "1234")):
        weak.append("ADMIN_KEY (16자 미만 또는 추측 가능 값)")

    admin_pw = os.getenv("ADMIN_PASSWORD_HASH", "")
    if admin_pw and not admin_pw.startswith("$2"):  # bcrypt 해시는 $2a$, $2b$, $2y$ 시작
        weak.append("ADMIN_PASSWORD_HASH (bcrypt 해시 형식 아님)")

    return missing + weak


def enforce_prod_requirements(logger=None) -> None:
    """프로덕션 필수 키 누락/약한 값 시 RuntimeError 발생.

    config.py 의 JWT_SECRET 약한 값 검증과 상보적.
    기동 초기(logger 초기화 후 즉시) 호출 권장.

    추가: ENV 환경변수가 설정되지 않은 경우 경고 (운영 가능성 알림).
    """
    env = os.getenv("ENV", os.getenv("ENVIRONMENT", "")).strip().lower()
    if not env:
        # ENV 미설정 — 운영자가 .env 에 ENV=production 누락한 경우 경고
        if logger is not None:
            logger.warning(
                "env.unset",
                hint="ENV=production 을 .env 에 명시하세요. 미설정 시 약한 secret 검증이 비활성화됩니다.",
            )

    missing = verify_prod_requirements()
    if missing:
        msg = (
            f"[SECURITY] 프로덕션 환경에서 필수/약한 환경변수 문제: {missing}. "
            f".env 파일을 점검하세요."
        )
        if logger is not None:
            logger.error("prod.missing_required_env", missing=missing)
        raise RuntimeError(msg)


__all__ = [
    "check_feature",
    "get_feature_status",
    "log_feature_status",
    "require_feature_env",
    "verify_prod_requirements",
    "enforce_prod_requirements",
]
