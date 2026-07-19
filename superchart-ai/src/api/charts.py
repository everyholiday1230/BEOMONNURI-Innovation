"""캔들 + 차트 API 메인 라우터 — 서브 라우터 포함."""
import time
from fastapi import APIRouter, HTTPException
from src.models.schemas import ApiResponse
from src.services.market import fetch_candles, _client
from src.services.symbol_resolver import resolve_symbol

router = APIRouter()

# ═══ Binance fallback circuit breaker ═══
# Render egress IP가 Binance에 -1003(rate-limit)로 밴된 상태에서 개별 종목
# fallback이 매번 5초 타임아웃을 소진 → 요청 폭주 시 커넥션/메모리 누적(OOM).
# fallback이 실패하면 일정 시간(기본 300초) Binance 시도를 건너뛴다.
_binance_fallback_blocked_until = 0.0
_BINANCE_FALLBACK_COOLDOWN = 300.0

# ═══ 캐시 헬퍼 (Redis shared cache) ═══
# 공통 위치: src/services/redis_cache.py
# 하위 호환을 위해 이 모듈에서도 노출 (기존 import 가 남아있을 수 있음).
from src.services.redis_cache import cache_get, cache_set, _get_cached, _set_cached  # noqa: F401


# ═══ 캔들 ═══
@router.get("/server-time", response_model=ApiResponse)
async def get_server_time():
    """서버 UTC 타임스탬프 (밀리초)."""
    return ApiResponse(data={"ts": int(time.time() * 1000)})

def _mark_stale(data):
    """업스트림(Bitget/Binance) 전체 실패로 24시간 캐시(ticker24_last)를 대신
    반환할 때, 프론트엔드가 "오래된 가격을 현재가처럼" 표시하지 않도록 명시적
    표시 필드를 추가한다. Binance 호환 응답 형식(딕셔너리 키)은 그대로 두고
    필드만 추가하므로 기존 파싱 로직에 영향 없음. 원본 캐시 객체를 변경하지
    않기 위해 새 dict/list 로 감싼다.
    """
    if isinstance(data, list):
        return [{**item, "stale": True} if isinstance(item, dict) else item for item in data]
    if isinstance(data, dict):
        return {**data, "stale": True}
    return data


def _bitget_to_binance_ticker(row: dict, symbol_in: str, scale: int = 1) -> dict:
    """Normalise a Bitget v2 mix ticker row to Binance fapi 24hr shape.

    scale is 1000 for symbols we accessed via stripping the "1000" prefix,
    so prices are multiplied back to the Binance-style unit.
    """
    def _f(v):
        try:
            return float(v)
        except Exception:
            return 0.0

    last = _f(row.get("lastPr")) * scale
    openp = _f(row.get("open24h") or row.get("openUtc")) * scale
    high = _f(row.get("high24h")) * scale
    low = _f(row.get("low24h")) * scale
    pct = _f(row.get("change24h")) * 100.0  # Bitget: 0.01 = 1%

    # 가격 포맷: 소수점 자릿수를 원본 정밀도에 맞춤
    def _fmt(v):
        if v == 0:
            return "0"
        s = f"{v:.12f}".rstrip('0').rstrip('.')
        return s

    return {
        "symbol": symbol_in,
        "priceChange": _fmt(last - openp),
        "priceChangePercent": f"{pct:.3f}",
        "weightedAvgPrice": _fmt(openp),
        "lastPrice": _fmt(last),
        "lastQty": "0",
        "openPrice": _fmt(openp),
        "highPrice": _fmt(high),
        "lowPrice": _fmt(low),
        "volume": str(row.get("baseVolume") or 0),
        "quoteVolume": str(row.get("quoteVolume") or 0),
        "openTime": int(int(row.get("ts", 0) or 0)) - 86_400_000,
        "closeTime": int(int(row.get("ts", 0) or 0)),
        "firstId": 0,
        "lastId": 0,
        "count": 0,
    }


