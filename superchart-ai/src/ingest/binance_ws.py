"""Binance WebSocket 수집기."""
import asyncio
import json
import websockets
import structlog

logger = structlog.get_logger(__name__)


class BinanceIngest:
    def __init__(self, symbols: list[str], timeframe: str = "5m"):
        # 방어 필터: Binance Futures USDT 무기한만 허용.
        # 주식/ETF/원자재(CL=F, AAPL 등)가 섞여 들어오면 WS HTTP 400 을 유발하므로 차단.
        self._symbols = [s.lower() for s in symbols if str(s).upper().endswith("USDT")]
        _dropped = [s for s in symbols if not str(s).upper().endswith("USDT")]
        if _dropped:
            logger.warning("binance.ws.dropped_non_usdt", count=len(_dropped), sample=_dropped[:5])
        self._tfs = ["1m", "5m", "15m", "1h", "4h", "1d"]
        self._running = False
        self._callbacks: list = []
        self._ws_list: list = []  # 청크별 ws 인스턴스 보관 (종료 시 일괄 close)
        self._reconnect_delay = 3

    def on_candle(self, cb):
        self._callbacks.append(cb)

    async def start(self):
        self._running = True
        # 6개 심볼씩 청크 (6심볼 × 6TF = 36스트림/연결)
        chunk_size = 3
        chunks = [self._symbols[i:i+chunk_size] for i in range(0, len(self._symbols), chunk_size)]
        tasks = [asyncio.create_task(self._connect(chunk)) for chunk in chunks]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _connect(self, symbols):
        backoff = self._reconnect_delay
        while self._running:
            ws_ref = None
            try:
                streams = "/".join(f"{s}@kline_{tf}" for s in symbols for tf in self._tfs)
                url = f"wss://fstream.binance.com/ws/{streams}"
                logger.info("binance.connecting", symbols=len(symbols), streams=len(symbols)*len(self._tfs))
                async with websockets.connect(url, ping_interval=20, ping_timeout=30, close_timeout=5) as ws:
                    ws_ref = ws
                    self._ws_list.append(ws)
                    backoff = self._reconnect_delay  # 성공했으니 백오프 초기화
                    logger.info("binance.connected", chunk=symbols[0] if symbols else "?")
                    async for msg in ws:
                        try:
                            raw = json.loads(msg)
                            data = raw if "k" in raw else raw.get("data", raw)
                            if "k" not in data:
                                continue
                            k = data["k"]
                            candle = {
                                "source": "BINANCE",
                                "symbol": k["s"],
                                "timeframe": k["i"],
                                "open_time": k["t"],
                                "close_time": k["T"],
                                "open": k["o"], "high": k["h"], "low": k["l"], "close": k["c"],
                                "volume": k["v"],
                                "is_final": k["x"],
                            }
                        except Exception as e:
                            logger.warning("binance.parse_error", error=str(e))
                            continue
                        # 콜백은 parse 블록 밖에서 — 콜백 예외를 parse 예외와 구분해 로그
                        for cb in self._callbacks:
                            try:
                                await cb(candle)
                            except Exception as e:
                                logger.warning("binance.callback_error", error=str(e))
            except Exception as e:
                logger.warning("binance.disconnected", error=str(e), chunk=symbols[0] if symbols else "?")
                # 지수 백오프 (최대 30초)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            finally:
                if ws_ref is not None:
                    try:
                        self._ws_list.remove(ws_ref)
                    except ValueError:
                        pass

    async def stop(self):
        self._running = False
        # 모든 활성 ws를 안전하게 close
        for ws in list(self._ws_list):
            try:
                await ws.close()
            except Exception:
                pass
        self._ws_list.clear()
