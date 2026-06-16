"""심볼 검색 + 시세 API."""
import uuid as _uuid
import structlog
from fastapi import APIRouter, Request
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends
from src.db.session import get_db
from src.models.tables import Symbol, Exchange
from src.models.schemas import ApiResponse, SymbolOut, PagedData

router = APIRouter()
logger = structlog.get_logger(__name__)

def _fallback_symbol_items(q: str = "", page: int = 1, page_size: int = 20):
    """DB 장애 시에도 UI가 의미 있는 종목 목록을 보여주도록 중앙 fallback 사용."""
    from src.services.symbol_resolver import DEFAULT_SYMBOLS, load_fallback

    load_fallback("symbols-api-fallback")
    needle = (q or "").lower()
    rows = list(DEFAULT_SYMBOLS)
    if needle:
        rows = [r for r in rows if needle in r[0].lower() or needle in r[1].lower() or needle in r[2].lower() or needle in r[3].lower()]
    total = len(rows)
    start = max(page - 1, 0) * page_size
    rows = rows[start:start + page_size]
    items = []
    for offset, (code, base, ko, en, _exchange_id) in enumerate(rows, start=start + 1):
        uid = f"00000000-0000-0000-0000-{offset:012d}"
        items.append(SymbolOut(
            id=_uuid.UUID(uid), symbol_code=code, display_name_ko=ko, display_name_en=en,
            exchange_code="BINANCE", asset_class="crypto", base_asset=base, quote_asset="USDT",
            api_code=code,
        ))
    return PagedData(items=items, page=page, page_size=page_size, total=total, has_next=(page * page_size < total))

