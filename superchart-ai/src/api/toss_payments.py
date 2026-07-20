"""토스페이먼츠 결제 연동 — 지표 단건 / 구독(정기결제 준비) / 포인트 충전 통합.

흐름(토스 결제위젯 v2 표준):
  1) 프론트: POST /v1/toss/prepare  → 서버가 금액을 재계산해 order_id 발급(payment_orders, status=ready)
  2) 프론트: Toss SDK로 결제창 호출(요청→인증) → successUrl로 paymentKey/orderId/amount 리다이렉트
  3) 프론트: POST /v1/toss/confirm  → 서버가 저장된 금액과 대조 후 Toss 결제승인(confirm) API 호출
  4) 승인 성공 시 order.kind 별로 상품을 지급(지표 구매 확정 / 구독 tier 부여 / 포인트 충전)

보안 원칙:
- 금액은 반드시 서버가 계산한다(프론트에서 보낸 금액을 신뢰하지 않음).
- confirm 단계에서 저장된 order.amount와 Toss가 승인한 금액을 다시 대조한다.
- order_id 는 서버가 발급하며 위조 방지를 위해 무작위 토큰을 포함한다.
- 동일 order_id 재confirm 요청은 멱등 처리(이미 지급된 주문은 다시 지급하지 않음).
"""
from __future__ import annotations

import json
import secrets

import structlog
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id
from src.services.toss import TossNotConfiguredError, TossPaymentError, confirm_payment, get_client_key

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/toss", tags=["Toss Payments"])

_ensured = False

# ── 상품 카탈로그(서버측 단일 출처) ──
# 지표 개별가는 indicator_products 테이블(purchases.py)이 있으면 그 값을 우선 사용하고,
# 없으면 여기 기본값(5만원)을 쓴다.
INDICATOR_DEFAULT_PRICE = 50000

PLAN_PRICES: dict[str, dict[str, int]] = {
    "vip": {"monthly": 29000, "yearly": 290000},
    "vvip": {"monthly": 49000, "yearly": 490000},
}
PLAN_TIER = {"vip": "pro", "vvip": "premium"}
PLAN_PERIOD_DAYS = {"monthly": 30, "yearly": 365}

# 포인트 충전 패키지(가격 → 지급 포인트, 보너스 포함)
POINT_PACKAGES: dict[int, int] = {
    10000: 10000,
    30000: 31500,
    50000: 54000,
    100000: 112000,
    300000: 345000,
}


def _bundle_rate(n: int) -> float:
    if n >= 10:
        return 0.40
    if n >= 5:
        return 0.25
    if n >= 3:
        return 0.15
    return 0.0


async def _ensure_tables(db: AsyncSession) -> None:
    global _ensured
    if _ensured:
        return
    try:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS payment_orders (
                id BIGSERIAL PRIMARY KEY,
                order_id TEXT UNIQUE NOT NULL,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL,              -- indicator | subscription | points
                amount INTEGER NOT NULL,
                currency TEXT NOT NULL DEFAULT 'KRW',
                status TEXT NOT NULL DEFAULT 'ready',  -- ready | paid | failed | canceled
                meta JSONB NOT NULL DEFAULT '{}'::jsonb,
                payment_key TEXT,
                approved_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id, created_at DESC)"))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS subscriptions (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                plan_code TEXT NOT NULL,        -- vip | vvip
                tier TEXT NOT NULL,             -- pro | premium
                cycle TEXT NOT NULL,            -- monthly | yearly
                status TEXT NOT NULL DEFAULT 'active',  -- active | canceled | expired
                current_period_end TIMESTAMPTZ NOT NULL,
                order_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id, current_period_end DESC)"))
        await db.commit()
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
    _ensured = True


def _new_order_id() -> str:
    # 토스 orderId 규칙: 영문 대소문자/숫자/-/_ , 6~64자
    return f"sc{secrets.token_hex(14)}"


def _to_json(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False)


@router.get("/config", response_model=ApiResponse)
async def toss_config():
    """프론트 SDK 초기화용 공개 클라이언트 키."""
    try:
        return ApiResponse(data={"client_key": get_client_key()})
    except TossNotConfiguredError as e:
        raise HTTPException(503, str(e))


async def _price_indicators(db: AsyncSession, codes: list[str]) -> tuple[int, list[dict]]:
    """지표 목록에 대해 서버가 가격+묶음할인을 재계산."""
    if not codes:
        raise HTTPException(400, "indicator_codes 가 비어 있습니다")
    codes = list(dict.fromkeys(codes))  # 중복 제거, 순서 보존

    rows = (await db.execute(text(
        "SELECT indicator_code, name, price FROM indicator_products "
        "WHERE indicator_code = ANY(:codes) AND is_active = true"
    ), {"codes": codes})).fetchall()
    priced = {r[0]: (r[1], int(r[2])) for r in rows}

    items = []
    subtotal = 0
    for code in codes:
        name, price = priced.get(code, (code, INDICATOR_DEFAULT_PRICE))
        items.append({"indicator_code": code, "name": name, "price": price})
        subtotal += price

    rate = _bundle_rate(len(codes))
    discount = round(subtotal * rate)
    total = subtotal - discount
    return total, items


