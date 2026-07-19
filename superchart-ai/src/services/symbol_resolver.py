"""심볼 해석 유틸리티 — DB 기반 (TTL 5분 자동 갱신)."""
import asyncio
import time
import structlog

logger = structlog.get_logger(__name__)

# ══════════════════════════════════════════════════════════════════════════
# BitMart TradFi 분류 (방식 C)
# BitMart /contract/public/details 응답에는 asset_class 필드가 없다. 따라서
# 금속(metal)/외환(forex)/지수(index)/원자재(commodity)/주식(stock) 을 명시적
# 화이트리스트로 분류한다. 목록에 없으면 crypto 로 간주한다.
#   값: symbol_code -> (asset_class, 한글명, 영문명)
# ══════════════════════════════════════════════════════════════════════════
# ══════════════════════════════════════════════════════════════════════════
# BitMart TradFi 분류 (방식 C)
# BitMart /contract/public/details 응답의 `tradfi_info.market_group` 을 1차 신호로
# 사용한다(공식 필드). market_group 이 없는(null) 금속/원자재는 명시적 심볼셋으로
# 보완한다. 최종 asset_class: crypto/stock/metal/forex/index/commodity/preipo.
# ══════════════════════════════════════════════════════════════════════════

# 실제 '지수' 상품(개별주가 아님). BitMart 는 국가 지수를 INDEX_XX 그룹에 개별주와
# 섞어 넣으므로, 진짜 지수 티커만 별도로 지정한다.
_BM_INDEX_SYMBOLS: dict[str, tuple[str, str]] = {
    "SPX500USDT": ("S&P 500", "S&P 500 Index"),
    "SPXUSDT":    ("S&P 500", "S&P 500"),
    "NAS100USDT": ("나스닥 100", "Nasdaq 100"),
    "US30USDT":   ("다우존스 30", "Dow Jones 30"),
    "US2000USDT": ("러셀 2000", "Russell 2000"),
    "US500USDT":  ("S&P 500", "US 500"),
    "US100USDT":  ("나스닥 100", "US 100"),
    "VIXUSDT":    ("변동성 지수(VIX)", "Volatility Index"),
    "GER40USDT":  ("독일 DAX 40", "Germany DAX 40"),
    "UK100USDT":  ("영국 FTSE 100", "UK 100"),
    "HK50USDT":   ("홍콩 항셍 50", "Hong Kong 50"),
    "JPN225USDT": ("일본 닛케이 225", "Japan 225"),
    "AUS200USDT": ("호주 ASX 200", "Australia 200"),
    "TW88USDT":   ("대만 가권 지수", "Taiwan Index"),
    "KR200USDT":  ("한국 코스피 200", "Korea 200"),
}

# 귀금속/산업금속 (metal). null market_group 포함.
_BM_METAL_SYMBOLS: dict[str, tuple[str, str]] = {
    "XAUUSDT":  ("금", "Gold"),
    "XAUTUSDT": ("금 (테더골드)", "Tether Gold"),
    "PAXGUSDT": ("금 (팍스골드)", "PAX Gold"),
    "XAGUSDT":  ("은", "Silver"),
    "SLVONUSDT":("은 (iShares Silver Trust)", "iShares Silver Trust"),
    "XPTUSDT":  ("백금", "Platinum"),
    "XPDUSDT":  ("팔라듐", "Palladium"),
    "XPBUSDT":  ("납", "Lead"),
    "XNIUSDT":  ("니켈", "Nickel"),
    "XCUUSDT":  ("구리", "Copper"),
    "XALUSDT":  ("알루미늄", "Aluminum"),
    "COPPERUSDT": ("구리", "Copper"),
}

# 에너지/원자재 (commodity). null market_group 포함.
_BM_COMMODITY_SYMBOLS: dict[str, tuple[str, str]] = {
    "CLUSDT":   ("WTI 원유", "WTI Crude Oil"),
    "XTIUSDT":  ("WTI 원유", "WTI Crude Oil"),
    "BZUSDT":   ("브렌트유", "Brent Oil"),
    "XBRUSDT":  ("브렌트유", "Brent Oil"),
    "NGASUSDT": ("천연가스", "Natural Gas (Henry Hub)"),
}

