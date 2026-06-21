"""심볼 검색 + 시세 API."""
import os
import time
import uuid as _uuid
import structlog
import httpx
from fastapi import APIRouter, Request
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends
from src.db.session import get_db
from src.models.tables import Symbol, Exchange
from src.models.schemas import ApiResponse, SymbolOut, PagedData

router = APIRouter()
logger = structlog.get_logger(__name__)
BINANCE_FAPI = "https://fapi.binance.com"
LIVE_SYMBOLS_CACHE_TTL = 60
_live_symbols_cache_rows: list[dict] = []
_live_symbols_cache_ts: float = 0.0

def _matches_symbol_filters(row: dict, q: str = "", asset_class: str | None = None, exchange: str | None = None) -> bool:
    if asset_class and str(row.get("asset_class") or "").lower() != asset_class.lower():
        return False
    if exchange and str(row.get("exchange_code") or "").upper() != exchange.upper():
        return False
    needle = (q or "").lower().strip()
    if not needle:
        return True
    return (
        needle in str(row.get("symbol_code", "")).lower()
        or needle in str(row.get("base_asset", "")).lower()
        or needle in str(row.get("display_name_ko", "")).lower()
        or needle in str(row.get("display_name_en", "")).lower()
    )


async def _fetch_live_crypto_rows() -> list[dict]:
    """Binance USDT 무기한 선물 전체 종목을 동적으로 수집."""
    global _live_symbols_cache_rows, _live_symbols_cache_ts

    now = time.time()
    if _live_symbols_cache_rows and (now - _live_symbols_cache_ts) < LIVE_SYMBOLS_CACHE_TTL:
        return _live_symbols_cache_rows

    try:
        async with httpx.AsyncClient(timeout=12) as client:
            resp = await client.get(f"{BINANCE_FAPI}/fapi/v1/exchangeInfo")
        if resp.status_code != 200:
            return []
        payload = resp.json() or {}
        symbols = payload.get("symbols") or []
        # 토큰화 주식/원자재 분류 보정용 화이트리스트(코어 티커 → asset_class).
        # Binance USDT 선물에는 토큰화 주식(AAPLUSDT 등)/원자재(XAUUSDT 등)도 포함되는데,
        # 전부 crypto 로 두면 워치리스트 crypto 탭에 주식이 섞인다. base 코어가 알려진
        # 주식/원자재면 올바른 asset_class 로 재분류한다.
        try:
            from src.services.symbol_resolver import (
                BSTOCKS_CATALOG, COMMODITY_TOKEN_CATALOG, XSTOCKS_CATALOG, BITGET_STOCKS_CATALOG,
            )
            _stock_cores: dict[str, str] = {}
            for _b, (_c, _ko, _en, _ac) in BSTOCKS_CATALOG.items():
                _stock_cores[str(_c).upper()] = _ac  # 표시코드(NVDA 등) 기준
            for _core, (_ko, _en, _ac) in XSTOCKS_CATALOG.items():
                _stock_cores.setdefault(_core.upper(), _ac)
            for _core, (_ko, _en, _ac) in BITGET_STOCKS_CATALOG.items():
                _stock_cores.setdefault(_core.upper(), _ac)
            # 원자재 코어(견적 제거한 base): XAU/XAG/CL/BZ/COPPER/NATGAS/XPT/XPD 등은 commodity
            _commodity_cores = {"XAU", "XAG", "XPT", "XPD", "CL", "BZ", "COPPER", "NATGAS", "WTI", "BRENT"}
            for _core, (_c, _ko, _en, _q) in COMMODITY_TOKEN_CATALOG.items():
                _commodity_cores.add(_core.upper())
        except Exception:
            _stock_cores, _commodity_cores = {}, set()

        def _classify(base: str) -> str:
            b = base.upper()
            if b in _commodity_cores:
                return "commodity"
            if b in _stock_cores:
                return _stock_cores[b]
            return "crypto"

        rows: list[dict] = []
        for s in symbols:
            if not isinstance(s, dict):
                continue
            if s.get("quoteAsset") != "USDT":
                continue
            if s.get("contractType") != "PERPETUAL":
                continue
            if s.get("status") != "TRADING":
                continue
            code = str(s.get("symbol") or "").upper()
            base = str(s.get("baseAsset") or "").upper()
            if not code or not base:
                continue
            ac = _classify(base)
            rows.append({
                "symbol_code": code,
                "base_asset": base,
                "display_name_ko": base,
                "display_name_en": base,
                "exchange_code": "BINANCE",
                "asset_class": ac,
                "quote_asset": "USDT",
                "api_code": code,
            })
        _live_symbols_cache_rows = rows
        _live_symbols_cache_ts = now
        return rows
    except Exception as e:
        logger.warning("symbols.live_crypto_fetch_fail", error=str(e)[:160])
        return _live_symbols_cache_rows


