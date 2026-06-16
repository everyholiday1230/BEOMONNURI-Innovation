"""Binance 실시간 수집기 v2 — REST 폴링 기반 (확실한 동작 보장).

WS가 불안정한 환경에서도 REST API로 1초마다 최신 가격을 가져옴.
"""
import asyncio
import httpx
import structlog

logger = structlog.get_logger(__name__)

BINANCE_REST = "https://fapi.binance.com"


class BinanceIngestV2:
    def __init__(self, symbols: list[str]):
        self._symbols = [s.upper() for s in symbols]
        self._tfs = ["1m", "5m", "15m", "1h", "4h", "1d"]
        self._running = False
        self._callbacks: list = []
        self._ticker_callbacks: list = []
        self._http: httpx.AsyncClient | None = None
        self._last_prices: dict[str, str] = {}

    def on_candle(self, cb):
        self._callbacks.append(cb)

    def on_ticker(self, cb):
        self._ticker_callbacks.append(cb)

    async def start(self):
        self._running = True
        self._http = httpx.AsyncClient(timeout=10)
        logger.info("binance_v2.started", symbols=len(self._symbols))

        # kline 폴링 (1m: 2초, HTF: 15초)
        await asyncio.gather(
            self._poll_klines(),
            self._poll_htf_klines(),
            return_exceptions=True
        )

    async def _poll_klines(self):
        """2초마다 전체 심볼의 1m kline — 배치 병렬 요청.

        주의: WS가 정상이면 REST polling은 ticker 백업 역할만 한다.
        WS의 candle 데이터가 도착하면 dedup이 막아주지만,
        rate limit 부담을 줄이기 위해 폴링 간격을 5초로 늘림.
        """
        last_ot: dict[str, int] = {}
        while self._running:
            # 5개씩 배치 병렬 요청
            for i in range(0, len(self._symbols), 5):
                if not self._running: break
                batch = self._symbols[i:i+5]
                tasks = [self._fetch_kline(sym, last_ot) for sym in batch]
                await asyncio.gather(*tasks, return_exceptions=True)
                await asyncio.sleep(0.5)  # 0.2 → 0.5 (배치 간 대기)
            await asyncio.sleep(5)  # 1 → 5 (전체 사이클 대기)

    async def _fetch_kline(self, sym, last_ot):
        try:
            r = await self._http.get(
                f"{BINANCE_REST}/fapi/v1/klines",
                params={"symbol": sym, "interval": "1m", "limit": 2}
            )
            data = r.json()
            if not data or not isinstance(data, list) or len(data) < 2:
                return
            prev_k, cur_k = data[-2], data[-1]
            cur_ot = cur_k[0]
            if sym in last_ot and last_ot[sym] != cur_ot:
                final_candle = {
                    "source": "BINANCE", "symbol": sym, "timeframe": "1m",
                    "open_time": prev_k[0], "close_time": prev_k[6],
                    "open": str(prev_k[1]), "high": str(prev_k[2]),
                    "low": str(prev_k[3]), "close": str(prev_k[4]),
                    "volume": str(prev_k[5]), "is_final": True, "isFinal": True,
                }
                for cb in self._callbacks:
                    try: await cb(final_candle)
                    except Exception: pass  # 개별 심볼 실패 허용
            last_ot[sym] = cur_ot
            # 1m 진행중 봉만 전송 (다른 TF는 WS kline 또는 HTF 폴링이 담당)
            candle = {
                "source": "BINANCE", "symbol": sym, "timeframe": "1m",
                "open_time": cur_k[0], "close_time": cur_k[6],
                "open": str(cur_k[1]), "high": str(cur_k[2]),
                "low": str(cur_k[3]), "close": str(cur_k[4]),
                "volume": str(cur_k[5]), "is_final": False,
            }
            for cb in self._callbacks:
                try: await cb(candle)
                except Exception as _e:
                    logger.debug("ingest.binance_rest.silent_except", error=str(_e)[:100])
            # 모든 TF 구독자에게 가격 업데이트 (candle이 아닌 ticker로)
            for cb in self._ticker_callbacks:
                try: await cb({"symbol": sym, "last_price": str(cur_k[4]), "open": str(cur_k[1])})
                except Exception as _e:
                    logger.debug("ingest.binance_rest.silent_except", error=str(_e)[:100])
        except Exception as _e:
            logger.debug("ingest.binance_rest.silent_except", error=str(_e)[:100])
    async def stop(self):
        self._running = False
        if self._http:
            await self._http.aclose()
        logger.info("binance_v2.stopped")

    async def _poll_htf_klines(self):
        """30초마다 상위 TF(5m,15m,1h,4h,1d) 봉 확정 + 진행중 봉.

        WS에서 모든 TF가 정상 들어오면 사실상 redundant. WS 끊김 대비 백업.
        """
        htfs = ["5m", "15m", "1h", "4h", "1d"]
        last_ot: dict[str, int] = {}
        while self._running:
            for tf in htfs:
                if not self._running: break
                # 5개씩 배치 병렬
                for i in range(0, len(self._symbols), 5):
                    if not self._running: break
                    batch = self._symbols[i:i+5]
                    tasks = [self._fetch_htf(sym, tf, last_ot) for sym in batch]
                    await asyncio.gather(*tasks, return_exceptions=True)
                    await asyncio.sleep(0.5)
            await asyncio.sleep(30)  # 5 → 30 (HTF는 자주 호출 불필요)

    async def _fetch_htf(self, sym, tf, last_ot):
        try:
            r = await self._http.get(
                f"{BINANCE_REST}/fapi/v1/klines",
                params={"symbol": sym, "interval": tf, "limit": 2}
            )
            data = r.json()
            if not data or len(data) < 2: return
            prev_k, cur_k = data[-2], data[-1]
            key = f"{sym}_{tf}"
            cur_ot = cur_k[0]
            if key in last_ot and last_ot[key] != cur_ot:
                final = {
                    "source": "BINANCE", "symbol": sym, "timeframe": tf,
                    "open_time": prev_k[0], "close_time": prev_k[6],
                    "open": str(prev_k[1]), "high": str(prev_k[2]),
                    "low": str(prev_k[3]), "close": str(prev_k[4]),
                    "volume": str(prev_k[5]), "is_final": True, "isFinal": True,
                }
                for cb in self._callbacks:
                    try: await cb(final)
                    except Exception as _e:
                        logger.debug("ingest.binance_rest.silent_except", error=str(_e)[:100])
            last_ot[key] = cur_ot
            progress = {
                "source": "BINANCE", "symbol": sym, "timeframe": tf,
                "open_time": cur_k[0], "close_time": cur_k[6],
                "open": str(cur_k[1]), "high": str(cur_k[2]),
                "low": str(cur_k[3]), "close": str(cur_k[4]),
                "volume": str(cur_k[5]), "is_final": False,
            }
            for cb in self._callbacks:
                try: await cb(progress)
                except Exception as _e:
                    logger.debug("ingest.binance_rest.silent_except", error=str(_e)[:100])
        except Exception as _e:
            logger.debug("ingest.binance_rest.silent_except", error=str(_e)[:100])