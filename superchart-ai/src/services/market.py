"""시장 데이터 서비스 — Binance/Bitget Futures 캔들 fetch (페이지네이션 + 캐시)."""
import httpx
import structlog
from src.services.redis_cache import cache_get, cache_set

BINANCE_BASE = "https://fapi.binance.com"
BINANCE_SPOT_BASE = "https://api.binance.com"
BITGET_BASE = "https://api.bitget.com"
YAHOO_BASE = "https://query1.finance.yahoo.com"
log = structlog.get_logger(__name__)

_http: httpx.AsyncClient | None = None

def _client() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(timeout=15, limits=httpx.Limits(max_connections=20, max_keepalive_connections=10))
    return _http
TF_MAP = {"1m":"1m","3m":"3m","5m":"5m","15m":"15m","30m":"30m","1h":"1h","2h":"2h","4h":"4h","1d":"1d"}
BITGET_TF_MAP = {"1m":"1m","3m":"3m","5m":"5m","15m":"15m","30m":"30m","1h":"1H","2h":"2H","4h":"4H","1d":"1D"}
YAHOO_INTERVAL_MAP = {"1m": "1m", "3m": "5m", "5m": "5m", "15m": "15m", "30m": "30m", "1h": "60m", "2h": "60m", "4h": "60m", "1d": "1d"}
TF_MS = {"1m":60_000,"3m":180_000,"5m":300_000,"15m":900_000,"30m":1_800_000,"1h":3_600_000,"2h":7_200_000,"4h":14_400_000,"1d":86_400_000}
MAX_LIMIT = 10000

_CACHE_TTL = {"1m": 120, "5m": 300, "15m": 600, "1h": 1800, "4h": 3600, "1d": 7200}


async def fetch_candles(symbol_code: str, exchange_id: int, timeframe: str, limit: int, end_time: int | None = None) -> list[dict]:
    """시장 캔들 조회. crypto는 Binance/Bitget, 기타 자산은 Yahoo Finance를 사용."""
    if not symbol_code or len(symbol_code) < 1:
        return []

    limit = min(max(limit, 1), 3000)

    if exchange_id == 4:
        return await _fetch_yahoo_raw(symbol_code, timeframe, limit, end_time)

    # exchange_id == 5: Binance Spot (토큰화 주식/원자재 — NVDABUSDT 등)
    if exchange_id == 5:
        if not end_time:
            key = f"spot:{symbol_code}:{timeframe}:{limit}"
            ttl = _CACHE_TTL.get(timeframe, 60)
            cached = await cache_get("candle", key)
            if cached is not None:
                return cached
            result = await _fetch_spot_raw(symbol_code, timeframe, limit, end_time)
            await cache_set("candle", key, result, ttl)
            return result
        return await _fetch_spot_raw(symbol_code, timeframe, limit, end_time)

    if not end_time:
        key = f"{symbol_code}:{exchange_id}:{timeframe}:{limit}"
        ttl = _CACHE_TTL.get(timeframe, 60)
        cached = await cache_get("candle", key)
        if cached is not None:
            return cached
        result = await _fetch_raw(symbol_code, timeframe, limit, end_time)
        await cache_set("candle", key, result, ttl)
        return result
    return await _fetch_raw(symbol_code, timeframe, limit, end_time)


async def _fetch_raw(symbol_code: str, timeframe: str, limit: int, end_time: int | None = None) -> list[dict]:
    """Binance Futures 원본 호출 + 1회 retry (네트워크 일시 장애 대비).

    retry 정책:
    - HTTP 200이 아니거나 예외 시 0.5초 대기 후 1회 재시도
    - 그래도 실패하면 빈 배열 (호출자 책임 처리)
    - 5xx 에러는 retry, 4xx 는 즉시 실패 (잘못된 요청)
    """
    import asyncio as _asyncio
    interval = TF_MAP.get(timeframe, timeframe)
    limit = min(limit, MAX_LIMIT)
    all_klines = []
    et = end_time

    c = _client()
    while len(all_klines) < limit:
        batch = min(1500, limit - len(all_klines))
        params = {"symbol": symbol_code, "interval": interval, "limit": batch}
        if et:
            params["endTime"] = et

        # 1회 retry with 0.5s backoff
        r = None
        for attempt in range(2):
            try:
                r = await c.get(f"{BINANCE_BASE}/fapi/v1/klines", params=params, timeout=15)
                if r.status_code == 200:
                    break
                # 4xx: 클라이언트 잘못 → retry 무의미
                if 400 <= r.status_code < 500:
                    break
                # 5xx: 서버 일시 장애 → retry
            except Exception:
                pass
            if attempt == 0:
                await _asyncio.sleep(0.5)

        if r is None or r.status_code != 200:
            if r is not None and r.status_code == 451:
                log.warning("market.binance_restricted_bitget_fallback", symbol=symbol_code, timeframe=timeframe)
            break
        data = r.json()
        if not data:
            break
        all_klines = data + all_klines  # 과거 데이터를 앞에 붙임
        if len(data) < batch:
            break
        et = data[0][0] - 1  # 첫 번째 캔들의 openTime - 1ms

    if not all_klines:
        return await _fetch_bitget_raw(symbol_code, timeframe, limit, end_time)

    return [{"openTime": str(k[0]), "closeTime": str(k[6]), "open": k[1], "high": k[2],
             "low": k[3], "close": k[4], "volume": k[5], "isFinal": True} for k in all_klines]