def _fallback_symbol_items(q: str = "", page: int = 1, page_size: int = 20, asset_class: str | None = None, exchange: str | None = None):
    """DB 장애 시에도 UI가 의미 있는 종목 목록을 보여주도록 중앙 fallback 사용."""
    from src.services.symbol_resolver import DEFAULT_SYMBOLS, DELISTED_SYMBOLS, get_curated_catalog, load_fallback

    load_fallback("symbols-api-fallback")
    needle = (q or "").lower().strip()

    rows: list[dict] = []
    for code, base, ko, en, _exchange_id in DEFAULT_SYMBOLS:
        if code in DELISTED_SYMBOLS:
            continue
        rows.append({
            "symbol_code": code,
            "base_asset": base,
            "display_name_ko": ko,
            "display_name_en": en,
            "exchange_code": "BINANCE",
            "asset_class": "crypto",
            "quote_asset": "USDT",
            "api_code": code,
        })

    rows.extend(get_curated_catalog())

    rows = [r for r in rows if _matches_symbol_filters(r, q=needle, asset_class=asset_class, exchange=exchange)]

    unique_rows: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        code = str(row.get("symbol_code", ""))
        if not code or code in seen:
            continue
        seen.add(code)
        unique_rows.append(row)

    total = len(unique_rows)
    start = max(page - 1, 0) * page_size
    rows = unique_rows[start:start + page_size]
    items = []
    for offset, row in enumerate(rows, start=start + 1):
        uid = f"00000000-0000-0000-0000-{offset:012d}"
        items.append(SymbolOut(
            id=_uuid.UUID(uid),
            symbol_code=str(row.get("symbol_code", "")),
            display_name_ko=row.get("display_name_ko"),
            display_name_en=row.get("display_name_en"),
            exchange_code=row.get("exchange_code") or "BINANCE",
            asset_class=str(row.get("asset_class") or "crypto"),
            base_asset=str(row.get("base_asset") or row.get("symbol_code") or ""),
            quote_asset=str(row.get("quote_asset") or "USDT"),
            api_code=row.get("api_code") or row.get("symbol_code"),
        ))
    return PagedData(items=items, page=page, page_size=page_size, total=total, has_next=(page * page_size < total))

