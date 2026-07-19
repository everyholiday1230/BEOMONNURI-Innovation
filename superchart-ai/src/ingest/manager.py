"""수집기 매니저 — BitMart Futures. REST 폴링 + WS 병행.

방식 C: 모든 시세를 BitMart Futures 로 일원화. 심볼 포맷은 Binance 와 동일(BTCUSDT)
이므로 기존 심볼 목록 유틸을 그대로 재사용한다. Binance/Bitget/Gate/Bybit 수집기
(binance_rest, binance_ws)는 코드상 보존하되 사용하지 않는다.
"""
import asyncio
import structlog
from src.ingest.bitmart_rest import BitMartIngestV2
from src.ingest.bitmart_ws import BitMartIngest
from src.services.symbol_resolver import get_binance_symbols

logger = structlog.get_logger(__name__)


def _build_ingest_symbols() -> list[str]:
    """BitMart Futures 수집 대상 심볼 목록. USDT 무기한만, 중복 제거.

    심볼 포맷은 Binance 와 동일하므로 get_binance_symbols() 를 그대로 쓴다.
    (BitMart 계약 목록에서 온 종목도 동일 포맷 BTCUSDT.)
    """
    seen = set()
    out = []
    for api in get_binance_symbols():
        if not api.endswith('USDT'):
            continue
        if api not in seen:
            seen.add(api)
            out.append(api)
    return out


class IngestManager:
    def __init__(self):
        self._rest: BitMartIngestV2 | None = None
        self._ws: BitMartIngest | None = None
        self._candle_subscribers: list = []
        self._ticker_subscribers: list = []
        self._tasks: list[asyncio.Task] = []

    def on_candle(self, cb):
        self._candle_subscribers.append(cb)

    def on_ticker(self, cb):
        self._ticker_subscribers.append(cb)

    async def _dispatch_candle(self, candle: dict):
        # dedupe: 동일 캔들 1초 내 중복 방지 (REST+WS 병행)
        key = f"{candle.get('symbol')}:{candle.get('timeframe')}:{candle.get('open_time')}"
        now = __import__('time').time()
        if not hasattr(self, '_seen'):
            self._seen = {}
            self._seen_last_gc = now
        if key in self._seen and now - self._seen[key] < 1.0:
            return
        self._seen[key] = now
        # GC: 시간 기반 — 매 5초 또는 항목 5000 도달 시
        # (이전: 10000 도달 시만 GC → 트래픽 적으면 무한 누적)
        gc_due = (now - self._seen_last_gc) > 5 or len(self._seen) > 5000
        if gc_due:
            cutoff = now - 5
            self._seen = {k: v for k, v in self._seen.items() if v > cutoff}
            self._seen_last_gc = now
        for cb in self._candle_subscribers:
            try:
                await cb(candle)
            except Exception as e:
                logger.warning("ingest.candle_dispatch_error", error=str(e))

    async def _dispatch_ticker(self, ticker: dict):
        for cb in self._ticker_subscribers:
            try:
                await cb(ticker)
            except Exception as e:
                logger.warning("ingest.ticker_dispatch_error", error=str(e))

    async def start(self):
        syms = _build_ingest_symbols()
        self._rest = BitMartIngestV2(syms)
        self._ws = BitMartIngest(syms)
        self._rest.on_candle(self._dispatch_candle)
        self._rest.on_ticker(self._dispatch_ticker)
        self._ws.on_candle(self._dispatch_candle)
        logger.info("ingest.started", bitmart=len(syms))
        await asyncio.gather(
            self._rest.start(),
            self._ws.start(),
            return_exceptions=True
        )