# 주요 종목 한글명(선택적 보강 — 없으면 base 코드 노출). 자동분류가 우선.
_BM_STOCK_NAMES: dict[str, tuple[str, str]] = {
    "AAPLUSDT": ("애플", "Apple"), "AAPLXUSDT": ("애플", "Apple"),
    "TSLAUSDT": ("테슬라", "Tesla"), "TSLAXUSDT": ("테슬라", "Tesla"),
    "NVDAUSDT": ("엔비디아", "NVIDIA"), "NVDAXUSDT": ("엔비디아", "NVIDIA"),
    "MSFTUSDT": ("마이크로소프트", "Microsoft"),
    "AMZNUSDT": ("아마존", "Amazon"), "AMZNXUSDT": ("아마존", "Amazon"),
    "GOOGLUSDT": ("알파벳", "Alphabet"), "GOOGLXUSDT": ("알파벳", "Alphabet"),
    "METAUSDT": ("메타", "Meta Platforms"), "METAXUSDT": ("메타", "Meta Platforms"),
    "COINUSDT": ("코인베이스", "Coinbase"), "COINXUSDT": ("코인베이스", "Coinbase"),
    "MSTRUSDT": ("스트래티지", "Strategy"), "MSTRXUSDT": ("스트래티지", "Strategy"),
    "HOODUSDT": ("로빈후드", "Robinhood"), "HOODXUSDT": ("로빈후드", "Robinhood"),
    "CRCLUSDT": ("서클", "Circle"), "CRCLXUSDT": ("서클", "Circle"),
    "ORCLUSDT": ("오라클", "Oracle"), "ORCLXUSDT": ("오라클", "Oracle"),
    "PLTRUSDT": ("팔란티어", "Palantir"), "PLTRXUSDT": ("팔란티어", "Palantir"),
    "NFLXUSDT": ("넷플릭스", "Netflix"), "AMDUSDT": ("AMD", "Advanced Micro Devices"),
    "INTCUSDT": ("인텔", "Intel"), "MUUSDT": ("마이크론", "Micron"),
    "SNDKUSDT": ("샌디스크", "SanDisk"), "CRWVUSDT": ("코어위브", "CoreWeave"),
    "BABAUSDT": ("알리바바", "Alibaba"), "NIOUSDT": ("니오", "NIO"),
    "JDUSDT": ("징둥닷컴", "JD.com"), "PDDUSDT": ("핀둬둬", "PDD Holdings"),
    "SAMSUNGUSDT": ("삼성전자", "Samsung Electronics"),
    "SKHYNIXUSDT": ("SK하이닉스", "SK Hynix"),
    "HYUNDAIUSDT": ("현대차", "Hyundai Motor"),
    "TENCENTUSDT": ("텐센트", "Tencent"), "XIAOMIUSDT": ("샤오미", "Xiaomi"),
    "MEITUANUSDT": ("메이퇀", "Meituan"), "SPCXUSDT": ("스페이스X", "SpaceX (Pre-IPO)"),
    "SPACEXUSDT": ("스페이스X", "SpaceX (Pre-IPO)"), "OPENAIUSDT": ("오픈AI", "OpenAI (Pre-IPO)"),
    "ANTHROPICUSDT": ("앤스로픽", "Anthropic (Pre-IPO)"), "SOFTBANKUSDT": ("소프트뱅크", "SoftBank"),
    "GLDUSDT": ("금 ETF", "SPDR Gold Shares"), "GDXUSDT": ("금광업 ETF", "VanEck Gold Miners ETF"),
    "SOXXUSDT": ("반도체 ETF", "iShares Semiconductor ETF"),
    "TQQQUSDT": ("나스닥100 3배 ETF", "ProShares UltraPro QQQ"),
    "QQQXUSDT": ("나스닥 100 ETF", "Invesco QQQ"), "SPYXUSDT": ("S&P 500 ETF", "SPDR S&P 500 ETF"),
}

# 외환 표시명
_BM_FOREX_NAMES: dict[str, tuple[str, str]] = {
    "EURUSDT": ("유로/달러", "EUR/USD"),
    "GBPUSDT": ("파운드/달러", "GBP/USD"),
    "JPYUSDT": ("엔/달러", "JPY/USD"),
    "AUDUSDT": ("호주달러/달러", "AUD/USD"),
    "CADUSDT": ("캐나다달러/달러", "CAD/USD"),
    "CHFUSDT": ("스위스프랑/달러", "CHF/USD"),
    "TRYUSDT": ("터키리라/달러", "TRY/USD"),
    "BRLUSDT": ("브라질헤알/달러", "BRL/USD"),
}

