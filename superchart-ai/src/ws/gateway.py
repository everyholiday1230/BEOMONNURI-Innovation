"""사용자 WebSocket 게이트웨이.

브라우저 ↔ 우리 서버 ↔ 거래소
클라이언트는 거래소를 직접 안 봄.
"""
import asyncio
import time
from collections import deque
from fastapi import WebSocket
import structlog

try:
    import orjson as _json
except Exception:  # pragma: no cover
    import json as _json

logger = structlog.get_logger(__name__)

MAX_CONNECTIONS = 2000
MAX_PER_IP = 20
WS_SEND_TIMEOUT_SEC = 1.0
MAX_SEND_CONCURRENCY = 200

# subscribe/unsubscribe 제한
MAX_CHANNELS_PER_REQUEST = 50
MAX_SUBSCRIPTIONS_PER_CONN = 300
MAX_INBOUND_MSG_PER_SEC = 60

# 채널별 코얼레싱/백프레셔
TICKER_COALESCE_WINDOW_SEC = 0.08
CANDLE_COALESCE_WINDOW_SEC = 0.05
MAX_PENDING_TICKERS = 2000
MAX_PENDING_CANDLES = 4000
METRICS_HISTORY_MAX = 900
METRICS_SAMPLE_INTERVAL_SEC = 1.0

# 운영 경고 임계치(기본값)
ALERT_PENDING_TICKERS = 1500
ALERT_PENDING_CANDLES = 3000
ALERT_BROADCAST_FAILED = 50
ALERT_BROADCAST_DROPPED = 10
ALERT_INBOUND_RATE_LIMITED = 20

# 거래소 심볼(1000xxx) ↔ 프론트엔드 표준 심볼 매핑.
# 프론트엔드는 'PEPEUSDT'로 구독하지만, Binance는 '1000PEPEUSDT' 심볼로 봉을 보내므로
# 브로드캐스트 키가 어긋난다. 구독 키를 양쪽 형태로 모두 생성해 매칭시킨다.
from src.services.symbol_resolver import SYMBOL_API_MAP, get_reverse_api_map


def _symbol_variants(symbol: str) -> list[str]:
    """주어진 심볼에 대응하는 가능한 모든 표기 반환 (프론트 ↔ 거래소)."""
    rev = get_reverse_api_map()
    out = [symbol]
    if symbol in rev:
        out.append(rev[symbol])
    elif symbol in SYMBOL_API_MAP:
        out.append(SYMBOL_API_MAP[symbol])
    return out