@router.get("/ticker-24hr")
async def proxy_ticker_24hr(symbol: str = ""):
    """24hr ticker — BitMart Futures 사용 (Redis 캐시 30s + 탄력성).

    방식 C: 모든 시세를 BitMart 로 일원화. 응답 형태는 Binance fapi 24hr 과
    동일하게 정규화하여 프론트엔드는 변경 불필요.
    """
    import structlog
    log = structlog.get_logger(__name__)
    from src.services import bitmart

    cache_key = symbol or "all"

    # 1) fresh cache (30s)
    cached = await cache_get("ticker24", cache_key)
    if cached is not None:
        return cached

    try:
        data = await bitmart.ticker_24hr(symbol)
    except Exception as e:
        stale = await cache_get("ticker24_last", cache_key)
        if stale is not None:
            log.warning("ticker.upstream_fail_stale_fallback", symbol=symbol, err=str(e))
            return _mark_stale(stale)
        log.warning("ticker.upstream_fail_no_fallback", symbol=symbol, err=str(e))
        return {"code": -1, "msg": f"upstream error: {e}"}

    # BitMart 실패(빈 결과 / 에러 dict) → stale 폴백
    bad = (not data) or (isinstance(data, dict) and data.get("code") == -1)
    if bad:
        stale = await cache_get("ticker24_last", cache_key)
        log.warning("ticker.upstream_err", symbol=symbol, body=str(data)[:200])
        if stale is not None:
            return _mark_stale(stale)
        return data

    await cache_set("ticker24", cache_key, data, ttl=30)
    await cache_set("ticker24_last", cache_key, data, ttl=86400)
    return data


@router.get("/long-short")
async def proxy_long_short(symbol: str = "BTCUSDT"):
    """롱숏 계정 비율 — BitMart 공개 API 미제공으로 비활성화.

    방식 C: 데이터 소스를 BitMart 로 일원화하면서 롱숏 비율은 BitMart 공개
    엔드포인트가 없어 제공할 수 없다. 프론트가 안전하게 '데이터 없음'으로
    처리하도록 빈 배열을 반환한다.
    """
    return {"code": 0, "data": [], "unsupported": True,
            "note": "롱숏 비율은 현재 데이터 소스(BitMart)에서 제공하지 않습니다."}


