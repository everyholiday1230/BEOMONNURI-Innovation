"""지표 개별 판매 API.

개선 사항(2026-07):
- 주문(order_id) 생성
- 결제 웹훅(서명 검증 + 멱등 처리)
- 레퍼럴 첫 결제 보상(on_payment) 원자적 연결
- 관리자 결제 이벤트 조회
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.auth import get_current_user_id
from src.services.admin_helpers import auth_admin_check

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/purchases", tags=["purchases"])

_ensured = False


async def _ensure_tables(db: AsyncSession):
    """결제/구매 관련 테이블 및 컬럼 멱등 보장.

    DDL 실행이 권한 부족 등으로 실패하더라도(예: 테이블 소유자가 다른 DB 롤인 경우)
    조회/구매 요청 전체가 503으로 실패하지 않도록 방어한다. 테이블/컬럼은 대개
    이미 존재하므로 실패를 삼키고 이후 재시도를 막는다.
    """
    global _ensured
    if _ensured:
        return

    try:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS indicator_products (
                id BIGSERIAL PRIMARY KEY,
                indicator_code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                price INTEGER NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT 'KRW',
                description TEXT,
                sort_order INTEGER DEFAULT 0,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))

        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS user_purchases (
                id BIGSERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                indicator_code TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                price INTEGER NOT NULL DEFAULT 0,
                order_id TEXT,
                payment_ref TEXT,
                purchased_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (user_id, indicator_code)
            )
        """))
        await db.execute(text("ALTER TABLE user_purchases ADD COLUMN IF NOT EXISTS order_id TEXT"))
        await db.execute(text("ALTER TABLE user_purchases ADD COLUMN IF NOT EXISTS payment_ref TEXT"))
        await db.execute(text("ALTER TABLE user_purchases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"))
        await db.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_purchases_order_id ON user_purchases(order_id) WHERE order_id IS NOT NULL"))

        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS payment_events (
                id BIGSERIAL PRIMARY KEY,
                provider TEXT NOT NULL,
                event_id TEXT NOT NULL,
                event_type TEXT,
                status TEXT NOT NULL,
                order_id TEXT,
                user_id TEXT,
                indicator_code TEXT,
                amount INTEGER,
                currency TEXT,
                tx_id TEXT,
                payload JSONB NOT NULL DEFAULT '{}'::jsonb,
                processed BOOLEAN NOT NULL DEFAULT FALSE,
                processed_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (provider, event_id)
            )
        """))
        await db.execute(text("CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events(order_id, created_at DESC)"))

        await db.commit()
    except Exception:
        # 권한 부족 등으로 DDL 실패 시: 세션 롤백 후 이후 요청은 정상 진행.
        # (테이블/컬럼은 이미 존재하는 것으로 간주 — 마이그레이션은 alembic으로 관리)
        try:
            await db.rollback()
        except Exception:
            pass
    _ensured = True



def _new_order_id() -> str:
    return f"ord_{secrets.token_hex(12)}"


def _verify_webhook_signature(raw_body: bytes, request: Request) -> bool:
    """웹훅 서명 검증.

    지원 헤더:
    - X-Payment-Signature
    - X-Signature
    값 형식: hex sha256
    """
    secret = (os.getenv("PAYMENT_WEBHOOK_SECRET") or "").strip()
    if not secret:
        return False

    got = (request.headers.get("x-payment-signature") or request.headers.get("x-signature") or "").strip()
    if not got:
        return False

    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(got, expected)


async def get_purchased_codes(db: AsyncSession, user_id: str) -> list[str]:
    """해당 유저가 구매 완료(paid)한 지표 코드 목록."""
    if not user_id:
        return []
    await _ensure_tables(db)
    rows = (await db.execute(text(
        "SELECT indicator_code FROM user_purchases WHERE user_id=:uid AND status='paid'"
    ), {"uid": user_id})).fetchall()
    return [r[0] for r in rows]


@router.get("/products", response_model=ApiResponse)
async def list_products(db: AsyncSession = Depends(get_db)):
    """판매 중인 지표 상품 목록 (공개)."""
    await _ensure_tables(db)
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
    await _ensure_tables(db)
    rows = (await db.execute(text(
        "SELECT indicator_code, status, price, order_id, payment_ref, purchased_at, created_at "
        "FROM user_purchases WHERE user_id=:uid ORDER BY created_at DESC"
    ), {"uid": user_id})).fetchall()
    return ApiResponse(data={
        "purchased": [r[0] for r in rows if r[1] == "paid"],
        "items": [{
            "indicator_code": r[0],
            "status": r[1],
            "price": r[2],
            "order_id": r[3],
            "payment_ref": r[4],
            "purchased_at": str(r[5]) if r[5] else None,
            "created_at": str(r[6]) if r[6] else None,
        } for r in rows],
    })


@router.post("/buy", response_model=ApiResponse)
async def buy(req: dict, user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    """구매 요청 — pending 주문 생성 + order_id 발급."""
    await _ensure_tables(db)
    code = (req.get("indicator_code") or "").strip()
    if not code:
        raise HTTPException(400, "indicator_code 필요")

    prod = (await db.execute(text(
        "SELECT name, price, currency FROM indicator_products WHERE indicator_code=:c AND is_active=true"
    ), {"c": code})).fetchone()
    if not prod:
        raise HTTPException(404, "판매 중인 상품이 아닙니다")

    existing = (await db.execute(text(
        "SELECT status, order_id FROM user_purchases WHERE user_id=:uid AND indicator_code=:c"
    ), {"uid": user_id, "c": code})).fetchone()
    if existing and existing[0] == "paid":
        return ApiResponse(data={"status": "paid", "message": "이미 보유한 지표입니다"})

    order_id = _new_order_id()
    await db.execute(text(
        "INSERT INTO user_purchases (user_id, indicator_code, status, price, order_id, created_at, updated_at) "
        "VALUES (:uid, :c, 'pending', :p, :oid, now(), now()) "
        "ON CONFLICT (user_id, indicator_code) DO UPDATE "
        "SET status='pending', price=:p, order_id=:oid, updated_at=now()"
    ), {"uid": user_id, "c": code, "p": int(prod[1]), "oid": order_id})
    await db.commit()

    return ApiResponse(data={
        "status": "pending",
        "order_id": order_id,
        "indicator_code": code,
        "price": int(prod[1]),
        "currency": prod[2] or "KRW",
        "message": "결제 준비됨 (PG에서 결제 완료 후 webhook으로 자동 확정)",
    })


@router.post("/webhook/payment", response_model=ApiResponse)
async def payment_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """결제 PG 웹훅.

    필수 필드(권장):
    - provider, event_id, status, order_id
    선택: user_id, indicator_code, amount, currency, tx_id, event_type
    """
    await _ensure_tables(db)

    raw = await request.body()
    if not _verify_webhook_signature(raw, request):
        raise HTTPException(401, "invalid webhook signature")

    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except Exception:
        raise HTTPException(400, "invalid json payload")

    provider = (payload.get("provider") or "unknown").strip().lower()
    event_id = (payload.get("event_id") or payload.get("id") or "").strip()
    status = (payload.get("status") or "").strip().lower()
    order_id = (payload.get("order_id") or "").strip()
    event_type = (payload.get("event_type") or payload.get("type") or "payment").strip()

    if not event_id:
        raise HTTPException(400, "event_id 필요")
    if status not in {"paid", "failed", "canceled", "cancelled", "pending"}:
        raise HTTPException(400, "지원하지 않는 status")

    # 멱등 이벤트 등록
    ins = await db.execute(text(
        "INSERT INTO payment_events (provider, event_id, event_type, status, order_id, user_id, indicator_code, amount, currency, tx_id, payload) "
        "VALUES (:provider, :event_id, :event_type, :status, :order_id, :uid, :code, :amount, :currency, :tx_id, CAST(:payload AS JSONB)) "
        "ON CONFLICT (provider, event_id) DO NOTHING"
    ), {
        "provider": provider,
        "event_id": event_id,
        "event_type": event_type,
        "status": status,
        "order_id": order_id or None,
        "uid": (payload.get("user_id") or "").strip() or None,
        "code": (payload.get("indicator_code") or "").strip() or None,
        "amount": int(payload.get("amount") or 0),
        "currency": (payload.get("currency") or "KRW").strip(),
        "tx_id": (payload.get("tx_id") or payload.get("transaction_id") or "").strip() or None,
        "payload": json.dumps(payload, ensure_ascii=False),
    })

    inserted = int(ins.rowcount or 0)
    if inserted == 0:
        await db.rollback()
        return ApiResponse(data={"accepted": True, "already_processed": True, "event_id": event_id})

    row = None
    if order_id:
        row = (await db.execute(text(
            "SELECT user_id, indicator_code, status FROM user_purchases WHERE order_id=:oid LIMIT 1"
        ), {"oid": order_id})).fetchone()

    if not row:
        uid = (payload.get("user_id") or "").strip()
        code = (payload.get("indicator_code") or "").strip()
        if uid and code:
            row = (await db.execute(text(
                "SELECT user_id, indicator_code, status FROM user_purchases "
                "WHERE user_id=:uid AND indicator_code=:code LIMIT 1"
            ), {"uid": uid, "code": code})).fetchone()

    if not row:
        await db.execute(text(
            "UPDATE payment_events SET processed=true, processed_at=now() WHERE provider=:provider AND event_id=:event_id"
        ), {"provider": provider, "event_id": event_id})
        await db.commit()
        return ApiResponse(data={
            "accepted": True,
            "linked": False,
            "message": "주문 매칭 실패(이벤트는 기록됨)",
            "event_id": event_id,
        })

    uid, code, before_status = str(row[0]), str(row[1]), (row[2] or "pending")

    if status == "paid":
        await db.execute(text(
            "UPDATE user_purchases "
            "SET status='paid', purchased_at=COALESCE(purchased_at, now()), "
            "    payment_ref=:pref, updated_at=now() "
            "WHERE user_id=:uid AND indicator_code=:code"
        ), {
            "pref": (payload.get("tx_id") or payload.get("transaction_id") or event_id),
            "uid": uid,
            "code": code,
        })

        referral_result = {"linked": False, "rewarded": False}
        if before_status != "paid":
            try:
                from src.api.referral import on_payment
                referral_result = await on_payment(
                    db,
                    uid,
                    payment_ref=(payload.get("tx_id") or event_id),
                    autocommit=False,
                )
            except Exception as e:
                logger.warning("purchases.webhook.referral_failed", event_id=event_id, user_id=uid, error=str(e)[:160])

        await db.execute(text(
            "UPDATE payment_events SET processed=true, processed_at=now() WHERE provider=:provider AND event_id=:event_id"
        ), {"provider": provider, "event_id": event_id})
        await db.commit()
        return ApiResponse(data={
            "accepted": True,
            "event_id": event_id,
            "order_id": order_id,
            "user_id": uid,
            "indicator_code": code,
            "status": "paid",
            "before_status": before_status,
            "referral": referral_result,
        })

    if status in {"failed", "canceled", "cancelled"}:
        await db.execute(text(
            "UPDATE user_purchases SET status=:st, updated_at=now() WHERE user_id=:uid AND indicator_code=:code"
        ), {"st": "canceled" if status in {"canceled", "cancelled"} else "failed", "uid": uid, "code": code})

    await db.execute(text(
        "UPDATE payment_events SET processed=true, processed_at=now() WHERE provider=:provider AND event_id=:event_id"
    ), {"provider": provider, "event_id": event_id})
    await db.commit()
    return ApiResponse(data={
        "accepted": True,
        "event_id": event_id,
        "order_id": order_id,
        "status": status,
        "before_status": before_status,
        "user_id": uid,
        "indicator_code": code,
    })


# ─── 관리자 ───

@router.post("/admin/set-product", response_model=ApiResponse)
async def admin_set_product(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """상품 등록/가격·활성 수정 (운영자)."""
    await auth_admin_check(request)
    await _ensure_tables(db)

    code = (req.get("indicator_code") or "").strip()
    if not code:
        raise HTTPException(400, "indicator_code 필요")
    name = req.get("name") or code
    price = int(req.get("price", 0))
    active = bool(req.get("is_active", True)) if "is_active" in req else True
    desc = req.get("description", "")

    await db.execute(text(
        "INSERT INTO indicator_products (indicator_code, name, price, description, is_active, updated_at) "
        "VALUES (:c, :n, :p, :d, :a, now()) "
        "ON CONFLICT (indicator_code) DO UPDATE "
        "SET name=:n, price=:p, description=:d, is_active=:a, updated_at=now()"
    ), {"c": code, "n": name, "p": price, "d": desc, "a": active})
    await db.commit()
    return ApiResponse(data={"indicator_code": code, "price": price, "is_active": active})


@router.post("/admin/grant", response_model=ApiResponse)
async def admin_grant(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """수동 구매 부여/회수 (운영자) — email 또는 user_id."""
    await auth_admin_check(request)
    await _ensure_tables(db)

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
            "INSERT INTO user_purchases (user_id, indicator_code, status, purchased_at, updated_at, order_id) "
            "VALUES (:uid, :c, 'paid', now(), now(), :oid) "
            "ON CONFLICT (user_id, indicator_code) DO UPDATE "
            "SET status='paid', purchased_at=COALESCE(user_purchases.purchased_at, now()), updated_at=now()"
        ), {"uid": uid, "c": code, "oid": _new_order_id()})
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
    await _ensure_tables(db)

    products = (await db.execute(text(
        "SELECT indicator_code, name, price, is_active, "
        "(SELECT COUNT(*) FROM user_purchases up WHERE up.indicator_code=ip.indicator_code AND up.status='paid') AS sold "
        "FROM indicator_products ip ORDER BY sort_order, name"
    ))).fetchall()
    return ApiResponse(data={"products": [
        {"indicator_code": r[0], "name": r[1], "price": r[2], "is_active": r[3], "sold": r[4]} for r in products
    ]})


@router.get("/admin/payments", response_model=ApiResponse)
async def admin_payments(request: Request, page: int = 1, db: AsyncSession = Depends(get_db)):
    """결제 이벤트 최근 내역(운영자)."""
    await auth_admin_check(request)
    await _ensure_tables(db)

    off = max(0, (page - 1) * 50)
    rows = (await db.execute(text(
        "SELECT provider, event_id, status, order_id, user_id, indicator_code, amount, currency, tx_id, processed, processed_at, created_at "
        "FROM payment_events ORDER BY created_at DESC LIMIT 50 OFFSET :off"
    ), {"off": off})).fetchall()
    return ApiResponse(data={
        "page": page,
        "items": [{
            "provider": r[0],
            "event_id": r[1],
            "status": r[2],
            "order_id": r[3],
            "user_id": r[4],
            "indicator_code": r[5],
            "amount": r[6],
            "currency": r[7],
            "tx_id": r[8],
            "processed": bool(r[9]),
            "processed_at": str(r[10]) if r[10] else None,
            "created_at": str(r[11]) if r[11] else None,
        } for r in rows],
    })


@router.post("/admin/refund", response_model=ApiResponse)
async def admin_refund(req: dict, request: Request, db: AsyncSession = Depends(get_db)):
    """결제 환불 처리(운영자) — user_purchases 상태를 'refunded'로 변경.

    PG(결제대행사) 측에서 실제 환불이 처리된 뒤, 그 결과를 내부 상태에 동기화하기
    위한 용도. 기존 admin/grant(grant=false)는 레코드를 DELETE해 결제 이력 자체가
    사라졌는데, 환불은 "결제했다가 취소된 사실"을 감사 기록으로 남겨야 하므로
    상태만 변경한다(이력 보존).
    """
    await auth_admin_check(request)
    await _ensure_tables(db)

    code = (req.get("indicator_code") or "").strip()
    uid = req.get("user_id")
    note = (req.get("note") or "").strip()
    if not uid and (req.get("email") or "").strip():
        row = (await db.execute(text("SELECT id FROM users WHERE email=:e"), {"e": req["email"].strip()})).fetchone()
        if not row:
            raise HTTPException(404, "해당 이메일 회원 없음")
        uid = str(row[0])
    if not uid or not code:
        raise HTTPException(400, "user_id(또는 email)와 indicator_code 필요")

    result = await db.execute(text(
        "UPDATE user_purchases SET status='refunded', updated_at=now() "
        "WHERE user_id=:uid AND indicator_code=:c AND status='paid'"
    ), {"uid": uid, "c": code})
    if int(result.rowcount or 0) == 0:
        await db.rollback()
        raise HTTPException(404, "결제 완료(paid) 상태의 구매 내역을 찾을 수 없습니다")

    await db.execute(text(
        "INSERT INTO payment_events (provider, event_id, event_type, status, order_id, user_id, indicator_code, processed, processed_at, payload) "
        "VALUES ('admin', :eid, 'refund', 'refunded', NULL, :uid, :c, true, now(), CAST(:payload AS JSONB))"
    ), {
        "eid": f"admin_refund_{_new_order_id()}",
        "uid": uid, "c": code,
        "payload": json.dumps({"note": note, "action": "admin_refund"}, ensure_ascii=False),
    })
    await db.commit()
    return ApiResponse(data={"user_id": uid, "indicator_code": code, "status": "refunded"})


@router.get("/admin/duplicate-payments", response_model=ApiResponse)
async def admin_duplicate_payments(request: Request, db: AsyncSession = Depends(get_db)):
    """중복 결제 의심 탐지(운영자) — 동일 사용자+상품에 결제 완료(paid) 이벤트가

    2건 이상 기록된 경우를 찾는다. 서로 다른 event_id로 같은 상품을 두 번 결제한
    경우(PG 오류, 사용자 중복 클릭 등) user_purchases는 최신 1건만 반영되지만
    payment_events 에는 모든 이벤트가 남으므로, 여기서 집계해 관리자에게 노출한다.
    """
    await auth_admin_check(request)
    await _ensure_tables(db)

    rows = (await db.execute(text(
        "SELECT user_id, indicator_code, COUNT(*) AS paid_count, "
        "       array_agg(event_id ORDER BY created_at) AS event_ids, "
        "       array_agg(amount ORDER BY created_at) AS amounts, "
        "       MAX(created_at) AS last_at "
        "FROM payment_events "
        "WHERE status='paid' AND user_id IS NOT NULL AND indicator_code IS NOT NULL "
        "GROUP BY user_id, indicator_code "
        "HAVING COUNT(*) > 1 "
        "ORDER BY last_at DESC LIMIT 100"
    ))).fetchall()
    return ApiResponse(data={"items": [{
        "user_id": r[0], "indicator_code": r[1], "paid_count": r[2],
        "event_ids": r[3], "amounts": r[4], "last_at": str(r[5]) if r[5] else None,
    } for r in rows]})
