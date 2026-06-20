"""심볼 해석 유틸리티 — DB 기반 (TTL 5분 자동 갱신)."""
import asyncio
import time
import structlog

logger = structlog.get_logger(__name__)

# 메모리 캐시 — load() 호출 후 채워짐
SYMBOL_EXCHANGE: dict[str, int] = {}
SYMBOL_API_MAP: dict[str, str] = {}
_last_load_time: float = 0
_TTL_SECONDS: int = 300  # 5분
_lock = asyncio.Lock() if hasattr(asyncio, 'Lock') else None

# 운영 중 거래정지/상폐로 간주해 숨길 심볼(과거 데이터 호환용으로 DB에는 남아있을 수 있음)
DELISTED_SYMBOLS: frozenset[str] = frozenset({
    "BTSUSDT", "BTCSTUSDT", "DREPUSDT", "COCOSUSDT", "SRMUSDT", "HNTUSDT",
    "CTKUSDT", "BZRXUSDT", "LITUSDT", "AKROUSDT", "BONDUSDT", "YFIIUSDT",
})

# 시총 순(market-cap) 정렬용 단일 진실 소스.
# 관심종목 "시총순" 정렬과 DB sort_order 시드(main.py)가 동일한 순위를 쓰도록
# 여기에 모아둔다. 값이 작을수록 상위 종목(BTC=1). 목록에 없는 심볼은 미시드로
# 간주해 맨 뒤로 보낸다.
_MARKET_CAP_ORDER: tuple[str, ...] = (
    "BTCUSDT", "ETHUSDT", "XRPUSDT", "BNBUSDT", "SOLUSDT",
    "ADAUSDT", "DOGEUSDT", "TRXUSDT", "AVAXUSDT", "LINKUSDT",
    "TONUSDT", "DOTUSDT", "SUIUSDT", "SHIBUSDT", "LTCUSDT",
    "BCHUSDT", "UNIUSDT", "NEARUSDT", "APTUSDT", "ICPUSDT",
    "ETCUSDT", "HBARUSDT", "XLMUSDT", "RENDERUSDT", "FILUSDT",
    "ARBUSDT", "OPUSDT", "ATOMUSDT", "INJUSDT", "FETUSDT",
    "STXUSDT", "IMXUSDT", "GRTUSDT", "ALGOUSDT", "THETAUSDT",
    "VETUSDT", "AAVEUSDT", "TIAUSDT", "JUPUSDT", "SEIUSDT",
    "KASUSDT", "ONDOUSDT", "WLDUSDT", "ENAUSDT", "PEPEUSDT",
    "BONKUSDT", "FLOKIUSDT", "WIFUSDT", "TRUMPUSDT", "PENGUUSDT",
    "POLUSDT", "LABUSDT",
)

# symbol_code -> 시총 순위(1부터). 미등록 심볼은 .get(code, 0) 으로 0(미시드) 처리.
MARKET_CAP_RANK: dict[str, int] = {code: i for i, code in enumerate(_MARKET_CAP_ORDER, start=1)}

# 미시드 심볼을 맨 뒤로 보낼 때 사용하는 큰 값.
UNRANKED_SENTINEL: int = 10**9


def market_cap_rank(symbol_code: str) -> int:
    """시총 순위(1=BTC) 반환. 미시드면 UNRANKED_SENTINEL(맨 뒤)."""
    return MARKET_CAP_RANK.get((symbol_code or "").upper(), UNRANKED_SENTINEL)


