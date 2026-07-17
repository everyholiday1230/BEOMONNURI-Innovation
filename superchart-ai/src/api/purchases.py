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


def _normalize_payment_status(status: str | None) -> str:
    """PG별 취소 상태 표기를 내부 표준값으로 통일한다."""
    normalized = (status or "").strip().lower()
    return "canceled" if normalized == "cancelled" else normalized


def _resolve_payment_transition(current: str | None, incoming: str) -> tuple[str, bool, str]:
    """순서가 뒤바뀐 웹훅이 확정된 구매 상태를 되돌리지 않도록 한다.

    paid/refunded는 내부 권한에 직접 영향을 주는 종결 상태다. paid는 관리자 환불만
    refunded로 바꿀 수 있고, refunded는 PG 웹훅으로 다시 활성화할 수 없다.
    failed/canceled 주문은 같은 주문의 후속 paid 이벤트로 복구할 수 있다.
    """
    current_status = _normalize_payment_status(current) or "pending"
    incoming_status = _normalize_payment_status(incoming)

    if current_status == "refunded":
        return current_status, False, "refunded_is_terminal"
    if current_status == "paid":
        reason = "duplicate_status" if incoming_status == "paid" else "paid_is_terminal"
        return current_status, False, reason
    if current_status in {"failed", "canceled"} and incoming_status != "paid":
        reason = "duplicate_status" if current_status == incoming_status else "terminal_failure"
        return current_status, False, reason
    if incoming_status == "pending" and current_status != "pending":
        return current_status, False, "stale_pending"
    if incoming_status == current_status:
        return current_status, False, "duplicate_status"
    return incoming_status, True, "applied"


def _payment_lookup_mode(order_id: str, user_id: str, indicator_code: str) -> str | None:
    """order_id가 제공되면 다른 주문으로 fallback하지 않는다."""
    if order_id:
        return "order_id"
    if user_id and indicator_code:
        return "identity"
    return None


def _payment_order_mismatch(
    *,
    order_user_id: str,
    order_indicator_code: str,
    order_amount: int,
    order_currency: str,
    payload_user_id: str,
    payload_indicator_code: str,
    payload_amount: int,
    payload_currency: str,
    amount_provided: bool,
    currency_provided: bool,
) -> str | None:
    """서명된 payload도 주문 원장과 대조해 잘못된 권한 부여를 차단한다."""
    if payload_user_id and payload_user_id != order_user_id:
        return "user_id_mismatch"
    if payload_indicator_code and payload_indicator_code != order_indicator_code:
        return "indicator_code_mismatch"
    if amount_provided and payload_amount != order_amount:
        return "amount_mismatch"
    if currency_provided and payload_currency.upper() != order_currency.upper():
        return "currency_mismatch"
    return None