@router.get("/liquidation-heatmap")
async def liquidation_heatmap(symbol: str = "BTCUSDT", symbolId: str = ""):
    """청산 히트맵 — Binance 강제 청산 주문 기반으로 가격대별 청산 누적량 반환.

    Strategy:
        1. forceOrders는 인증 필요 → 공개 API인 allForceOrders는 제한적이므로,
        2. open interest 변화 + 가격 + 펀딩비 기반으로 청산 위험 가격대 추정
        3. 24시간 청산 데이터를 가격 buckets로 누적

    Returns:
        {
          "success": true,
          "data": {
            "buckets": [{"price": 100000, "long_liq": 1234.5, "short_liq": 567.8}, ...],
            "current_price": 102000,
            "total_long_liq_24h": 50000000,
            "total_short_liq_24h": 30000000,
            "max_long_cluster": {"price": 99000, "amount": 5000000},
            "max_short_cluster": {"price": 105000, "amount": 4200000}
          }
        }
    """
    import httpx
    import structlog
    log = structlog.get_logger(__name__)

    # 프론트는 symbolId 로 호출(예: ?symbolId=ETHUSDT). symbolId 우선, 없으면 symbol.
    import re as _re
    _sym = (symbolId or symbol or "BTCUSDT").strip().upper()
    if not _re.fullmatch(r"[A-Z0-9]{2,30}", _sym):
        _sym = "BTCUSDT"
    symbol = _sym

    cache_key = symbol
    cached = await cache_get("liq_heatmap", cache_key)
    if cached is not None:
        return cached

    # 방식 C: 가격/펀딩비는 BitMart 에서 조회. OI 히스토리는 BitMart 공개 API
    # 미제공이라 사용하지 않고(빈 배열), 청산 추정은 캔들 변동성 기반으로 동작한다.
    from src.services import bitmart
    current_price = 0.0
    funding_rate = 0.0
    oi_data: list = []
    klines: list = []
    try:
        tk = await bitmart.fetch_ticker(symbol)
        if tk and tk.get("last_price"):
            current_price = float(tk["last_price"])
    except Exception as e:
        log.warning("liq_heatmap.price_fail", symbol=symbol, err=str(e)[:120])

    if current_price <= 0:
        # 폴백: 자체 캔들 데이터의 종가
        try:
            from src.services.market import fetch_candles
            from src.services.symbol_resolver import resolve_symbol
            api_sym, ex_id = resolve_symbol(symbol)
            cd = await fetch_candles(api_sym, ex_id, "1h", 2)
            if cd:
                current_price = float(cd[-1].get("close") or cd[-1].get("c") or 0)
        except Exception:
            pass
    if current_price <= 0:
        return {"success": False, "error": "invalid price"}

    try:
        funding_rate = await bitmart.fetch_funding_rate(symbol)
    except Exception:
        funding_rate = 0.0

    # 캔들은 항상 자체 서비스(fetch_candles, Bitget 폴백 포함)로 — Render egress 에서
    # Binance fapi 가 차단되어도 청산 히트맵이 동작하도록 한다.
    try:
        from src.services.market import fetch_candles
        from src.services.symbol_resolver import resolve_symbol
        api_sym, ex_id = resolve_symbol(symbol)
        cd = await fetch_candles(api_sym, ex_id, "1h", 24)
        klines = []
        for c in (cd or []):
            try:
                o = float(c.get("open") or c.get("o") or 0)
                h = float(c.get("high") or c.get("h") or 0)
                l = float(c.get("low") or c.get("l") or 0)
                cl = float(c.get("close") or c.get("c") or 0)
                v = float(c.get("volume") or c.get("v") or 0)
                klines.append([c.get("openTime", 0), o, h, l, cl, v, c.get("closeTime", 0), v * cl])
            except Exception:
                continue
    except Exception as e:
        log.warning("liq_heatmap.candle_fetch_fail", symbol=symbol, err=str(e)[:120])
        klines = []

    # 청산 추정 알고리즘:
    # - 1시간봉 24개에서 변동성 + OI 변화 기반 추정
    # - 큰 캔들 + OI 감소 = 청산 발생
    # - 청산 가격대 = 큰 변동 캔들의 high/low 인근

    if not isinstance(klines, list) or len(klines) < 5:
        return {"success": False, "error": "insufficient data"}

    if not isinstance(oi_data, list):
        oi_data = []

    # OI 변화율
    oi_changes = []
    for i in range(1, len(oi_data)):
        try:
            prev_oi = float(oi_data[i - 1].get("sumOpenInterest", 0))
            cur_oi = float(oi_data[i].get("sumOpenInterest", 0))
            oi_changes.append((cur_oi - prev_oi) / prev_oi if prev_oi > 0 else 0)
        except Exception:
            oi_changes.append(0)

    # 청산 버킷 생성 (가격 ±5% 범위, 50개 buckets)
    price_low = current_price * 0.94
    price_high = current_price * 1.06
    bucket_count = 50
    bucket_step = (price_high - price_low) / bucket_count

    buckets = [
        {"price": price_low + bucket_step * (i + 0.5), "long_liq": 0.0, "short_liq": 0.0}
        for i in range(bucket_count)
    ]

    # 캔들 별 청산 추정
    total_long_liq = 0.0
    total_short_liq = 0.0
    for i, k in enumerate(klines):
        try:
            high = float(k[2])
            low = float(k[3])
            close = float(k[4])
            volume_usdt = float(k[7])  # quote asset volume
            # OI 변화가 음수 = 청산 가능성 (포지션 강제 종료)
            oi_change = oi_changes[i - 1] if i > 0 and i - 1 < len(oi_changes) else 0
            # 변동성 계수 (high-low 폭)
            volatility = (high - low) / close if close > 0 else 0
            # 청산 추정 비율 = 거래량 × 변동성 × |OI 변화|
            estimated_liq = volume_usdt * volatility * (abs(oi_change) + 0.05)

            # 펀딩비 양수 = 롱 포지션 많음 = 하락 시 롱 청산 우세
            # 펀딩비 음수 = 숏 포지션 많음 = 상승 시 숏 청산 우세
            if close < (high + low) / 2:  # 하락 캔들
                long_liq_share = 0.7 if funding_rate > 0 else 0.5
            else:  # 상승 캔들
                long_liq_share = 0.3 if funding_rate < 0 else 0.5

            long_amt = estimated_liq * long_liq_share
            short_amt = estimated_liq * (1 - long_liq_share)
            total_long_liq += long_amt
            total_short_liq += short_amt

            # high~low 범위에 분포 (롱 청산은 low 근처, 숏 청산은 high 근처)
            for b in buckets:
                bp = b["price"]
                if low <= bp <= high:
                    # 거리 기반 가중치
                    long_weight = 1.0 - (bp - low) / (high - low + 1e-9)  # low에 가까울수록 큼
                    short_weight = (bp - low) / (high - low + 1e-9)  # high에 가까울수록 큼
                    b["long_liq"] += long_amt * long_weight / 24  # 24봉 분산
                    b["short_liq"] += short_amt * short_weight / 24
        except Exception:
            continue

    # 최대 클러스터 찾기
    max_long = max(buckets, key=lambda b: b["long_liq"], default=None)
    max_short = max(buckets, key=lambda b: b["short_liq"], default=None)

    # 정리: 각 버킷 값 반올림
    for b in buckets:
        b["price"] = round(b["price"], 2)
        b["long_liq"] = round(b["long_liq"], 0)
        b["short_liq"] = round(b["short_liq"], 0)

    payload = {
        "success": True,
        "data": {
            "buckets": buckets,
            "current_price": round(current_price, 2),
            "total_long_liq_24h": round(total_long_liq, 0),
            "total_short_liq_24h": round(total_short_liq, 0),
            "max_long_cluster": {
                "price": round(max_long["price"], 2) if max_long else 0,
                "amount": round(max_long["long_liq"], 0) if max_long else 0,
            } if max_long else None,
            "max_short_cluster": {
                "price": round(max_short["price"], 2) if max_short else 0,
                "amount": round(max_short["short_liq"], 0) if max_short else 0,
            } if max_short else None,
            "funding_rate": round(funding_rate * 100, 4),
            "symbol": symbol,
        },
    }

    await cache_set("liq_heatmap", cache_key, payload, ttl=600)  # 10분 캐시(밴 예방)
    await cache_set("liq_heatmap_last", cache_key, payload, ttl=86400)
    return payload

