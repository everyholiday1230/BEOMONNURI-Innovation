"""관리자 인증 헬퍼 - 모든 admin API에서 공유.

ADMIN_KEY 검증 + 길이 검사 + 타이밍 공격 방지 (constant-time 비교).
"""
from __future__ import annotations
import os
import secrets
from fastapi import HTTPException, Request
import structlog

log = structlog.get_logger(__name__)

# 최소 길이 (보안 권장)
MIN_KEY_LENGTH = 32

_warned = False


def _check_key_strength():
    """ADMIN_KEY 길이 검사 + 약하면 경고 (1회만)."""
    global _warned
    if _warned:
        return
    _warned = True
    key = os.getenv("ADMIN_KEY", "")
    if not key:
        log.error("ADMIN_KEY 미설정 - 모든 admin API 차단됨")
    elif len(key) < MIN_KEY_LENGTH:
        log.warning(
            "ADMIN_KEY 약함 - 권장 길이 미달",
            current_length=len(key),
            min_length=MIN_KEY_LENGTH,
            note="python -c 'import secrets;print(secrets.token_urlsafe(32))' 로 강한 키 생성"
        )


def verify_admin_key(request: Request) -> None:
    """
    Admin API 요청 검증.

    Raises:
        HTTPException(403): 키가 없거나 일치하지 않을 때

    헤더: x-admin-key
    """
    _check_key_strength()

    expected = os.getenv("ADMIN_KEY", "")
    if not expected:
        # 키가 환경변수에 없으면 모든 요청 거부
        raise HTTPException(503, "Admin 시스템 비활성화 (ADMIN_KEY 미설정)")

    provided = request.headers.get("x-admin-key", "")

    if not provided:
        raise HTTPException(403, "Admin 인증 필요")

    # 타이밍 공격 방지 - constant time 비교
    if not secrets.compare_digest(provided, expected):
        # 시도 로그 (IP 추적 가능)
        client_ip = request.client.host if request.client else "unknown"
        log.warning("admin.key_mismatch", ip=client_ip, length=len(provided))
        raise HTTPException(403, "Admin 인증 실패")