# market_group → 상위 asset_class (지수/금속/원자재는 세부 심볼셋이 우선)
_MARKET_GROUP_CLASS: dict[str, str] = {
    "US_MARKET": "stock", "HK_STOCK": "stock",
    "INDEX_KR": "stock", "INDEX_JP": "stock", "INDEX_HK": "stock",
    "INDEX_UK": "stock", "INDEX_DE": "stock", "INDEX_TW": "stock", "INDEX_AU": "stock",
    "FOREX": "forex",
    "METAL_LME": "metal",
    "COMMODITY_CME": "commodity", "COMMODITY_ICE": "commodity",
    "PRE_LIST": "preipo",
}


def classify_bitmart_symbol(symbol_code: str, market_group: str | None = None) -> tuple[str, str | None, str | None]:
    """BitMart 심볼 → (asset_class, 한글명, 영문명).

    우선순위:
      1) 명시적 지수/금속/원자재 심볼셋 (정식 이름 포함)
      2) tradfi_info.market_group 매핑
      3) crypto (기본)
    """
    from src.services.bitmart_names import EXTRA_STOCK_NAMES
    code = (symbol_code or "").upper()
    if code in _BM_INDEX_SYMBOLS:
        ko, en = _BM_INDEX_SYMBOLS[code]
        return "index", ko, en
    if code in _BM_METAL_SYMBOLS:
        ko, en = _BM_METAL_SYMBOLS[code]
        return "metal", ko, en
    if code in _BM_COMMODITY_SYMBOLS:
        ko, en = _BM_COMMODITY_SYMBOLS[code]
        return "commodity", ko, en

    def _stock_name():
        if code in _BM_STOCK_NAMES:
            return _BM_STOCK_NAMES[code]
        if code in EXTRA_STOCK_NAMES:
            return EXTRA_STOCK_NAMES[code]
        return (None, None)

    if market_group:
        ac = _MARKET_GROUP_CLASS.get(market_group)
        if ac == "forex":
            ko, en = _BM_FOREX_NAMES.get(code, (None, None))
            return ac, ko, en
        if ac:
            ko, en = _stock_name()
            return ac, ko, en
    # market_group 없이도 알려진 주식이면 stock
    ko, en = _stock_name()
    if ko or en:
        return "stock", ko, en
    return "crypto", None, None



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
    # 워치리스트에 실시간 가격(ticker-24hr)이 잡히지 않는 토큰화 주식 — 목록에서 제외.
    # (일반 티커 피드에 없어 가격 미표시 → 사용자 혼란. 2026-07 정리)
    "ABBV", "BBXUSDT", "DHR", "DISUSDT", "HDUSDT", "KO", "MA", "MCD",
    "NFLX", "NOKUSDT", "NVOUSDT", "PAYPUSDT", "PEP", "QNTXUSDT", "UBERUSDT", "UNH",
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

# ── xStocks(Backed Finance 토큰화 증권) 화이트리스트 ───────────────
# Solana 기반 토큰화 주식. Binance 에는 없고 Gate.io/Bybit 등에서 거래된다.
# 명명: base = "{CORE}X" (예: AAPLX), 견적 USDT. 일반 코인과 X 접미사가
# 겹치므로 알려진 주식 티커만 화이트리스트로 관리하고 실제 상장 여부는
# 거래소 API 의 거래상태로 자동 판별한다.
#   key   = core 티커(미국 주식/ETF), value = (한글명, 영문명, asset_class)
# Binance bStocks 와 중복되는 종목(NVDA/TSLA/CRCL/COIN)은 bStocks 우선이므로
# 등록 시 자동 제외된다.
XSTOCKS_CATALOG: dict[str, tuple[str, str, str]] = {
    "AAPL":  ("애플", "Apple", "stock"),
    "MSFT":  ("마이크로소프트", "Microsoft", "stock"),
    "AMZN":  ("아마존", "Amazon", "stock"),
    "GOOGL": ("알파벳", "Alphabet", "stock"),
    "META":  ("메타", "Meta Platforms", "stock"),
    "NVDA":  ("엔비디아", "NVIDIA", "stock"),
    "TSLA":  ("테슬라", "Tesla", "stock"),
    "COIN":  ("코인베이스", "Coinbase", "stock"),
    "MSTR":  ("스트래티지", "Strategy", "stock"),
    "HOOD":  ("로빈후드", "Robinhood", "stock"),
    "CRCL":  ("서클", "Circle", "stock"),
    "MCD":   ("맥도날드", "McDonald's", "stock"),
    "KO":    ("코카콜라", "Coca-Cola", "stock"),
    "PEP":   ("펩시코", "PepsiCo", "stock"),
    "AVGO":  ("브로드컴", "Broadcom", "stock"),
    "LLY":   ("일라이 릴리", "Eli Lilly", "stock"),
    "UNH":   ("유나이티드헬스", "UnitedHealth", "stock"),
    "ABBV":  ("애브비", "AbbVie", "stock"),
    "CSCO":  ("시스코", "Cisco", "stock"),
    "DHR":   ("다나허", "Danaher", "stock"),
    "HD":    ("홈디포", "Home Depot", "stock"),
    "MA":    ("마스터카드", "Mastercard", "stock"),
    "NFLX":  ("넷플릭스", "Netflix", "stock"),
    "WMT":   ("월마트", "Walmart", "stock"),
    "SPY":   ("S&P 500 ETF", "SPDR S&P 500 ETF", "etf"),
    "QQQ":   ("나스닥 100 ETF", "Invesco QQQ", "etf"),
}