@router.get("/candles", response_model=ApiResponse)
async def get_candles(symbolId: str = "BTCUSDT", timeframe: str = "5m", limit: int = 1000, endTime: str = ""):
    """캔들(OHLCV) 데이터 조회. symbolId: 심볼코드, timeframe: 1m/5m/15m/1h/4h/1d, limit: 1~2000."""
    # symbolId 검증 (영문 대문자/숫자만, 2~30자) — SQL/XSS/제어문자 차단
    import re as _re
    if not symbolId or not _re.fullmatch(r"[A-Z0-9]{2,30}", symbolId):
        raise HTTPException(400, "잘못된 symbolId 형식입니다 (영문 대문자/숫자 2~30자)")
    # 화이트리스트 검증 — DB에 등록된 심볼만 허용
    from src.services.symbol_resolver import SYMBOL_EXCHANGE, SYMBOL_API_MAP, ensure_fresh
    await ensure_fresh()
    _whitelisted = (symbolId in SYMBOL_EXCHANGE) or (symbolId in SYMBOL_API_MAP.values())
    # 화이트리스트에 없지만 형식이 유효한 심볼(목록엔 있으나 캔들 소스 미연결 등):
    # 404 대신 빈 캔들 + unsupported 표기로 응답한다. 프론트는 '데이터 없음'으로 처리하고
    # 콘솔 404/재시도 폭주를 막는다. 외부 API 호출 없이 즉시 반환(부하 0).
    if not _whitelisted:
        return ApiResponse(data={"symbolId": symbolId, "timeframe": timeframe, "candles": [], "supported": False, "note": "이 종목은 현재 캔들 데이터를 제공하지 않습니다."})
    # 입력 검증 (감사 보고서 9.3 반영)
    # timeframe 별칭 정규화 — 차트/패널이 24h, 12h 등 별칭을 보내도 거부(400) 대신 매핑.
    _TF_ALIAS = {"24h": "1d", "1day": "1d", "1D": "1d", "12h": "4h", "8h": "4h", "6h": "4h",
                 "3d": "1d", "7d": "1w", "1W": "1w", "1week": "1w", "1month": "1M", "1mo": "1M"}
    timeframe = _TF_ALIAS.get(timeframe, timeframe)
    _ALLOWED_TF = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w", "1M"}
    if timeframe not in _ALLOWED_TF:
        raise HTTPException(400, f"지원하지 않는 timeframe: {timeframe}. 허용: {sorted(_ALLOWED_TF)}")
    # limit 범위 (1 ~ 2000)
    try:
        limit = int(limit)
    except (TypeError, ValueError):
        limit = 500
    limit = max(1, min(limit, 2000))
    # endTime 검증 (ms epoch)
    end_time_int = None
    if endTime:
        try:
            end_time_int = int(endTime)
            # 2000-01-01 ~ 2050-01-01 범위 내 (잘못된 값 방지)
            if end_time_int < 946684800000 or end_time_int > 2524608000000:
                end_time_int = None
        except (TypeError, ValueError):
            end_time_int = None
    api_sym, exchange_id = resolve_symbol(symbolId)
    candles = await fetch_candles(api_sym, exchange_id, timeframe, limit, end_time=end_time_int)
    return ApiResponse(data={"symbolId": symbolId, "timeframe": timeframe, "candles": candles})