# DB가 일시 장애이거나 로컬 실행에서 미기동인 경우에도 차트 핵심 기능이
# 500으로 죽지 않도록 하는 안전 심볼셋. 운영에서는 DB 로드가 성공하면
# 즉시 실제 DB 심볼로 덮어쓴다.
DEFAULT_SYMBOLS: tuple[tuple[str, str, str, str, int], ...] = (
    ("TRUMPUSDT", "TRUMP", "오피셜트럼프", "Official Trump", 2),
    ("BANKUSDT", "BANK", "로렌조프로토콜", "Lorenzo Protocol", 2),
    ("BTCUSDT", "BTC", "비트코인", "Bitcoin", 2),
    ("ETHUSDT", "ETH", "이더리움", "Ethereum", 2),
    ("BNBUSDT", "BNB", "바이낸스코인", "BNB", 2),
    ("SOLUSDT", "SOL", "솔라나", "Solana", 2),
    ("XRPUSDT", "XRP", "리플", "XRP", 2),
    ("ADAUSDT", "ADA", "에이다", "Cardano", 2),
    ("DOGEUSDT", "DOGE", "도지코인", "Dogecoin", 2),
    ("TRXUSDT", "TRX", "트론", "TRON", 2),
    ("AVAXUSDT", "AVAX", "아발란체", "Avalanche", 2),
    ("LINKUSDT", "LINK", "체인링크", "Chainlink", 2),
    ("DOTUSDT", "DOT", "폴카닷", "Polkadot", 2),
    ("SUIUSDT", "SUI", "수이", "Sui", 2),
    ("SHIBUSDT", "SHIB", "시바이누", "Shiba Inu", 2),
    ("LTCUSDT", "LTC", "라이트코인", "Litecoin", 2),
    ("BCHUSDT", "BCH", "비트코인캐시", "Bitcoin Cash", 2),
    ("UNIUSDT", "UNI", "유니스왑", "Uniswap", 2),
    ("NEARUSDT", "NEAR", "니어프로토콜", "NEAR Protocol", 2),
    ("APTUSDT", "APT", "앱토스", "Aptos", 2),
    ("ICPUSDT", "ICP", "인터넷컴퓨터", "Internet Computer", 2),
    ("ETCUSDT", "ETC", "이더리움클래식", "Ethereum Classic", 2),
    ("HBARUSDT", "HBAR", "헤데라", "Hedera", 2),
    ("XLMUSDT", "XLM", "스텔라루멘", "Stellar", 2),
    ("FILUSDT", "FIL", "파일코인", "Filecoin", 2),
    ("ARBUSDT", "ARB", "아비트럼", "Arbitrum", 2),
    ("OPUSDT", "OP", "옵티미즘", "Optimism", 2),
    ("ATOMUSDT", "ATOM", "코스모스", "Cosmos", 2),
    ("INJUSDT", "INJ", "인젝티브", "Injective", 2),
    ("FETUSDT", "FET", "페치에이아이", "Fetch.ai", 2),
    ("PEPEUSDT", "PEPE", "페페", "Pepe", 2),
    ("BONKUSDT", "BONK", "봉크", "Bonk", 2),
    ("WIFUSDT", "WIF", "도그위프햇", "dogwifhat", 2),
)

# 코어 심볼 유니버스(crypto + stock + commodity + etf)
# - symbol_code 는 UI/검색용 안전 코드(영문대문자/숫자)
# - api_code 는 외부 데이터 공급자 코드(예: Yahoo Finance GC=F)
CURATED_SYMBOLS: tuple[dict[str, str | int], ...] = (
    # 정적 비암호화폐는 두지 않는다. Binance Spot 토큰화 증권/원자재는
    # BSTOCKS_CATALOG / COMMODITY_TOKEN_CATALOG 화이트리스트 + exchangeInfo
    # 상장상태 자동감지로 _DYNAMIC_SPOT 에 동적 등록된다.
)

# ── Binance Spot 토큰화 증권(bStocks) 화이트리스트 ──────────────────
# Binance 는 exchangeInfo 에 "토큰화 증권" 표시를 제공하지 않으므로(일반 코인과
# B 접미사가 겹침), 알려진 bStocks 티커를 화이트리스트로 관리하고 실제 상장
# 여부는 exchangeInfo 의 TRADING 상태로 자동 판별한다.
#   key   = Binance base asset (예: NVDAB)
#   value = (표시 symbol_code, 한글명, 영문명, asset_class)
# 신규 bStocks 가 추가되면 여기 한 줄만 더하면 상장 시 자동 노출된다.
BSTOCKS_CATALOG: dict[str, tuple[str, str, str, str]] = {
    "NVDAB": ("NVDA", "엔비디아", "NVIDIA", "stock"),
    "TSLAB": ("TSLA", "테슬라", "Tesla", "stock"),
    "CRCLB": ("CRCL", "서클", "Circle", "stock"),
    "SNDKB": ("SNDK", "샌디스크", "SanDisk", "stock"),
    "MUB":   ("MU", "마이크론", "Micron", "stock"),
    "SPCXB": ("SPCX", "스페이스X", "SpaceX", "stock"),
    "AMDB":  ("AMD", "AMD", "Advanced Micro Devices", "stock"),
    "INTCB": ("INTC", "인텔", "Intel", "stock"),
    "MSTRB": ("MSTR", "스트래티지", "Strategy", "stock"),
    "EWYB":  ("EWY", "한국 ETF", "iShares MSCI South Korea ETF", "etf"),
}