@router.get("/symbols", response_model=ApiResponse)
async def search_symbols(q: str = "", asset_class: str | None = None, exchange: str | None = None,
                         page: int = 1, page_size: int = 20, db: AsyncSession = Depends(get_db)):
    # page_size/page 안전 범위로 클램프 (과대/음수 요청에 의한 부하 방지)
    page_size = min(max(page_size, 1), 500)
    page = max(page, 1)
    # ── Redis 캐시 (60초) — 페이지 첫 로드 시 동일 쿼리가 다수 발생 ──
    from src.services.redis_cache import cache_get, cache_set
    cache_key = f"q={q}|ac={asset_class or ''}|ex={exchange or ''}|p={page}|ps={page_size}"
    cached = await cache_get("symbols_search", cache_key)
    if cached is not None:
        return ApiResponse(data=cached)

    base = select(Symbol, Exchange.exchange_code).join(Exchange).where(Symbol.status == "active")
    if q:
        q_safe = q.replace("%", "\\%").replace("_", "\\_")
        base = base.where(or_(Symbol.symbol_code.ilike(f"%{q_safe}%"), Symbol.base_asset.ilike(f"%{q_safe}%"),
                                Symbol.display_name_ko.ilike(f"%{q_safe}%"), Symbol.display_name_en.ilike(f"%{q_safe}%")))
    if asset_class:
        base = base.where(Symbol.asset_class == asset_class)
    if exchange:
        base = base.where(Exchange.exchange_code == exchange)
    try:
        # total count
        count_q = select(func.count()).select_from(base.subquery())
        total = (await db.execute(count_q)).scalar() or 0
        # 정렬: sort_order 가 NULL 이면 맨 뒤로, 같은 값이면 symbol_code 알파벳 순
        # (도메인 DB 에 sort_order 가 안 채워진 상황 대비)
        query = (
            base.order_by(
                Symbol.sort_order.asc().nullslast(),
                Symbol.symbol_code.asc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        result = await db.execute(query)
        items = [SymbolOut(id=s.id, symbol_code=s.symbol_code, display_name_ko=s.display_name_ko,
                           display_name_en=s.display_name_en, exchange_code=ec, asset_class=s.asset_class,
                           base_asset=s.base_asset, quote_asset=s.quote_asset,
                           img_url=(s.metadata_ or {}).get("img_url"),
                           api_code=(s.metadata_ or {}).get("api_code"))
                 for s, ec in result.all()]
        data = PagedData(items=items, page=page, page_size=page_size, total=total, has_next=(page * page_size < total))
        # 캐시 저장 (60초) — 종목 목록은 자주 안 변함
        await cache_set("symbols_search", cache_key, data.model_dump(), ttl=60)
        return ApiResponse(data=data)
    except Exception as e:
        logger.warning("symbols.fallback", error=str(e)[:200])
        return ApiResponse(data=_fallback_symbol_items(q=q, page=page, page_size=page_size))

@router.post("/symbols/refresh-metadata")
async def refresh_symbol_metadata(request: Request, only_missing: bool = True):
    """CoinGecko 기반 메타데이터 일괄 갱신 (Admin-Key 필요).

    Query:
        only_missing: True (default) — display_name_ko==base_asset 인 종목만
                      False — 전체 종목 강제 갱신 (느림)
    """
    from src.services.admin_auth import verify_admin_key
    verify_admin_key(request)
    from src.services.symbol_metadata import update_db_metadata
    from src.services.symbol_resolver import load as reload_cache
    stats = await update_db_metadata(only_missing=only_missing)
    # 캐시 갱신
    await reload_cache()
    return ApiResponse(data=stats)


@router.post("/symbols/sync-from-file")
async def sync_symbols_from_file(request: Request):
    """관리자: 서버의 scripts/db/sync_full.sql 파일을 실행해 DB 동기화.

    Render Shell 접근 불가 시 우회용. Admin-Key 필요.
    파일은 우리가 직접 생성하므로 신뢰 가능. 안전 검사로 위험 명령어 차단.
    """
    from pathlib import Path
    from src.services.admin_auth import verify_admin_key
    verify_admin_key(request)

    sql_file = Path(__file__).resolve().parent.parent.parent / "scripts" / "db" / "sync_full.sql"
    if not sql_file.exists():
        from fastapi import HTTPException
        raise HTTPException(404, f"SQL 파일 없음: {sql_file}")

    sql = sql_file.read_text(encoding="utf-8")
    if "BEGIN;" not in sql or "COMMIT;" not in sql:
        from fastapi import HTTPException
        raise HTTPException(400, "SQL 파일 형식 오류")

    forbidden = ["DROP DATABASE", "DROP SCHEMA", "DROP TABLE", "TRUNCATE",
                 "ALTER USER", "CREATE USER", "GRANT ALL", "REVOKE"]
    sql_upper = sql.upper()
    for f in forbidden:
        if f in sql_upper:
            from fastapi import HTTPException
            raise HTTPException(400, f"금지된 명령어: {f}")

    import asyncpg
    db_url = os.getenv("DATABASE_URL", "")
    if not db_url:
        from fastapi import HTTPException
        raise HTTPException(500, "DATABASE_URL 미설정")
    db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")

    import structlog
    log = structlog.get_logger(__name__)
    log.info("admin.sync_from_file_start", size=len(sql))

    conn = await asyncpg.connect(db_url)
    try:
        before = await conn.fetchval("SELECT COUNT(*) FROM symbols WHERE status='active'")
        await conn.execute(sql)
        after = await conn.fetchval("SELECT COUNT(*) FROM symbols WHERE status='active'")

        from src.services.symbol_resolver import load as reload_cache
        await reload_cache()

        log.info("admin.sync_from_file_done", before=before, after=after)
        return ApiResponse(data={
            "before_count": before,
            "after_count": after,
            "added": after - before,
            "size": len(sql),
        })
    finally:
        await conn.close()

@router.get("/symbols/lookup-metadata")
async def lookup_one_symbol(base: str, request: Request):
    """단일 base_asset 메타데이터 조회 (Admin-Key 필요).

    예: GET /v1/symbols/lookup-metadata?base=BTC
    """
    from src.services.admin_auth import verify_admin_key
    verify_admin_key(request)
    from src.services.symbol_metadata import lookup_symbol_metadata
    meta = await lookup_symbol_metadata(base)
    return ApiResponse(data=meta)

@router.get("/symbols/{symbol_id}", response_model=ApiResponse)
async def get_symbol(symbol_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Symbol, Exchange.exchange_code).join(Exchange).where(Symbol.id == symbol_id))
    row = result.first()
    if not row:
        from fastapi import HTTPException; raise HTTPException(404, "Symbol not found")
    s, ec = row
    return ApiResponse(data=SymbolOut(id=s.id, symbol_code=s.symbol_code, display_name_ko=s.display_name_ko,
                                      display_name_en=s.display_name_en, exchange_code=ec, asset_class=s.asset_class,
                                      base_asset=s.base_asset, quote_asset=s.quote_asset,
                                      img_url=(s.metadata_ or {}).get("img_url"),
                                      api_code=(s.metadata_ or {}).get("api_code")))

@router.post("/symbols/reload")
async def reload_symbols(request: Request):
    """DB에서 심볼 캐시를 다시 로드 (Admin-Key 필요)."""
    from src.services.admin_auth import verify_admin_key
    verify_admin_key(request)
    from src.services.symbol_resolver import load
    await load()
    from src.services.symbol_resolver import SYMBOL_EXCHANGE
    return ApiResponse(data={"reloaded": len(SYMBOL_EXCHANGE)})