async def _fetch_spot_raw(symbol_code: str, timeframe: str, limit: int, end_time: int | None = None) -> list[dict]:
    """Binance Spot klines 조회 (api.binance.com/api/v3/klines).

    토큰화 주식/원자재(NVDABUSDT, TSLABUSDT, XAUTUSDT 등)는 Spot 시장에만 존재한다.
    응답 포맷은 Futures klines 와 동일. 폴백 없음(Spot 미존재 시 빈 배열).
    """
    import asyncio as _asyncio
    interval = TF_MAP.get(timeframe, timeframe)
    limit = min(limit, MAX_LIMIT)
    all_klines: list = []
    et = end_time
    c = _client()
    while len(all_klines) < limit:
        batch = min(1000, limit - len(all_klines))  # Spot klines 최대 1000
        params = {"symbol": symbol_code, "interval": interval, "limit": batch}
        if et:
            params["endTime"] = et
        r = None
        for attempt in range(2):
            try:
                r = await c.get(f"{BINANCE_SPOT_BASE}/api/v3/klines", params=params, timeout=15)
                if r.status_code == 200:
                    break
                if 400 <= r.status_code < 500:
                    break
            except Exception:
                pass
            if attempt == 0:
                await _asyncio.sleep(0.5)
        if r is None or r.status_code != 200:
            break
        data = r.json()
        if not data:
            break
        all_klines = data + all_klines
        if len(data) < batch:
            break
        et = data[0][0] - 1

    if not all_klines:
        return []
    return [{"openTime": str(k[0]), "closeTime": str(k[6]), "open": k[1], "high": k[2],
             "low": k[3], "close": k[4], "volume": k[5], "isFinal": True} for k in all_klines]


async def fetch_ticker(symbol_code: str) -> dict | None:
    """Fetch a Futures ticker with Binance first and Bitget as regional fallback.

    Frontend realtime expects ``symbol`` and ``last_price``. Binance Futures can
    return HTTP 451 in restricted locations, so ticker delivery must not depend
    only on Binance kline polling.
    """
    if not symbol_code or len(symbol_code) < 2:
        return None
    try:
        from src.services.symbol_resolver import get_api_symbol
        api_symbol = get_api_symbol(symbol_code)
    except Exception:
        api_symbol = symbol_code

    # 1) Binance Futures when available.
    try:
        r = await _client().get(f"{BINANCE_BASE}/fapi/v1/ticker/24hr", params={"symbol": api_symbol}, timeout=8)
        if r.status_code == 200:
            raw = r.json()
            if isinstance(raw, dict) and raw.get("lastPrice"):
                return {
                    "source": "BINANCE",
                    "symbol": symbol_code,
                    "api_symbol": api_symbol,
                    "last_price": str(raw.get("lastPrice")),
                    "open": str(raw.get("openPrice") or raw.get("lastPrice")),
                    "change_24h": str(raw.get("priceChangePercent", "")),
                    "ts": raw.get("closeTime"),
                }
        elif r.status_code == 451:
            log.warning("market.binance_ticker_restricted_bitget_fallback", symbol=symbol_code, api_symbol=api_symbol)
    except Exception as e:
        log.debug("market.binance_ticker_fail", symbol=symbol_code, err=str(e)[:120])

    # 2) Bitget Futures fallback. Its public endpoint works from environments
    # where Binance Futures is geoblocked.
    try:
        r = await _client().get(
            f"{BITGET_BASE}/api/v2/mix/market/ticker",
            params={"symbol": symbol_code, "productType": "USDT-FUTURES"},
            timeout=8,
        )
        raw = r.json()
    except Exception as e:
        log.warning("market.bitget_ticker_fail", symbol=symbol_code, err=str(e)[:160])
        return None
    if r.status_code != 200 or not isinstance(raw, dict) or raw.get("code") != "00000":
        log.warning("market.bitget_ticker_bad_response", symbol=symbol_code, status=r.status_code, body=str(raw)[:200])
        return None
    data = raw.get("data")
    item = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
    if not isinstance(item, dict) or not item.get("lastPr"):
        return None
    return {
        "source": "BITGET",
        "symbol": symbol_code,
        "last_price": str(item.get("lastPr")),
        "open": str(item.get("open24h") or item.get("openUtc") or item.get("lastPr")),
        "change_24h": str(item.get("change24h", "")),
        "ts": item.get("ts") or raw.get("requestTime"),
    }