# ═══ 서브 라우터 ═══
from src.api.charts_signals import router as signals_router
from src.api.charts_indicators import router as indicators_router
from src.api.charts_analysis import router as analysis_router
from src.api.qsignal import router as qsignal_router

router.include_router(signals_router)
router.include_router(indicators_router)
router.include_router(analysis_router)
router.include_router(qsignal_router)


@router.get("/hot-coins")
async def hot_coins(asset_class: str = "crypto"):
    """인기 종목 TOP 10 — Binance 24hr ticker 기반."""
    import httpx
    
    key = f"hot:{asset_class}"
    cached = await _get_cached("hot", key, 60)
    if cached is not None:
        return cached
    
    # DB에서 우리 종목 목록
    from src.db.session import SessionLocal
    from sqlalchemy import text
    async with SessionLocal() as db:
        rows = (await db.execute(text("SELECT symbol_code FROM symbols WHERE status='active' AND asset_class = :cls"), {"cls": asset_class})).fetchall()
    our_symbols = set(r[0] for r in rows)
    
    if asset_class == 'crypto':
        try:
            from src.services import bitmart
            tickers = await bitmart.ticker_24hr("")
            if not isinstance(tickers, list):
                tickers = []
            
            results = []
            for t in tickers:
                sym = t['symbol']
                if sym not in our_symbols: continue
                try:
                    results.append({
                        "symbol": sym,
                        "price": float(t['lastPrice']),
                        "change_pct": float(t['priceChangePercent']),
                        "volume": float(t['quoteVolume']),
                        "high": float(t['highPrice']),
                        "low": float(t['lowPrice']),
                    })
                except Exception: pass
            
            # 거래량 × 변동성으로 정렬
            for r in results:
                r['score'] = r['volume'] * abs(r['change_pct'])
            results.sort(key=lambda x: -x['score'])
            data = {"items": results[:10], "updated": True}
        except Exception as e:
            data = {"items": [], "error": str(e)}
    else:
        data = {"items": [], "note": "주식은 별도 API 필요"}
    
    await _set_cached("hot", key, data, 60)
    return data


