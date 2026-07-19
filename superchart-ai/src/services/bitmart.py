"""BitMart USD-M Futures V2 공개 시장데이터 클라이언트.

방식 C: 모든 시세 데이터 소스를 BitMart Futures로 일원화한다.
- 심볼 포맷은 Binance와 동일(BTCUSDT). 별도 매핑 불필요.
- 공개(public) 엔드포인트만 사용하므로 API 키가 필요 없다.
- 프론트엔드는 기존 Binance형 스키마를 기대하므로, 응답을 그대로 정규화한다.

Base URL: https://api-cloud-v2.bitmart.com
Endpoints (모두 public/NONE):
- GET /contract/public/kline           캔들 (step=분, start_time/end_time=초, 최대 500/요청)
- GET /contract/public/details         계약 상세 목록 = 심볼목록 + 24h 티커(last/high/low/change/volume)
- GET /contract/public/funding-rate    현재 펀딩비
- GET /contract/public/open-interest   현재 미결제약정(히스토리 없음)
"""
import asyncio
import time
import httpx
import structlog

log = structlog.get_logger(__name__)

BITMART_BASE = "https://api-cloud-v2.bitmart.com"

# 우리 timeframe → BitMart kline step(분 단위)
TF_STEP_MIN = {
    "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
    "1h": 60, "2h": 120, "4h": 240, "1d": 1440, "1w": 10080,
}
# timeframe → 밀리초 (closeTime 계산용)
TF_MS = {
    "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
    "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "1d": 86_400_000, "1w": 604_800_000,
}
_KLINE_MAX = 500  # BitMart 단일 요청 최대 캔들 수

