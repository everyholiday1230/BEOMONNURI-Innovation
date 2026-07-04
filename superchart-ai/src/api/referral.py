"""레퍼럴 시스템 API."""
import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id
from src.services.admin_helpers import auth_admin_check

router = APIRouter(prefix="/referral", tags=["referral"])

# 포인트 기본 정책 (2026-07)
POINTS_SIGNUP_REFERRER = 1000   # 추천인 보상 (피추천인 이메일 인증 완료 시)
POINTS_SIGNUP_REFERRED = 1000   # 피추천인: 가입 축하 포인트
POINTS_PAYMENT_REFERRER = 5000  # 추천인: 피추천인 첫 결제 추가 보상
MONTHLY_REFERRAL_CAP = 50000    # 월 최대 레퍼럴 보상
EXPIRY_DAYS_REFERRAL = 90       # 레퍼럴 포인트 유효기간
EXPIRY_DAYS_SIGNUP = 30         # 가입 축하 포인트 유효기간

_ensured = False


def _generate_code(length=8):
    """랜덤 레퍼럴 코드 생성 (영문 대문자 + 숫자)."""
    chars = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))


async def _ensure_tables(db: AsyncSession):
    """레퍼럴/포인트 보조 스키마 멱등 보장."""
    global _ensured
    if _ensured:
        return
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS referral_codes (
            id BIGSERIAL PRIMARY KEY,
            user_id TEXT NOT NULL UNIQUE,
            code TEXT NOT NULL UNIQUE,
            commission_rate INTEGER DEFAULT 20,
            tier TEXT DEFAULT 'bronze',
            total_earned INTEGER DEFAULT 0,
            total_referrals INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """))
    await db.execute(text("""
        CREATE TABLE IF NOT EXISTS referral_links (
            id BIGSERIAL PRIMARY KEY,
            referrer_id TEXT NOT NULL,
            referred_id TEXT NOT NULL,
            referral_code TEXT,
            status TEXT NOT NULL DEFAULT 'registered',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            paid_at TIMESTAMPTZ,
            UNIQUE (referred_id)
        )
    """))
    await db.execute(text("CREATE INDEX IF NOT EXISTS idx_referral_links_referrer ON referral_links(referrer_id, created_at DESC)"))
    await db.execute(text("CREATE INDEX IF NOT EXISTS idx_referral_links_status ON referral_links(status, created_at DESC)"))

    # point_lots 테이블이 있는 경우 ref_id 기반 추적 인덱스 보강
    await db.execute(text("CREATE INDEX IF NOT EXISTS idx_point_ledger_reason_ref ON point_ledger(reason, ref_id, user_id)"))
    await db.commit()
    _ensured = True


async def _referral_monthly_earned(db: AsyncSession, referrer_id: str) -> int:
    """이번 달 추천 보상 누적 지급량."""
    earned = (await db.execute(text(
        "SELECT COALESCE(SUM(amount), 0) FROM point_ledger "
        "WHERE user_id = :uid "
        "  AND reason IN ('referral_signup', 'referral_payment') "
        "  AND amount > 0 "
        "  AND created_at >= date_trunc('month', now())"
    ), {"uid": referrer_id})).scalar() or 0
    return int(earned)


async def _try_add_point_lot(db: AsyncSession, user_id: str, amount: int, reason: str, ref_id: str | None = None):
    """point_lots 연동(있을 때만). 기존 정본(users.points)은 그대로 유지."""
    if amount <= 0:
        return
    table_exists = (await db.execute(text("SELECT to_regclass('public.point_lots')"))).scalar()
    if not table_exists:
        return

    if reason == "signup_bonus":
        expiry = datetime.now(timezone.utc) + timedelta(days=EXPIRY_DAYS_SIGNUP)
        point_type = "signup_bonus"
    elif reason in ("referral_signup", "referral_payment"):
        expiry = datetime.now(timezone.utc) + timedelta(days=EXPIRY_DAYS_REFERRAL)
        point_type = reason
    else:
        expiry = None
        point_type = "event"

    await db.execute(text(
        "INSERT INTO point_lots (user_id, amount, remaining, point_type, reason, ref_id, expires_at) "
        "VALUES (:uid, :amt, :amt, :ptype, :reason, :ref_id, :exp)"
    ), {
        "uid": user_id,
        "amt": int(amount),
        "ptype": point_type,
        "reason": reason,
        "ref_id": ref_id,
        "exp": expiry,
    })


@router.get("/my-code", response_model=ApiResponse)
async def get_my_code(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """내 레퍼럴 코드 조회 (없으면 자동 생성)."""
    await _ensure_tables(db)
    row = (await db.execute(text("SELECT code, commission_rate, tier, total_earned, total_referrals FROM referral_codes WHERE user_id = :uid"), {"uid": user_id})).fetchone()
    if row:
        return ApiResponse(data={"code": row[0], "commission_rate": row[1] or 20, "tier": row[2] or "bronze", "total_earned": row[3] or 0, "total_referrals": row[4] or 0})
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
    await _ensure_tables(db)
    code = (req.get("code") or "").strip().upper()
    if not code or len(code) < 4:
        raise HTTPException(400, "유효하지 않은 코드")
    existing = (await db.execute(text("SELECT referral_code FROM referral_links WHERE referred_id = :uid"), {"uid": user_id})).fetchone()
    if existing:
        existing_code = (existing[0] or "").upper()
        if existing_code == code:
            return ApiResponse(data={"message": "이미 적용된 추천 코드입니다"})
        raise HTTPException(400, "이미 추천 코드를 사용했습니다")

    referrer = (await db.execute(text("SELECT user_id FROM referral_codes WHERE code = :c"), {"c": code})).fetchone()
    if not referrer:
        raise HTTPException(404, "존재하지 않는 코드입니다")
    referrer_id = str(referrer[0])
    if referrer_id == user_id:
        raise HTTPException(400, "본인 코드는 사용할 수 없습니다")

    await db.execute(text(
        "INSERT INTO referral_links (referrer_id, referred_id, referral_code) VALUES (:rid, :uid, :c)"
    ), {"rid": referrer_id, "uid": user_id, "c": code})

    await _add_points(db, user_id, POINTS_SIGNUP_REFERRED, "signup_bonus", "가입 축하 포인트")
    await db.commit()
    return ApiResponse(data={"message": f"가입 축하 포인트 +{POINTS_SIGNUP_REFERRED}P 적립! 이메일 인증을 완료하면 추천인에게도 보상이 지급됩니다."})


async def reward_referrer_on_verify(db: AsyncSession, referred_id: str) -> bool:
    """피추천인 이메일 인증 완료 시 추천인 보상 1회 지급(멱등)."""
    await _ensure_tables(db)
    link = (await db.execute(text(
        "SELECT id, referrer_id, referral_code, status FROM referral_links "
        "WHERE referred_id = :uid LIMIT 1"
    ), {"uid": referred_id})).fetchone()
    if not link:
        return False

    link_id, referrer_id, code, status = str(link[0]), str(link[1]), link[2], (link[3] or "registered")
    if referrer_id == str(referred_id):
        return False

    paid = (await db.execute(text(
        "SELECT 1 FROM point_ledger "
        "WHERE user_id = :rid AND reason = 'referral_signup' AND ref_id = :lid LIMIT 1"
    ), {"rid": referrer_id, "lid": link_id})).fetchone()
    if paid:
        if status == "registered":
            await db.execute(text("UPDATE referral_links SET status = 'verified' WHERE id = :lid"), {"lid": link_id})
        return False

    monthly = await _referral_monthly_earned(db, referrer_id)
    if monthly + POINTS_SIGNUP_REFERRER > MONTHLY_REFERRAL_CAP:
        if status == "registered":
            await db.execute(text("UPDATE referral_links SET status = 'verified' WHERE id = :lid"), {"lid": link_id})
        return False

    await _add_points(db, referrer_id, POINTS_SIGNUP_REFERRER, "referral_signup", f"추천 보상 — 이메일 인증 완료 ({code})", link_id)
    if status == "registered":
        await db.execute(text("UPDATE referral_links SET status = 'verified' WHERE id = :lid"), {"lid": link_id})
    return True


@router.get("/points", response_model=ApiResponse)
async def get_points(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """내 포인트 잔액 + 추천 현황."""
    await _ensure_tables(db)
    points = (await db.execute(text("SELECT COALESCE(points, 0) FROM users WHERE id = :uid"), {"uid": user_id})).scalar() or 0
    referrals = (await db.execute(text("SELECT COUNT(*) FROM referral_links WHERE referrer_id = :uid"), {"uid": user_id})).scalar() or 0
    paid_referrals = (await db.execute(text("SELECT COUNT(*) FROM referral_links WHERE referrer_id = :uid AND status = 'paid'"), {"uid": user_id})).scalar() or 0
    monthly_earned = await _referral_monthly_earned(db, user_id)
    return ApiResponse(data={
        "points": int(points),
        "referrals": int(referrals),
        "paid_referrals": int(paid_referrals),
        "monthly_referral_earned": int(monthly_earned),
        "monthly_cap": MONTHLY_REFERRAL_CAP,
    })


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
    await _ensure_tables(db)
    total_codes = (await db.execute(text("SELECT COUNT(*) FROM referral_codes"))).scalar()
    total_links = (await db.execute(text("SELECT COUNT(*) FROM referral_links"))).scalar()
    total_paid = (await db.execute(text("SELECT COUNT(*) FROM referral_links WHERE status='paid'"))).scalar()
    total_points = (await db.execute(text("SELECT COALESCE(SUM(points),0) FROM users"))).scalar()
    return ApiResponse(data={
        "total_codes": total_codes, "total_links": total_links,
        "total_paid": total_paid, "total_points_issued": total_points,
        "monthly_cap": MONTHLY_REFERRAL_CAP,
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
        SELECT rc.code, u.email, u.nickname, COALESCE(u.points,0),
               (SELECT COUNT(*) FROM referral_links rl WHERE rl.referrer_id = rc.user_id) as referrals,
               rc.created_at
        FROM referral_codes rc JOIN users u ON rc.user_id::text = u.id::text
        ORDER BY referrals DESC, rc.created_at DESC
        LIMIT 20 OFFSET :off
    """), {"off": offset})).fetchall()
    return ApiResponse(data={"items": [
        {"code": r[0], "email": r[1], "nickname": r[2], "points": r[3], "referrals": r[4], "date": str(r[5])}
        for r in rows
    ]})


