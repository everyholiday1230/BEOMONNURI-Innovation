"""인증.

두 종류의 주체:
  admin   선생님/운영자 — username + password 로그인, JWT 발급
  student 학생 — 반 코드 + 이름으로 참여, JWT 발급 (비밀번호/이메일 없음)

JWT payload:
  sub  : 주체 id
  role : 'admin' | 'student'
  (student 의 경우) cid: class_id, name

superchart-ai 의 패턴(jose + passlib bcrypt)을 따른다.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from . import db
from .config import settings

# 비밀번호 해시는 bcrypt 를 직접 사용한다.
# (passlib 1.7.4 는 bcrypt 5.x 와 호환되지 않아 로그인 시 예외가 난다.
#  bcrypt 를 직접 쓰면 버전 종속을 없앨 수 있다.)
import bcrypt as _bcrypt


def _to72(pw: str) -> bytes:
    """bcrypt 는 72바이트까지만 사용한다. 초과분은 잘라 표준 동작을 맞춘다."""
    return pw.encode("utf-8")[:72]


def hash_password(pw: str) -> str:
    return _bcrypt.hashpw(_to72(pw), _bcrypt.gensalt()).decode("ascii")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(_to72(pw), hashed.encode("ascii"))
    except Exception:
        return False


bearer = HTTPBearer(auto_error=False)


def make_token(sub: str, role: str, extra: dict | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": sub,
        "role": role,
        "iat": now,
        "exp": now + timedelta(hours=settings.JWT_TTL_HOURS),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALG)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 인증입니다.")


def ensure_seed_admin() -> None:
    """최초 기동 시 관리자 계정이 없으면 .env 값으로 생성."""
    if not db.get_admin_by_username(settings.ADMIN_USERNAME):
        db.create_admin(settings.ADMIN_USERNAME, hash_password(settings.ADMIN_PASSWORD))


# ── 의존성 ────────────────────────────────────────────────────

def _token_from(creds: HTTPAuthorizationCredentials | None) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요합니다.")
    return _decode(creds.credentials)


def current_admin(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    payload = _token_from(creds)
    if payload.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="관리자 권한이 필요합니다.")
    admin = db.get_admin(payload["sub"])
    if not admin:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="계정을 찾을 수 없습니다.")
    return admin


def current_student(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    payload = _token_from(creds)
    if payload.get("role") != "student":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="학생 인증이 필요합니다.")
    student = db.get_student(payload["sub"])
    if not student:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="학생을 찾을 수 없습니다.")
    return student


def current_subject(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    """admin 또는 student 아무나. 반환에 role 포함."""
    payload = _token_from(creds)
    role = payload.get("role")
    if role == "admin":
        a = db.get_admin(payload["sub"])
        if a:
            return {**a, "role": "admin"}
    elif role == "student":
        s = db.get_student(payload["sub"])
        if s:
            return {**s, "role": "student"}
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 인증입니다.")
