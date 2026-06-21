"""관리자 권한 관리 — 7역할 계정 레지스트리 + 권한 변경 감사 (추가 전용).

정직한 범위 안내:
- 현재 1차 관리자 인증 게이트는 ADMIN_KEY(verify_admin_key/auth_admin_check)다.
  본 모듈은 그 게이트를 통과한 운영자가 "관리자 계정·역할·2단계 인증 사용 여부"를
  등록/관리하고 권한 변경을 감사 로그로 남기는 레지스트리다.
- 실제 역할별 메뉴 접근 강제(엔드포인트 단위 RBAC)와 로그인 2FA 강제는 세션 기반
  관리자 로그인 체계와 연동되어야 완성된다(후속). 본 모듈은 그 토대(계정/역할/감사)를
  안전하게(추가 전용) 마련한다.

추가 테이블(IF NOT EXISTS): admin_accounts, admin_role_audit.
롤백: DROP TABLE IF EXISTS admin_accounts, admin_role_audit;
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.admin_helpers import auth_admin_check

router = APIRouter(prefix="/admin-roles", tags=["AdminRoles"])

# 7개 역할 + 메뉴 접근(참고 정책). 실제 강제는 세션 RBAC 연동 시 적용.
ROLES = {
    "super":   {"label": "최고 관리자", "menus": "*"},
    "ops":     {"label": "운영 관리자", "menus": ["overview", "users", "subscriptions", "tickets", "content", "system", "metrics"]},
    "support": {"label": "고객지원 관리자", "menus": ["overview", "tickets", "users"]},
    "content": {"label": "콘텐츠 관리자", "menus": ["overview", "content", "plans"]},
    "billing": {"label": "결제 관리자", "menus": ["overview", "subscriptions", "points"]},
    "data":    {"label": "데이터 관리자", "menus": ["overview", "symdata", "symbols", "metrics"]},
    "readonly": {"label": "읽기 전용 관리자", "menus": ["overview", "metrics", "system"]},
}

_ensured = False


async def _ensure(db: AsyncSession) -> None:
    global _ensured
    if _ensured:
        return
    try:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS admin_accounts (
                id BIGSERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                name TEXT,
                role TEXT NOT NULL DEFAULT 'readonly',
                two_factor BOOLEAN NOT NULL DEFAULT FALSE,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS admin_role_audit (
                id BIGSERIAL PRIMARY KEY,
                actor TEXT,
                action TEXT NOT NULL,
                target_email TEXT,
                role_before TEXT,
                role_after TEXT,
                detail TEXT,
                ip TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        await db.commit()
        _ensured = True
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass


async def _audit(db: AsyncSession, action: str, target: str, before: str | None, after: str | None, detail: str, ip: str):
    await db.execute(text(
        "INSERT INTO admin_role_audit (actor, action, target_email, role_before, role_after, detail, ip) "
        "VALUES ('admin',:ac,:t,:b,:a,:d,:ip)"
    ), {"ac": action, "t": target, "b": before, "a": after, "d": detail, "ip": ip})


@router.get("/roles", response_model=ApiResponse)
async def list_roles(_a: None = Depends(auth_admin_check)):
    return ApiResponse(data={"roles": [{"key": k, "label": v["label"], "menus": v["menus"]} for k, v in ROLES.items()]})


@router.get("/accounts", response_model=ApiResponse)
async def list_accounts(request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    rows = (await db.execute(text(
        "SELECT email, name, role, two_factor, active, created_at FROM admin_accounts ORDER BY created_at DESC LIMIT 200"
    ))).fetchall()
    return ApiResponse(data={"items": [
        {"email": r[0], "name": r[1], "role": r[2], "role_label": ROLES.get(r[2], {}).get("label", r[2]),
         "two_factor": bool(r[3]), "active": bool(r[4]), "date": str(r[5])} for r in rows
    ]})


@router.post("/accounts", response_model=ApiResponse)
async def create_account(req: dict, request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    email = (req.get("email") or "").strip().lower()
    name = (req.get("name") or "").strip()
    role = (req.get("role") or "readonly").strip()
    two_factor = bool(req.get("two_factor", False))
    if not email or "@" not in email:
        raise HTTPException(400, "유효한 이메일 필요")
    if role not in ROLES:
        raise HTTPException(400, f"알 수 없는 역할: {role}")
    ip = request.client.host if request and request.client else ""
    try:
        await db.execute(text(
            "INSERT INTO admin_accounts (email, name, role, two_factor) VALUES (:e,:n,:r,:tf) "
            "ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role, two_factor=EXCLUDED.two_factor, updated_at=now()"
        ), {"e": email, "n": name, "r": role, "tf": two_factor})
        await _audit(db, "create", email, None, role, f"name={name}, 2fa={two_factor}", ip)
        await db.commit()
        return ApiResponse(data={"message": f"{email} ({ROLES[role]['label']}) 등록 완료"})
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"등록 실패: {str(e)[:120]}")


@router.post("/update-role", response_model=ApiResponse)
async def update_role(req: dict, request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    email = (req.get("email") or "").strip().lower()
    role = (req.get("role") or "").strip()
    if role not in ROLES:
        raise HTTPException(400, f"알 수 없는 역할: {role}")
    cur = (await db.execute(text("SELECT role FROM admin_accounts WHERE email=:e"), {"e": email})).fetchone()
    if not cur:
        raise HTTPException(404, "관리자 계정 없음")
    before = cur[0]
    ip = request.client.host if request and request.client else ""
    try:
        await db.execute(text("UPDATE admin_accounts SET role=:r, updated_at=now() WHERE email=:e"), {"r": role, "e": email})
        await _audit(db, "update_role", email, before, role, "권한 변경", ip)
        await db.commit()
        return ApiResponse(data={"message": f"{email} 역할 변경: {ROLES.get(before,{}).get('label',before)} → {ROLES[role]['label']}"})
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"변경 실패: {str(e)[:120]}")


@router.post("/set-2fa", response_model=ApiResponse)
async def set_2fa(req: dict, request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    email = (req.get("email") or "").strip().lower()
    enabled = bool(req.get("enabled", False))
    row = (await db.execute(text("SELECT two_factor FROM admin_accounts WHERE email=:e"), {"e": email})).fetchone()
    if not row:
        raise HTTPException(404, "관리자 계정 없음")
    ip = request.client.host if request and request.client else ""
    await db.execute(text("UPDATE admin_accounts SET two_factor=:tf, updated_at=now() WHERE email=:e"), {"tf": enabled, "e": email})
    await _audit(db, "set_2fa", email, None, None, f"2단계 인증 {'사용' if enabled else '해제'}", ip)
    await db.commit()
    return ApiResponse(data={"message": f"{email} 2단계 인증 {'사용' if enabled else '해제'}"})


@router.post("/delete", response_model=ApiResponse)
async def delete_account(req: dict, request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    email = (req.get("email") or "").strip().lower()
    row = (await db.execute(text("SELECT role FROM admin_accounts WHERE email=:e"), {"e": email})).fetchone()
    if not row:
        raise HTTPException(404, "관리자 계정 없음")
    ip = request.client.host if request and request.client else ""
    # 삭제는 비활성화로 처리(감사 보존) — active=FALSE
    await db.execute(text("UPDATE admin_accounts SET active=FALSE, updated_at=now() WHERE email=:e"), {"e": email})
    await _audit(db, "deactivate", email, row[0], None, "계정 비활성화", ip)
    await db.commit()
    return ApiResponse(data={"message": f"{email} 비활성화 완료"})


@router.get("/audit", response_model=ApiResponse)
async def role_audit(request: Request, page: int = 1, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    off = max(0, (page - 1) * 30)
    rows = (await db.execute(text(
        "SELECT created_at, action, target_email, role_before, role_after, detail FROM admin_role_audit ORDER BY created_at DESC LIMIT 30 OFFSET :o"
    ), {"o": off})).fetchall()
    return ApiResponse(data={"items": [
        {"date": str(r[0]), "action": r[1], "target": r[2], "before": r[3], "after": r[4], "detail": r[5]} for r in rows
    ]})