@router.post("/prepare", response_model=ApiResponse)
async def prepare(req: dict, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """결제 준비 — 서버가 금액을 계산하고 order_id를 발급한다(프론트가 보낸 금액은 무시)."""
    await _ensure_tables(db)
    kind = (req.get("kind") or "").strip()
    if kind not in ("indicator", "subscription", "points"):
        raise HTTPException(400, "kind 는 indicator | subscription | points 중 하나여야 합니다")

    meta: dict = {}
    order_name = ""

    if kind == "indicator":
        codes = req.get("indicator_codes") or []
        if not isinstance(codes, list) or not all(isinstance(c, str) for c in codes):
            raise HTTPException(400, "indicator_codes 는 문자열 배열이어야 합니다")
        amount, items = await _price_indicators(db, codes)
        if amount <= 0:
            raise HTTPException(400, "결제 금액이 0원입니다")
        meta = {"indicator_codes": [it["indicator_code"] for it in items], "items": items}
        order_name = items[0]["name"] if len(items) == 1 else f"{items[0]['name']} 외 {len(items) - 1}건"

    elif kind == "subscription":
        plan_code = (req.get("plan_code") or "").strip().lower()
        cycle = (req.get("cycle") or "").strip().lower()
        if plan_code not in PLAN_PRICES:
            raise HTTPException(400, "plan_code 는 vip | vvip 중 하나여야 합니다")
        if cycle not in PLAN_PERIOD_DAYS:
            raise HTTPException(400, "cycle 은 monthly | yearly 중 하나여야 합니다")
        amount = PLAN_PRICES[plan_code][cycle]
        meta = {"plan_code": plan_code, "cycle": cycle, "tier": PLAN_TIER[plan_code]}
        order_name = f"{plan_code.upper()} 구독 ({'연간' if cycle == 'yearly' else '월간'})"

    else:  # points
        try:
            amount = int(req.get("amount"))
        except (TypeError, ValueError):
            raise HTTPException(400, "amount 가 필요합니다")
        if amount not in POINT_PACKAGES:
            raise HTTPException(400, "지원하지 않는 포인트 충전 금액입니다")
        meta = {"points_amount": amount, "points_granted": POINT_PACKAGES[amount]}
        order_name = f"포인트 충전 {POINT_PACKAGES[amount]:,}P"

    order_id = _new_order_id()
    await db.execute(text(
        "INSERT INTO payment_orders (order_id, user_id, kind, amount, meta, status) "
        "VALUES (:oid, :uid, :kind, :amount, CAST(:meta AS JSONB), 'ready')"
    ), {"oid": order_id, "uid": user_id, "kind": kind, "amount": amount, "meta": _to_json(meta)})
    await db.commit()

    return ApiResponse(data={
        "order_id": order_id,
        "amount": amount,
        "order_name": order_name[:100],
        "currency": "KRW",
    })


@router.post("/confirm", response_model=ApiResponse)
async def confirm(req: dict, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """결제 승인 — Toss confirm API 호출 후 성공하면 상품을 지급한다."""
    await _ensure_tables(db)
    payment_key = (req.get("payment_key") or req.get("paymentKey") or "").strip()
    order_id = (req.get("order_id") or req.get("orderId") or "").strip()
    try:
        client_amount = int(req.get("amount"))
    except (TypeError, ValueError):
        raise HTTPException(400, "amount 가 필요합니다")

    if not payment_key or not order_id:
        raise HTTPException(400, "payment_key 와 order_id 가 필요합니다")

    row = (await db.execute(text(
        "SELECT user_id, kind, amount, status, meta FROM payment_orders WHERE order_id=:oid FOR UPDATE"
    ), {"oid": order_id})).fetchone()
    if not row:
        raise HTTPException(404, "주문을 찾을 수 없습니다")

    order_user_id, kind, order_amount, status, meta = str(row[0]), str(row[1]), int(row[2]), str(row[3]), row[4]
    if order_user_id != user_id:
        raise HTTPException(403, "본인의 주문이 아닙니다")

    if status == "paid":
        # 이미 지급 완료된 주문 — 멱등 응답
        return ApiResponse(data={"status": "paid", "order_id": order_id, "already_processed": True})
    if status not in ("ready", "failed"):
        raise HTTPException(409, f"처리할 수 없는 주문 상태입니다: {status}")

    # 서버가 계산해 저장한 금액과 클라이언트가 보낸 금액(결제창에 표시된 금액) 대조.
    if client_amount != order_amount:
        await db.execute(text(
            "UPDATE payment_orders SET status='failed', updated_at=now() WHERE order_id=:oid"
        ), {"oid": order_id})
        await db.commit()
        raise HTTPException(400, "결제 금액이 주문 금액과 일치하지 않습니다")

    try:
        payment = await confirm_payment(payment_key, order_id, order_amount)
    except TossNotConfiguredError as e:
        raise HTTPException(503, str(e))
    except TossPaymentError as e:
        await db.execute(text(
            "UPDATE payment_orders SET status='failed', payment_key=:pk, updated_at=now() WHERE order_id=:oid"
        ), {"oid": order_id, "pk": payment_key})
        await db.commit()
        logger.warning("toss.confirm.rejected", order_id=order_id, code=e.code, message=e.message)
        raise HTTPException(e.status_code if e.status_code < 500 else 502, f"결제 승인 실패: {e.message}")

    if str(payment.get("status") or "").upper() != "DONE":
        await db.execute(text(
            "UPDATE payment_orders SET status='failed', payment_key=:pk, updated_at=now() WHERE order_id=:oid"
        ), {"oid": order_id, "pk": payment_key})
        await db.commit()
        raise HTTPException(400, "결제가 완료 상태가 아닙니다")

    await db.execute(text(
        "UPDATE payment_orders SET status='paid', payment_key=:pk, approved_at=now(), updated_at=now() "
        "WHERE order_id=:oid"
    ), {"oid": order_id, "pk": payment_key})

    fulfillment = await _fulfill(db, user_id, kind, meta, order_id)
    await db.commit()

    return ApiResponse(data={
        "status": "paid",
        "order_id": order_id,
        "kind": kind,
        "fulfillment": fulfillment,
    })


async def _fulfill(db: AsyncSession, user_id: str, kind: str, meta, order_id: str) -> dict:
    """결제 승인 성공 후 실제 상품을 지급한다. 재사용 가능하도록 kind별로 분리."""
    if isinstance(meta, str):
        meta = json.loads(meta)

    if kind == "indicator":
        codes = meta.get("indicator_codes") or []
        for code in codes:
            await db.execute(text(
                "INSERT INTO user_purchases (user_id, indicator_code, status, order_id, payment_ref, purchased_at, updated_at) "
                "VALUES (:uid, :c, 'paid', :oid, :oid, now(), now()) "
                "ON CONFLICT (user_id, indicator_code) DO UPDATE "
                "SET status='paid', order_id=:oid, payment_ref=:oid, purchased_at=COALESCE(user_purchases.purchased_at, now()), updated_at=now()"
            ), {"uid": user_id, "c": code, "oid": order_id})
        return {"granted_indicators": codes}

    if kind == "subscription":
        plan_code = meta.get("plan_code")
        tier = meta.get("tier")
        cycle = meta.get("cycle")
        days = PLAN_PERIOD_DAYS.get(cycle, 30)

        # 기존 활성 구독이 있으면 연장(현재 만료일 기준), 없으면 지금부터 시작.
        existing = (await db.execute(text(
            "SELECT current_period_end FROM subscriptions WHERE user_id=:uid AND status='active' "
            "ORDER BY current_period_end DESC LIMIT 1"
        ), {"uid": user_id})).fetchone()
        await db.execute(text(
            "INSERT INTO subscriptions (user_id, plan_code, tier, cycle, status, current_period_end, order_id) "
            "VALUES (:uid, :plan, :tier, :cycle, 'active', "
            "        GREATEST(now(), COALESCE(:cur, now())) + (:days || ' days')::interval, :oid)"
        ), {"uid": user_id, "plan": plan_code, "tier": tier, "cycle": cycle, "cur": existing[0] if existing else None,
            "days": days, "oid": order_id})

        await db.execute(text("UPDATE users SET tier=:t WHERE id=:uid"), {"t": tier, "uid": user_id})
        from src.services.beom_free import invalidate_tier_cache
        invalidate_tier_cache(user_id)
        return {"granted_tier": tier, "plan_code": plan_code, "cycle": cycle}

    if kind == "points":
        amount_krw = meta.get("points_amount")
        granted = int(meta.get("points_granted") or amount_krw or 0)
        from src.api.points import grant as points_grant
        await points_grant(db, user_id, granted, "charge", "포인트 충전", f"{amount_krw:,}원 결제", order_id)
        return {"granted_points": granted}

    return {}


# ─── 내 구독 조회 ───

@router.get("/subscription", response_model=ApiResponse)
async def my_subscription(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """현재 활성 구독 조회 (만료된 건 자동으로 만료 처리)."""
    await _ensure_tables(db)
    await db.execute(text(
        "UPDATE subscriptions SET status='expired', updated_at=now() "
        "WHERE user_id=:uid AND status='active' AND current_period_end <= now()"
    ), {"uid": user_id})
    row = (await db.execute(text(
        "SELECT plan_code, tier, cycle, current_period_end FROM subscriptions "
        "WHERE user_id=:uid AND status='active' ORDER BY current_period_end DESC LIMIT 1"
    ), {"uid": user_id})).fetchone()
    await db.commit()
    if not row:
        return ApiResponse(data={"active": False})
    return ApiResponse(data={
        "active": True,
        "plan_code": row[0],
        "tier": row[1],
        "cycle": row[2],
        "current_period_end": str(row[3]),
    })
