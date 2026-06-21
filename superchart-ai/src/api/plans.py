"""요금제 관리 — 서비스 요금제 카탈로그 (추가 전용).

정직한 범위 안내:
- 본 모듈은 요금제의 '표시/설명 카탈로그'(요금제명·가격·결제주기·AI 분석 횟수 표기·
  기능 제한 설명·활성 상태)를 관리한다. 실제 기능 제한 강제(rate limit 등)는
  src/services/tier_guard.py (FREE_LIMITS) 와 tier 기반 가드가 단일 출처(SoT)다.
  즉, 여기서 'AI 분석 횟수'를 바꿔도 실제 제한이 즉시 바뀌지 않는다(표시용). 실제
  강제값 변경은 tier_guard 연동(후속)이 필요하며 UI에 명시한다.
- 추가 테이블 service_plans 만 사용(IF NOT EXISTS). 기존 users.tier/tier_guard 무변경.

롤백: DROP TABLE IF EXISTS service_plans;
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_db
from src.models.schemas import ApiResponse
from src.services.admin_helpers import auth_admin_check

router = APIRouter(prefix="/plans", tags=["Plans"])

# 알려진 tier 와의 매핑(표시용). tier_guard 의 FREE_LIMITS 도 함께 노출해 정합성 점검.
_SEED = [
    {"code": "free",    "tier": "free",    "name": "일반",  "price": 0,     "billing_cycle": "—",
     "ai_analysis_count": "일 3회", "features": "기본 차트·지표, AI 무료 분석(제한)", "sort_order": 1},
    {"code": "vip",     "tier": "pro",     "name": "VIP",   "price": None,  "billing_cycle": "월간",
     "ai_analysis_count": "무제한", "features": "전 지표·신호, AI 분석 무제한, 청산 히트맵", "sort_order": 2},
    {"code": "vvip",    "tier": "premium", "name": "VVIP",  "price": None,  "billing_cycle": "월간",
     "ai_analysis_count": "무제한", "features": "VIP 전체 + 우선 지원·고급 분석", "sort_order": 3},
]

_ensured = False


async def _ensure(db: AsyncSession) -> None:
    global _ensured
    if _ensured:
        return
    try:
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS service_plans (
                id BIGSERIAL PRIMARY KEY,
                code TEXT UNIQUE NOT NULL,
                tier TEXT,
                name TEXT NOT NULL,
                price INTEGER,
                billing_cycle TEXT,
                ai_analysis_count TEXT,
                features TEXT,
                active BOOLEAN NOT NULL DEFAULT TRUE,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        await db.execute(text("""
            CREATE TABLE IF NOT EXISTS service_plans_audit (
                id BIGSERIAL PRIMARY KEY,
                actor TEXT, action TEXT NOT NULL, code TEXT,
                detail TEXT, ip TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """))
        # 비어 있으면 알려진 tier 로 시드(멱등: ON CONFLICT DO NOTHING)
        for p in _SEED:
            await db.execute(text(
                "INSERT INTO service_plans (code, tier, name, price, billing_cycle, ai_analysis_count, features, sort_order) "
                "VALUES (:code,:tier,:name,:price,:bc,:ai,:feat,:so) ON CONFLICT (code) DO NOTHING"
            ), {"code": p["code"], "tier": p["tier"], "name": p["name"], "price": p["price"],
                "bc": p["billing_cycle"], "ai": p["ai_analysis_count"], "feat": p["features"], "so": p["sort_order"]})
        await db.commit()
        _ensured = True
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass


async def _audit(db: AsyncSession, action: str, code: str, detail: str, ip: str):
    await db.execute(text(
        "INSERT INTO service_plans_audit (actor, action, code, detail, ip) VALUES ('admin',:a,:c,:d,:ip)"
    ), {"a": action, "c": code, "d": detail, "ip": ip})


@router.get("", response_model=ApiResponse)
async def list_plans(request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    rows = (await db.execute(text(
        "SELECT code, tier, name, price, billing_cycle, ai_analysis_count, features, active, sort_order "
        "FROM service_plans ORDER BY sort_order, id"
    ))).fetchall()
    # tier_guard 실제 강제값(무료 한도)도 함께 노출 — 정합성 확인용(읽기 전용)
    try:
        from src.services.tier_guard import FREE_LIMITS
        free_limits = dict(FREE_LIMITS)
    except Exception:
        free_limits = {}
    return ApiResponse(data={
        "items": [
            {"code": r[0], "tier": r[1], "name": r[2], "price": r[3], "billing_cycle": r[4],
             "ai_analysis_count": r[5], "features": r[6], "active": bool(r[7]), "sort_order": r[8]} for r in rows
        ],
        "enforced_free_limits": free_limits,
        "note": "기능 제한 강제값은 tier_guard.FREE_LIMITS 가 단일 출처입니다. 본 카탈로그는 표시/설명용이며 강제값 변경은 tier_guard 연동(후속)이 필요합니다.",
    })


@router.post("", response_model=ApiResponse)
async def upsert_plan(req: dict, request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    code = (req.get("code") or "").strip().lower()
    name = (req.get("name") or "").strip()
    if not code or not name:
        raise HTTPException(400, "code 와 name 은 필수입니다")
    price = req.get("price")
    try:
        price = int(price) if price not in (None, "") else None
    except (TypeError, ValueError):
        raise HTTPException(400, "price 는 정수여야 합니다")
    tier = (req.get("tier") or "").strip() or None
    billing_cycle = (req.get("billing_cycle") or "").strip() or None
    ai_count = (req.get("ai_analysis_count") or "").strip() or None
    features = (req.get("features") or "").strip() or None
    sort_order = req.get("sort_order")
    try:
        sort_order = int(sort_order) if sort_order not in (None, "") else 0
    except (TypeError, ValueError):
        sort_order = 0
    active = bool(req.get("active", True))
    ip = request.client.host if request and request.client else ""
    try:
        await db.execute(text(
            "INSERT INTO service_plans (code, tier, name, price, billing_cycle, ai_analysis_count, features, active, sort_order, updated_at) "
            "VALUES (:c,:t,:n,:p,:bc,:ai,:f,:a,:so,now()) "
            "ON CONFLICT (code) DO UPDATE SET tier=EXCLUDED.tier, name=EXCLUDED.name, price=EXCLUDED.price, "
            "billing_cycle=EXCLUDED.billing_cycle, ai_analysis_count=EXCLUDED.ai_analysis_count, "
            "features=EXCLUDED.features, active=EXCLUDED.active, sort_order=EXCLUDED.sort_order, updated_at=now()"
        ), {"c": code, "t": tier, "n": name, "p": price, "bc": billing_cycle, "ai": ai_count,
            "f": features, "a": active, "so": sort_order})
        await _audit(db, "upsert", code, f"name={name}, price={price}", ip)
        await db.commit()
        return ApiResponse(data={"message": f"요금제 '{name}' ({code}) 저장 완료"})
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(500, f"저장 실패: {str(e)[:120]}")


@router.post("/toggle", response_model=ApiResponse)
async def toggle_plan(req: dict, request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    code = (req.get("code") or "").strip().lower()
    row = (await db.execute(text("SELECT active FROM service_plans WHERE code=:c"), {"c": code})).fetchone()
    if not row:
        raise HTTPException(404, "요금제 없음")
    new_active = not bool(row[0])
    ip = request.client.host if request and request.client else ""
    await db.execute(text("UPDATE service_plans SET active=:a, updated_at=now() WHERE code=:c"), {"a": new_active, "c": code})
    await _audit(db, "toggle", code, f"active={new_active}", ip)
    await db.commit()
    return ApiResponse(data={"message": f"{code} {'활성화' if new_active else '비활성화'} 완료", "active": new_active})


@router.get("/audit", response_model=ApiResponse)
async def plans_audit(request: Request, db: AsyncSession = Depends(get_db), _a: None = Depends(auth_admin_check)):
    await _ensure(db)
    rows = (await db.execute(text(
        "SELECT created_at, action, code, detail FROM service_plans_audit ORDER BY created_at DESC LIMIT 30"
    ))).fetchall()
    return ApiResponse(data={"items": [
        {"date": str(r[0]), "action": r[1], "code": r[2], "detail": r[3]} for r in rows
    ]})