class ConnectionManager:
    """WS 연결 + 구독 관리."""

    def __init__(self):
        self._connections: dict[str, WebSocket] = {}  # conn_id → ws
        self._subscriptions: dict[str, set[str]] = {}  # channel_key → {conn_ids}
        self._ip_counts: dict[str, int] = {}  # ip → count
        self._user_conns: dict[str, set[str]] = {}  # user_id → {conn_ids}
        self._conn_sub_counts: dict[str, int] = {}  # conn_id → subscription count
        self._conn_rate: dict[str, dict[str, float]] = {}  # conn_id → rate state

        # 채널별 코얼레싱 버퍼 (키별 최신값 유지)
        self._pending_tickers: dict[str, dict] = {}
        self._pending_candles: dict[str, dict] = {}
        self._ticker_flush_task: asyncio.Task | None = None
        self._candle_flush_task: asyncio.Task | None = None
        self._send_semaphore = asyncio.Semaphore(MAX_SEND_CONCURRENCY)
        self._metrics_history = deque(maxlen=METRICS_HISTORY_MAX)
        self._last_metrics_sample_ts = 0.0

        # 간단 성능 메트릭
        self._perf = {
            "broadcast_calls": 0,
            "broadcast_sent": 0,
            "broadcast_failed": 0,
            "broadcast_dropped": 0,
            "ticker_coalesced_in": 0,
            "ticker_coalesced_overwrite": 0,
            "ticker_coalesced_flush": 0,
            "candle_coalesced_in": 0,
            "candle_coalesced_overwrite": 0,
            "candle_coalesced_flush": 0,
            "send_user_calls": 0,
            "send_user_sent": 0,
            "inbound_rate_limited": 0,
            "subscription_rejected": 0,
            "last_broadcast_ms": 0.0,
            "avg_broadcast_ms": 0.0,
        }

    async def connect(self, ws: WebSocket) -> str | None:
        ip = ws.client.host if ws.client else "unknown"

        # Origin 검증 — CSWSH (Cross-Site WebSocket Hijacking) 방어
        # CORS 와 동일한 origins 화이트리스트 적용
        origin = ws.headers.get("origin", "")
        if origin:
            from src.middleware.cors import _resolve_origins
            try:
                allowed = _resolve_origins()
            except Exception:
                allowed = ["http://localhost:3000", "http://localhost:8000"]
            if origin not in allowed:
                logger.warning("ws.origin_rejected", ip=ip, origin=origin)
                await ws.close(code=4003, reason="Origin not allowed")
                return None

        if len(self._connections) >= MAX_CONNECTIONS:
            # close code 1013 = Try Again Later → 클라이언트가 길게 백오프
            await ws.close(code=1013, reason="Server at capacity — retry later")
            return None
        if self._ip_counts.get(ip, 0) >= MAX_PER_IP:
            await ws.close(code=1013, reason="Too many connections from this IP — retry later")
            return None

        # 토큰 인증 — token 파라미터 있으면 검증, 실패 시 명시 거부
        # (token 없으면 익명 허용 — 차트 시청만 가능)
        token = ws.query_params.get("token")
        user_id = None
        if token:
            try:
                from src.services.auth import decode_token
                payload = decode_token(token)
                if payload.get("type") == "refresh":
                    # refresh 토큰은 access 용도로 사용 불가
                    await ws.close(code=4001, reason="Refresh token not allowed")
                    return None
                user_id = payload.get("sub")
                if not user_id:
                    await ws.close(code=4001, reason="Invalid token payload")
                    return None
            except Exception as _e:
                # 토큰이 있는데 검증 실패 — 위변조/만료 등. 명시 거부
                logger.warning("ws.gateway.invalid_token", ip=ip, error=str(_e)[:100])
                await ws.close(code=4001, reason="Invalid token")
                return None
        await ws.accept()
        conn_id = f"c_{id(ws)}_{int(time.time()*1000)}"
        self._connections[conn_id] = ws
        self._ip_counts[ip] = self._ip_counts.get(ip, 0) + 1
        self._conn_sub_counts[conn_id] = 0
        self._conn_rate[conn_id] = {"window_start": time.time(), "count": 0}
        if user_id:
            self._user_conns.setdefault(user_id, set()).add(conn_id)
        await ws.send_json({"type": "system.connected", "connId": conn_id, "authenticated": user_id is not None})
        logger.info("ws.connected", conn_id=conn_id, ip=ip, user=user_id)
        return conn_id

    def disconnect(self, conn_id: str):
        ws = self._connections.pop(conn_id, None)
        if ws and ws.client:
            ip = ws.client.host
            self._ip_counts[ip] = max(0, self._ip_counts.get(ip, 1) - 1)

        removed_subs = 0
        for subs in self._subscriptions.values():
            if conn_id in subs:
                subs.discard(conn_id)
                removed_subs += 1

        # user_conns 정리
        for user_id, conns in list(self._user_conns.items()):
            conns.discard(conn_id)
            if not conns:
                del self._user_conns[user_id]

        # 빈 subscription set 정리 (메모리 누수 방지)
        empty_keys = [k for k, v in self._subscriptions.items() if not v]
        for k in empty_keys:
            del self._subscriptions[k]

        self._conn_sub_counts.pop(conn_id, None)
        self._conn_rate.pop(conn_id, None)
        logger.info("ws.disconnected", conn_id=conn_id, removed_subs=removed_subs)

    def _inbound_rate_limited(self, conn_id: str) -> bool:
        state = self._conn_rate.get(conn_id)
        if not state:
            return False
        now = time.time()
        if now - state["window_start"] >= 1.0:
            state["window_start"] = now
            state["count"] = 0
        state["count"] += 1
        if state["count"] > MAX_INBOUND_MSG_PER_SEC:
            self._perf["inbound_rate_limited"] += 1
            self._record_metrics_sample(force=True)
            return True
        return False

    def _record_metrics_sample(self, force: bool = False):
        """경량 WS 성능 시계열 샘플 기록(초 단위)."""
        now = time.time()
        if not force and (now - self._last_metrics_sample_ts) < METRICS_SAMPLE_INTERVAL_SEC:
            return
        self._last_metrics_sample_ts = now
        self._metrics_history.append({
            "ts": round(now, 3),
            "connections": len(self._connections),
            "subscriptions": len(self._subscriptions),
            "pending_tickers": len(self._pending_tickers),
            "pending_candles": len(self._pending_candles),
            "broadcast_failed": int(self._perf.get("broadcast_failed", 0)),
            "broadcast_dropped": int(self._perf.get("broadcast_dropped", 0)),
            "inbound_rate_limited": int(self._perf.get("inbound_rate_limited", 0)),
            "avg_broadcast_ms": float(self._perf.get("avg_broadcast_ms", 0.0)),
        })

    def ws_alerts(self) -> list[dict]:
        """WS 성능 알림 상태 계산."""
        alerts = []
        if len(self._pending_tickers) >= ALERT_PENDING_TICKERS:
            alerts.append({"level": "warning", "code": "WS_PENDING_TICKERS", "value": len(self._pending_tickers), "threshold": ALERT_PENDING_TICKERS})
        if len(self._pending_candles) >= ALERT_PENDING_CANDLES:
            alerts.append({"level": "warning", "code": "WS_PENDING_CANDLES", "value": len(self._pending_candles), "threshold": ALERT_PENDING_CANDLES})
        if int(self._perf.get("broadcast_failed", 0)) >= ALERT_BROADCAST_FAILED:
            alerts.append({"level": "warning", "code": "WS_BROADCAST_FAILED", "value": int(self._perf.get("broadcast_failed", 0)), "threshold": ALERT_BROADCAST_FAILED})
        if int(self._perf.get("broadcast_dropped", 0)) >= ALERT_BROADCAST_DROPPED:
            alerts.append({"level": "critical", "code": "WS_BROADCAST_DROPPED", "value": int(self._perf.get("broadcast_dropped", 0)), "threshold": ALERT_BROADCAST_DROPPED})
        if int(self._perf.get("inbound_rate_limited", 0)) >= ALERT_INBOUND_RATE_LIMITED:
            alerts.append({"level": "info", "code": "WS_INBOUND_RATE_LIMITED", "value": int(self._perf.get("inbound_rate_limited", 0)), "threshold": ALERT_INBOUND_RATE_LIMITED})
        return alerts

    def metrics_history(self, limit: int = 120) -> list[dict]:
        limit = max(1, min(2000, int(limit or 120)))
        if not self._metrics_history:
            self._record_metrics_sample(force=True)
        return list(self._metrics_history)[-limit:]

    def subscribe(self, conn_id: str, channels: list[dict]):
        # 입력 검증 — 부적절한 키 채워서 메모리 폭발 방지
        if not isinstance(channels, list) or len(channels) > MAX_CHANNELS_PER_REQUEST:
            self._perf["subscription_rejected"] += 1
            self._record_metrics_sample(force=True)
            return

        current = self._conn_sub_counts.get(conn_id, 0)
        if current >= MAX_SUBSCRIPTIONS_PER_CONN:
            self._perf["subscription_rejected"] += 1
            self._record_metrics_sample(force=True)
            return

        added = 0
        for ch in channels:
            if not isinstance(ch, dict):
                continue
            if current >= MAX_SUBSCRIPTIONS_PER_CONN:
                break
            name = str(ch.get('name', ''))[:30]
            sym = str(ch.get('symbolId', ''))[:30]
            tf = str(ch.get('timeframe', ''))[:10]
            if not name:
                continue
            key = f"{name}:{sym}:{tf}"
            if key not in self._subscriptions:
                self._subscriptions[key] = set()
            subs = self._subscriptions[key]
            if conn_id in subs:
                continue
            subs.add(conn_id)
            current += 1
            added += 1
            logger.debug('ws.subscribe.key', key=key, conn=conn_id)

        self._conn_sub_counts[conn_id] = current
        if added:
            logger.info("ws.subscribed", conn_id=conn_id, channels=added, total=current)
        self._record_metrics_sample(force=added > 0)

    def unsubscribe(self, conn_id: str, channels: list[dict]):
        if not isinstance(channels, list):
            return
        removed = 0
        for ch in channels:
            if not isinstance(ch, dict):
                continue
            name = str(ch.get('name', ''))[:30]
            sym = str(ch.get('symbolId', ''))[:30]
            tf = str(ch.get('timeframe', ''))[:10]
            key = f"{name}:{sym}:{tf}"
            subs = self._subscriptions.get(key)
            if subs and conn_id in subs:
                subs.discard(conn_id)
                removed += 1
                # 빈 set 즉시 정리 — 메모리 누수 방지
                if not subs:
                    del self._subscriptions[key]
        if removed:
            self._conn_sub_counts[conn_id] = max(0, self._conn_sub_counts.get(conn_id, 0) - removed)
            self._record_metrics_sample(force=True)

    def ticker_symbols(self) -> list[str]:
        """현재 ticker 구독자가 있는 심볼 목록.

        거래소/Redis/leader 장애 시에도 활성 클라이언트에게 최소 ticker
        fallback을 제공하기 위해 public helper로 노출한다.
        """
        symbols: set[str] = set()
        for key, conn_ids in list(self._subscriptions.items()):
            if not conn_ids or not key.startswith("ticker:"):
                continue
            parts = key.split(":", 2)
            if len(parts) >= 2 and parts[1]:
                symbols.add(parts[1])
        return sorted(symbols)

    async def _send_one(self, cid: str, ws: WebSocket, payload: dict, payload_text: str | None):
        async with self._send_semaphore:
            try:
                if payload_text is not None:
                    await asyncio.wait_for(ws.send_text(payload_text), timeout=WS_SEND_TIMEOUT_SEC)
                else:
                    await asyncio.wait_for(ws.send_json(payload), timeout=WS_SEND_TIMEOUT_SEC)
                return cid, True
            except Exception:
                return cid, False

    async def _broadcast_direct(self, channel_name: str, symbol: str, timeframe: str, data: dict) -> int:
        """실제 WS 전송 루틴 (코얼레싱 flush 포함 공용)."""
        t0 = time.perf_counter()
        self._perf["broadcast_calls"] += 1

        # 심볼 변형(프론트/거래소) 모두에 대해 검사
        keys_to_check: list[str] = []
        for s in _symbol_variants(symbol):
            keys_to_check.append(f"{channel_name}:{s}:{timeframe}")
            keys_to_check.append(f"{channel_name}:{s}:")  # timeframe-wildcard

        target_conn_ids: set[str] = set()
        for key in keys_to_check:
            conn_ids = self._subscriptions.get(key)
            if conn_ids:
                target_conn_ids.update(conn_ids)

        if not target_conn_ids:
            elapsed = (time.perf_counter() - t0) * 1000.0
            self._perf["last_broadcast_ms"] = round(elapsed, 3)
            self._perf["avg_broadcast_ms"] = round((self._perf["avg_broadcast_ms"] * 0.9) + (elapsed * 0.1), 3)
            self._record_metrics_sample()
            return 0

        sent = 0
        payload = {"type": f"{channel_name}.update", "data": data}
        try:
            _raw = _json.dumps(payload)
            payload_text = _raw.decode() if isinstance(_raw, (bytes, bytearray)) else _raw
        except Exception:
            payload_text = None
        failed_conns: list[str] = []

        tasks = []
        for conn_id in target_conn_ids:
            ws = self._connections.get(conn_id)
            if ws:
                tasks.append(self._send_one(conn_id, ws, payload, payload_text))

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if isinstance(r, tuple):
                    cid, ok = r
                    if ok:
                        sent += 1
                    else:
                        failed_conns.append(cid)

        for conn_id in failed_conns:
            self.disconnect(conn_id)

        self._perf["broadcast_sent"] += sent
        self._perf["broadcast_failed"] += len(failed_conns)
        elapsed = (time.perf_counter() - t0) * 1000.0
        self._perf["last_broadcast_ms"] = round(elapsed, 3)
        self._perf["avg_broadcast_ms"] = round((self._perf["avg_broadcast_ms"] * 0.9) + (elapsed * 0.1), 3)
        self._record_metrics_sample()
        return sent

    async def _ticker_flush_loop(self):
        """짧은 주기로 심볼별 최신 ticker만 브로드캐스트."""
        try:
            while True:
                await asyncio.sleep(TICKER_COALESCE_WINDOW_SEC)
                if not self._pending_tickers:
                    continue
                snapshot = self._pending_tickers
                self._pending_tickers = {}
                self._perf["ticker_coalesced_flush"] += len(snapshot)
                tasks = [self._broadcast_direct("ticker", sym, "", item) for sym, item in snapshot.items()]
                if tasks:
                    await asyncio.gather(*tasks, return_exceptions=True)
        except asyncio.CancelledError:
            raise
        except Exception as _e:
            logger.warning("ws.ticker_flush_failed", error=str(_e)[:120])
            self._ticker_flush_task = None

    async def _candle_flush_loop(self):
        """짧은 주기로 심볼+타임프레임 최신 진행중 봉만 브로드캐스트."""
        try:
            while True:
                await asyncio.sleep(CANDLE_COALESCE_WINDOW_SEC)
                if not self._pending_candles:
                    continue
                snapshot = self._pending_candles
                self._pending_candles = {}
                self._perf["candle_coalesced_flush"] += len(snapshot)
                tasks = []
                for key, item in snapshot.items():
                    sym, tf = key.split(":", 1)
                    tasks.append(self._broadcast_direct("candle", sym, tf, item))
                if tasks:
                    await asyncio.gather(*tasks, return_exceptions=True)
        except asyncio.CancelledError:
            raise
        except Exception as _e:
            logger.warning("ws.candle_flush_failed", error=str(_e)[:120])
            self._candle_flush_task = None

    def _ensure_ticker_flusher(self):
        if self._ticker_flush_task is None or self._ticker_flush_task.done():
            self._ticker_flush_task = asyncio.create_task(self._ticker_flush_loop())

    def _ensure_candle_flusher(self):
        if self._candle_flush_task is None or self._candle_flush_task.done():
            self._candle_flush_task = asyncio.create_task(self._candle_flush_loop())

    async def broadcast(self, channel_name: str, symbol: str, timeframe: str, data: dict):
        """특정 채널 구독자에게 브로드캐스트.

        - ticker: 심볼별 최신값 코얼레싱
        - candle: 진행중(isFinal=false) 봉만 심볼+TF 기준 코얼레싱
        """
        if channel_name == "ticker":
            symbol_key = symbol or str(data.get("symbol", ""))
            if symbol_key:
                if symbol_key in self._pending_tickers:
                    self._perf["ticker_coalesced_overwrite"] += 1
                elif len(self._pending_tickers) >= MAX_PENDING_TICKERS:
                    self._perf["broadcast_dropped"] += 1
                    self._record_metrics_sample(force=True)
                    return 0
                self._pending_tickers[symbol_key] = data
                self._perf["ticker_coalesced_in"] += 1
                self._ensure_ticker_flusher()
                return 0

        if channel_name == "candle":
            is_final = bool(data.get("isFinal") or data.get("is_final"))
            if not is_final:
                symbol_key = symbol or str(data.get("symbol", ""))
                tf_key = timeframe or str(data.get("timeframe", ""))
                if symbol_key:
                    ckey = f"{symbol_key}:{tf_key}"
                    if ckey in self._pending_candles:
                        self._perf["candle_coalesced_overwrite"] += 1
                    elif len(self._pending_candles) >= MAX_PENDING_CANDLES:
                        self._perf["broadcast_dropped"] += 1
                        self._record_metrics_sample(force=True)
                        return 0
                    self._pending_candles[ckey] = data
                    self._perf["candle_coalesced_in"] += 1
                    self._ensure_candle_flusher()
                    return 0

        return await self._broadcast_direct(channel_name, symbol, timeframe, data)

    async def handle_message(self, conn_id: str, msg: dict):
        if self._inbound_rate_limited(conn_id):
            ws = self._connections.get(conn_id)
            if ws:
                try:
                    await ws.send_json({"type": "system.rate_limited", "message": "Too many WS messages"})
                except Exception:
                    self.disconnect(conn_id)
            return

        action = msg.get("action")
        if action == "subscribe":
            self.subscribe(conn_id, msg.get("channels", []))
        elif action == "unsubscribe":
            self.unsubscribe(conn_id, msg.get("channels", []))
        elif action == "ping":
            ws = self._connections.get(conn_id)
            if ws:
                await ws.send_json({"type": "pong"})

    async def send_to_user(self, user_id: str, data: dict) -> int:
        """특정 사용자의 모든 WS 연결에 메시지 전송. 전송된 연결 수 반환."""
        self._perf["send_user_calls"] += 1
        if not user_id:
            return 0
        conn_ids = list(self._user_conns.get(user_id, set()))
        if not conn_ids:
            return 0

        try:
            _raw = _json.dumps(data)
            payload_text = _raw.decode() if isinstance(_raw, (bytes, bytearray)) else _raw
        except Exception:
            payload_text = None

        tasks = []
        for cid in conn_ids:
            ws = self._connections.get(cid)
            if ws:
                tasks.append(self._send_one(cid, ws, data, payload_text))

        sent = 0
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if isinstance(r, tuple):
                    cid, ok = r
                    if ok:
                        sent += 1
                    else:
                        self.disconnect(cid)
        self._perf["send_user_sent"] += sent
        self._record_metrics_sample()
        return sent

    def metrics_snapshot(self) -> dict:
        self._record_metrics_sample()
        return {
            **self._perf,
            "connection_count": len(self._connections),
            "subscription_keys": len(self._subscriptions),
            "pending_tickers": len(self._pending_tickers),
            "pending_candles": len(self._pending_candles),
            "send_concurrency": MAX_SEND_CONCURRENCY,
            "max_subscriptions_per_conn": MAX_SUBSCRIPTIONS_PER_CONN,
            "max_inbound_msg_per_sec": MAX_INBOUND_MSG_PER_SEC,
            "metrics_history_size": len(self._metrics_history),
            "alerts": self.ws_alerts(),
        }

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def close_all(self):
        """모든 WS 연결 종료 (graceful shutdown)."""
        if self._ticker_flush_task and not self._ticker_flush_task.done():
            self._ticker_flush_task.cancel()
            try:
                await self._ticker_flush_task
            except Exception:
                pass
        if self._candle_flush_task and not self._candle_flush_task.done():
            self._candle_flush_task.cancel()
            try:
                await self._candle_flush_task
            except Exception:
                pass

        for conn_id, ws in list(self._connections.items()):
            try:
                await ws.close(code=1001, reason="Server shutdown")
            except Exception as _e:
                logger.debug("ws.gateway.silent_except", error=str(_e)[:100])
        self._connections.clear()
        self._subscriptions.clear()
        self._ip_counts.clear()
        self._user_conns.clear()
        self._conn_sub_counts.clear()
        self._conn_rate.clear()
        self._pending_tickers.clear()
        self._pending_candles.clear()
        self._metrics_history.clear()

    async def cleanup_dead(self):
        """죽은 WS 연결 정리 — 주기적 호출용."""
        dead = []
        for conn_id, ws in list(self._connections.items()):
            try:
                if ws.client_state.name != "CONNECTED":
                    dead.append(conn_id)
            except Exception:
                dead.append(conn_id)
        for conn_id in dead:
            self.disconnect(conn_id)
        if dead:
            logger.info("ws.cleanup", removed=len(dead), remaining=len(self._connections))


# 싱글톤
ws_manager = ConnectionManager()
