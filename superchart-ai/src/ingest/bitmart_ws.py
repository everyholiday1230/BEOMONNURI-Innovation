"""BitMart Futures WebSocket 수집기.

방식 C: 모든 시세를 BitMart 로 일원화. binance_ws.BinanceIngest 와 동일한
on_candle 콜백 인터페이스를 제공한다.

공개 채널: wss://openapi-ws-v2.bitmart.com/api?protocol=1.1
K-line 채널: futures/klineBin{1m,5m,15m,1H,4H,1D}:BTCUSDT
주의:
- 20초간 데이터 없으면 서버가 끊으므로 주기적으로 'ping' 문자열을 보낸다.
- kline push 에는 확정 플래그가 없어 is_final=False(진행중)로 전파한다.
  (봉 확정 처리는 REST 폴링(bitmart_rest)의 직전봉 확정 이벤트가 담당.)
"""
import asyncio
import json
import websockets
import structlog

logger = structlog.get_logger(__name__)

BITMART_WS = "wss://openapi-ws-v2.bitmart.com/api?protocol=1.1"

# 우리 timeframe → BitMart klineBin 채널 접미사
_TF_CHANNEL = {
    "1m": "klineBin1m", "5m": "klineBin5m", "15m": "klineBin15m",
    "1h": "klineBin1H", "4h": "klineBin4H", "1d": "klineBin1D",
}
# BitMart 채널 접미사 → 우리 timeframe (역매핑)
_CHANNEL_TF = {v: k for k, v in _TF_CHANNEL.items()}


class BitMartIngest:
    def __init__(self, symbols: list[str]):
        self._symbols = [s.upper() for s in symbols if str(s).upper().endswith("USDT")]
        _dropped = [s for s in symbols if not str(s).upper().endswith("USDT")]
        if _dropped:
            logger.warning("bitmart.ws.dropped_non_usdt", count=len(_dropped), sample=_dropped[:5])
        self._tfs = ["1m", "5m", "15m", "1h", "4h", "1d"]
        self._running = False
        self._callbacks: list = []
        self._ws_list: list = []
        self._reconnect_delay = 3

    def on_candle(self, cb):
        self._callbacks.append(cb)

    async def start(self):
        self._running = True
        # 심볼 3개씩 청크 (3심볼 × 6TF = 18채널/연결)
        chunk_size = 3
        chunks = [self._symbols[i:i + chunk_size] for i in range(0, len(self._symbols), chunk_size)]
        tasks = [asyncio.create_task(self._connect(chunk)) for chunk in chunks]
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _connect(self, symbols):
        backoff = self._reconnect_delay
        while self._running:
            ws_ref = None
            try:
                args = [f"futures/{_TF_CHANNEL[tf]}:{s}" for s in symbols for tf in self._tfs]
                logger.info("bitmart.connecting", symbols=len(symbols), channels=len(args))
                async with websockets.connect(BITMART_WS, ping_interval=None, close_timeout=5) as ws:
                    ws_ref = ws
                    self._ws_list.append(ws)
                    backoff = self._reconnect_delay
                    # 채널 구독 (args 총 길이 4096바이트 제한 → 청크당 18채널로 안전)
                    await ws.send(json.dumps({"action": "subscribe", "args": args}))
                    logger.info("bitmart.connected", chunk=symbols[0] if symbols else "?")
                    # keepalive: 15초마다 ping
                    ka = asyncio.create_task(self._keepalive(ws))
                    try:
                        async for msg in ws:
                            self._handle_message(msg)
                    finally:
                        ka.cancel()
            except Exception as e:
                logger.warning("bitmart.disconnected", error=str(e), chunk=symbols[0] if symbols else "?")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            finally:
                if ws_ref is not None:
                    try:
                        self._ws_list.remove(ws_ref)
                    except ValueError:
                        pass

    async def _keepalive(self, ws):
        try:
            while self._running:
                await asyncio.sleep(15)
                try:
                    await ws.send("ping")
                except Exception:
                    return
        except asyncio.CancelledError:
            return

    def _handle_message(self, msg):
        # 'pong' 텍스트/구독 응답은 무시
        if not msg or msg == "pong":
            return
        try:
            raw = json.loads(msg)
        except Exception:
            return
        group = raw.get("group") or ""
        data = raw.get("data")
        if not group or not isinstance(data, dict):
            return
        # group 예: "futures/klineBin1m:BTCUSDT"
        try:
            channel_part, symbol = group.split(":", 1)
            channel = channel_part.split("/", 1)[1]  # klineBin1m
        except (ValueError, IndexError):
            return
        tf = _CHANNEL_TF.get(channel)
        if not tf:
            return
        try:
            ts = int(data.get("ts", 0))
            candle = {
                "source": "BITMART",
                "symbol": str(data.get("symbol") or symbol).upper(),
                "timeframe": tf,
                "open_time": ts * 1000,
                "close_time": ts * 1000,
                "open": str(data.get("o")), "high": str(data.get("h")),
                "low": str(data.get("l")), "close": str(data.get("c")),
                "volume": str(data.get("v") or 0),
                "is_final": False,
            }
        except (ValueError, TypeError):
            return
        for cb in self._callbacks:
            # 콜백은 async — 루프에 태스크로 던진다
            try:
                asyncio.create_task(cb(candle))
            except Exception as e:
                logger.warning("bitmart.callback_error", error=str(e))

    async def stop(self):
        self._running = False
        for ws in list(self._ws_list):
            try:
                await ws.close()
            except Exception:
                pass
        self._ws_list.clear()
