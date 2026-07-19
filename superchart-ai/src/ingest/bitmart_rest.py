"""BitMart Futures 실시간 수집기 — REST 폴링 기반 (확실한 동작 보장).

방식 C: 모든 시세를 BitMart Futures 로 일원화. WS 가 불안정한 환경에서도
REST 로 최신 캔들/가격을 가져온다. binance_rest.BinanceIngestV2 와 동일한
콜백 인터페이스(on_candle/on_ticker)를 제공한다.

BitMart kline: GET /contract/public/kline?symbol=&step=<분>&start_time=<초>&end_time=<초>
"""
import asyncio
import time
import httpx
import structlog

logger = structlog.get_logger(__name__)

BITMART_BASE = "https://api-cloud-v2.bitmart.com"

# 우리 timeframe → BitMart step(분)
_TF_STEP = {"1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440}
_TF_SEC = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}


class BitMartIngestV2:
    def __init__(self, symbols: list[str]):
        # USDT 무기한만 허용 (심볼 포맷 BTCUSDT)
        self._symbols = [s.upper() for s in symbols if str(s).upper().endswith("USDT")]
        _dropped = [s for s in symbols if not str(s).upper().endswith("USDT")]
        if _dropped:
            logger.warning("bitmart.rest.dropped_non_usdt", count=len(_dropped), sample=_dropped[:5])
        self._running = False
        self._callbacks: list = []
        self._ticker_callbacks: list = []
        self._http: httpx.AsyncClient | None = None

    def on_candle(self, cb):
        self._callbacks.append(cb)

    def on_ticker(self, cb):
        self._ticker_callbacks.append(cb)

    async def start(self):
        self._running = True
        self._http = httpx.AsyncClient(timeout=10)
        logger.info("bitmart_v2.started", symbols=len(self._symbols))
        await asyncio.gather(
            self._poll_klines(),
            self._poll_htf_klines(),
            return_exceptions=True,
        )

    async def stop(self):
        self._running = False
        if self._http:
            await self._http.aclose()
        logger.info("bitmart_v2.stopped")

    async def _fetch_last2(self, sym: str, tf: str):
        """해당 심볼/TF의 최근 2개 캔들 조회 → [(prev), (cur)] 정규화 리스트."""
        step = _TF_STEP[tf]
        sec = _TF_SEC[tf]
        now = int(time.time())
        params = {
            "symbol": sym,
            "step": step,
            "start_time": now - sec * 3,
            "end_time": now,
        }
        r = await self._http.get(f"{BITMART_BASE}/contract/public/kline", params=params)
        body = r.json()
        if not isinstance(body, dict) or body.get("code") != 1000:
            return []
        data = body.get("data") or []
        out = []
        for k in data:
            try:
                ts = int(k.get("timestamp", 0))
                out.append({
                    "open_time": ts * 1000,
                    "close_time": ts * 1000 + sec * 1000 - 1,
                    "open": str(k.get("open_price")), "high": str(k.get("high_price")),
                    "low": str(k.get("low_price")), "close": str(k.get("close_price")),
                    "volume": str(k.get("volume") or 0),
                })
            except (ValueError, TypeError):
                continue
        out.sort(key=lambda x: x["open_time"])
        return out[-2:]

    async def _poll_klines(self):
        """5초마다 전체 심볼의 1m 캔들 — 배치 병렬."""
        last_ot: dict[str, int] = {}
        while self._running:
            for i in range(0, len(self._symbols), 5):
                if not self._running:
                    break
                batch = self._symbols[i:i + 5]
                await asyncio.gather(*[self._fetch_kline(sym, "1m", last_ot) for sym in batch],
                                     return_exceptions=True)
                await asyncio.sleep(0.5)
            await asyncio.sleep(5)

    async def _poll_htf_klines(self):
        """30초마다 상위 TF(5m,15m,1h,4h,1d) 캔들."""
        htfs = ["5m", "15m", "1h", "4h", "1d"]
        last_ot: dict[str, int] = {}
        while self._running:
            for tf in htfs:
                for i in range(0, len(self._symbols), 5):
                    if not self._running:
                        break
                    batch = self._symbols[i:i + 5]
                    await asyncio.gather(*[self._fetch_kline(sym, tf, last_ot) for sym in batch],
                                         return_exceptions=True)
                    await asyncio.sleep(0.5)
            await asyncio.sleep(30)

    async def _fetch_kline(self, sym: str, tf: str, last_ot: dict):
        try:
            rows = await self._fetch_last2(sym, tf)
            if not rows:
                return
            cur = rows[-1]
            key = f"{sym}_{tf}"
            cur_ot = cur["open_time"]
            # 직전 봉 확정 전파
            if key in last_ot and last_ot[key] != cur_ot and len(rows) >= 2:
                prev = rows[-2]
                final = {
                    "source": "BITMART", "symbol": sym, "timeframe": tf,
                    "open_time": prev["open_time"], "close_time": prev["close_time"],
                    "open": prev["open"], "high": prev["high"], "low": prev["low"],
                    "close": prev["close"], "volume": prev["volume"],
                    "is_final": True, "isFinal": True,
                }
                for cb in self._callbacks:
                    try:
                        await cb(final)
                    except Exception:
                        pass
            last_ot[key] = cur_ot
            # 진행중 봉 전파
            candle = {
                "source": "BITMART", "symbol": sym, "timeframe": tf,
                "open_time": cur_ot, "close_time": cur["close_time"],
                "open": cur["open"], "high": cur["high"], "low": cur["low"],
                "close": cur["close"], "volume": cur["volume"], "is_final": False,
            }
            for cb in self._callbacks:
                try:
                    await cb(candle)
                except Exception as _e:
                    logger.debug("ingest.bitmart_rest.silent_except", error=str(_e)[:100])
            # 1m 폴링 시 ticker 전파
            if tf == "1m":
                for cb in self._ticker_callbacks:
                    try:
                        await cb({"symbol": sym, "last_price": cur["close"], "open": cur["open"]})
                    except Exception as _e:
                        logger.debug("ingest.bitmart_rest.silent_except", error=str(_e)[:100])
        except Exception as _e:
            logger.debug("ingest.bitmart_rest.silent_except", error=str(_e)[:100])
