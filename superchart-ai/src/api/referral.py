"""레퍼럴 시스템 API."""
import secrets
import string
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id
from src.services.admin_helpers import auth_admin_check

router = APIRouter(prefix="/referral", tags=["referral"])

# 포인트 기본 정책 (2026-06 권장값)
# 주의: 추천인 보상의 정식 트리거는 "피추천인 이메일 인증 완료"이며, 월 최대
# 레퍼럴 보상(50,000P)·유효기간(레퍼럴 90일/가입축하 30일)·짧은 순 사용은
# 포인트 소멸 버킷(point_lots) + 부정사용 검증과 함께 Phase 2(백엔드)에서
# 적용한다. 현재 apply()는 가입 시점에 적립하는 기존 동작을 유지한다.
POINTS_SIGNUP_REFERRER = 1000   # 추천인 보상 (정식: 피추천인 이메일 인증 완료 시)
POINTS_SIGNUP_REFERRED = 1000   # 피추천인: 가입 축하 포인트
POINTS_PAYMENT_REFERRER = 5000  # 추천인: 피추천인 첫 결제 추가 보상
MONTHLY_REFERRAL_CAP = 50000    # 월 최대 레퍼럴 보상 (Phase 2 적용)
EXPIRY_DAYS_REFERRAL = 90       # 레퍼럴 포인트 유효기간 (Phase 2 적용)
EXPIRY_DAYS_SIGNUP = 30         # 가입 축하 포인트 유효기간 (Phase 2 적용)


def _generate_code(length=8):
    """랜덤 레퍼럴 코드 생성 (영문 대문자 + 숫자)"""
    chars = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))


