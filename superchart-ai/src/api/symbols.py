"""심볼 검색 + 시세 API."""
import os
import time
import uuid as _uuid
import structlog
import httpx
from pathlib import Path
from functools import lru_cache
from fastapi import APIRouter, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends
from src.db.session import get_db
from src.models.tables import Symbol, Exchange
from src.models.schemas import ApiResponse, SymbolOut, PagedData

router = APIRouter()
logger = structlog.get_logger(__name__)
LIVE_SYMBOLS_CACHE_TTL = 60
_live_symbols_cache_rows: list[dict] = []
_live_symbols_cache_ts: float = 0.0

_STATIC_ROOT = Path(__file__).resolve().parent.parent.parent / "static"

@lru_cache(maxsize=1)
def _logo_inventory() -> dict[str, dict[str, str]]:
    """asset_class별 로고 파일 인벤토리.

    반환값은 {대문자 파일명: 실제(원본 대소문자) 파일명} 매핑이다.
    파일 존재 여부는 대문자로 비교하고, URL에는 실제 파일명을 그대로
    사용해 대소문자 구분 파일시스템(Linux)에서 404가 나지 않도록 한다.
    """
    inv: dict[str, dict[str, str]] = {"coin": {}, "stock": {}}
    try:
        for p in (_STATIC_ROOT / "coin-logos").glob("*"):
            if p.is_file():
                inv["coin"][p.name.upper()] = p.name
        for p in (_STATIC_ROOT / "stock-logos").glob("*"):
            if p.is_file():
                inv["stock"][p.name.upper()] = p.name
    except Exception:
        pass
    return inv


def _symbol_token(row: dict) -> str:
    raw = str(row.get("base_asset") or row.get("symbol_code") or "").upper().strip()
    if raw.startswith("KRW-"):
        raw = raw[4:]
    for q in ("USDT", "USDC", "BUSD", "USD", "KRW"):
        if raw.endswith(q) and len(raw) > len(q):
            raw = raw[:-len(q)]
            break
    return "".join(ch for ch in raw if ch.isalnum())


def _fallback_logo_url(row: dict) -> str | None:
    token = _symbol_token(row)
    if not token:
        return None
    ac = str(row.get("asset_class") or "crypto").lower()
    inv = _logo_inventory()
    if ac in ("stock", "etf", "commodity"):
        candidates = [
            ("stock", f"{token}.SVG"),
            ("stock", f"{token}.PNG"),
        ]
    else:
        candidates = [
            ("coin", f"{token}.PNG"),
            ("coin", f"{token}.SVG"),
        ]
    for bucket, filename in candidates:
        actual = inv[bucket].get(filename)
        if actual:
            return f"/static/{bucket}-logos/{actual}"
    return None