_http: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(
            timeout=15,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http


async def fetch_candles(symbol: str, timeframe: str, limit: int, end_time: int | None = None) -> list[dict]:
    """BitMart Futures 캔들 조회 → Binance형 OHLCV 스키마로 정규화.

    Args:
        symbol: 계약 심볼 (예: BTCUSDT)
        timeframe: 1m/3m/5m/15m/30m/1h/2h/4h/1d/1w
        limit: 요청 캔들 수 (내부적으로 500개씩 페이지네이션)
        end_time: 종료 시각(ms epoch). None이면 현재까지.

    Returns:
        [{openTime, closeTime, open, high, low, close, volume, isFinal}, ...] (과거→최신)
    """
    if not symbol or len(symbol) < 2:
        return []
    step = TF_STEP_MIN.get(timeframe)
    if not step:
        return []
    step_ms = TF_MS.get(timeframe, step * 60_000)
    step_sec = step_ms // 1000
    limit = min(max(limit, 1), 3000)

    # end_time(ms) 기준으로 뒤에서부터 500개씩 채운다.
    end_ms = int(end_time) if end_time else int(time.time() * 1000)
    all_rows: list[dict] = []
    c = _client()

    # 최대 페이지 수 방어 (limit/500 + 여유)
    max_pages = (limit // _KLINE_MAX) + 2
    for _ in range(max_pages):
        if len(all_rows) >= limit:
            break
        want = min(_KLINE_MAX, limit - len(all_rows))
        cur_end_sec = end_ms // 1000
        cur_start_sec = cur_end_sec - step_sec * want
        params = {
            "symbol": symbol,
            "step": step,
            "start_time": cur_start_sec,
            "end_time": cur_end_sec,
        }
        rows = None
        for attempt in range(2):
            try:
                r = await c.get(f"{BITMART_BASE}/contract/public/kline", params=params, timeout=15)
                if r.status_code == 200:
                    body = r.json()
                    if isinstance(body, dict) and body.get("code") == 1000:
                        rows = body.get("data") or []
                        break
                    # code != 1000 → 잘못된 심볼/파라미터: 재시도 무의미
                    log.debug("bitmart.kline_bad_code", symbol=symbol, body=str(body)[:160])
                    rows = []
                    break
                if 400 <= r.status_code < 500:
                    rows = []
                    break
            except Exception as e:
                log.debug("bitmart.kline_fail", symbol=symbol, err=str(e)[:120])
            if attempt == 0:
                await asyncio.sleep(0.5)
        if not rows:
            break
        # 정규화 후 앞에 붙임(과거 데이터가 앞)
        page = _normalize_klines(rows, step_ms)
        if not page:
            break
        all_rows = page + all_rows
        # 다음 페이지는 이번 배치의 첫 캔들 직전까지
        earliest_open_ms = int(page[0]["openTime"])
        new_end_ms = earliest_open_ms - 1
        if new_end_ms >= end_ms:
            break
        end_ms = new_end_ms
        if len(page) < want:
            # 더 이상 과거 데이터 없음
            break

    # 중복 제거(openTime 기준) + 정렬 + 마지막 limit개
    dedup: dict[str, dict] = {}
    for row in all_rows:
        dedup[row["openTime"]] = row
    out = sorted(dedup.values(), key=lambda x: int(x["openTime"]))
    return out[-limit:]


def _normalize_klines(rows: list, step_ms: int) -> list[dict]:
    """BitMart kline data(list) → Binance형 OHLCV.

    BitMart 항목: {timestamp(sec), open_price, close_price, high_price, low_price, volume}
    """
    out: list[dict] = []
    for k in rows:
        try:
            if isinstance(k, dict):
                ts = int(k.get("timestamp", 0))
                o = k.get("open_price"); h = k.get("high_price")
                l = k.get("low_price"); cl = k.get("close_price")
                v = k.get("volume")
            else:
                # 방어: list 형태 응답 대비
                ts = int(k[0]); o, h, l, cl, v = k[1], k[3], k[4], k[2], k[5]
            open_ms = ts * 1000
            out.append({
                "openTime": str(open_ms),
                "closeTime": str(open_ms + step_ms - 1),
                "open": str(o), "high": str(h), "low": str(l), "close": str(cl),
                "volume": str(v if v is not None else 0),
                "isFinal": True,
            })
        except (KeyError, IndexError, ValueError, TypeError):
            continue
    return out


async def fetch_details(symbol: str = "") -> list[dict]:
    """계약 상세 목록 조회. symbol 없으면 전체.

    Returns: BitMart symbols 배열 (각 항목: symbol, base_currency, quote_currency,
             last_price, high_24h, low_24h, change_24h, volume_24h, turnover_24h, status ...)
    """
    params = {"symbol": symbol} if symbol else {}
    try:
        r = await _client().get(f"{BITMART_BASE}/contract/public/details", params=params, timeout=10)
        body = r.json()
    except Exception as e:
        log.warning("bitmart.details_fail", symbol=symbol, err=str(e)[:160])
        return []
    if r.status_code != 200 or not isinstance(body, dict) or body.get("code") != 1000:
        log.warning("bitmart.details_bad", symbol=symbol, status=r.status_code, body=str(body)[:200])
        return []
    data = body.get("data") or {}
    return data.get("symbols") or []


def _detail_to_binance_ticker(row: dict) -> dict:
    """BitMart 계약 상세 1건 → Binance fapi 24hr ticker 형태로 정규화.

    change_24h는 소수(0.004 = 0.4%). openPrice는 last/(1+change)로 역산.
    """
    def _f(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    sym = str(row.get("symbol", ""))
    last = _f(row.get("last_price"))
    high = _f(row.get("high_24h"))
    low = _f(row.get("low_24h"))
    change = _f(row.get("change_24h"))  # 소수 비율
    pct = change * 100.0
    openp = last / (1.0 + change) if (1.0 + change) != 0 else last

    def _fmt(v):
        if v == 0:
            return "0"
        return f"{v:.12f}".rstrip("0").rstrip(".")

    ts = int(row.get("open_timestamp", 0) or 0)
    now_ms = int(time.time() * 1000)
    return {
        "symbol": sym,
        "priceChange": _fmt(last - openp),
        "priceChangePercent": f"{pct:.3f}",
        "weightedAvgPrice": _fmt(openp),
        "lastPrice": _fmt(last),
        "lastQty": "0",
        "openPrice": _fmt(openp),
        "highPrice": _fmt(high),
        "lowPrice": _fmt(low),
        "volume": str(row.get("volume_24h") or 0),
        "quoteVolume": str(row.get("turnover_24h") or 0),
        "openTime": now_ms - 86_400_000,
        "closeTime": now_ms,
        "firstId": 0, "lastId": 0, "count": 0,
    }


async def fetch_ticker(symbol: str) -> dict | None:
    """단일 심볼의 실시간 티커 → {source, symbol, last_price, open, change_24h, ts}.

    프론트 realtime은 symbol/last_price 를 기대한다.
    """
    if not symbol or len(symbol) < 2:
        return None
    rows = await fetch_details(symbol)
    if not rows:
        return None
    row = rows[0] if isinstance(rows, list) else rows
    if not isinstance(row, dict) or not row.get("last_price"):
        return None

    def _f(v):
        try:
            return float(v)
        except (TypeError, ValueError):
            return 0.0

    last = _f(row.get("last_price"))
    change = _f(row.get("change_24h"))
    openp = last / (1.0 + change) if (1.0 + change) != 0 else last
    return {
        "source": "BITMART",
        "symbol": symbol,
        "api_symbol": symbol,
        "last_price": str(row.get("last_price")),
        "open": str(openp),
        "change_24h": f"{change * 100.0:.3f}",
        "ts": int(time.time() * 1000),
    }


async def ticker_24hr(symbol: str = "") -> dict | list:
    """Binance fapi 24hr 호환 응답. symbol 지정 시 dict, 없으면 list."""
    rows = await fetch_details(symbol)
    if symbol:
        if not rows:
            return {"code": -1, "msg": "bitmart: symbol not found"}
        return _detail_to_binance_ticker(rows[0])
    return [_detail_to_binance_ticker(r) for r in rows if isinstance(r, dict)]


async def fetch_contract_symbols() -> list[dict]:
    """거래중(status=Trading)인 USDT 무기한 계약 목록.

    Returns: [{symbol, base, quote, api_code}, ...]
    """
    rows = await fetch_details("")
    out: list[dict] = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        # USDT 무기한(perpetual, product_type=1)만
        if str(r.get("quote_currency", "")).upper() != "USDT":
            continue
        try:
            if int(r.get("product_type", 1)) != 1:
                continue
        except (TypeError, ValueError):
            pass
        status = str(r.get("status", "")).lower()
        if status and status != "trading":
            continue
        sym = str(r.get("symbol", "")).upper()
        base = str(r.get("base_currency", "")).upper()
        if not sym or not base:
            continue
        out.append({
            "symbol": sym,
            "base_asset": base,
            "quote_asset": "USDT",
            "api_code": sym,
        })
    return out


async def fetch_funding_rate(symbol: str) -> float:
    """현재 펀딩비(소수). 실패 시 0.0."""
    try:
        r = await _client().get(
            f"{BITMART_BASE}/contract/public/funding-rate", params={"symbol": symbol}, timeout=8
        )
        body = r.json()
        if r.status_code == 200 and isinstance(body, dict) and body.get("code") == 1000:
            data = body.get("data") or {}
            return float(data.get("rate_value") or 0.0)
    except Exception as e:
        log.debug("bitmart.funding_fail", symbol=symbol, err=str(e)[:120])
    return 0.0
