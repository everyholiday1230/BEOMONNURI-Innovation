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
    {"symbol_code": "AAPL", "base_asset": "AAPL", "display_name_ko": "애플", "display_name_en": "Apple", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "AAPL"},
    {"symbol_code": "MSFT", "base_asset": "MSFT", "display_name_ko": "마이크로소프트", "display_name_en": "Microsoft", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "MSFT"},
    {"symbol_code": "NVDA", "base_asset": "NVDA", "display_name_ko": "엔비디아", "display_name_en": "NVIDIA", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "NVDA"},
    {"symbol_code": "TSLA", "base_asset": "TSLA", "display_name_ko": "테슬라", "display_name_en": "Tesla", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "TSLA"},
    {"symbol_code": "AMZN", "base_asset": "AMZN", "display_name_ko": "아마존", "display_name_en": "Amazon", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "AMZN"},
    {"symbol_code": "GOOGL", "base_asset": "GOOGL", "display_name_ko": "알파벳", "display_name_en": "Alphabet", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "GOOGL"},
    {"symbol_code": "META", "base_asset": "META", "display_name_ko": "메타", "display_name_en": "Meta", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "META"},
    {"symbol_code": "SPY", "base_asset": "SPY", "display_name_ko": "SPY ETF", "display_name_en": "SPDR S&P 500 ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "SPY"},
    {"symbol_code": "QQQ", "base_asset": "QQQ", "display_name_ko": "QQQ ETF", "display_name_en": "Invesco QQQ", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "QQQ"},
    {"symbol_code": "IWM", "base_asset": "IWM", "display_name_ko": "IWM ETF", "display_name_en": "iShares Russell 2000 ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "IWM"},
    {"symbol_code": "VTI", "base_asset": "VTI", "display_name_ko": "VTI ETF", "display_name_en": "Vanguard Total Stock Market ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "VTI"},
    {"symbol_code": "GLD", "base_asset": "GLD", "display_name_ko": "GLD ETF", "display_name_en": "SPDR Gold Shares", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "GLD"},
    {"symbol_code": "SLV", "base_asset": "SLV", "display_name_ko": "SLV ETF", "display_name_en": "iShares Silver Trust", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "SLV"},
    {"symbol_code": "USO", "base_asset": "USO", "display_name_ko": "USO ETF", "display_name_en": "United States Oil Fund", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "USO"},
    {"symbol_code": "TLT", "base_asset": "TLT", "display_name_ko": "TLT ETF", "display_name_en": "iShares 20+ Year Treasury Bond ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "TLT"},
    {"symbol_code": "XAUUSD", "base_asset": "XAU", "display_name_ko": "국제 금", "display_name_en": "Gold Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "GC=F"},
    {"symbol_code": "XAGUSD", "base_asset": "XAG", "display_name_ko": "국제 은", "display_name_en": "Silver Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "SI=F"},
    {"symbol_code": "WTI", "base_asset": "WTI", "display_name_ko": "WTI 원유", "display_name_en": "Crude Oil WTI Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "CL=F"},
    {"symbol_code": "BRENT", "base_asset": "BRENT", "display_name_ko": "브렌트유", "display_name_en": "Brent Crude Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "BZ=F"},
    {"symbol_code": "NATGAS", "base_asset": "NATGAS", "display_name_ko": "천연가스", "display_name_en": "Natural Gas Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "NG=F"},
    {"symbol_code": "COPPER", "base_asset": "COPPER", "display_name_ko": "구리", "display_name_en": "Copper Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "HG=F"},
    # ── 신규 주식(미국 대형주) ── api_code = Yahoo Finance 티커 ──
    {"symbol_code": "AVGO", "base_asset": "AVGO", "display_name_ko": "브로드컴", "display_name_en": "Broadcom", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "AVGO"},
    {"symbol_code": "BRKB", "base_asset": "BRKB", "display_name_ko": "버크셔 해서웨이", "display_name_en": "Berkshire Hathaway B", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "BRK-B"},
    {"symbol_code": "LLY", "base_asset": "LLY", "display_name_ko": "일라이 릴리", "display_name_en": "Eli Lilly", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "LLY"},
    {"symbol_code": "JPM", "base_asset": "JPM", "display_name_ko": "JP모건", "display_name_en": "JPMorgan Chase", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "JPM"},
    {"symbol_code": "VISA", "base_asset": "VISA", "display_name_ko": "비자", "display_name_en": "Visa", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "V"},
    {"symbol_code": "MA", "base_asset": "MA", "display_name_ko": "마스터카드", "display_name_en": "Mastercard", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "MA"},
    {"symbol_code": "UNH", "base_asset": "UNH", "display_name_ko": "유나이티드헬스", "display_name_en": "UnitedHealth", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "UNH"},
    {"symbol_code": "WMT", "base_asset": "WMT", "display_name_ko": "월마트", "display_name_en": "Walmart", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "WMT"},
    {"symbol_code": "XOM", "base_asset": "XOM", "display_name_ko": "엑슨모빌", "display_name_en": "Exxon Mobil", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "XOM"},
    {"symbol_code": "JNJ", "base_asset": "JNJ", "display_name_ko": "존슨앤드존슨", "display_name_en": "Johnson & Johnson", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "JNJ"},
    {"symbol_code": "HD", "base_asset": "HD", "display_name_ko": "홈디포", "display_name_en": "Home Depot", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "HD"},
    {"symbol_code": "PG", "base_asset": "PG", "display_name_ko": "P&G", "display_name_en": "Procter & Gamble", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "PG"},
    {"symbol_code": "COST", "base_asset": "COST", "display_name_ko": "코스트코", "display_name_en": "Costco", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "COST"},
    {"symbol_code": "NFLX", "base_asset": "NFLX", "display_name_ko": "넷플릭스", "display_name_en": "Netflix", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "NFLX"},
    {"symbol_code": "CRM", "base_asset": "CRM", "display_name_ko": "세일즈포스", "display_name_en": "Salesforce", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "CRM"},
    {"symbol_code": "ORCL", "base_asset": "ORCL", "display_name_ko": "오라클", "display_name_en": "Oracle", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "ORCL"},
    {"symbol_code": "AMD", "base_asset": "AMD", "display_name_ko": "AMD", "display_name_en": "Advanced Micro Devices", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "AMD"},
    {"symbol_code": "ADBE", "base_asset": "ADBE", "display_name_ko": "어도비", "display_name_en": "Adobe", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "ADBE"},
    {"symbol_code": "KO", "base_asset": "KO", "display_name_ko": "코카콜라", "display_name_en": "Coca-Cola", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "KO"},
    {"symbol_code": "PEP", "base_asset": "PEP", "display_name_ko": "펩시코", "display_name_en": "PepsiCo", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "PEP"},
    {"symbol_code": "BAC", "base_asset": "BAC", "display_name_ko": "뱅크오브아메리카", "display_name_en": "Bank of America", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "BAC"},
    {"symbol_code": "ABBV", "base_asset": "ABBV", "display_name_ko": "애브비", "display_name_en": "AbbVie", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "ABBV"},
    {"symbol_code": "MRK", "base_asset": "MRK", "display_name_ko": "머크", "display_name_en": "Merck", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "MRK"},
    {"symbol_code": "PFE", "base_asset": "PFE", "display_name_ko": "화이자", "display_name_en": "Pfizer", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "PFE"},
    {"symbol_code": "DIS", "base_asset": "DIS", "display_name_ko": "월트디즈니", "display_name_en": "Walt Disney", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "DIS"},
    {"symbol_code": "INTC", "base_asset": "INTC", "display_name_ko": "인텔", "display_name_en": "Intel", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "INTC"},
    {"symbol_code": "QCOM", "base_asset": "QCOM", "display_name_ko": "퀄컴", "display_name_en": "Qualcomm", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "QCOM"},
    {"symbol_code": "TXN", "base_asset": "TXN", "display_name_ko": "텍사스인스트루먼트", "display_name_en": "Texas Instruments", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "TXN"},
    {"symbol_code": "CSCO", "base_asset": "CSCO", "display_name_ko": "시스코", "display_name_en": "Cisco", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "CSCO"},
    {"symbol_code": "PYPL", "base_asset": "PYPL", "display_name_ko": "페이팔", "display_name_en": "PayPal", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "PYPL"},
    {"symbol_code": "SHOP", "base_asset": "SHOP", "display_name_ko": "쇼피파이", "display_name_en": "Shopify", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "SHOP"},
    {"symbol_code": "COIN", "base_asset": "COIN", "display_name_ko": "코인베이스", "display_name_en": "Coinbase", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "COIN"},
    {"symbol_code": "PLTR", "base_asset": "PLTR", "display_name_ko": "팔란티어", "display_name_en": "Palantir", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "PLTR"},
    {"symbol_code": "SNOW", "base_asset": "SNOW", "display_name_ko": "스노우플레이크", "display_name_en": "Snowflake", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "SNOW"},
    {"symbol_code": "BABA", "base_asset": "BABA", "display_name_ko": "알리바바", "display_name_en": "Alibaba", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "BABA"},
    {"symbol_code": "UBER", "base_asset": "UBER", "display_name_ko": "우버", "display_name_en": "Uber", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "stock", "quote_asset": "USD", "api_code": "UBER"},
    # ── 신규 ETF ──
    {"symbol_code": "VOO", "base_asset": "VOO", "display_name_ko": "VOO ETF", "display_name_en": "Vanguard S&P 500 ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "VOO"},
    {"symbol_code": "IVV", "base_asset": "IVV", "display_name_ko": "IVV ETF", "display_name_en": "iShares Core S&P 500 ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "IVV"},
    {"symbol_code": "DIA", "base_asset": "DIA", "display_name_ko": "DIA ETF", "display_name_en": "SPDR Dow Jones ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "DIA"},
    {"symbol_code": "EEM", "base_asset": "EEM", "display_name_ko": "EEM ETF", "display_name_en": "iShares MSCI Emerging Markets ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "EEM"},
    {"symbol_code": "EFA", "base_asset": "EFA", "display_name_ko": "EFA ETF", "display_name_en": "iShares MSCI EAFE ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "EFA"},
    {"symbol_code": "ARKK", "base_asset": "ARKK", "display_name_ko": "ARKK ETF", "display_name_en": "ARK Innovation ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "ARKK"},
    {"symbol_code": "SMH", "base_asset": "SMH", "display_name_ko": "SMH ETF", "display_name_en": "VanEck Semiconductor ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "SMH"},
    {"symbol_code": "SOXX", "base_asset": "SOXX", "display_name_ko": "SOXX ETF", "display_name_en": "iShares Semiconductor ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "SOXX"},
    {"symbol_code": "XLK", "base_asset": "XLK", "display_name_ko": "XLK ETF", "display_name_en": "Technology Select Sector SPDR", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "XLK"},
    {"symbol_code": "XLF", "base_asset": "XLF", "display_name_ko": "XLF ETF", "display_name_en": "Financial Select Sector SPDR", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "XLF"},
    {"symbol_code": "XLE", "base_asset": "XLE", "display_name_ko": "XLE ETF", "display_name_en": "Energy Select Sector SPDR", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "XLE"},
    {"symbol_code": "XLV", "base_asset": "XLV", "display_name_ko": "XLV ETF", "display_name_en": "Health Care Select Sector SPDR", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "XLV"},
    {"symbol_code": "SCHD", "base_asset": "SCHD", "display_name_ko": "SCHD ETF", "display_name_en": "Schwab US Dividend Equity ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "SCHD"},
    {"symbol_code": "GDX", "base_asset": "GDX", "display_name_ko": "GDX ETF", "display_name_en": "VanEck Gold Miners ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "GDX"},
    {"symbol_code": "HYG", "base_asset": "HYG", "display_name_ko": "HYG ETF", "display_name_en": "iShares iBoxx High Yield Corporate Bond ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "HYG"},
    {"symbol_code": "AGG", "base_asset": "AGG", "display_name_ko": "AGG ETF", "display_name_en": "iShares Core US Aggregate Bond ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "AGG"},
    {"symbol_code": "VNQ", "base_asset": "VNQ", "display_name_ko": "VNQ ETF", "display_name_en": "Vanguard Real Estate ETF", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "etf", "quote_asset": "USD", "api_code": "VNQ"},
    # ── 신규 원자재(선물) ── api_code = Yahoo Finance 선물 티커 ──
    {"symbol_code": "PLATINUM", "base_asset": "PLATINUM", "display_name_ko": "백금", "display_name_en": "Platinum Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "PL=F"},
    {"symbol_code": "PALLADIUM", "base_asset": "PALLADIUM", "display_name_ko": "팔라듐", "display_name_en": "Palladium Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "PA=F"},
    {"symbol_code": "CORN", "base_asset": "CORN", "display_name_ko": "옥수수", "display_name_en": "Corn Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "ZC=F"},
    {"symbol_code": "WHEAT", "base_asset": "WHEAT", "display_name_ko": "밀", "display_name_en": "Wheat Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "ZW=F"},
    {"symbol_code": "SOYBEAN", "base_asset": "SOYBEAN", "display_name_ko": "대두", "display_name_en": "Soybean Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "ZS=F"},
    {"symbol_code": "COFFEE", "base_asset": "COFFEE", "display_name_ko": "커피", "display_name_en": "Coffee Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "KC=F"},
    {"symbol_code": "SUGAR", "base_asset": "SUGAR", "display_name_ko": "설탕", "display_name_en": "Sugar Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "SB=F"},
    {"symbol_code": "COTTON", "base_asset": "COTTON", "display_name_ko": "면화", "display_name_en": "Cotton Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "CT=F"},
    {"symbol_code": "COCOA", "base_asset": "COCOA", "display_name_ko": "코코아", "display_name_en": "Cocoa Futures", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "CC=F"},
    {"symbol_code": "DXY", "base_asset": "DXY", "display_name_ko": "달러인덱스", "display_name_en": "US Dollar Index", "exchange_id": 4, "exchange_code": "TWELVE_DATA", "asset_class": "commodity", "quote_asset": "USD", "api_code": "DX-Y.NYB"},
)


def get_curated_catalog() -> list[dict[str, str | int]]:
    return [row for row in CURATED_SYMBOLS if str(row.get("symbol_code", "")) not in DELISTED_SYMBOLS]


def _iter_seed_symbols() -> list[tuple[str, int, str]]:
    rows: list[tuple[str, int, str]] = []
    for code, _base, _ko, _en, exchange_id in DEFAULT_SYMBOLS:
        if code in DELISTED_SYMBOLS:
            continue
        rows.append((code, exchange_id, code))
    for item in CURATED_SYMBOLS:
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
        SYMBOL_EXCHANGE[s.symbol_code] = s.exchange_id
        api_code = (s.metadata_ or {}).get("api_code")
        SYMBOL_API_MAP[s.symbol_code] = api_code or s.symbol_code

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


# Binance(crypto) 거래소 식별자. DEFAULT_SYMBOLS / CURATED_SYMBOLS 의 exchange_id 와 일치.
BINANCE_EXCHANGE_ID = 2


def get_binance_symbols() -> list[str]:
    """Binance Futures 수집 대상(crypto) API 심볼만 반환.

    주식/ETF/원자재(TWELVE_DATA, exchange_id=4)는 Binance 에 존재하지 않아
    REST `Invalid symbol`(code -2) / WS `HTTP 400` 을 유발하므로 제외한다.
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


def get_api_symbol(sym: str) -> str:
    """프론트 심볼 → 거래소 API 심볼."""
    return SYMBOL_API_MAP.get(sym, sym)


def get_reverse_api_map() -> dict[str, str]:
    """거래소 API 심볼 → 프론트 심볼 (1000PEPEUSDT → PEPEUSDT)."""
    return {v: k for k, v in SYMBOL_API_MAP.items()}