def _resolve_img_url(row: dict) -> str | None:
    img = row.get("img_url")
    if isinstance(img, str) and img.strip():
        return img.strip()
    return _fallback_logo_url(row)

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
    """BitMart USDT 무기한 선물 전체 종목을 동적으로 수집.

    방식 C: 데이터 소스를 BitMart 로 일원화. 심볼 포맷은 Binance 와 동일(BTCUSDT).
    """
    global _live_symbols_cache_rows, _live_symbols_cache_ts

    now = time.time()
    if _live_symbols_cache_rows and (now - _live_symbols_cache_ts) < LIVE_SYMBOLS_CACHE_TTL:
        return _live_symbols_cache_rows

    try:
        from src.services import bitmart
        from src.services.symbol_resolver import classify_bitmart_symbol
        contracts = await bitmart.fetch_contract_symbols()
        if not contracts:
            return _live_symbols_cache_rows

        rows: list[dict] = []
        for cinfo in contracts:
            code = str(cinfo.get("symbol") or "").upper()
            base = str(cinfo.get("base_asset") or "").upper()
            if not code or not base:
                continue
            ac, name_ko, name_en = classify_bitmart_symbol(code, cinfo.get("market_group"))
            rows.append({
                "symbol_code": code,
                "base_asset": base,
                "display_name_ko": name_ko or base,
                "display_name_en": name_en or base,
                "exchange_code": "BITMART",
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


async def _fallback_symbol_items(q: str = "", page: int = 1, page_size: int = 20, asset_class: str | None = None, exchange: str | None = None):
    """DB 장애 시에도 BitMart 종목만 노출한다(방식 C).

    비상 상황이라도 Binance/기타 거래소 종목은 절대 노출하지 않는다.
    BitMart 라이브 계약을 그대로 사용하고, 그마저 실패하면 빈 목록을 반환한다.
    """
    needle = (q or "").lower().strip()
    try:
        live_rows = await _fetch_live_crypto_rows()
    except Exception:
        live_rows = []

    rows = [r for r in live_rows
            if _matches_symbol_filters(r, q=needle, asset_class=asset_class, exchange=exchange)]

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
            exchange_code=row.get("exchange_code") or "BITMART",
            asset_class=str(row.get("asset_class") or "crypto"),
            base_asset=str(row.get("base_asset") or row.get("symbol_code") or ""),
            quote_asset=str(row.get("quote_asset") or "USDT"),
            img_url=_resolve_img_url(row),
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
    cache_key = f"v2|q={q}|ac={asset_class or ''}|ex={exchange or ''}|p={page}|ps={page_size}"
    cached = await cache_get("symbols_search", cache_key)
    if cached is not None:
        return ApiResponse(data=cached)

    base = select(Symbol, Exchange.exchange_code).join(Exchange).where(Symbol.status == "active")

    try:
        from src.services.symbol_resolver import DELISTED_SYMBOLS, classify_bitmart_symbol

        # ── 방식 C: 종목 유니버스는 BitMart 계약 목록이 유일한 정본이다. ──
        # BitMart 에 실재하는 종목만 노출한다. DB/curated 는 로고·이름 보강에만 쓴다.
        live_rows = await _fetch_live_crypto_rows()

        # DB 를 보강용 인덱스로만 로드 (symbol_code -> {img_url, names, sort_order})
        db_index: dict[str, dict] = {}
        try:
            query = base.order_by(Symbol.sort_order.asc().nullslast(), Symbol.symbol_code.asc())
            result = await db.execute(query)
            for s, ec in result.all():
                db_index[s.symbol_code] = {
                    "display_name_ko": s.display_name_ko,
                    "display_name_en": s.display_name_en,
                    "base_asset": s.base_asset,
                    "sort_order": s.sort_order,
                    "img_url": (s.metadata_ or {}).get("img_url"),
                }
        except Exception:
            db_index = {}

        merged_rows: list[dict] = []
        if live_rows:
            for row in live_rows:
                code = str(row.get("symbol_code", ""))
                if not code or code in DELISTED_SYMBOLS:
                    continue
                enrich = db_index.get(code, {})
                merged = {
                    "id": _uuid.uuid5(_uuid.NAMESPACE_DNS, f"bm:{code}"),
                    "symbol_code": code,
                    # 이름: BitMart 분류 이름 우선, 없으면 DB, 최후 base
                    "display_name_ko": row.get("display_name_ko") or enrich.get("display_name_ko") or row.get("base_asset"),
                    "display_name_en": row.get("display_name_en") or enrich.get("display_name_en") or row.get("base_asset"),
                    "exchange_code": "BITMART",
                    "asset_class": row.get("asset_class") or "crypto",
                    "base_asset": row.get("base_asset") or code,
                    "quote_asset": row.get("quote_asset") or "USDT",
                    "img_url": enrich.get("img_url"),
                    "api_code": row.get("api_code") or code,
                    "sort_order": enrich.get("sort_order"),
                    "source": "live",
                }
                if _matches_symbol_filters(merged, q=q, asset_class=asset_class, exchange=exchange):
                    merged_rows.append(merged)
        else:
            # BitMart 목록을 못 받은 예외 상황에서만 DB 로 폴백(서비스 중단 방지).
            for code, enrich in db_index.items():
                if code in DELISTED_SYMBOLS:
                    continue
                ac, ko, en = classify_bitmart_symbol(code)
                row = {
                    "id": _uuid.uuid5(_uuid.NAMESPACE_DNS, f"dbfb:{code}"),
                    "symbol_code": code,
                    "display_name_ko": ko or enrich.get("display_name_ko") or enrich.get("base_asset"),
                    "display_name_en": en or enrich.get("display_name_en") or enrich.get("base_asset"),
                    "exchange_code": "BITMART",
                    "asset_class": ac,
                    "base_asset": enrich.get("base_asset") or code,
                    "quote_asset": "USDT",
                    "img_url": enrich.get("img_url"),
                    "api_code": code,
                    "sort_order": enrich.get("sort_order"),
                    "source": "db",
                }
                if _matches_symbol_filters(row, q=q, asset_class=asset_class, exchange=exchange):
                    merged_rows.append(row)

        # 4) 중복 제거 + 정렬 + 페이징
        dedup: dict[str, dict] = {}
        # 단일 소스(BitMart)이므로 우선순위는 사실상 무의미하나 dedup 안전용으로 유지
        priority = {"live": 3, "db": 2, "curated": 1}

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
                img_url=_resolve_img_url(row),
                api_code=row.get("api_code") or row.get("symbol_code"),
            )
            for row in chunk
        ]

        data = PagedData(items=items, page=page, page_size=page_size, total=total, has_next=(page * page_size < total))
        await cache_set("symbols_search", cache_key, data.model_dump(), ttl=60)
        return ApiResponse(data=data)
    except Exception as e:
        logger.warning("symbols.fallback", error=str(e)[:200])
        return ApiResponse(data=await _fallback_symbol_items(q=q, page=page, page_size=page_size, asset_class=asset_class, exchange=exchange))

@router.post("/symbols/refresh-metadata")
async def refresh_symbol_metadata(request: Request, only_missing: bool = True):
    """[비활성] 메타데이터 외부 갱신 — 방식 C: BitMart 외 외부 데이터 소스 사용 안 함.

    CoinGecko 등 외부 호출을 제거했다. 종목 한글/영문명은 BitMart 분류맵
    (symbol_resolver + bitmart_names)에서 제공한다.
    """
    from src.services.admin_auth import verify_admin_key
    verify_admin_key(request)
    return ApiResponse(data={
        "disabled": True,
        "note": "외부(CoinGecko) 메타데이터 갱신은 비활성화되었습니다. 모든 데이터는 BitMart 기반입니다.",
    })


async def _refresh_symbol_metadata_legacy(request: Request, only_missing: bool = True):
    """[미사용 보존] 이전 CoinGecko 기반 메타데이터 일괄 갱신."""
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
    """[비활성] 단일 종목 외부 메타데이터 조회 — 방식 C: BitMart 외 외부 소스 미사용."""
    from src.services.admin_auth import verify_admin_key
    verify_admin_key(request)
    return ApiResponse(data={"disabled": True, "base": base,
                             "note": "외부(CoinGecko) 조회는 비활성화되었습니다."})

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
