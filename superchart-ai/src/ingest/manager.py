"""수집기 매니저 — Binance Futures. REST 폴링 + WS 병행."""
import asyncio
import structlog
from src.ingest.binance_rest import BinanceIngestV2
from src.ingest.binance_ws import BinanceIngest
from src.services.symbol_resolver import get_binance_symbols

logger = structlog.get_logger(__name__)


def _build_ingest_symbols() -> list[str]:
    """Binance Futures 수집 대상(crypto) API 심볼 목록 생성. 중복 제거.

    - crypto(exchange_id=2)만 포함. 주식/ETF/원자재(TWELVE_DATA)는 Binance 미상장 →
      REST `Invalid symbol`(code -2) / WS `HTTP 400` 유발하므로 제외.
    - Futures 미상장 Spot 전용 밈코인 등도 추가 제외 (error=-2 방지).
    """
    # Futures에 없는 종목 (Spot 전용 밈코인 등)
    _FUTURES_EXCLUDED = {'BONKUSDT', 'FLOKIUSDT', 'LUNCUSDT', 'PEPEUSDT', 'RADUSDT', 'SHIBUSDT'}
    seen = set()
    out = []
    for api in get_binance_symbols():
        if api in _FUTURES_EXCLUDED:
            continue
        # 안전장치: Binance Futures USDT 무기한만 허용 (오염 심볼 차단)
        if not api.endswith('USDT'):
            continue
        if api not in seen:
            seen.add(api)
            out.append(api)
    return out


class IngestManager:
    def __init__(self):
        self._rest: BinanceIngestV2 | None = None
        self._ws: BinanceIngest | None = None
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
        self._rest = BinanceIngestV2(syms)
        self._ws = BinanceIngest(syms)
        self._rest.on_candle(self._dispatch_candle)
        self._rest.on_ticker(self._dispatch_ticker)
        self._ws.on_candle(self._dispatch_candle)
        logger.info("ingest.started", binance=len(syms))
        await asyncio.gather(
            self._rest.start(),
            self._ws.start(),
            return_exceptions=True
        )

    async def stop(self):
        if self._rest:
            await self._rest.stop()
        if self._ws:
            await self._ws.stop()
        for t in self._tasks:
            if not t.done():
                t.cancel()
        logger.info("ingest.stopped")