@router.get("/admin/integrity-check", response_model=ApiResponse)
async def admin_integrity_check(request: Request, db: AsyncSession = Depends(get_db), _admin: None = Depends(auth_admin_check)):
    """관리자: 레퍼럴 데이터 정합성 점검 리포트."""
    await _ensure_tables(db)
    dup_links = (await db.execute(text(
        "SELECT referred_id, COUNT(*) c FROM referral_links GROUP BY referred_id HAVING COUNT(*) > 1 ORDER BY c DESC LIMIT 50"
    ))).fetchall()

    missing_signup_reward = (await db.execute(text(
        "SELECT rl.id, rl.referrer_id, rl.referred_id, rl.status "
        "FROM referral_links rl "
        "LEFT JOIN point_ledger pl ON pl.user_id = rl.referrer_id AND pl.reason = 'referral_signup' AND pl.ref_id = rl.id::text "
        "WHERE rl.status IN ('verified', 'paid') AND pl.id IS NULL "
        "ORDER BY rl.created_at DESC LIMIT 50"
    ))).fetchall()

    missing_payment_reward = (await db.execute(text(
        "SELECT rl.id, rl.referrer_id, rl.referred_id "
        "FROM referral_links rl "
        "LEFT JOIN point_ledger pl ON pl.user_id = rl.referrer_id AND pl.reason = 'referral_payment' AND pl.ref_id = rl.id::text "
        "WHERE rl.status = 'paid' AND pl.id IS NULL "
        "ORDER BY rl.paid_at DESC NULLS LAST LIMIT 50"
    ))).fetchall()

    return ApiResponse(data={
        "duplicate_referred_links": [{"referred_id": str(r[0]), "count": int(r[1])} for r in dup_links],
        "missing_signup_reward": [
            {"link_id": str(r[0]), "referrer_id": str(r[1]), "referred_id": str(r[2]), "status": r[3]} for r in missing_signup_reward
        ],
        "missing_payment_reward": [
            {"link_id": str(r[0]), "referrer_id": str(r[1]), "referred_id": str(r[2])} for r in missing_payment_reward
        ],
    })