@router.post("/webhook/payment", response_model=ApiResponse)
async def payment_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """서명·멱등성·주문 잠금·단조 상태 전이를 적용한 결제 PG 웹훅."""
    await _ensure_tables(db)

    raw = await request.body()
    if not _verify_webhook_signature(raw, request):
        raise HTTPException(401, "invalid webhook signature")

    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise HTTPException(400, "invalid json payload")
    if not isinstance(payload, dict):
        raise HTTPException(400, "json object payload required")

    provider = str(payload.get("provider") or "unknown").strip().lower()
    event_id = str(payload.get("event_id") or payload.get("id") or "").strip()
    status = _normalize_payment_status(str(payload.get("status") or ""))
    order_id = str(payload.get("order_id") or "").strip()
    event_type = str(payload.get("event_type") or payload.get("type") or "payment").strip()
    payload_uid = str(payload.get("user_id") or "").strip()
    payload_code = str(payload.get("indicator_code") or "").strip()
    payload_currency = str(payload.get("currency") or "KRW").strip()
    amount_provided = "amount" in payload and payload.get("amount") is not None
    currency_provided = "currency" in payload and payload.get("currency") is not None

    if not event_id:
        raise HTTPException(400, "event_id 필요")
    if status not in {"paid", "failed", "canceled", "pending"}:
        raise HTTPException(400, "지원하지 않는 status")
    try:
        amount = int(payload.get("amount") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "amount는 정수여야 합니다")
    if amount < 0:
        raise HTTPException(400, "amount는 0 이상이어야 합니다")

    # on_payment 내부의 스키마 확인은 commit할 수 있으므로 이벤트 트랜잭션 시작 전에
    # 완료한다. 실제 보상 변경은 아래 nested transaction(savepoint)에서 격리한다.
    referral_on_payment = None
    if status == "paid":
        from src.api.referral import _ensure_tables as ensure_referral_tables
        from src.api.referral import on_payment

        await ensure_referral_tables(db)
        referral_on_payment = on_payment

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
        "uid": payload_uid or None,
        "code": payload_code or None,
        "amount": amount,
        "currency": payload_currency,
        "tx_id": str(payload.get("tx_id") or payload.get("transaction_id") or "").strip() or None,
        "payload": json.dumps(payload, ensure_ascii=False),
    })

    if int(ins.rowcount or 0) == 0:
        await db.rollback()
        return ApiResponse(data={"accepted": True, "already_processed": True, "event_id": event_id})

    # 서로 다른 event_id가 동시에 도착해도 같은 주문 행을 직렬 처리한다.
    # order_id가 명시됐는데 찾지 못한 경우 identity fallback을 금지해 오주문 연결을 막는다.
    lookup_mode = _payment_lookup_mode(order_id, payload_uid, payload_code)
    row = None
    if lookup_mode == "order_id":
        row = (await db.execute(text(
            "SELECT up.user_id, up.indicator_code, up.status, up.order_id, up.price, "
            "       COALESCE(ip.currency, 'KRW') "
            "FROM user_purchases up "
            "LEFT JOIN indicator_products ip ON ip.indicator_code = up.indicator_code "
            "WHERE up.order_id=:oid LIMIT 1 FOR UPDATE OF up"
        ), {"oid": order_id})).fetchone()
    elif lookup_mode == "identity":
        row = (await db.execute(text(
            "SELECT up.user_id, up.indicator_code, up.status, up.order_id, up.price, "
            "       COALESCE(ip.currency, 'KRW') "
            "FROM user_purchases up "
            "LEFT JOIN indicator_products ip ON ip.indicator_code = up.indicator_code "
            "WHERE up.user_id=:uid AND up.indicator_code=:code LIMIT 1 FOR UPDATE OF up"
        ), {"uid": payload_uid, "code": payload_code})).fetchone()

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
            "match_failure": "unknown_order_id" if order_id else "missing_or_unknown_identity",
        })

    uid, code = str(row[0]), str(row[1])
    before_status = _normalize_payment_status(row[2]) or "pending"
    matched_order_id = str(row[3]) if row[3] else None
    order_amount = int(row[4] or 0)
    order_currency = str(row[5] or "KRW")
    mismatch = _payment_order_mismatch(
        order_user_id=uid,
        order_indicator_code=code,
        order_amount=order_amount,
        order_currency=order_currency,
        payload_user_id=payload_uid,
        payload_indicator_code=payload_code,
        payload_amount=amount,
        payload_currency=payload_currency,
        amount_provided=amount_provided,
        currency_provided=currency_provided,
    )
    if mismatch:
        await db.execute(text(
            "UPDATE payment_events SET processed=true, processed_at=now() "
            "WHERE provider=:provider AND event_id=:event_id"
        ), {"provider": provider, "event_id": event_id})
        await db.commit()
        logger.warning(
            "purchases.webhook.order_mismatch",
            event_id=event_id,
            order_id=matched_order_id,
            mismatch=mismatch,
        )
        return ApiResponse(data={
            "accepted": True,
            "linked": False,
            "event_id": event_id,
            "order_id": matched_order_id,
            "status": before_status,
            "match_failure": mismatch,
        })

    effective_status, transition_applied, transition_reason = _resolve_payment_transition(before_status, status)
    referral_result = {"linked": False, "rewarded": False, "skipped": True}

    if transition_applied and effective_status == "paid":
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

        try:
            async with db.begin_nested():
                referral_result = await referral_on_payment(
                    db,
                    uid,
                    payment_ref=str(payload.get("tx_id") or event_id),
                    autocommit=False,
                )
        except Exception as e:
            # SAVEPOINT만 rollback되므로 구매 확정과 이벤트 처리는 계속 커밋할 수 있다.
            referral_result = {"linked": False, "rewarded": False, "error": "reward_failed"}
            logger.warning("purchases.webhook.referral_failed", event_id=event_id, user_id=uid, error=str(e)[:160])
    elif transition_applied:
        await db.execute(text(
            "UPDATE user_purchases SET status=:st, updated_at=now() "
            "WHERE user_id=:uid AND indicator_code=:code"
        ), {"st": effective_status, "uid": uid, "code": code})

    await db.execute(text(
        "UPDATE payment_events SET processed=true, processed_at=now() WHERE provider=:provider AND event_id=:event_id"
    ), {"provider": provider, "event_id": event_id})
    await db.commit()
    return ApiResponse(data={
        "accepted": True,
        "linked": True,
        "event_id": event_id,
        "order_id": matched_order_id,
        "event_status": status,
        "status": effective_status,
        "before_status": before_status,
        "transition_applied": transition_applied,
        "transition_reason": transition_reason,
        "user_id": uid,
        "indicator_code": code,
        "referral": referral_result,
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
