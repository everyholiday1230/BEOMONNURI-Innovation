"""독립 WebSocket 서버 — 포트 8001에서 실행.
Redis Pub/Sub에서 캔들/티커 수신 → 연결된 클라이언트에 브로드캐스트.
"""
import asyncio
import json
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn

from src.ws.pubsub import subscribe_loop
from src.ws.gateway import WSManager

app = FastAPI()
ws_manager = WSManager()


@app.websocket("/v1/ws")
async def websocket_endpoint(websocket: WebSocket):
    """클라이언트 WS 연결 처리."""
    await ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # 클라이언트 → 서버 메시지 처리 (subscribe/unsubscribe)
            try:
                msg = json.loads(data)
                action = msg.get("action")
                if action == "subscribe":
                    symbol = msg.get("symbol", "")
                    timeframe = msg.get("timeframe", "")
                    ws_manager.subscribe(websocket, symbol, timeframe)
                elif action == "unsubscribe":
                    symbol = msg.get("symbol", "")
                    ws_manager.unsubscribe(websocket, symbol)
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


@app.get("/health")
async def health():
    return {"status": "ok", "ws_connections": ws_manager.connection_count(), "role": "ws_server"}


async def _redis_listener():
    """Redis Pub/Sub → WS 브로드캐스트."""
    async def on_candle(data):
        symbol = data.get("symbol", "")
        timeframe = data.get("timeframe", "")
        await ws_manager.broadcast("candle", symbol, timeframe, data)

    async def on_ticker(data):
        symbol = data.get("symbol", "")
        await ws_manager.broadcast("ticker", symbol, "", data)

    while True:
        try:
            await subscribe_loop(on_candle, on_ticker)
        except Exception as e:
            print(f"[WS] Redis subscribe error: {e}, reconnecting in 3s...")
            await asyncio.sleep(3)


@app.on_event("startup")
async def startup():
    asyncio.create_task(_redis_listener())
    print("[WS Server] Started on :8001, listening Redis Pub/Sub")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
