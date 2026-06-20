"""캔들 DB 저장 - 배치 인서트 + 마감봉만.

설계:
- 마감되지 않은 봉(is_final=False)은 저장 안 함 (불필요한 쓰기 방지)
- 100개 또는 5초마다 배치 INSERT
- ON CONFLICT (symbol_id, exchange_id, timeframe, open_time) DO UPDATE
- 메모리 큐 무한 증가 방지 (max 5000)
"""
import asyncio
import time
from datetime import datetime, timezone
import structlog
from sqlalchemy import text

logger = structlog.get_logger(__name__)

# 큐 크기 제한 (메모리 안전)
MAX_QUEUE_SIZE = 5000
BATCH_SIZE = 100
FLUSH_INTERVAL_SEC = 5.0


class CandleDBWriter:
    def __init__(self):
        self._queue: list[dict] = []
        self._lock = asyncio.Lock()
        self._last_flush = 0.0
        self._symbol_id_cache: dict[str, str] = {}  # symbol_code → uuid
        self._stats = {
            'queued': 0,
            'flushed': 0,
            'failed': 0,
            'last_flush_at': 0.0,
        }
    
    @property
    def stats(self) -> dict:
        return {**self._stats, 'queue_size': len(self._queue)}
    
    async def _load_symbol_cache(self):
        """symbol_code → uuid 매핑 로드."""
        from src.db.session import SessionLocal
        async with SessionLocal() as db:
            rows = (await db.execute(text(
                "SELECT id::text, symbol_code FROM symbols"
            ))).all()
        self._symbol_id_cache = {row[1]: row[0] for row in rows}
        logger.info("candle_writer.symbol_cache_loaded", count=len(self._symbol_id_cache))
    
    async def enqueue(self, candle: dict):
        """캔들을 큐에 추가. 마감봉만 저장."""
        # 마감된 봉만 저장
        if not (candle.get('isFinal') or candle.get('is_final')):
            return
        
        # 큐 크기 제한 (메모리 안전)
        if len(self._queue) >= MAX_QUEUE_SIZE:
            logger.warning("candle_writer.queue_full", size=len(self._queue))
            return
        
        async with self._lock:
            self._queue.append(candle)
            self._stats['queued'] += 1
        
        # 즉시 flush 조건: 배치 크기 도달
        if len(self._queue) >= BATCH_SIZE:
            asyncio.create_task(self._maybe_flush())
    
    async def _maybe_flush(self):
        """flush 시도 (다른 task 동시 실행 방지)."""
        now = time.time()
        if now - self._last_flush < 1.0:  # rate limit
            return
        await self.flush()
    
    async def flush(self):
        """큐의 모든 캔들을 DB에 INSERT."""
        async with self._lock:
            if not self._queue:
                return
            batch = self._queue[:]
            self._queue.clear()
        
        # symbol cache 비어있으면 로드
        if not self._symbol_id_cache:
            try:
                await self._load_symbol_cache()
            except Exception as e:
                logger.error("candle_writer.cache_load_failed", error=str(e))
                return
        
        # 변환 + UPSERT
        from src.db.session import SessionLocal
        rows_to_insert = []
        for c in batch:
            sym = c.get('symbol', '')
            sym_id = self._symbol_id_cache.get(sym)
            if not sym_id:
                continue
            try:
                ot = c.get('open_time') or c.get('openTime')
                ct = c.get('close_time') or c.get('closeTime')
                if isinstance(ot, (int, float)):
                    ot_dt = datetime.fromtimestamp(int(ot) / 1000, tz=timezone.utc)
                elif isinstance(ot, str):
                    ot_dt = datetime.fromtimestamp(int(ot) / 1000, tz=timezone.utc) if ot.isdigit() else datetime.fromisoformat(ot)
                else:
                    continue
                if isinstance(ct, (int, float)):
                    ct_dt = datetime.fromtimestamp(int(ct) / 1000, tz=timezone.utc)
                elif isinstance(ct, str):
                    ct_dt = datetime.fromtimestamp(int(ct) / 1000, tz=timezone.utc) if ct.isdigit() else datetime.fromisoformat(ct)
                else:
                    ct_dt = ot_dt
                
                rows_to_insert.append({
                    'symbol_id': sym_id,
                    'exchange_id': int(c.get('exchange_id', 1)),
                    'timeframe': c.get('timeframe', '1m'),
                    'open_time': ot_dt,
                    'close_time': ct_dt,
                    'open': str(c.get('open', 0)),
                    'high': str(c.get('high', 0)),
                    'low': str(c.get('low', 0)),
                    'close': str(c.get('close', 0)),
                    'volume': str(c.get('volume', 0)),
                    'quote_volume': str(c.get('quote_volume', c.get('quoteVolume', 0)) or 0),
                    'trade_count': int(c.get('trade_count', c.get('count', 0)) or 0),
                    'is_final': True,
                })
            except Exception as e:
                logger.warning("candle_writer.parse_error", error=str(e), symbol=sym)
                continue
        
        if not rows_to_insert:
            return
        
        try:
            async with SessionLocal() as db:
                # PostgreSQL UPSERT (ON CONFLICT)
                await db.execute(text("""
                    INSERT INTO candle_bars (
                        symbol_id, exchange_id, timeframe, open_time, close_time,
                        open, high, low, close, volume, quote_volume, trade_count, is_final
                    ) VALUES (
                        :symbol_id, :exchange_id, :timeframe, :open_time, :close_time,
                        :open, :high, :low, :close, :volume, :quote_volume, :trade_count, :is_final
                    )
                    ON CONFLICT (symbol_id, exchange_id, timeframe, open_time)
                    DO UPDATE SET
                        close_time = EXCLUDED.close_time,
                        open = EXCLUDED.open,
                        high = EXCLUDED.high,
                        low = EXCLUDED.low,
                        close = EXCLUDED.close,
                        volume = EXCLUDED.volume,
                        quote_volume = EXCLUDED.quote_volume,
                        trade_count = EXCLUDED.trade_count,
                        is_final = EXCLUDED.is_final,
                        ingested_at = now()
                """), rows_to_insert)
                await db.commit()
            self._stats['flushed'] += len(rows_to_insert)
            self._last_flush = time.time()
            self._stats['last_flush_at'] = self._last_flush
            logger.debug("candle_writer.flushed", count=len(rows_to_insert))
        except Exception as e:
            self._stats['failed'] += len(rows_to_insert)
            logger.error("candle_writer.flush_failed", error=str(e), count=len(rows_to_insert))
    
    async def periodic_flush_loop(self):
        """주기적 flush (시간 기준)."""
        while True:
            try:
                await asyncio.sleep(FLUSH_INTERVAL_SEC)
                await self._maybe_flush()
            except asyncio.CancelledError:
                # 종료 시 마지막 flush
                await self.flush()
                raise
            except Exception as e:
                logger.warning("candle_writer.periodic_error", error=str(e))


# 싱글톤 인스턴스
candle_writer = CandleDBWriter()