# ── Binance Spot 원자재 토큰 화이트리스트 ──────────────────────────
#   key = Binance base asset, value = (표시 symbol_code, 한글명, 영문명, 우선 견적)
COMMODITY_TOKEN_CATALOG: dict[str, tuple[str, str, str, str]] = {
    "XAUT": ("XAUUSD", "금", "Gold (Tether Gold)", "USDT"),
    "PAXG": ("PAXGUSD", "금 (PAXG)", "Gold (PAX Gold)", "USDT"),
}

# exchangeInfo 자동감지로 채워지는 동적 Spot 종목 카탈로그(런타임)
_DYNAMIC_SPOT: list[dict[str, str | int]] = []


def _curated_all() -> list[dict[str, str | int]]:
    """정적 CURATED + 동적 Spot(bStocks/원자재) 합본."""
    return list(CURATED_SYMBOLS) + list(_DYNAMIC_SPOT)


def get_curated_catalog() -> list[dict[str, str | int]]:
    return [row for row in _curated_all() if str(row.get("symbol_code", "")) not in DELISTED_SYMBOLS]



def _iter_seed_symbols() -> list[tuple[str, int, str]]:
    rows: list[tuple[str, int, str]] = []
    for code, _base, _ko, _en, exchange_id in DEFAULT_SYMBOLS:
        if code in DELISTED_SYMBOLS:
            continue
        rows.append((code, exchange_id, code))
    for item in _curated_all():
        code = str(item.get("symbol_code", ""))
        if not code or code in DELISTED_SYMBOLS:
            continue
        rows.append((code, int(item.get("exchange_id", 2)), str(item.get("api_code") or code)))
    return rows


def load_fallback(reason: str = ""):
    """DB 불가 상황의 안전 심볼 캐시를 주입한다."""
    global _last_load_time
    SYMBOL_EXCHANGE.clear()
    SYMBOL_API_MAP.clear()
    for code, exchange_id, api_code in _iter_seed_symbols():
        SYMBOL_EXCHANGE[code] = exchange_id
        SYMBOL_API_MAP[code] = api_code
    _last_load_time = time.time()
    logger.warning("symbol_resolver.fallback_loaded", symbols=len(SYMBOL_EXCHANGE), reason=reason[:160])


async def load():
    """DB에서 심볼 목록을 읽어 캐시에 저장.

    DB/네트워크 장애는 차트 전체 장애로 전파하지 않고 fallback 심볼셋으로
    격리한다. 이 함수는 startup과 요청 경로 모두에서 호출되므로 예외를
    외부로 던지지 않는 것이 중요하다.
    """
    global _last_load_time
    from src.db.session import SessionLocal
    from src.models.tables import Symbol
    from sqlalchemy import select

    try:
        async with SessionLocal() as db:
            rows = (await db.execute(select(Symbol))).scalars().all()
    except Exception as e:
        load_fallback(str(e))
        return

    SYMBOL_EXCHANGE.clear()
    SYMBOL_API_MAP.clear()
    for s in rows:
        if s.symbol_code in DELISTED_SYMBOLS or s.status != "active":
            continue
        # 방식 A: Binance(Futures crypto=2 / Spot 토큰=5) 종목만 유지.
        # DB 에 잔존하는 Twelve Data 주식/ETF/원자재는 노출에서 제외.
        if not is_binance_exchange(s.exchange_id):
            continue
        SYMBOL_EXCHANGE[s.symbol_code] = s.exchange_id
        api_code = (s.metadata_ or {}).get("api_code")
        SYMBOL_API_MAP[s.symbol_code] = api_code or s.symbol_code

    # Binance Spot 토큰화 증권/원자재(bStocks) 동적 갱신 (TTL 1시간, 실패 무해)
    try:
        await refresh_binance_spot_listings()
    except Exception as e:
        logger.warning("symbol_resolver.spot_refresh_in_load", error=str(e)[:120])

    # DB에 아직 반영되지 않은 필수/신규 종목을 메모리 카탈로그로 보강
    for code, exchange_id, api_code in _iter_seed_symbols():
        SYMBOL_EXCHANGE.setdefault(code, exchange_id)
        SYMBOL_API_MAP.setdefault(code, api_code)
    if not SYMBOL_EXCHANGE:
        load_fallback("empty-db-symbols")
        return
    _last_load_time = time.time()
    logger.info("symbol_resolver.loaded", symbols=len(SYMBOL_EXCHANGE), api_maps=len(SYMBOL_API_MAP))