@router.post("/admin/reconcile", response_model=ApiResponse)
async def admin_reconcile(req: dict, request: Request, db: AsyncSession = Depends(get_db), _admin: None = Depends(auth_admin_check)):
    """관리자: 특정 피추천인 기준 레퍼럴 정합성 복구."""
    await _ensure_tables(db)
    referred_id = (req.get("referred_id") or "").strip()
    dry_run = bool(req.get("dry_run", True))
    if not referred_id:
        raise HTTPException(400, "referred_id 필요")

    link = (await db.execute(text(
        "SELECT id, referrer_id, status, referral_code FROM referral_links WHERE referred_id=:uid ORDER BY created_at DESC LIMIT 1"
    ), {"uid": referred_id})).fetchone()
    if not link:
        raise HTTPException(404, "레퍼럴 링크를 찾을 수 없습니다")

    link_id = str(link[0])
    referrer_id = str(link[1])
    status = (link[2] or "registered").lower()

    email_verified = (await db.execute(text(
        "SELECT 1 FROM users WHERE id::text=:uid AND email_verified_at IS NOT NULL LIMIT 1"
    ), {"uid": referred_id})).fetchone() is not None
    has_paid_purchase = (await db.execute(text(
        "SELECT 1 FROM user_purchases WHERE user_id::text=:uid AND status='paid' LIMIT 1"
    ), {"uid": referred_id})).fetchone() is not None

    has_signup_reward = (await db.execute(text(
        "SELECT 1 FROM point_ledger WHERE user_id=:rid AND reason='referral_signup' AND ref_id=:lid LIMIT 1"
    ), {"rid": referrer_id, "lid": link_id})).fetchone() is not None
    has_payment_reward = (await db.execute(text(
        "SELECT 1 FROM point_ledger WHERE user_id=:rid AND reason='referral_payment' AND ref_id=:lid LIMIT 1"
    ), {"rid": referrer_id, "lid": link_id})).fetchone() is not None

    actions: list[str] = []
    if email_verified and not has_signup_reward:
        actions.append("grant_signup_reward")
    if has_paid_purchase and not has_payment_reward:
        actions.append("grant_payment_reward")

    if status == "registered" and email_verified:
        actions.append("set_status_verified")
    if has_paid_purchase and status != "paid":
        actions.append("set_status_paid")

    if dry_run:
        return ApiResponse(data={
            "dry_run": True,
            "link_id": link_id,
            "referrer_id": referrer_id,
            "referred_id": referred_id,
            "status": status,
            "email_verified": email_verified,
            "has_paid_purchase": has_paid_purchase,
            "actions": actions,
        })

    if "grant_signup_reward" in actions:
        monthly = await _referral_monthly_earned(db, referrer_id)
        if monthly + POINTS_SIGNUP_REFERRER <= MONTHLY_REFERRAL_CAP:
            await _add_points(db, referrer_id, POINTS_SIGNUP_REFERRER, "referral_signup", "관리자 정합성 복구(이메일 인증)", link_id)

    if "grant_payment_reward" in actions:
        monthly = await _referral_monthly_earned(db, referrer_id)
        if monthly + POINTS_PAYMENT_REFERRER <= MONTHLY_REFERRAL_CAP:
            await _add_points(db, referrer_id, POINTS_PAYMENT_REFERRER, "referral_payment", "관리자 정합성 복구(첫 결제)", link_id)

    if "set_status_verified" in actions and "set_status_paid" not in actions:
        await db.execute(text("UPDATE referral_links SET status='verified' WHERE id=:lid"), {"lid": link_id})
    if "set_status_paid" in actions:
        await db.execute(text("UPDATE referral_links SET status='paid', paid_at=COALESCE(paid_at, now()) WHERE id=:lid"), {"lid": link_id})

    await db.commit()
    return ApiResponse(data={
        "dry_run": False,
        "link_id": link_id,
        "referred_id": referred_id,
        "applied_actions": actions,
    })


