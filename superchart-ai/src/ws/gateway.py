"""사용자 WebSocket 게이트웨이.

브라우저 ↔ 우리 서버 ↔ 거래소
클라이언트는 거래소를 직접 안 봄.
"""
import time
from fastapi import WebSocket
import structlog

logger = structlog.get_logger(__name__)

MAX_CONNECTIONS = 2000
MAX_PER_IP = 20

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
        for subs in self._subscriptions.values():
            subs.discard(conn_id)
        # user_conns 정리
        for user_id, conns in list(self._user_conns.items()):
            conns.discard(conn_id)
            if not conns:
                del self._user_conns[user_id]
        # 빈 subscription set 정리 (메모리 누수 방지)
        empty_keys = [k for k, v in self._subscriptions.items() if not v]
        for k in empty_keys:
            del self._subscriptions[k]
        logger.info("ws.disconnected", conn_id=conn_id)

    def subscribe(self, conn_id: str, channels: list[dict]):
        # 입력 검증 — 부적절한 키 채워서 메모리 폭발 방지
        if not isinstance(channels, list) or len(channels) > 50:
            return
        added = 0
        for ch in channels:
            if not isinstance(ch, dict):
                continue
            name = str(ch.get('name', ''))[:30]
            sym = str(ch.get('symbolId', ''))[:30]
            tf = str(ch.get('timeframe', ''))[:10]
            if not name:
                continue
            key = f"{name}:{sym}:{tf}"
            if key not in self._subscriptions:
                self._subscriptions[key] = set()
            self._subscriptions[key].add(conn_id)
            added += 1
            logger.info('debug.subscribe.key', key=key, conn=conn_id)
        if added:
            logger.info("ws.subscribed", conn_id=conn_id, channels=added)

    def unsubscribe(self, conn_id: str, channels: list[dict]):
        if not isinstance(channels, list):
            return
        for ch in channels:
            if not isinstance(ch, dict):
                continue
            name = str(ch.get('name', ''))[:30]
            sym = str(ch.get('symbolId', ''))[:30]
            tf = str(ch.get('timeframe', ''))[:10]
            key = f"{name}:{sym}:{tf}"
            subs = self._subscriptions.get(key)
            if subs:
                subs.discard(conn_id)
                # 빈 set 즉시 정리 — 메모리 누수 방지
                if not subs:
                    del self._subscriptions[key]

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

    async def broadcast(self, channel_name: str, symbol: str, timeframe: str, data: dict):
        """특정 채널 구독자에게 브로드캐스트.

        동일 채널명이 일치하는 키만 매칭. 중복 전송 방지를 위해 conn_id 집합으로 dedupe.
        PEPE/SHIB/BONK/FLOKI 처럼 거래소 내부 심볼(1000xxx)과 프론트엔드 표시 심볼이
        다른 경우에도 매칭되도록 양쪽 변형 키를 모두 확인한다.
        """
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
            return 0

        sent = 0
        payload = {"type": f"{channel_name}.update", "data": data}
        failed_conns: list[str] = []
        # 동시 전송 + 개별 timeout (느린 클라이언트가 전체 broadcast 를 지연시키지 않도록)
        # 감사 보고서 6.1 반영
        import asyncio as _asyncio
        async def _send_one(cid: str, w):
            try:
                await _asyncio.wait_for(w.send_json(payload), timeout=2.0)
                return cid, True
            except Exception:
                return cid, False
        tasks = []
        active_ids: list[str] = []
        for conn_id in target_conn_ids:
            ws = self._connections.get(conn_id)
            if ws:
                tasks.append(_send_one(conn_id, ws))
                active_ids.append(conn_id)
        if tasks:
            results = await _asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if isinstance(r, tuple):
                    cid, ok = r
                    if ok:
                        sent += 1
                    else:
                        failed_conns.append(cid)
                else:
                    # Exception 이 올라온 경우 — 어느 conn 인지 알 수 없으니 전체 재검증은 하지 않음
                    pass
        for conn_id in failed_conns:
            self.disconnect(conn_id)
        return sent

    async def handle_message(self, conn_id: str, msg: dict):
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
        if not user_id:
            return 0
        conn_ids = list(self._user_conns.get(user_id, set()))
        sent = 0
        for cid in conn_ids:
            ws = self._connections.get(cid)
            if not ws:
                continue
            try:
                await ws.send_json(data)
                sent += 1
            except Exception as _e:
                logger.debug("ws.gateway.silent_except", error=str(_e)[:100])
        return sent

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    async def close_all(self):
        """모든 WS 연결 종료 (graceful shutdown)."""
        for conn_id, ws in list(self._connections.items()):
            try:
                await ws.close(code=1001, reason="Server shutdown")
            except Exception as _e:
                logger.debug("ws.gateway.silent_except", error=str(_e)[:100])
        self._connections.clear()
        self._subscriptions.clear()
        self._ip_counts.clear()
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