@router.get("/symbols", response_model=ApiResponse)
async def search_symbols(q: str = "", asset_class: str | None = None, exchange: str | None = None,
                         page: int = 1, page_size: int = 20, db: AsyncSession = Depends(get_db)):
    # page_size/page 안전 범위로 클램프 (과대/음수 요청에 의한 부하 방지)
    page_size = min(max(page_size, 1), 5000)
    page = max(page, 1)
    # ── Redis 캐시 (60초) — 페이지 첫 로드 시 동일 쿼리가 다수 발생 ──
    from src.services.redis_cache import cache_get, cache_set
    cache_key = f"q={q}|ac={asset_class or ''}|ex={exchange or ''}|p={page}|ps={page_size}"
    cached = await cache_get("symbols_search", cache_key)
    if cached is not None:
        return ApiResponse(data=cached)

    base = select(Symbol, Exchange.exchange_code).join(Exchange).where(Symbol.status == "active")

    try:
        from src.services.symbol_resolver import DELISTED_SYMBOLS, get_curated_catalog

        # 1) DB 활성 심볼(전체)
        query = base.order_by(Symbol.sort_order.asc().nullslast(), Symbol.symbol_code.asc())
        result = await db.execute(query)

        merged_rows: list[dict] = []
        for s, ec in result.all():
            if s.symbol_code in DELISTED_SYMBOLS:
                continue
            row = {
                "id": s.id,
                "symbol_code": s.symbol_code,
                "display_name_ko": s.display_name_ko,
                "display_name_en": s.display_name_en,
                "exchange_code": ec,
                "asset_class": s.asset_class,
                # 시총 순 정렬용 랭크 (0/NULL = 미시드 → 맨 뒤). merge 단계에서 보존.
                "sort_order": s.sort_order,
                "base_asset": s.base_asset,
                "quote_asset": s.quote_asset,
                "img_url": (s.metadata_ or {}).get("img_url"),
                "api_code": (s.metadata_ or {}).get("api_code") or s.symbol_code,
                "source": "db",
            }
            if _matches_symbol_filters(row, q=q, asset_class=asset_class, exchange=exchange):
                merged_rows.append(row)

        # 2) 고정 카탈로그 보강
        for row in get_curated_catalog():
            if not _matches_symbol_filters(row, q=q, asset_class=asset_class, exchange=exchange):
                continue
            merged_rows.append({
                "id": _uuid.uuid5(_uuid.NAMESPACE_DNS, f"curated:{row.get('symbol_code')}") ,
                "symbol_code": str(row.get("symbol_code", "")),
                "display_name_ko": row.get("display_name_ko"),
                "display_name_en": row.get("display_name_en"),
                "exchange_code": row.get("exchange_code") or "TWELVE_DATA",
                "asset_class": str(row.get("asset_class") or "crypto"),
                "base_asset": str(row.get("base_asset") or row.get("symbol_code") or ""),
                "quote_asset": str(row.get("quote_asset") or "USD"),
                "img_url": row.get("img_url"),
                "api_code": row.get("api_code") or row.get("symbol_code"),
                "source": "curated",
            })

        # 3) Binance 전체 USDT 선물(동적 확장)
        live_rows = await _fetch_live_crypto_rows()
        for row in live_rows:
            if str(row.get("symbol_code", "")) in DELISTED_SYMBOLS:
                continue
            if not _matches_symbol_filters(row, q=q, asset_class=asset_class, exchange=exchange):
                continue
            merged_rows.append({
                "id": _uuid.uuid5(_uuid.NAMESPACE_DNS, f"live:{row.get('symbol_code')}") ,
                **row,
                "source": "live",
            })

        # 4) 중복 제거 + 정렬 + 페이징
        dedup: dict[str, dict] = {}
        # 우선순위: db > curated > live
        priority = {"db": 3, "curated": 2, "live": 1}

        def _dedup_key(row: dict) -> str:
            """중복 제거 키.

            - crypto: symbol_code 그대로(예: SHIBUSDT vs 1000SHIBUSDT 는 별개 계약이라 유지).
            - stock/etf/commodity: 같은 기초자산이 거래소별로 AAPL(xStocks)·AAPLUSDT(Binance)
              처럼 다른 코드로 중복 노출되므로, 자산군+기초자산명으로 묶어 1개만 남긴다.
            """
            ac = str(row.get("asset_class") or "crypto")
            code = str(row.get("symbol_code", ""))
            if ac == "crypto":
                return "crypto:" + code
            # 비암호화폐: 기초자산 코어로 묶는다(거래소별 AAPL / AAPLUSDT 통합).
            base = str(row.get("base_asset") or "").upper()
            if not base:
                base = code.upper()
            for q in ("USDT", "USDC", "BUSD", "USD"):
                if base.endswith(q) and len(base) > len(q):
                    base = base[: -len(q)]
                    break
            # 동일 자산의 별칭 통합(예: 금 토큰 XAUT[Tether Gold] / XAU 는 같은 '금'으로 묶음).
            _ALIAS = {"XAUT": "XAU"}
            base = _ALIAS.get(base, base)
            return f"{ac}:{base}"

        for row in merged_rows:
            code = str(row.get("symbol_code", ""))
            if not code:
                continue
            key = _dedup_key(row)
            prev = dedup.get(key)
            if not prev or priority.get(str(row.get("source")), 0) > priority.get(str(prev.get("source")), 0):
                dedup[key] = row

        # 시총 순 정렬: sort_order 1,2,3... 가 상위 종목(BTC/ETH/...).
        # DB sort_order 가 채워져 있으면(>0) 그것을 쓰고, 아니면 코드 기반
        # 정적 시총 순위 맵으로 보강한다(동적 추가/원자재/주식 등 미시드 대비).
        # 둘 다 없으면 맨 뒤로 보내고, 그 안에서는 자산군→심볼코드 순으로 안정 정렬.
        from src.services.symbol_resolver import market_cap_rank

        def _mcap_rank(r: dict) -> int:
            so = r.get("sort_order")
            try:
                so = int(so) if so is not None else 0
            except (TypeError, ValueError):
                so = 0
            if so > 0:
                return so
            return market_cap_rank(str(r.get("symbol_code") or ""))

        all_rows = sorted(
            dedup.values(),
            key=lambda r: (_mcap_rank(r), str(r.get("asset_class") or ""), str(r.get("symbol_code") or "")),
        )
        total = len(all_rows)
        start = (page - 1) * page_size
        chunk = all_rows[start:start + page_size]

        items: list[SymbolOut] = [
            SymbolOut(
                id=row.get("id") if isinstance(row.get("id"), _uuid.UUID) else _uuid.uuid5(_uuid.NAMESPACE_DNS, f"sym:{row.get('symbol_code')}") ,
                symbol_code=str(row.get("symbol_code", "")),
                display_name_ko=row.get("display_name_ko"),
                display_name_en=row.get("display_name_en"),
                exchange_code=row.get("exchange_code"),
                asset_class=str(row.get("asset_class") or "crypto"),
                base_asset=str(row.get("base_asset") or row.get("symbol_code") or ""),
                quote_asset=str(row.get("quote_asset") or "USDT"),
                img_url=row.get("img_url"),
                api_code=row.get("api_code") or row.get("symbol_code"),
            )
            for row in chunk
        ]

        data = PagedData(items=items, page=page, page_size=page_size, total=total, has_next=(page * page_size < total))
        await cache_set("symbols_search", cache_key, data.model_dump(), ttl=60)
        return ApiResponse(data=data)
    except Exception as e:
        logger.warning("symbols.fallback", error=str(e)[:200])
        return ApiResponse(data=_fallback_symbol_items(q=q, page=page, page_size=page_size, asset_class=asset_class, exchange=exchange))

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
