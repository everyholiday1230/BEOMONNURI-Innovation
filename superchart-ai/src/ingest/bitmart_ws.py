"""BitMart Futures WebSocket 수집기.

방식 C: 모든 시세를 BitMart 로 일원화. binance_ws.BinanceIngest 와 동일한
on_candle 콜백 인터페이스 + on_ticker 를 제공한다.

공개 채널: wss://openapi-ws-v2.bitmart.com/api?protocol=1.1
- K-line: futures/klineBin{1m,5m,15m,1H,4H,1D}:BTCUSDT
    응답: {"group":"futures/klineBin1m:BTCUSDT","data":{"symbol":"BTCUSDT",
           "items":[{"o","h","l","c","v","ts"}]}}
- Ticker: futures/ticker:BTCUSDT
    응답: {"group":"futures/ticker:BTCUSDT","data":{"symbol","last_price","range",...}}

주의:
- 20초간 데이터 없으면 서버가 끊으므로 15초마다 'ping' 문자열 전송.
- kline push 에는 확정 플래그가 없어 is_final=False(진행중)로 전파.
  (봉 확정은 REST 폴링(bitmart_rest)의 직전봉 확정 이벤트가 담당.)
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
_CHANNEL_TF = {v: k for k, v in _TF_CHANNEL.items()}
_TF_MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000,
          "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}


class BitMartIngest:
    def __init__(self, symbols: list[str]):
        self._symbols = [s.upper() for s in symbols if str(s).upper().endswith("USDT")]
        _dropped = [s for s in symbols if not str(s).upper().endswith("USDT")]
        if _dropped:
            logger.warning("bitmart.ws.dropped_non_usdt", count=len(_dropped), sample=_dropped[:5])
        self._tfs = ["1m", "5m", "15m", "1h", "4h", "1d"]
        self._running = False
        self._callbacks: list = []
        self._ticker_callbacks: list = []
        self._ws_list: list = []
        self._reconnect_delay = 3
        # (symbol,tf) → 마지막으로 본 진행중 캔들 (open_time 롤오버 시 직전봉 확정 전파용)
        self._last_candle: dict[str, dict] = {}

    def on_candle(self, cb):
        self._callbacks.append(cb)

    def on_ticker(self, cb):
        self._ticker_callbacks.append(cb)

    async def start(self):
        self._running = True
        # 심볼 3개씩 청크 (3심볼 × (6 kline + 1 ticker) = 21채널/연결, 4096바이트 이내)
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
                args += [f"futures/ticker:{s}" for s in symbols]
                logger.info("bitmart.connecting", symbols=len(symbols), channels=len(args))
                async with websockets.connect(BITMART_WS, ping_interval=None, close_timeout=5) as ws:
                    ws_ref = ws
                    self._ws_list.append(ws)
                    backoff = self._reconnect_delay
                    await ws.send(json.dumps({"action": "subscribe", "args": args}))
                    logger.info("bitmart.connected", chunk=symbols[0] if symbols else "?")
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
        try:
            channel_part, symbol = group.split(":", 1)
            channel = channel_part.split("/", 1)[1]  # klineBin1m / ticker
        except (ValueError, IndexError):
            return

        if channel == "ticker":
            self._emit_ticker(symbol, data)
            return

        tf = _CHANNEL_TF.get(channel)
        if not tf:
            return
        # kline data 는 items 배열 안에 들어온다
        items = data.get("items")
        sym = str(data.get("symbol") or symbol).upper()
        if not isinstance(items, list):
            return
        step_ms = _TF_MS.get(tf, 60_000)
        for it in items:
            try:
                ts = int(it.get("ts", 0))
                open_ms = ts * 1000
                candle = {
                    "source": "BITMART", "symbol": sym, "timeframe": tf,
                    "open_time": open_ms, "close_time": open_ms + step_ms - 1,
                    "open": str(it.get("o")), "high": str(it.get("h")),
                    "low": str(it.get("l")), "close": str(it.get("c")),
                    "volume": str(it.get("v") or 0),
                    "is_final": False,
                }
            except (ValueError, TypeError):
                continue
            # 롤오버 감지: 같은 (symbol,tf)의 open_time 이 커지면 직전 봉을 확정 전파
            k = f"{sym}_{tf}"
            prev = self._last_candle.get(k)
            if prev and prev["open_time"] < open_ms:
                final = {**prev, "is_final": True, "isFinal": True}
                self._dispatch(self._callbacks, final)
            self._last_candle[k] = candle
            self._dispatch(self._callbacks, candle)
            # 1m kline 로 ticker 도 보강(가격 신선도)
            if tf == "1m":
                self._dispatch(self._ticker_callbacks,
                               {"symbol": sym, "last_price": candle["close"], "open": candle["open"]})

    def _emit_ticker(self, symbol, data):
        last = data.get("last_price")
        if last is None:
            return
        sym = str(data.get("symbol") or symbol).upper()
        self._dispatch(self._ticker_callbacks, {
            "symbol": sym,
            "last_price": str(last),
            "open": str(last),  # 티커 채널엔 open 없음 — last 로 대체(변동률은 REST 티커가 제공)
        })

    def _dispatch(self, callbacks, payload):
        for cb in callbacks:
            try:
                asyncio.create_task(cb(payload))
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
