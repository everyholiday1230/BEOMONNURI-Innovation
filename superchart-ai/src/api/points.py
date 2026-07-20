"""포인트 시스템 Phase 2 — 소멸 버킷(point_lots) + 상점 + 구매 + 감사 + 관리자.

설계 원칙 (안전 최우선):
- 추가 전용(ADDITIVE). 기존 테이블(users/point_ledger/referral_*)을 DROP/ALTER 하지 않는다.
- 잔액의 정본(canonical)은 기존 users.points + point_ledger 를 그대로 사용한다.
  (referral._add_points 재사용 → 기존 화면/통계와 항상 일치)
- point_lots 는 "유효기간별 잔여"를 추적하는 보조 원장. 적립=lot 생성, 사용=오래된(소멸
  임박) lot부터 FIFO 차감, 소멸=만료 lot 잔여를 0으로 + 음수 차감.
- 모든 신규 테이블은 CREATE TABLE IF NOT EXISTS 로 지연 생성(멱등).
- 실제 운영 DB 미검증 → 모든 작업은 트랜잭션 + 예외 시 rollback.

롤백: 신규 테이블만 DROP 하면 원상복구 (기존 데이터 영향 없음).
  DROP TABLE IF EXISTS point_lots, point_products, point_purchases, point_audit;
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id
from src.services.admin_helpers import auth_admin_check

router = APIRouter(prefix="/points", tags=["points"])

# 포인트 유형별 기본 유효기간(일). None = 무기한.
EXPIRY_DAYS = {
    "signup_bonus": 30,
    "referral_signup": 90,
    "referral_payment": 90,
    "event": 60,
    "admin_adjust": None,
    "purchase_refund": 90,
    "charge": None,  # 유료 충전 포인트는 만료 없음
}

_ensured = False


async def _ensure(db: AsyncSession) -> None:
    """신규 테이블 멱등 생성 (기존 테이블은 절대 건드리지 않음)."""
    global _ensured
    if _ensured:
        return
    try:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS point_lots (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                amount INTEGER NOT NULL,
                remaining INTEGER NOT NULL,
                point_type TEXT NOT NULL DEFAULT 'event',
                reason TEXT,
                ref_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                expires_at TIMESTAMPTZ
            )
        """))
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_point_lots_user ON point_lots(user_id, remaining, expires_at)"))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS point_products (
                id BIGSERIAL PRIMARY KEY,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT 'etc',
                description TEXT,
                cost INTEGER NOT NULL,
                period TEXT,
                duration_days INTEGER,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS point_purchases (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                product_code TEXT NOT NULL,
                product_name TEXT,
                cost INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_point_purchases_user ON point_purchases(user_id, created_at)"))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS point_audit (
                id BIGSERIAL PRIMARY KEY,
                actor TEXT NOT NULL,
                action TEXT NOT NULL,
                user_id TEXT,
                amount INTEGER,
                balance_before INTEGER,
                balance_after INTEGER,
                ref TEXT,
                ip TEXT,
                reason TEXT,
                result TEXT,
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


async def _balance(db: AsyncSession, user_id: str) -> int:
    return int((await db.execute(text("SELECT COALESCE(points,0) FROM users WHERE id=:u"), {"u": user_id})).scalar() or 0)


async def _ledger_add(db: AsyncSession, user_id: str, amount: int, reason: str, note: str = "", ref_id: str | None = None) -> tuple[int, int]:
    """잔액 정본(users.points) + point_ledger 갱신 (기존 패턴과 동일)."""
    # 원자적 증감 — 동시 요청에도 잔액이 어긋나지 않도록 DB에서 직접 더한다.
    after = (await db.execute(text(
        "UPDATE users SET points = COALESCE(points, 0) + :a WHERE id = :u RETURNING points"
    ), {"a": amount, "u": user_id})).scalar()
    if after is None:
        return 0, 0
    after = int(after)
    before = after - amount
    await db.execute(text(
        "INSERT INTO point_ledger (user_id, amount, balance, reason, ref_id, note) VALUES (:u,:a,:b,:r,:ref,:n)"
    ), {"u": user_id, "a": amount, "b": after, "r": reason, "ref": ref_id, "n": note})
    return before, after


async def grant(db: AsyncSession, user_id: str, amount: int, point_type: str, reason: str, note: str = "", ref_id: str | None = None):
    """포인트 적립: lot 생성 + 정본 잔액/원장 갱신."""
    if amount <= 0:
        return
    days = EXPIRY_DAYS.get(point_type, None)
    expires = (datetime.now(timezone.utc) + timedelta(days=days)) if days else None
    await db.execute(text(
        "INSERT INTO point_lots (user_id, amount, remaining, point_type, reason, ref_id, expires_at) "
        "VALUES (:u,:a,:a,:t,:r,:ref,:e)"
    ), {"u": user_id, "a": amount, "t": point_type, "r": reason, "ref": ref_id, "e": expires})
    await _ledger_add(db, user_id, amount, reason, note, ref_id)


async def expire_sweep(db: AsyncSession, user_id: str):
    """만료된 lot 잔여를 회수(음수 차감). 읽기 시 지연 실행."""
    rows = (await db.execute(text(
        "SELECT id, remaining FROM point_lots WHERE user_id=:u AND remaining>0 AND expires_at IS NOT NULL AND expires_at <= now()"
    ), {"u": user_id})).fetchall()
    total = 0
    for r in rows:
        total += int(r[1] or 0)
        await db.execute(text("UPDATE point_lots SET remaining=0 WHERE id=:id"), {"id": r[0]})
    if total > 0:
        await _ledger_add(db, user_id, -total, "expire", f"{total}P 소멸")


async def spend(db: AsyncSession, user_id: str, amount: int, reason: str, note: str = "", ref_id: str | None = None) -> bool:
    """포인트 사용: 소멸 임박(유효기간 짧은) lot부터 FIFO 차감 + 정본 잔액/원장 갱신.
    잔액 부족이면 False (변경 없음).

    동시성: 정본 잔액 차감은 조건부 원자 UPDATE(points >= amount)로 수행해
    동시 요청에도 이중 차감/음수 잔액이 발생하지 않는다.
    """
    if amount <= 0:
        return False
    await expire_sweep(db, user_id)

    # 조건부 원자 차감 — 잔액이 충분할 때만 차감되고, 부족하면 0행 → False.
    after = (await db.execute(text(
        "UPDATE users SET points = COALESCE(points,0) - :amt "
        "WHERE id = :u AND COALESCE(points,0) >= :amt RETURNING points"
    ), {"amt": amount, "u": user_id})).scalar()
    if after is None:
        return False  # 잔액 부족 (변경 없음)
    after = int(after)

    # 원장 기록
    await db.execute(text(
        "INSERT INTO point_ledger (user_id, amount, balance, reason, ref_id, note) VALUES (:u,:a,:b,:r,:ref,:n)"
    ), {"u": user_id, "a": -amount, "b": after, "r": reason, "ref": ref_id, "n": note})

    # 소멸 임박(유효기간 짧은) lot 부터 FIFO 로 remaining 차감 (보조 원장)
    lots = (await db.execute(text(
        "SELECT id, remaining FROM point_lots WHERE user_id=:u AND remaining>0 "
        "ORDER BY (expires_at IS NULL), expires_at ASC, created_at ASC"
    ), {"u": user_id})).fetchall()
    need = amount
    for lot in lots:
        if need <= 0:
            break
        take = min(int(lot[1] or 0), need)
        await db.execute(text("UPDATE point_lots SET remaining=remaining-:t WHERE id=:id"), {"t": take, "id": lot[0]})
        need -= take
    return True


async def _usable_and_expiring(db: AsyncSession, user_id: str):
    """사용 가능 포인트(=정본 잔액) + 30일 내 소멸 예정 합계."""
    await expire_sweep(db, user_id)
    bal = await _balance(db, user_id)
    soon = int((await db.execute(text(
        "SELECT COALESCE(SUM(remaining),0) FROM point_lots WHERE user_id=:u AND remaining>0 "
        "AND expires_at IS NOT NULL AND expires_at <= now() + interval '30 days'"
    ), {"u": user_id})).scalar() or 0)
    soonest = (await db.execute(text(
        "SELECT MIN(expires_at) FROM point_lots WHERE user_id=:u AND remaining>0 AND expires_at IS NOT NULL AND expires_at > now()"
    ), {"u": user_id})).scalar()
    return bal, soon, soonest


_DEFAULT_PRODUCTS = [
    ("signal_build_1", "나만의 신호 만들기 1회", "ai", "버튼식 빌더로 나만의 매매 신호를 만드는 이용권 1회", 1000, "1회", None, 1),
]


# 카탈로그 동기화는 프로세스당 1회만 수행 (매 요청마다 재실행 방지).
_catalog_synced = False

# 과거 기본 상품 코드 — 상점 개편 전 시드되었던 항목. 데이터는 지우지 않고
# active=FALSE 로만 숨긴다(구매 이력/감사 로그 보존). 관리자가 직접 추가한
# 상품은 이 목록에 없으므로 영향을 받지 않는다.
_LEGACY_PRODUCT_CODES = [
    "ai_deep_1", "ai_risk_1", "ind_beom_pro_7", "preset_premium_30",
    "heatmap_detail_24", "paper_slot_10", "watch_slot_ext",
]


async def _sync_catalog(db: AsyncSession) -> None:
    """코드 정의(_DEFAULT_PRODUCTS)를 상점에 반영 + 과거 기본 상품 숨김.

    안전 원칙:
    - 데이터를 삭제하지 않는다. 과거 기본 상품은 active=FALSE 로만 전환한다.
    - 카탈로그 상품은 upsert 로 최신 정보 반영 + active=TRUE 로 되돌린다.
    - 관리자가 직접 추가한 상품(레거시 목록에 없음)은 건드리지 않는다.
    - 멱등하며, 이미 원하는 상태면 실질적 변경이 없다.
    """
    global _catalog_synced
    if _catalog_synced:
        return
    catalog_codes = {row[0] for row in _DEFAULT_PRODUCTS}
    try:
        # 1) 카탈로그 상품 upsert (활성화 포함)
        for code, name, cat, desc, cost, period, dur, order in _DEFAULT_PRODUCTS:
            await db.execute(text(
                "INSERT INTO point_products (code, name, category, description, cost, period, duration_days, active, sort_order) "
                "VALUES (:c,:n,:cat,:d,:cost,:p,:dur,TRUE,:o) "
                "ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, "
                "description=EXCLUDED.description, cost=EXCLUDED.cost, period=EXCLUDED.period, "
                "duration_days=EXCLUDED.duration_days, active=TRUE, sort_order=EXCLUDED.sort_order"
            ), {"c": code, "n": name, "cat": cat, "d": desc, "cost": cost, "p": period, "dur": dur, "o": order})
        # 2) 과거 기본 상품 중 현재 카탈로그에 없는 것만 비활성화(삭제 아님)
        legacy_to_hide = [c for c in _LEGACY_PRODUCT_CODES if c not in catalog_codes]
        if legacy_to_hide:
            await db.execute(
                text("UPDATE point_products SET active=FALSE WHERE code IN :codes AND active=TRUE").bindparams(
                    bindparam("codes", expanding=True)
                ),
                {"codes": legacy_to_hide},
            )
        await db.commit()
        _catalog_synced = True
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass


# ─────────────────────────── 사용자 엔드포인트 ───────────────────────────

@router.get("/summary", response_model=ApiResponse)
async def summary(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    await _ensure(db)
    try:
        bal, soon, soonest = await _usable_and_expiring(db, user_id)
        await db.commit()
    except Exception:
        await db.rollback()
        return ApiResponse(data={"points": 0, "usable": 0, "expiring": 0, "soonest_expire": None, "month_earned": 0, "month_used": 0})
    # 이번 달 적립/사용 (point_ledger 기준)
    month_earned = int((await db.execute(text(
        "SELECT COALESCE(SUM(amount),0) FROM point_ledger WHERE user_id=:u AND amount>0 AND created_at >= date_trunc('month', now())"
    ), {"u": user_id})).scalar() or 0)
    month_used = int((await db.execute(text(
        "SELECT COALESCE(SUM(amount),0) FROM point_ledger WHERE user_id=:u AND amount<0 AND created_at >= date_trunc('month', now())"
    ), {"u": user_id})).scalar() or 0)
    return ApiResponse(data={
        "points": bal, "usable": bal, "expiring": soon,
        "soonest_expire": str(soonest) if soonest else None,
        "month_earned": month_earned, "month_used": abs(month_used),
    })


@router.get("/shop", response_model=ApiResponse)
async def shop(db: AsyncSession = Depends(get_db)):
    await _ensure(db)
    # 코드 정의를 상점의 단일 출처로 반영(프로세스당 1회, 멱등, 데이터 삭제 없음).
    await _sync_catalog(db)
    rows = (await db.execute(text(
        "SELECT code, name, category, description, cost, period, active FROM point_products WHERE active=TRUE ORDER BY sort_order, id"
    ))).fetchall()
    return ApiResponse(data={"items": [
        {"code": r[0], "name": r[1], "category": r[2], "description": r[3], "cost": r[4], "period": r[5]} for r in rows
    ]})


@router.get("/expiring", response_model=ApiResponse)
async def expiring(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    await _ensure(db)
    await expire_sweep(db, user_id)
    await db.commit()
    rows = (await db.execute(text(
        "SELECT remaining, point_type, expires_at FROM point_lots WHERE user_id=:u AND remaining>0 AND expires_at IS NOT NULL "
        "ORDER BY expires_at ASC LIMIT 20"
    ), {"u": user_id})).fetchall()
    return ApiResponse(data={"items": [
        {"amount": r[0], "type": r[1], "expires_at": str(r[2])} for r in rows
    ]})


@router.post("/buy", response_model=ApiResponse)
async def buy(req: dict, request: Request, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    await _ensure(db)
    code = (req.get("product_code") or "").strip()
    if not code:
        raise HTTPException(400, "product_code 필요")
    prod = (await db.execute(text(
        "SELECT code, name, cost, duration_days, active FROM point_products WHERE code=:c"
    ), {"c": code})).fetchone()
    if not prod or not prod[4]:
        raise HTTPException(404, "판매 중이지 않은 상품입니다")
    cost = int(prod[2])
    before = await _balance(db, user_id)
    ip = request.client.host if request and request.client else ""
    try:
        ok = await spend(db, user_id, cost, "purchase", f"상품 구매: {prod[1]}", code)
        if not ok:
            # 감사 로그(실패)
            await db.execute(text(
                "INSERT INTO point_audit (actor, action, user_id, amount, balance_before, balance_after, ref, ip, reason, result) "
                "VALUES (:ac,'buy',:u,:amt,:b,:b,:ref,:ip,'잔액 부족','fail')"
            ), {"ac": user_id, "u": user_id, "amt": -cost, "b": before, "ref": code, "ip": ip})
            await db.commit()
            need = cost - before
            return ApiResponse(data={"success": False, "reason": "insufficient", "need": need, "balance": before, "cost": cost})
        # 구매/엔타이틀먼트 기록
        dur = prod[3]
        exp = (datetime.now(timezone.utc) + timedelta(days=int(dur))) if dur else None
        await db.execute(text(
            "INSERT INTO point_purchases (user_id, product_code, product_name, cost, status, expires_at) "
            "VALUES (:u,:c,:n,:cost,'active',:e)"
        ), {"u": user_id, "c": code, "n": prod[1], "cost": cost, "e": exp})
        after = await _balance(db, user_id)
        await db.execute(text(
            "INSERT INTO point_audit (actor, action, user_id, amount, balance_before, balance_after, ref, ip, reason, result) "
            "VALUES (:ac,'buy',:u,:amt,:bb,:ba,:ref,:ip,:rs,'ok')"
        ), {"ac": user_id, "u": user_id, "amt": -cost, "bb": before, "ba": after, "ref": code, "ip": ip, "rs": prod[1]})
        await db.commit()
        return ApiResponse(data={"success": True, "balance": after, "product": prod[1], "expires_at": str(exp) if exp else None})
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"구매 처리 실패: {str(e)[:120]}")


@router.get("/purchases", response_model=ApiResponse)
async def my_purchases(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    await _ensure(db)
    rows = (await db.execute(text(
        "SELECT product_name, cost, status, expires_at, created_at FROM point_purchases WHERE user_id=:u ORDER BY created_at DESC LIMIT 50"
    ), {"u": user_id})).fetchall()
    return ApiResponse(data={"items": [
        {"name": r[0], "cost": r[1], "status": r[2], "expires_at": str(r[3]) if r[3] else None, "date": str(r[4])} for r in rows
    ]})


# ─────────────────────────── 관리자 엔드포인트 ───────────────────────────

@router.get("/admin/overview", response_model=ApiResponse)
async def admin_overview(request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    today_grant = int((await db.execute(text(
        "SELECT COALESCE(SUM(amount),0) FROM point_ledger WHERE amount>0 AND created_at::date = now()::date"
    ))).scalar() or 0)
    today_use = int((await db.execute(text(
        "SELECT COALESCE(SUM(amount),0) FROM point_ledger WHERE amount<0 AND created_at::date = now()::date"
    ))).scalar() or 0)
    total_issued = int((await db.execute(text("SELECT COALESCE(SUM(amount),0) FROM point_ledger WHERE amount>0"))).scalar() or 0)
    usable_total = int((await db.execute(text("SELECT COALESCE(SUM(points),0) FROM users"))).scalar() or 0)
    expiring_total = int((await db.execute(text(
        "SELECT COALESCE(SUM(remaining),0) FROM point_lots WHERE remaining>0 AND expires_at IS NOT NULL AND expires_at <= now() + interval '30 days'"
    ))).scalar() or 0)
    purchases = int((await db.execute(text("SELECT COUNT(*) FROM point_purchases"))).scalar() or 0)
    top_prod = (await db.execute(text(
        "SELECT product_name, COUNT(*) c FROM point_purchases GROUP BY product_name ORDER BY c DESC LIMIT 1"
    ))).fetchone()
    return ApiResponse(data={
        "today_grant": today_grant, "today_use": abs(today_use), "total_issued": total_issued,
        "usable_total": usable_total, "expiring_total": expiring_total, "purchases": purchases,
        "top_product": (top_prod[0] if top_prod else None),
    })


@router.get("/admin/audit", response_model=ApiResponse)
async def admin_audit(request: Request, page: int = 1, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    off = max(0, (page - 1) * 30)
    rows = (await db.execute(text(
        "SELECT created_at, actor, action, user_id, amount, balance_before, balance_after, ref, reason, result "
        "FROM point_audit ORDER BY created_at DESC LIMIT 30 OFFSET :o"
    ), {"o": off})).fetchall()
    return ApiResponse(data={"items": [
        {"date": str(r[0]), "actor": r[1], "action": r[2], "user_id": r[3], "amount": r[4],
         "before": r[5], "after": r[6], "ref": r[7], "reason": r[8], "result": r[9]} for r in rows
    ]})


@router.post("/admin/grant", response_model=ApiResponse)
async def admin_grant(req: dict, request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    """관리자 수동 지급(양수) / 회수(음수)."""
    await _ensure(db)
    email = (req.get("email") or "").strip()
    amount = int(req.get("amount", 0))
    reason = (req.get("note") or "관리자 수동 조정").strip()
    if not email or amount == 0:
        raise HTTPException(400, "email 과 0이 아닌 amount 필요")
    urow = (await db.execute(text("SELECT id FROM users WHERE email=:e"), {"e": email})).fetchone()
    if not urow:
        raise HTTPException(404, "해당 이메일의 회원 없음")
    uid = str(urow[0])
    ip = request.client.host if request and request.client else ""
    before = await _balance(db, uid)
    try:
        if amount > 0:
            await grant(db, uid, amount, "admin_adjust", reason, ref_id="admin")
            action = "grant"
        else:
            # 회수: lot FIFO 차감 + 정본
            ok = await spend(db, uid, -amount, "revoke", reason, "admin")
            if not ok:
                raise HTTPException(400, f"회수 불가: 보유 포인트({before}P) 부족")
            action = "recover"
        after = await _balance(db, uid)
        await db.execute(text(
            "INSERT INTO point_audit (actor, action, user_id, amount, balance_before, balance_after, ref, ip, reason, result) "
            "VALUES ('admin',:act,:u,:amt,:bb,:ba,'admin',:ip,:rs,'ok')"
        ), {"act": action, "u": uid, "amt": amount, "bb": before, "ba": after, "ip": ip, "rs": reason})
        await db.commit()
        return ApiResponse(data={"message": f"{amount:+d}P {'지급' if amount>0 else '회수'} 완료", "balance": after})
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"처리 실패: {str(e)[:120]}")


# ═══ 관리자: 포인트 상품 관리 (기존 point_products 테이블 재사용) ═══
@router.get("/admin/products", response_model=ApiResponse)
async def admin_products(request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    """포인트 상점 상품 전체 목록(비활성 포함)."""
    await _ensure(db)
    rows = (await db.execute(text(
        "SELECT code, name, category, description, cost, period, duration_days, active, sort_order "
        "FROM point_products ORDER BY sort_order, id"
    ))).fetchall()
    return ApiResponse(data={"items": [
        {"code": r[0], "name": r[1], "category": r[2], "description": r[3], "cost": r[4],
         "period": r[5], "duration_days": r[6], "active": bool(r[7]), "sort_order": r[8]} for r in rows
    ]})


@router.post("/admin/products", response_model=ApiResponse)
async def admin_upsert_product(req: dict, request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    """상품 생성/수정(코드 기준 upsert)."""
    await _ensure(db)
    code = (req.get("code") or "").strip()
    name = (req.get("name") or "").strip()
    if not code or not name:
        raise HTTPException(400, "code 와 name 은 필수입니다")
    try:
        cost = int(req.get("cost", 0))
    except (TypeError, ValueError):
        raise HTTPException(400, "cost 는 정수여야 합니다")
    if cost < 0:
        raise HTTPException(400, "cost 는 0 이상이어야 합니다")
    category = (req.get("category") or "etc").strip()
    description = (req.get("description") or "").strip()
    period = (req.get("period") or "").strip() or None
    duration_days = req.get("duration_days")
    try:
        duration_days = int(duration_days) if duration_days not in (None, "") else None
    except (TypeError, ValueError):
        duration_days = None
    sort_order = req.get("sort_order")
    try:
        sort_order = int(sort_order) if sort_order not in (None, "") else 0
    except (TypeError, ValueError):
        sort_order = 0
    active = bool(req.get("active", True))
    ip = request.client.host if request and request.client else ""
    try:
        await db.execute(text(
            "INSERT INTO point_products (code, name, category, description, cost, period, duration_days, active, sort_order) "
            "VALUES (:c,:n,:cat,:d,:cost,:p,:dd,:a,:so) "
            "ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category, "
            "description=EXCLUDED.description, cost=EXCLUDED.cost, period=EXCLUDED.period, "
            "duration_days=EXCLUDED.duration_days, active=EXCLUDED.active, sort_order=EXCLUDED.sort_order"
        ), {"c": code, "n": name, "cat": category, "d": description, "cost": cost,
            "p": period, "dd": duration_days, "a": active, "so": sort_order})
        await db.execute(text(
            "INSERT INTO point_audit (actor, action, user_id, amount, ref, ip, reason, result) "
            "VALUES ('admin','product_upsert',NULL,:cost,:c,:ip,:rs,'ok')"
        ), {"cost": cost, "c": code, "ip": ip, "rs": f"상품 저장: {name}"})
        await db.commit()
        return ApiResponse(data={"message": f"상품 '{name}' ({code}) 저장 완료"})
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"저장 실패: {str(e)[:120]}")


@router.post("/admin/products/toggle", response_model=ApiResponse)
async def admin_toggle_product(req: dict, request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    """상품 활성/비활성 전환."""
    await _ensure(db)
    code = (req.get("code") or "").strip()
    row = (await db.execute(text("SELECT active, code FROM point_products WHERE lower(code)=lower(:c)"), {"c": code})).fetchone()
    if not row:
        raise HTTPException(404, "상품 없음")
    new_active = not bool(row[0])
    stored_code = row[1]
    ip = request.client.host if request and request.client else ""
    await db.execute(text("UPDATE point_products SET active=:a WHERE code=:c"), {"a": new_active, "c": stored_code})
    await db.execute(text(
        "INSERT INTO point_audit (actor, action, ref, ip, reason, result) "
        "VALUES ('admin','product_toggle',:c,:ip,:rs,'ok')"
    ), {"c": stored_code, "ip": ip, "rs": f"활성 상태 → {new_active}"})
    await db.commit()
    return ApiResponse(data={"message": f"{code} {'활성화' if new_active else '비활성화'} 완료", "active": new_active})


# ═══ 포인트 정책(읽기 전용 — 현재 적용 중인 기본값) ═══
@router.get("/policy", response_model=ApiResponse)
async def points_policy(request: Request, _a: None = Depends(auth_admin_check)):
    """현재 코드에 적용 중인 포인트 정책 상수(읽기 전용).

    정직한 한계: 정책을 화면에서 편집하려면 별도 설정 저장소(config 테이블)가 필요하며
    현재는 referral.py 상수가 단일 출처(SoT)다.
    """
    try:
        from src.api.referral import (
            POINTS_SIGNUP_REFERRED, POINTS_SIGNUP_REFERRER, POINTS_PAYMENT_REFERRER,
            MONTHLY_REFERRAL_CAP, EXPIRY_DAYS_REFERRAL, EXPIRY_DAYS_SIGNUP,
        )
    except Exception:
        POINTS_SIGNUP_REFERRED = POINTS_SIGNUP_REFERRER = POINTS_PAYMENT_REFERRER = 0
        MONTHLY_REFERRAL_CAP = EXPIRY_DAYS_REFERRAL = EXPIRY_DAYS_SIGNUP = 0
    return ApiResponse(data={
        "signup_bonus": POINTS_SIGNUP_REFERRED,
        "signup_bonus_expiry_days": EXPIRY_DAYS_SIGNUP,
        "referrer_reward": POINTS_SIGNUP_REFERRER,
        "referrer_reward_trigger": "피추천인 이메일 인증 완료 시",
        "referrer_reward_expiry_days": EXPIRY_DAYS_REFERRAL,
        "first_payment_bonus": POINTS_PAYMENT_REFERRER,
        "monthly_cap": MONTHLY_REFERRAL_CAP,
        "use_order": "유효기간이 짧은 순(FIFO by expiry)",
        "disclaimer": "포인트는 현금으로 환불 또는 출금할 수 없으며, 범온 슈퍼차트 AI 서비스 내 기능 이용에만 사용할 수 있습니다.",
        "editable": False,
        "note": "정책 편집은 별도 설정 저장소(config) 연동 후 제공됩니다. 현재 값은 코드 상수 기준입니다.",
    })