@router.get("/my-code", response_model=ApiResponse)
async def get_my_code(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """내 레퍼럴 코드 조회 (없으면 자동 생성)."""
    row = (await db.execute(text("SELECT code, commission_rate, tier, total_earned, total_referrals FROM referral_codes WHERE user_id = :uid"), {"uid": user_id})).fetchone()
    if row:
        return ApiResponse(data={"code": row[0], "commission_rate": row[1] or 20, "tier": row[2] or "bronze", "total_earned": row[3] or 0, "total_referrals": row[4] or 0})
    # 자동 생성
    for _ in range(10):
        code = _generate_code()
        exists = (await db.execute(text("SELECT 1 FROM referral_codes WHERE code = :c"), {"c": code})).fetchone()
        if not exists:
            await db.execute(text("INSERT INTO referral_codes (user_id, code) VALUES (:uid, :c)"), {"uid": user_id, "c": code})
            await db.execute(text("UPDATE users SET referral_code = :c WHERE id = :uid"), {"uid": user_id, "c": code})
            await db.commit()
            return ApiResponse(data={"code": code, "commission_rate": 20, "tier": "bronze", "total_earned": 0, "total_referrals": 0})
    raise HTTPException(500, "코드 생성 실패")


@router.post("/apply", response_model=ApiResponse)
async def apply_code(req: dict, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """추천 코드 적용 (가입 후 1회)."""
    code = (req.get("code") or "").strip().upper()
    if not code or len(code) < 4:
        raise HTTPException(400, "유효하지 않은 코드")
    # 이미 추천받은 적 있는지 (동일 코드 재요청은 멱등 처리)
    existing = (await db.execute(text("SELECT referral_code FROM referral_links WHERE referred_id = :uid"), {"uid": user_id})).fetchone()
    if existing:
        existing_code = (existing[0] or "").upper()
        if existing_code == code:
            return ApiResponse(data={"message": "이미 적용된 추천 코드입니다"})
        raise HTTPException(400, "이미 추천 코드를 사용했습니다")
    # 코드 소유자 찾기
    referrer = (await db.execute(text("SELECT user_id FROM referral_codes WHERE code = :c"), {"c": code})).fetchone()
    if not referrer:
        raise HTTPException(404, "존재하지 않는 코드입니다")
    referrer_id = str(referrer[0])
    if referrer_id == user_id:
        raise HTTPException(400, "본인 코드는 사용할 수 없습니다")
    # 연결 생성 (추천인 보상은 '이메일 인증 완료' 시점에 지급 — 부정 가입 방지)
    await db.execute(text(
        "INSERT INTO referral_links (referrer_id, referred_id, referral_code) VALUES (:rid, :uid, :c)"
    ), {"rid": referrer_id, "uid": user_id, "c": code})
    # 포인트 적립 — 피추천인 가입 축하(즉시). 추천인 보상은 verify_email 에서 지급.
    await _add_points(db, user_id, POINTS_SIGNUP_REFERRED, "signup_bonus", "가입 축하 포인트")
    await db.commit()
    return ApiResponse(data={"message": f"가입 축하 포인트 +{POINTS_SIGNUP_REFERRED}P 적립! 이메일 인증을 완료하면 추천인에게도 보상이 지급됩니다."})


async def reward_referrer_on_verify(db: AsyncSession, referred_id: str) -> bool:
    """피추천인 이메일 인증 완료 시 추천인에게 보상 1회 지급(멱등).

    중복 지급 방지: 해당 link 에 대해 이미 referral_signup 보상 ledger 가 있으면 건너뛴다.
    호출 측에서 commit 한다(여기서는 commit 하지 않음).
    """
    link = (await db.execute(text(
        "SELECT id, referrer_id, referral_code, status FROM referral_links WHERE referred_id = :uid"
    ), {"uid": referred_id})).fetchone()
    if not link:
        return False
    link_id, referrer_id, code, status = str(link[0]), str(link[1]), link[2], (link[3] or "registered")
    if referrer_id == str(referred_id):
        return False  # 자가 추천 방어
    # 이미 이 link 로 추천인 보상이 지급되었는지 (멱등)
    paid = (await db.execute(text(
        "SELECT 1 FROM point_ledger WHERE user_id = :rid AND reason = 'referral_signup' AND ref_id = :lid LIMIT 1"
    ), {"rid": referrer_id, "lid": link_id})).fetchone()
    if paid:
        return False
    await _add_points(db, referrer_id, POINTS_SIGNUP_REFERRER, "referral_signup", f"추천 보상 — 이메일 인증 완료 ({code})", link_id)
    try:
        await db.execute(text("UPDATE referral_links SET status = 'verified' WHERE id = :lid AND status = 'registered'"), {"lid": link_id})
    except Exception:
        pass
    return True


@router.get("/points", response_model=ApiResponse)
async def get_points(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """내 포인트 잔액 + 추천 현황."""
    points = (await db.execute(text("SELECT COALESCE(points, 0) FROM users WHERE id = :uid"), {"uid": user_id})).scalar() or 0
    referrals = (await db.execute(text("SELECT COUNT(*) FROM referral_links WHERE referrer_id = :uid"), {"uid": user_id})).scalar() or 0
    paid_referrals = (await db.execute(text("SELECT COUNT(*) FROM referral_links WHERE referrer_id = :uid AND status = 'paid'"), {"uid": user_id})).scalar() or 0
    return ApiResponse(data={"points": points, "referrals": referrals, "paid_referrals": paid_referrals})


@router.get("/history", response_model=ApiResponse)
async def get_history(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """포인트 이력 (최근 50건)."""
    rows = (await db.execute(text(
        "SELECT amount, balance, reason, note, created_at FROM point_ledger WHERE user_id = :uid ORDER BY created_at DESC LIMIT 50"
    ), {"uid": user_id})).fetchall()
    return ApiResponse(data={"history": [
        {"amount": r[0], "balance": r[1], "reason": r[2], "note": r[3], "date": str(r[4])} for r in rows
    ]})


# ─── 관리자 전용 ───

@router.get("/admin/stats", response_model=ApiResponse)
async def admin_stats(request: Request, db: AsyncSession = Depends(get_db), _admin: None = Depends(auth_admin_check)):
    """관리자: 레퍼럴 전체 통계."""
    total_codes = (await db.execute(text("SELECT COUNT(*) FROM referral_codes"))).scalar()
    total_links = (await db.execute(text("SELECT COUNT(*) FROM referral_links"))).scalar()
    total_paid = (await db.execute(text("SELECT COUNT(*) FROM referral_links WHERE status='paid'"))).scalar()
    total_points = (await db.execute(text("SELECT COALESCE(SUM(points),0) FROM users"))).scalar()
    return ApiResponse(data={
        "total_codes": total_codes, "total_links": total_links,
        "total_paid": total_paid, "total_points_issued": total_points
    })


@router.post("/admin/adjust", response_model=ApiResponse)
async def admin_adjust(req: dict, request: Request, db: AsyncSession = Depends(get_db), _admin: None = Depends(auth_admin_check)):
    """관리자: 포인트 수동 조정."""
    uid = req.get("user_id")
    amount = int(req.get("amount", 0))
    note = req.get("note", "관리자 수동 조정")
    if not uid:
        email = (req.get("email") or "").strip()
        if email:
            row = (await db.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email})).fetchone()
            if not row:
                raise HTTPException(404, "해당 이메일의 회원 없음")
            uid = str(row[0])
    if not uid or amount == 0:
        raise HTTPException(400, "user_id(또는 email)와 amount 필요")
    await _add_points(db, uid, amount, "admin_adjust", note)
    await db.commit()
    return ApiResponse(data={"message": f"{amount:+d}P 조정 완료"})


@router.get("/admin/list", response_model=ApiResponse)
async def admin_list(request: Request, page: int = 1, db: AsyncSession = Depends(get_db), _admin: None = Depends(auth_admin_check)):
    """관리자: 레퍼럴 목록."""
    offset = (page - 1) * 20
    rows = (await db.execute(text("""
        SELECT rc.code, u.email, u.nickname, u.points,
               (SELECT COUNT(*) FROM referral_links rl WHERE rl.referrer_id = rc.user_id) as referrals,
               rc.created_at
        FROM referral_codes rc JOIN users u ON rc.user_id = u.id
        ORDER BY referrals DESC, rc.created_at DESC
        LIMIT 20 OFFSET :off
    """), {"off": offset})).fetchall()
    return ApiResponse(data={"items": [
        {"code": r[0], "email": r[1], "nickname": r[2], "points": r[3], "referrals": r[4], "date": str(r[5])}
        for r in rows
    ]})


# ─── 내부 헬퍼 ───

async def _add_points(db: AsyncSession, user_id: str, amount: int, reason: str, note: str = "", ref_id: str = None):
    """포인트 적립/차감 + 원장 기록."""
    # 현재 잔액
    cur = (await db.execute(text("SELECT COALESCE(points, 0) FROM users WHERE id = :uid"), {"uid": user_id})).scalar() or 0
    new_balance = cur + amount
    # users 업데이트
    await db.execute(text("UPDATE users SET points = :p WHERE id = :uid"), {"p": new_balance, "uid": user_id})
    # 원장 기록
    await db.execute(text(
        "INSERT INTO point_ledger (user_id, amount, balance, reason, ref_id, note) VALUES (:uid, :amt, :bal, :reason, :ref, :note)"
    ), {"uid": user_id, "amt": amount, "bal": new_balance, "reason": reason, "ref": ref_id, "note": note})


async def on_payment(db: AsyncSession, user_id: str):
    """결제 시 호출 — 추천인에게 포인트 적립."""
    link = (await db.execute(text(
        "SELECT id, referrer_id FROM referral_links WHERE referred_id = :uid AND status = 'registered'"
    ), {"uid": user_id})).fetchone()
    if not link:
        return
    link_id, referrer_id = str(link[0]), str(link[1])
    # 상태 변경
    await db.execute(text("UPDATE referral_links SET status = 'paid', paid_at = now() WHERE id = :lid"), {"lid": link_id})
    # 추천인 포인트
    await _add_points(db, referrer_id, POINTS_PAYMENT_REFERRER, "referral_payment", "피추천인 첫 결제 보너스", link_id)
    await db.commit()
