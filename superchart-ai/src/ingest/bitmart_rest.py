"""BitMart Futures 실시간 수집기 — REST 백업 (rate-limit 안전).

방식 C: 실시간 캔들/티커의 주 경로는 WebSocket(bitmart_ws)이다. 이 REST
수집기는 WS 끊김 대비 '티커 백업' 역할만 한다.

핵심: BitMart 공개 API 는 IP당 12회/2초 제한이 있으므로, 심볼마다 개별
호출하지 않는다. 대신 `GET /contract/public/details` (심볼 없이) **1회 호출로
전체 심볼의 24h 시세**를 받아 ticker 를 전파한다. → 요청 1건/사이클.

binance_rest.BinanceIngestV2 와 동일한 on_candle/on_ticker 인터페이스를 제공한다.
(캔들은 WS 가 담당하므로 여기선 ticker 만 전파.)
"""
import asyncio
import time
import httpx
import structlog

logger = structlog.get_logger(__name__)

BITMART_BASE = "https://api-cloud-v2.bitmart.com"


class BitMartIngestV2:
    def __init__(self, symbols: list[str]):
        self._symbols = {s.upper() for s in symbols if str(s).upper().endswith("USDT")}
        self._running = False
        self._callbacks: list = []       # on_candle (미사용 — WS 담당, 인터페이스 호환용)
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
        await self._poll_all_tickers()

    async def stop(self):
        self._running = False
        if self._http:
            await self._http.aclose()
        logger.info("bitmart_v2.stopped")

    async def _poll_all_tickers(self):
        """5초마다 전체 심볼 24h 시세를 1회 호출로 조회 → ticker 전파.

        rate-limit: /contract/public/details 는 12회/2초 허용. 5초당 1회는 매우 안전.
        """
        while self._running:
            try:
                r = await self._http.get(f"{BITMART_BASE}/contract/public/details")
                body = r.json()
                if r.status_code == 200 and isinstance(body, dict) and body.get("code") == 1000:
                    symbols = (body.get("data") or {}).get("symbols") or []
                    for row in symbols:
                        try:
                            sym = str(row.get("symbol", "")).upper()
                            if self._symbols and sym not in self._symbols:
                                continue
                            last = row.get("last_price")
                            if last is None:
                                continue
                            change = float(row.get("change_24h") or 0.0)
                            last_f = float(last)
                            openp = last_f / (1.0 + change) if (1.0 + change) != 0 else last_f
                            payload = {
                                "symbol": sym,
                                "last_price": str(last),
                                "open": str(openp),
                                "change_24h": f"{change * 100.0:.3f}",
                            }
                        except (TypeError, ValueError):
                            continue
                        for cb in self._ticker_callbacks:
                            try:
                                await cb(payload)
                            except Exception as _e:
                                logger.debug("ingest.bitmart_rest.silent_except", error=str(_e)[:100])
                else:
                    logger.debug("bitmart_rest.details_bad", status=r.status_code)
            except Exception as _e:
                logger.debug("ingest.bitmart_rest.silent_except", error=str(_e)[:100])
            await asyncio.sleep(5)