# exchangeInfo 자동감지로 채워지는 동적 xStocks 카탈로그(런타임)
_DYNAMIC_XSTOCKS: list[dict[str, str | int]] = []

# ── Bitget 토큰화 주식(ON 접미사) 화이트리스트 ───────────────────────
# Bitget 의 토큰화 주식은 base 가 "{CORE}ON" 형식(예: TSLAON, NVDAON). USDT 견적.
# 실제 상장 여부는 Bitget spot symbols API(status='online')로 자동 판별.
#   key = core 티커, value = (한글명, 영문명, asset_class)
# Binance bStocks / xStocks 와 core 가 겹치면 그쪽 우선(등록 시 제외) — symbols.py
# dedup 이 명칭 기준으로 한 번 더 통합하므로 중복 노출은 발생하지 않음.
BITGET_STOCKS_CATALOG: dict[str, tuple[str, str, str]] = {
    "AAPL":  ("애플", "Apple", "stock"),
    "MSFT":  ("마이크로소프트", "Microsoft", "stock"),
    "AMZN":  ("아마존", "Amazon", "stock"),
    "GOOGL": ("알파벳", "Alphabet", "stock"),
    "META":  ("메타", "Meta Platforms", "stock"),
    "NVDA":  ("엔비디아", "NVIDIA", "stock"),
    "TSLA":  ("테슬라", "Tesla", "stock"),
    "AMD":   ("AMD", "Advanced Micro Devices", "stock"),
    "SPY":   ("S&P 500 ETF", "SPDR S&P 500 ETF", "etf"),
    "QQQ":   ("나스닥 100 ETF", "Invesco QQQ", "etf"),
}
# exchangeInfo 자동감지로 채워지는 동적 Bitget 토큰화 주식 카탈로그(런타임)
_DYNAMIC_BITGET_STOCKS: list[dict[str, str | int]] = []
_bitget_stocks_last_refresh: float = 0.0


def _curated_all() -> list[dict[str, str | int]]:
    """정적 CURATED + 동적 Spot(bStocks/원자재) + 동적 xStocks + 동적 Bitget 주식 합본."""
    return list(CURATED_SYMBOLS) + list(_DYNAMIC_SPOT) + list(_DYNAMIC_XSTOCKS) + list(_DYNAMIC_BITGET_STOCKS)


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
        # 방식 C: 모든 데이터는 BitMart Futures. DB 심볼은 BTCUSDT 포맷이 동일하므로
        # 그대로 사용한다(exchange_id 무관하게 crypto/토큰화주식 전부 BitMart 계약으로 조회).
        SYMBOL_EXCHANGE[s.symbol_code] = s.exchange_id
        api_code = (s.metadata_ or {}).get("api_code")
        SYMBOL_API_MAP[s.symbol_code] = api_code or s.symbol_code

    # 방식 C: Binance Spot / Gate / Bybit / Bitget 등 타 거래소 동적 목록 갱신은
    # 사용하지 않는다(BitMart 일원화). BitMart 계약 목록(TradFi Stocks 포함)은
    # api/symbols.py 의 _fetch_live_crypto_rows() 가 담당한다.

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
XSTOCKS_EXCHANGE_ID = 6  # Gate.io/Bybit 토큰화 증권(xStocks)
BITGET_STOCKS_EXCHANGE_ID = 7  # Bitget 토큰화 주식(ON 접미사)
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