@router.get("/trend-insights")
async def trend_insights():
    """24시간 트렌드 인사이트 — TOP 5 상승/하락/거래량/변동성 분리.

    Returns:
        {
          "success": true,
          "data": {
            "top_gainers": [{symbol, change_pct, price, volume}, ...],   # 상승 TOP 5
            "top_losers": [...],                                          # 하락 TOP 5
            "top_volume": [...],                                          # 거래량 TOP 5
            "top_volatility": [...],                                      # 변동성 TOP 5 (high-low)
            "market_summary": {
              "total_count": 200,
              "gainers_count": 120,
              "losers_count": 80,
              "avg_change": 1.23,
              "btc_change": 0.5,
              "market_mood": "bullish" | "bearish" | "mixed"
            }
          }
        }
    """
    import httpx
    from src.services.redis_cache import cache_get, cache_set

    cached = await cache_get("trend_insights", "all")
    if cached is not None:
        return cached

    try:
        from src.db.session import SessionLocal
        from sqlalchemy import text
        async with SessionLocal() as db:
            rows = (await db.execute(text(
                "SELECT symbol_code, display_name_ko FROM symbols WHERE status='active' AND asset_class='crypto'"
            ))).fetchall()
        our_symbols = {r[0]: r[1] for r in rows}

        from src.services import bitmart
        tickers = await bitmart.ticker_24hr("")
        if not isinstance(tickers, list):
            tickers = []

        items = []
        for t in tickers:
            sym = t.get('symbol', '')
            if sym not in our_symbols:
                continue
            try:
                items.append({
                    "symbol": sym,
                    "name_ko": our_symbols.get(sym, sym),
                    "price": float(t['lastPrice']),
                    "change_pct": float(t['priceChangePercent']),
                    "volume": float(t['quoteVolume']),
                    "high": float(t['highPrice']),
                    "low": float(t['lowPrice']),
                    "volatility_pct": (float(t['highPrice']) - float(t['lowPrice'])) / float(t['lastPrice']) * 100 if float(t['lastPrice']) > 0 else 0,
                })
            except Exception:
                continue

        if not items:
            return {"success": False, "error": "no data"}

        # 정렬
        gainers = sorted(items, key=lambda x: -x['change_pct'])[:5]
        losers = sorted(items, key=lambda x: x['change_pct'])[:5]
        by_volume = sorted(items, key=lambda x: -x['volume'])[:5]
        by_volatility = sorted(items, key=lambda x: -x['volatility_pct'])[:5]

        # 시장 요약
        total = len(items)
        gainers_count = sum(1 for i in items if i['change_pct'] > 0)
        losers_count = sum(1 for i in items if i['change_pct'] < 0)
        avg_change = sum(i['change_pct'] for i in items) / total if total else 0
        btc = next((i for i in items if i['symbol'] == 'BTCUSDT'), None)
        btc_change = btc['change_pct'] if btc else 0

        # 시장 분위기
        if gainers_count > losers_count * 2 and avg_change > 1:
            mood = "bullish"
            mood_label = "강한 상승장"
        elif gainers_count > losers_count and avg_change > 0.3:
            mood = "lean_bullish"
            mood_label = "상승 우위"
        elif losers_count > gainers_count * 2 and avg_change < -1:
            mood = "bearish"
            mood_label = "강한 하락장"
        elif losers_count > gainers_count and avg_change < -0.3:
            mood = "lean_bearish"
            mood_label = "하락 우위"
        else:
            mood = "mixed"
            mood_label = "혼조세"

        payload = {
            "success": True,
            "data": {
                "top_gainers": gainers,
                "top_losers": losers,
                "top_volume": by_volume,
                "top_volatility": by_volatility,
                "market_summary": {
                    "total_count": total,
                    "gainers_count": gainers_count,
                    "losers_count": losers_count,
                    "neutral_count": total - gainers_count - losers_count,
                    "avg_change": round(avg_change, 2),
                    "btc_change": round(btc_change, 2),
                    "market_mood": mood,
                    "market_mood_label": mood_label,
                },
                "updated_at": int(__import__('time').time()),
            },
        }

        await cache_set("trend_insights", "all", payload, ttl=60)
        return payload
    except Exception as e:
        import structlog
        log = structlog.get_logger(__name__)
        log.warning("trend_insights.fail", err=str(e)[:120])
        return {"success": False, "error": str(e)}
