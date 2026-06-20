"""지표 개별 판매 API (결제 PG 연동 전 준비 — buy는 stub으로 pending 생성)."""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
import structlog
from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id
from src.services.admin_helpers import auth_admin_check

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/purchases", tags=["purchases"])


async def get_purchased_codes(db: AsyncSession, user_id: str) -> list[str]:
    """해당 유저가 구매 완료(paid)한 지표 코드 목록."""
    if not user_id:
        return []
    rows = (await db.execute(text(
        "SELECT indicator_code FROM user_purchases WHERE user_id=:uid AND status='paid'"
    ), {"uid": user_id})).fetchall()
    return [r[0] for r in rows]


@router.get("/products", response_model=ApiResponse)
async def list_products(db: AsyncSession = Depends(get_db)):
    """판매 중인 지표 상품 목록 (공개).

    DB가 일시적으로 불능이어도 프런트가 503 콘솔 에러로 흔들리지 않도록
    빈 목록(success=true)으로 안전 폴백한다.
    """
    try:
        rows = (await db.execute(text(
            "SELECT indicator_code, name, price, currency, description FROM indicator_products "
            "WHERE is_active=true ORDER BY sort_order, name"
        ))).fetchall()
        return ApiResponse(data=[{
            "indicator_code": r[0], "name": r[1], "price": r[2], "currency": r[3], "description": r[4]
        } for r in rows])
    except Exception as e:
        logger.warning("purchases.products.fallback", error=str(e)[:200])
        return ApiResponse(data=[])


@router.get("/mine", response_model=ApiResponse)
async def my_purchases(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """내 구매 내역."""
    rows = (await db.execute(text(
        "SELECT indicator_code, status, price, purchased_at, created_at FROM user_purchases "
        "WHERE user_id=:uid ORDER BY created_at DESC"
    ), {"uid": user_id})).fetchall()
    return ApiResponse(data={
        "purchased": [r[0] for r in rows if r[1] == "paid"],
        "items": [{"indicator_code": r[0], "status": r[1], "price": r[2],
                   "purchased_at": str(r[3]) if r[3] else None, "created_at": str(r[4])} for r in rows],
    })


@router.post("/buy", response_model=ApiResponse)
async def buy(req: dict, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """구매 요청 — 결제 PG 연동 전이므로 pending 주문 생성(추후 결제 콜백에서 paid 처리)."""
    code = (req.get("indicator_code") or "").strip()
    if not code:
        raise HTTPException(400, "indicator_code 필요")
    prod = (await db.execute(text(
        "SELECT name, price FROM indicator_products WHERE indicator_code=:c AND is_active=true"
    ), {"c": code})).fetchone()
    if not prod:
        raise HTTPException(404, "판매 중인 상품이 아닙니다")
    # 이미 구매(paid)면 그대로
    existing = (await db.execute(text(
        "SELECT status FROM user_purchases WHERE user_id=:uid AND indicator_code=:c"
    ), {"uid": user_id, "c": code})).fetchone()
    if existing and existing[0] == "paid":
        return ApiResponse(data={"status": "paid", "message": "이미 보유한 지표입니다"})
    # pending 주문 upsert
    await db.execute(text(
        "INSERT INTO user_purchases (user_id, indicator_code, status, price) "
        "VALUES (:uid, :c, 'pending', :p) "
        "ON CONFLICT (user_id, indicator_code) DO UPDATE SET status='pending', price=:p, created_at=now()"
    ), {"uid": user_id, "c": code, "p": prod[1]})
    await db.commit()
    # ── 결제 PG 연동 지점 ──
    # 추후 여기서 PG 결제창 URL 생성/리다이렉트. 결제완료 콜백이 status='paid', purchased_at=now() 로 갱신.
    return ApiResponse(data={"status": "pending", "price": prod[1],
                             "message": "결제 준비됨 (결제 연동 후 자동 완료)"})


# ─── 관리자 ───

@router.post("/admin/set-product", response_model=ApiResponse)
async def admin_set_product(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """상품 등록/가격·활성 수정 (운영자)."""
    await auth_admin_check(request)
    code = (req.get("indicator_code") or "").strip()
    if not code:
        raise HTTPException(400, "indicator_code 필요")
    name = req.get("name") or code
    price = int(req.get("price", 0))
    active = bool(req.get("is_active", True)) if "is_active" in req else True
    desc = req.get("description", "")
    await db.execute(text(
        "INSERT INTO indicator_products (indicator_code, name, price, description, is_active) "
        "VALUES (:c, :n, :p, :d, :a) "
        "ON CONFLICT (indicator_code) DO UPDATE SET name=:n, price=:p, description=:d, is_active=:a, updated_at=now()"
    ), {"c": code, "n": name, "p": price, "d": desc, "a": active})
    await db.commit()
    return ApiResponse(data={"indicator_code": code, "price": price, "is_active": active})


@router.post("/admin/grant", response_model=ApiResponse)
async def admin_grant(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """수동 구매 부여/회수 (운영자) — email 또는 user_id."""
    await auth_admin_check(request)
    code = (req.get("indicator_code") or "").strip()
    grant = bool(req.get("grant", True))
    uid = req.get("user_id")
    if not uid and (req.get("email") or "").strip():
        row = (await db.execute(text("SELECT id FROM users WHERE email=:e"), {"e": req["email"].strip()})).fetchone()
        if not row:
            raise HTTPException(404, "해당 이메일 회원 없음")
        uid = str(row[0])
    if not uid or not code:
        raise HTTPException(400, "user_id(또는 email)와 indicator_code 필요")
    if grant:
        await db.execute(text(
            "INSERT INTO user_purchases (user_id, indicator_code, status, purchased_at) "
            "VALUES (:uid, :c, 'paid', now()) "
            "ON CONFLICT (user_id, indicator_code) DO UPDATE SET status='paid', purchased_at=now()"
        ), {"uid": uid, "c": code})
    else:
        await db.execute(text(
            "DELETE FROM user_purchases WHERE user_id=:uid AND indicator_code=:c"
        ), {"uid": uid, "c": code})
    await db.commit()
    return ApiResponse(data={"user_id": uid, "indicator_code": code, "granted": grant})


@router.get("/admin/list", response_model=ApiResponse)
async def admin_list(request: Request, db: AsyncSession = Depends(get_db)):
    """상품 + 구매 통계 (운영자)."""
    await auth_admin_check(request)
    products = (await db.execute(text(
        "SELECT indicator_code, name, price, is_active, "
        "(SELECT COUNT(*) FROM user_purchases up WHERE up.indicator_code=ip.indicator_code AND up.status='paid') AS sold "
        "FROM indicator_products ip ORDER BY sort_order, name"
    ))).fetchall()
    return ApiResponse(data={"products": [
        {"indicator_code": r[0], "name": r[1], "price": r[2], "is_active": r[3], "sold": r[4]} for r in products
    ]})