# ─── 내부 헬퍼 ───

async def _add_points(db: AsyncSession, user_id: str, amount: int, reason: str, note: str = "", ref_id: str = None):
    """포인트 적립/차감 + 원장 기록 + point_lots 연동."""
    if amount == 0:
        return

    cur = (await db.execute(text("SELECT COALESCE(points, 0) FROM users WHERE id = :uid"), {"uid": user_id})).scalar() or 0
    new_balance = int(cur) + int(amount)

    await db.execute(text("UPDATE users SET points = :p WHERE id = :uid"), {"p": new_balance, "uid": user_id})
    await db.execute(text(
        "INSERT INTO point_ledger (user_id, amount, balance, reason, ref_id, note) "
        "VALUES (:uid, :amt, :bal, :reason, :ref, :note)"
    ), {"uid": user_id, "amt": int(amount), "bal": new_balance, "reason": reason, "ref": ref_id, "note": note})

    try:
        await _try_add_point_lot(db, user_id, int(amount), reason, ref_id)
    except Exception:
        pass


async def on_payment(db: AsyncSession, user_id: str, payment_ref: str | None = None, autocommit: bool = True) -> dict:
    """결제 완료 시 호출 — 추천인 포인트 적립(첫 결제 1회, 멱등)."""
    await _ensure_tables(db)
    link = (await db.execute(text(
        "SELECT id, referrer_id, status FROM referral_links "
        "WHERE referred_id = :uid "
        "ORDER BY created_at DESC LIMIT 1"
    ), {"uid": user_id})).fetchone()
    if not link:
        return {"linked": False, "rewarded": False}

    link_id, referrer_id, status = str(link[0]), str(link[1]), (link[2] or "registered")

    already_paid = (await db.execute(text(
        "SELECT 1 FROM point_ledger "
        "WHERE user_id = :rid AND reason = 'referral_payment' AND ref_id = :lid LIMIT 1"
    ), {"rid": referrer_id, "lid": link_id})).fetchone() is not None

    if status != "paid":
        await db.execute(text(
            "UPDATE referral_links SET status = 'paid', paid_at = COALESCE(paid_at, now()) WHERE id = :lid"
        ), {"lid": link_id})

    rewarded = False
    capped = False
    if not already_paid:
        monthly = await _referral_monthly_earned(db, referrer_id)
        if monthly + POINTS_PAYMENT_REFERRER <= MONTHLY_REFERRAL_CAP:
            note = "피추천인 첫 결제 보너스"
            if payment_ref:
                note = f"{note} ({payment_ref})"
            await _add_points(db, referrer_id, POINTS_PAYMENT_REFERRER, "referral_payment", note, link_id)
            rewarded = True
        else:
            capped = True

    if autocommit:
        await db.commit()
    return {
        "linked": True,
        "rewarded": rewarded,
        "already_paid": already_paid,
        "status_before": status,
        "capped": capped,
        "link_id": link_id,
    }