async def _fetch_bitget_raw(symbol_code: str, timeframe: str, limit: int, end_time: int | None = None) -> list[dict]:
    """Bitget Futures 캔들 fallback.

    Binance Futures가 지역 제한(451) 또는 네트워크 문제로 빈 배열을 반환할 때
    같은 USDT 선물 데이터를 Bitget에서 가져와 프론트가 기대하는 Binance형
    OHLCV 스키마로 정규화한다.
    """
    granularity = BITGET_TF_MAP.get(timeframe)
    if not granularity:
        return []
    params = {
        "symbol": symbol_code,
        "productType": "USDT-FUTURES",
        "granularity": granularity,
        "limit": min(max(limit, 1), 1000),
    }
    if end_time:
        params["endTime"] = end_time
    try:
        r = await _client().get(f"{BITGET_BASE}/api/v2/mix/market/candles", params=params, timeout=15)
        raw = r.json()
    except Exception as e:
        log.warning("market.bitget_candles_fail", symbol=symbol_code, timeframe=timeframe, err=str(e)[:160])
        return []
    if r.status_code != 200 or not isinstance(raw, dict) or raw.get("code") != "00000" or not isinstance(raw.get("data"), list):
        log.warning("market.bitget_candles_bad_response", symbol=symbol_code, status=r.status_code, body=str(raw)[:200])
        return []

    step = TF_MS.get(timeframe, 0)
    rows = sorted(raw["data"], key=lambda k: int(k[0]) if k and str(k[0]).isdigit() else 0)
    candles: list[dict] = []
    for k in rows[-limit:]:
        try:
            open_ts = int(k[0])
            close_ts = open_ts + step - 1 if step else open_ts
            candles.append({
                "openTime": str(open_ts),
                "closeTime": str(close_ts),
                "open": str(k[1]),
                "high": str(k[2]),
                "low": str(k[3]),
                "close": str(k[4]),
                "volume": str(k[5]),
                "isFinal": True,
            })
        except Exception:
            continue
    return candles


async def _fetch_yahoo_raw(symbol_code: str, timeframe: str, limit: int, end_time: int | None = None) -> list[dict]:
    """Yahoo Finance chart API 기반 캔들 조회 (주식/원자재/ETF)."""
    import time

    interval = YAHOO_INTERVAL_MAP.get(timeframe, "1d")
    step_ms = TF_MS.get(timeframe, 86_400_000)

    now_ms = int(time.time() * 1000)
    period2_ms = int(end_time) if end_time else now_ms
    lookback_ms = max(step_ms * (limit + 20), 3_600_000)
    period1_ms = max(period2_ms - lookback_ms, 0)

    params = {
        "interval": interval,
        "period1": str(period1_ms // 1000),
        "period2": str(period2_ms // 1000),
        "includePrePost": "false",
        "events": "div,splits",
    }

    try:
        r = await _client().get(f"{YAHOO_BASE}/v8/finance/chart/{symbol_code}", params=params, timeout=15)
        raw = r.json()
    except Exception as e:
        log.warning("market.yahoo_candles_fail", symbol=symbol_code, timeframe=timeframe, err=str(e)[:160])
        return []

    try:
        result = ((raw or {}).get("chart") or {}).get("result") or []
        if r.status_code != 200 or not result:
            return []

        row = result[0]
        ts = row.get("timestamp") or []
        quote = ((row.get("indicators") or {}).get("quote") or [{}])[0]
        opens = quote.get("open") or []
        highs = quote.get("high") or []
        lows = quote.get("low") or []
        closes = quote.get("close") or []
        vols = quote.get("volume") or []

        candles: list[dict] = []
        for i, t in enumerate(ts):
            if i >= len(opens) or i >= len(highs) or i >= len(lows) or i >= len(closes):
                continue
            o = opens[i]
            h = highs[i]
            l = lows[i]
            c = closes[i]
            v = vols[i] if i < len(vols) else 0
            if o is None or h is None or l is None or c is None:
                continue
            open_ts = int(t) * 1000
            close_ts = open_ts + step_ms - 1
            candles.append({
                "openTime": str(open_ts),
                "closeTime": str(close_ts),
                "open": str(o),
                "high": str(h),
                "low": str(l),
                "close": str(c),
                "volume": str(v or 0),
                "isFinal": True,
            })

        return candles[-limit:]
    except Exception as e:
        log.warning("market.yahoo_parse_fail", symbol=symbol_code, err=str(e)[:160])
        return []