async def ensure_fresh():
    """TTL 초과 시 자동 리로드 (동시성 안전)."""
    global _last_load_time, _lock
    if time.time() - _last_load_time < _TTL_SECONDS:
        return
    if _lock is None:
        _lock = asyncio.Lock()
    async with _lock:
        # 더블 체크 (다른 코루틴이 이미 리로드했을 수 있음)
        if time.time() - _last_load_time < _TTL_SECONDS:
            return
        await load()
        if not SYMBOL_EXCHANGE:
            load_fallback("empty-cache-after-load")


def resolve_symbol(sym: str) -> tuple[str, int]:
    """심볼 코드 → (api_symbol, exchange_id).

    안전성: 잘못된 형식은 모르는 심볼로 취급하여 빈 결과 유도.
    - 형식 오류(영문대문자/숫자 외 문자) → ("", 2) 반환 → 외부 API 호출 시 빈 결과
    """
    if not sym or not isinstance(sym, str):
        return "", 2
    # 영문 대문자 + 숫자만 허용 (SQL/XSS/제어문자 차단)
    if not all(c.isupper() or c.isdigit() for c in sym) or not (2 <= len(sym) <= 30):
        return "", 2
    api_sym = SYMBOL_API_MAP.get(sym, sym)
    exchange_id = SYMBOL_EXCHANGE.get(sym, 2)
    return api_sym, exchange_id


def get_all_symbols() -> list[str]:
    """등록된 전체 심볼 코드 목록."""
    return list(SYMBOL_EXCHANGE.keys())


# Binance 거래소 식별자. 2=Futures(USD-M, crypto), 5=Spot(토큰화 주식/원자재).
# 방식 A: Binance 에서 실거래되는 종목만 유니버스에 유지한다.
BINANCE_EXCHANGE_ID = 2
BINANCE_SPOT_EXCHANGE_ID = 5
BINANCE_EXCHANGE_IDS = frozenset({BINANCE_EXCHANGE_ID, BINANCE_SPOT_EXCHANGE_ID})


def is_binance_exchange(exchange_id: int) -> bool:
    try:
        return int(exchange_id) in BINANCE_EXCHANGE_IDS
    except (TypeError, ValueError):
        return False


def get_binance_symbols() -> list[str]:
    """Binance Futures 수집 대상(crypto, exchange_id=2) API 심볼만 반환.

    Spot 토큰화 주식/원자재(exchange_id=5)는 Futures 가 아니므로 여기서 제외하고
    별도 Spot 수집 경로에서 처리한다.
    중복 제거 + 등록 순서 유지.
    """
    seen: set[str] = set()
    out: list[str] = []
    for code, exchange_id, api_code in _iter_seed_symbols():
        if int(exchange_id) != BINANCE_EXCHANGE_ID:
            continue
        api = SYMBOL_API_MAP.get(code, api_code or code)
        if api and api not in seen:
            seen.add(api)
            out.append(api)
    return out


def get_binance_spot_symbols() -> list[str]:
    """Binance Spot 수집/조회 대상(exchange_id=5) API 페어 반환. 예: NVDABUSDT."""
    seen: set[str] = set()
    out: list[str] = []
    for code, exchange_id, api_code in _iter_seed_symbols():
        if int(exchange_id) != BINANCE_SPOT_EXCHANGE_ID:
            continue
        api = SYMBOL_API_MAP.get(code, api_code or code)
        if api and api not in seen:
            seen.add(api)
            out.append(api)
    return out