# ── xStocks(Gate.io 주소스 + Bybit 폴백) 동적 로더 ──────────────────
_GATE_PAIRS_URL = "https://api.gateio.ws/api/v4/spot/currency_pairs"
_BYBIT_SPOT_URL = "https://api.bybit.com/v5/market/instruments-info?category=spot"
_xstocks_last_refresh: float = 0.0


def _existing_spot_codes() -> set[str]:
    """이미 등록된 Binance Spot(bStocks/원자재) symbol_code 집합 — xStocks 중복 제거용."""
    return {str(i.get("symbol_code", "")) for i in _DYNAMIC_SPOT}


async def _fetch_gate_xstocks() -> set[str]:
    """Gate.io 에서 거래가능(tradable)한 xStocks core 티커 집합 반환."""
    import httpx
    out: set[str] = set()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(_GATE_PAIRS_URL)
    if r.status_code != 200:
        return out
    for p in r.json():
        if p.get("quote") != "USDT" or p.get("trade_status") != "tradable":
            continue
        base = str(p.get("base", ""))
        if base.endswith("X") and base[:-1] in XSTOCKS_CATALOG:
            out.add(base[:-1])
    return out


async def _fetch_bybit_xstocks() -> set[str]:
    """Bybit 에서 거래중(Trading)인 xStocks core 티커 집합 반환."""
    import httpx
    out: set[str] = set()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(_BYBIT_SPOT_URL)
    if r.status_code != 200:
        return out
    for it in r.json().get("result", {}).get("list", []):
        if it.get("quoteCoin") != "USDT" or it.get("status") != "Trading":
            continue
        base = str(it.get("baseCoin", ""))
        if base.endswith("X") and base[:-1] in XSTOCKS_CATALOG:
            out.add(base[:-1])
    return out


async def refresh_xstocks_listings(force: bool = False) -> int:
    """Gate.io(주) + Bybit(폴백) 에서 거래중인 xStocks 만 동적 등록.

    - api_code 는 "{source}:{pair}" 형식으로 저장(예: GATE:AAPLX_USDT).
      Gate 우선, 없으면 Bybit.
    - Binance bStocks 와 symbol_code 가 겹치면 bStocks 우선(제외).
    - 실패해도 기존 _DYNAMIC_XSTOCKS 유지.
    """
    global _DYNAMIC_XSTOCKS, _xstocks_last_refresh
    now = time.time()
    if not force and (now - _xstocks_last_refresh) < _SPOT_REFRESH_TTL and _DYNAMIC_XSTOCKS:
        return len(_DYNAMIC_XSTOCKS)

    try:
        gate = await _fetch_gate_xstocks()
    except Exception as e:
        logger.warning("symbol_resolver.xstocks_gate_failed", error=str(e)[:160])
        gate = set()
    try:
        bybit = await _fetch_bybit_xstocks()
    except Exception as e:
        logger.warning("symbol_resolver.xstocks_bybit_failed", error=str(e)[:160])
        bybit = set()

    if not gate and not bybit:
        return len(_DYNAMIC_XSTOCKS)

    taken = _existing_spot_codes()  # bStocks 우선 중복 제거
    new_x: list[dict[str, str | int]] = []
    for core in XSTOCKS_CATALOG:
        if core in taken:  # Binance bStocks 에 이미 있으면 스킵
            continue
        ko, en, asset_class = XSTOCKS_CATALOG[core]
        if core in gate:
            api = f"GATE:{core}X_USDT"
        elif core in bybit:
            api = f"BYBIT:{core}XUSDT"
        else:
            continue  # 어느 거래소에서도 거래 안 함
        new_x.append({
            "symbol_code": core, "base_asset": core,
            "display_name_ko": ko, "display_name_en": en,
            "exchange_id": XSTOCKS_EXCHANGE_ID, "exchange_code": "XSTOCKS",
            "asset_class": asset_class, "quote_asset": "USDT", "api_code": api,
        })

    _DYNAMIC_XSTOCKS = new_x
    _xstocks_last_refresh = now
    logger.info(
        "symbol_resolver.xstocks_refreshed",
        count=len(new_x),
        codes=[str(i["symbol_code"]) for i in new_x],
    )
    return len(new_x)