# ─── 관리자: 부정 사용 신호 (읽기 전용 휴리스틱) ───
@router.get("/admin/fraud-signals", response_model=ApiResponse)
async def admin_fraud_signals(request: Request, db: AsyncSession = Depends(get_db), _admin: None = Depends(auth_admin_check)):
    """레퍼럴 부정 사용 신호(읽기 전용)."""
    signals: list[dict] = []
    try:
        self_ref = (await db.execute(text(
            "SELECT COUNT(*) FROM referral_links WHERE referrer_id = referred_id"
        ))).scalar() or 0
        if self_ref:
            signals.append({"type": "self_referral", "label": "자가 추천(추천인=피추천인)", "count": int(self_ref),
                            "severity": "high", "detail": "정상 흐름에서는 차단되지만 잔존 데이터가 있는지 확인하세요."})
    except Exception:
        pass

    try:
        dup_rows = (await db.execute(text(
            "SELECT referred_id, COUNT(*) c FROM referral_links GROUP BY referred_id HAVING COUNT(*) > 1 ORDER BY c DESC LIMIT 20"
        ))).fetchall()
        for r in dup_rows:
            signals.append({"type": "duplicate_referred", "label": "동일 피추천인 복수 연결",
                            "target": str(r[0]), "count": int(r[1]), "severity": "medium",
                            "detail": "한 회원이 여러 추천 링크에 연결됨 — 중복/조작 가능성 점검."})
    except Exception:
        pass

    try:
        burst_rows = (await db.execute(text(
            "SELECT referrer_id, created_at::date d, COUNT(*) c FROM referral_links "
            "GROUP BY referrer_id, created_at::date HAVING COUNT(*) >= 5 ORDER BY c DESC LIMIT 10"
        ))).fetchall()
        for r in burst_rows:
            signals.append({"type": "burst", "label": "단기 다수 초대(같은 날 5건+)",
                            "target": str(r[0]), "date": str(r[1]), "count": int(r[2]), "severity": "medium",
                            "detail": "동일 추천인이 짧은 기간에 다수 초대 — 어뷰징 가능성 점검."})
    except Exception:
        pass

    return ApiResponse(data={
        "signals": signals,
        "total": len(signals),
        "note": "경량 휴리스틱(현 데이터 기준). 동일 IP·기기 탐지는 가입/요청 로깅 연동 후 제공됩니다. 본 화면은 신호만 제공하며 자동 조치는 하지 않습니다.",
    })
