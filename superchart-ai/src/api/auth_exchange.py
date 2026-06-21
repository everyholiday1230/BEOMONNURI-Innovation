"""거래소 인증 엔드포인트.

src/api/auth.py에서 분리:
- POST /v1/auth/request-verification       — 거래소 인증 요청 접수
- GET  /v1/auth/verification-status        — 내 인증 요청 상태
- POST /v1/auth/admin/approve-verification — 관리자 승인
- POST /v1/auth/admin/reject-verification  — 관리자 반려
- GET  /v1/auth/admin/pending-verifications — 대기 중 목록
- POST /v1/auth/verify-bitmart             — BitMart CID (하위 호환)
- POST /v1/auth/verify-bitget              — Bitget UID (하위 호환)

관리자 엔드포인트는 auth_admin_check 필수.
BitMart/Bitget 실제 가입 여부 검증은 auth_helpers.py의
check_bitmart_invite / check_bitget_referral 에 위임 (필요 시).
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.models.tables import User, VerificationRequest
from src.services.admin_helpers import auth_admin_check
from src.services.auth import get_current_user_id


router = APIRouter()


@router.post("/request-verification", response_model=ApiResponse)
async def request_verification(
    req: dict,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """거래소 인증 요청 접수 — 관리자 확인 후 순차 승인."""
    exchange = req.get("exchange", "").strip().lower()
    value = str(req.get("value", "")).strip()
    if exchange not in ("bitmart", "bitget") or not value:
        raise HTTPException(400, "거래소와 인증 정보를 입력해주세요")
    # 중복 요청 체크
    existing = await db.execute(
        select(VerificationRequest).where(
            VerificationRequest.user_id == user_id,
            VerificationRequest.status == "pending",
        )
    )
    if existing.scalar():
        return ApiResponse(data={"status": "pending", "message": "이미 검토 대기 중인 요청이 있습니다"})
    vr = VerificationRequest(user_id=user_id, exchange=exchange, submitted_value=value)
    db.add(vr)
    await db.commit()
    return ApiResponse(
        data={
            "status": "pending",
            "message": "인증 요청이 접수되었습니다. 관리자 확인 후 순차 승인됩니다.",
        }
    )


@router.get("/verification-status", response_model=ApiResponse)
async def verification_status(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """내 인증 요청 상태 조회."""
    result = await db.execute(
        select(VerificationRequest)
        .where(VerificationRequest.user_id == user_id)
        .order_by(VerificationRequest.created_at.desc())
        .limit(1)
    )
    vr = result.scalar()
    if not vr:
        return ApiResponse(data={"status": "none"})
    return ApiResponse(
        data={
            "status": vr.status,
            "exchange": vr.exchange,
            "reject_reason": vr.reject_reason,
            "created_at": str(vr.created_at),
        }
    )


@router.post("/admin/approve-verification", response_model=ApiResponse)
async def admin_approve_verification(
    req: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """관리자 인증 요청 승인."""
    await auth_admin_check(request)
    vr_id = req.get("id")
    if not vr_id:
        raise HTTPException(400, "id required")
    result = await db.execute(select(VerificationRequest).where(VerificationRequest.id == vr_id))
    vr = result.scalar()
    if not vr:
        raise HTTPException(404, "요청을 찾을 수 없습니다")

    # 사용자 승급
    user_result = await db.execute(select(User).where(User.id == vr.user_id))
    user = user_result.scalar()
    if user:
        user.tier = "pro"
        user.referral_exchange = vr.exchange
        user.referral_verified_at = datetime.now(timezone.utc)
    vr.status = "approved"
    vr.reviewed_by = "admin"
    vr.reviewed_at = datetime.now(timezone.utc)
    await db.commit()

    # 레퍼럴: 추천인 포인트 적립 (첫 결제/승급)
    try:
        from src.api.referral import on_payment
        await on_payment(db, str(user.id))
    except Exception:
        pass

    from src.services.beom_free import invalidate_tier_cache
    invalidate_tier_cache(str(vr.user_id))

    return ApiResponse(data={"approved": True})


@router.post("/admin/reject-verification", response_model=ApiResponse)
async def admin_reject_verification(
    req: dict,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """관리자 인증 요청 반려."""
    await auth_admin_check(request)
    vr_id = req.get("id")
    reason = req.get("reason", "")
    result = await db.execute(select(VerificationRequest).where(VerificationRequest.id == vr_id))
    vr = result.scalar()
    if not vr:
        raise HTTPException(404, "요청을 찾을 수 없습니다")
    vr.status = "rejected"
    vr.reject_reason = reason
    vr.reviewed_by = "admin"
    vr.reviewed_at = datetime.now(timezone.utc)
    await db.commit()
    return ApiResponse(data={"rejected": True})


@router.get("/admin/pending-verifications", response_model=ApiResponse)
async def admin_pending_verifications(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """관리자 대기 중 인증 요청 목록."""
    await auth_admin_check(request)
    try:
        results = (
            await db.execute(
                select(VerificationRequest)
                .where(VerificationRequest.status == "pending")
                .order_by(VerificationRequest.created_at.desc())
            )
        ).scalars().all()
    except Exception:
        # 인증요청 테이블 미생성/스키마 불일치 등 — 503 대신 빈 목록으로 안전 반환
        try:
            await db.rollback()
        except Exception:
            pass
        return ApiResponse(data=[])
    # 사용자 정보 조회
    user_ids = [v.user_id for v in results]
    users = {}
    if user_ids:
        for u in (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all():
            users[u.id] = {"email": u.email, "nickname": u.nickname}
    return ApiResponse(
        data=[
            {
                "id": str(v.id),
                "user_id": str(v.user_id),
                "email": users.get(v.user_id, {}).get("email", ""),
                "nickname": users.get(v.user_id, {}).get("nickname", ""),
                "exchange": v.exchange,
                "submitted_value": v.submitted_value,
                "status": v.status,
                "created_at": str(v.created_at),
            }
            for v in results
        ]
    )


@router.post("/verify-bitmart", response_model=ApiResponse)
async def verify_bitmart(
    req: dict,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """BitMart CID 인증 요청 접수 (하위 호환)."""
    return await request_verification(
        {"exchange": "bitmart", "value": str(req.get("cid", ""))},
        user_id,
        db,
    )


@router.post("/verify-bitget", response_model=ApiResponse)
async def verify_bitget(
    req: dict,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Bitget UID 인증 요청 접수 (하위 호환)."""
    return await request_verification(
        {"exchange": "bitget", "value": req.get("uid", "")},
        user_id,
        db,
    )