# Binance Spot exchangeInfo 엔드포인트
_BINANCE_SPOT_EXCHANGE_INFO = "https://api.binance.com/api/v3/exchangeInfo"
_spot_listings_last_refresh: float = 0.0
_SPOT_REFRESH_TTL = 3600  # 1시간


def _build_dynamic_spot_from_codes(trading_pairs: set[str]) -> list[dict[str, str | int]]:
    """화이트리스트 ∩ 실제 TRADING 페어 → 동적 Spot 카탈로그 항목 생성.

    bStocks(B 접미사)와 원자재 토큰을 합쳐 exchange_id=5(BINANCE_SPOT)로 등록.
    표시 symbol_code 는 실종목명(NVDA), api_code 는 실제 Binance 페어(NVDABUSDT).
    """
    out: list[dict[str, str | int]] = []
    seen_codes: set[str] = set()

    # bStocks: base + 'USDT' 페어가 TRADING 인 것만
    for base, (code, ko, en, asset_class) in BSTOCKS_CATALOG.items():
        pair = f"{base}USDT"
        if pair in trading_pairs and code not in seen_codes:
            seen_codes.add(code)
            out.append({
                "symbol_code": code, "base_asset": code,
                "display_name_ko": ko, "display_name_en": en,
                "exchange_id": BINANCE_SPOT_EXCHANGE_ID, "exchange_code": "BINANCE_SPOT",
                "asset_class": asset_class, "quote_asset": "USDT", "api_code": pair,
            })

    # 원자재 토큰: 우선 견적(USDT) 페어가 TRADING 이면 등록
    for base, (code, ko, en, quote) in COMMODITY_TOKEN_CATALOG.items():
        pair = f"{base}{quote}"
        if pair in trading_pairs and code not in seen_codes:
            seen_codes.add(code)
            out.append({
                "symbol_code": code, "base_asset": base,
                "display_name_ko": ko, "display_name_en": en,
                "exchange_id": BINANCE_SPOT_EXCHANGE_ID, "exchange_code": "BINANCE_SPOT",
                "asset_class": "commodity", "quote_asset": quote, "api_code": pair,
            })
    return out


async def refresh_binance_spot_listings(force: bool = False) -> int:
    """Binance Spot exchangeInfo 를 조회해 화이트리스트 중 TRADING 종목만 동적 등록.

    - 실패해도 기존 _DYNAMIC_SPOT 을 유지(차트 전체 장애로 전파하지 않음).
    - TTL(1시간) 내 재호출은 스킵(force=True 면 무시).
    반환: 등록된 동적 Spot 종목 수.
    """
    global _DYNAMIC_SPOT, _spot_listings_last_refresh
    now = time.time()
    if not force and (now - _spot_listings_last_refresh) < _SPOT_REFRESH_TTL and _DYNAMIC_SPOT:
        return len(_DYNAMIC_SPOT)

    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(_BINANCE_SPOT_EXCHANGE_INFO)
        if r.status_code != 200:
            logger.warning("symbol_resolver.spot_refresh_http", status=r.status_code)
            return len(_DYNAMIC_SPOT)
        data = r.json()
        trading = {s["symbol"] for s in data.get("symbols", []) if s.get("status") == "TRADING"}
    except Exception as e:
        logger.warning("symbol_resolver.spot_refresh_failed", error=str(e)[:160])
        return len(_DYNAMIC_SPOT)

    new_spot = _build_dynamic_spot_from_codes(trading)
    _DYNAMIC_SPOT = new_spot
    _spot_listings_last_refresh = now
    logger.info(
        "symbol_resolver.spot_listings_refreshed",
        count=len(new_spot),
        codes=[str(i["symbol_code"]) for i in new_spot],
    )
    return len(new_spot)


def get_api_symbol(sym: str) -> str:
    """프론트 심볼 → 거래소 API 심볼."""
    return SYMBOL_API_MAP.get(sym, sym)


def get_reverse_api_map() -> dict[str, str]:
    """거래소 API 심볼 → 프론트 심볼 (1000PEPEUSDT → PEPEUSDT)."""
    return {v: k for k, v in SYMBOL_API_MAP.items()}