def get_xstocks_symbols() -> list[tuple[str, str]]:
    """등록된 xStocks 의 (symbol_code, api_code) 목록. api_code 는 GATE:/BYBIT: prefix 포함."""
    return [(str(i["symbol_code"]), str(i["api_code"])) for i in _DYNAMIC_XSTOCKS]


# ── Bitget 토큰화 주식(ON) 동적 등록 ──────────────────────────────
_BITGET_SPOT_SYMBOLS_URL = "https://api.bitget.com/api/v2/spot/public/symbols"


async def _fetch_bitget_stocks() -> set[str]:
    """Bitget 에서 거래중(online)인 토큰화 주식 core 티커 집합 반환.

    Bitget base 는 '{CORE}ON' 형식(예: TSLAON). USDT 견적 + status=='online' 만.
    """
    import httpx
    out: set[str] = set()
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(_BITGET_SPOT_SYMBOLS_URL)
    if r.status_code != 200:
        return out
    for it in r.json().get("data", []):
        base = str(it.get("baseCoin", "")).upper()
        if it.get("quoteCoin", "").upper() != "USDT" or it.get("status") != "online":
            continue
        if base.endswith("ON") and base[:-2] in BITGET_STOCKS_CATALOG:
            out.add(base[:-2])
    return out


async def refresh_bitget_stocks_listings(force: bool = False) -> int:
    """Bitget 에서 거래중인 토큰화 주식만 동적 등록.

    - api_code = "{CORE}ONUSDT" (예: TSLAONUSDT). exchange_id = 7.
    - Binance bStocks / xStocks 와 core 가 겹치면 그쪽 우선(제외).
    - 실패해도 기존 _DYNAMIC_BITGET_STOCKS 유지.
    """
    global _DYNAMIC_BITGET_STOCKS, _bitget_stocks_last_refresh
    now = time.time()
    if not force and (now - _bitget_stocks_last_refresh) < _SPOT_REFRESH_TTL and _DYNAMIC_BITGET_STOCKS:
        return len(_DYNAMIC_BITGET_STOCKS)
    try:
        online = await _fetch_bitget_stocks()
    except Exception as e:
        logger.warning("symbol_resolver.bitget_stocks_failed", error=str(e)[:160])
        return len(_DYNAMIC_BITGET_STOCKS)
    if not online:
        return len(_DYNAMIC_BITGET_STOCKS)
    # bStocks(Binance Spot) + 기존 동적 xStocks 에 이미 있는 core 는 제외(중복 방지)
    taken = _existing_spot_codes() | {str(i["symbol_code"]) for i in _DYNAMIC_XSTOCKS}
    new_b: list[dict[str, str | int]] = []
    for core in BITGET_STOCKS_CATALOG:
        if core in taken or core not in online:
            continue
        ko, en, asset_class = BITGET_STOCKS_CATALOG[core]
        new_b.append({
            "symbol_code": core, "base_asset": core,
            "display_name_ko": ko, "display_name_en": en,
            "exchange_id": BITGET_STOCKS_EXCHANGE_ID, "exchange_code": "BITGET",
            "asset_class": asset_class, "quote_asset": "USDT", "api_code": f"{core}ONUSDT",
        })
    _DYNAMIC_BITGET_STOCKS = new_b
    _bitget_stocks_last_refresh = now
    logger.info("symbol_resolver.bitget_stocks_refreshed", count=len(new_b),
                codes=[str(i["symbol_code"]) for i in new_b])
    return len(new_b)


def get_bitget_stocks_symbols() -> list[tuple[str, str]]:
    """등록된 Bitget 토큰화 주식의 (symbol_code, api_code) 목록. api_code = '{CORE}ONUSDT'."""
    return [(str(i["symbol_code"]), str(i["api_code"])) for i in _DYNAMIC_BITGET_STOCKS]


def get_api_symbol(sym: str) -> str:
    """프론트 심볼 → 거래소 API 심볼."""
    return SYMBOL_API_MAP.get(sym, sym)


def get_reverse_api_map() -> dict[str, str]:
    """거래소 API 심볼 → 프론트 심볼 (1000PEPEUSDT → PEPEUSDT)."""
    return {v: k for k, v in SYMBOL_API_MAP.items()}
