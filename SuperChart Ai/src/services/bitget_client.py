"""비트겟 Futures API 클라이언트 — 재시도, 속도제한, 양방향 레버리지."""
import asyncio
import hashlib
import hmac
import time
import base64
import json
import httpx

BASE = "https://api.bitget.com"
MAX_RETRIES = 3
TIMEOUT = 20
_last_call = 0.0
_call_lock = asyncio.Lock() if hasattr(asyncio, 'Lock') else None


class BitgetClient:
    def __init__(self, api_key: str, secret: str, passphrase: str):
        self._key = api_key
        self._secret = secret
        self._passphrase = passphrase
        self._product_type = "USDT-FUTURES"
        self._leverage_cache = set()  # 이미 설정한 심볼

    def _sign(self, ts: str, method: str, path: str, body: str = "") -> str:
        msg = ts + method.upper() + path + body
        mac = hmac.new(self._secret.encode(), msg.encode(), hashlib.sha256)
        return base64.b64encode(mac.digest()).decode()

    def _headers(self, method: str, path: str, body: str = "") -> dict:
        ts = str(int(time.time() * 1000))
        return {
            "ACCESS-KEY": self._key,
            "ACCESS-SIGN": self._sign(ts, method, path, body),
            "ACCESS-TIMESTAMP": ts,
            "ACCESS-PASSPHRASE": self._passphrase,
            "Content-Type": "application/json",
            "locale": "en-US",
        }

    async def _request(self, method: str, path: str, params: dict | None = None, body: dict | None = None) -> dict:
        # 속도 제한: 최소 100ms 간격
        global _last_call
        now = time.time()
        wait = 0.1 - (now - _last_call)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_call = time.time()

        url = BASE + path
        body_str = json.dumps(body) if body else ""
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items())
            path = path + "?" + qs
            url = BASE + path
        headers = self._headers(method, path, body_str)

        # 재시도 로직
        for attempt in range(MAX_RETRIES):
            try:
                async with httpx.AsyncClient(timeout=TIMEOUT) as c:
                    if method == "GET":
                        r = await c.get(url, headers=headers)
                    else:
                        r = await c.post(url, headers=headers, content=body_str)
                    return r.json()
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    await asyncio.sleep(1 * (attempt + 1))
                else:
                    return {"code": "error", "msg": str(e)}

    # ── 계좌 ──
    async def get_balance(self) -> dict:
        return await self._request("GET", "/api/v2/mix/account/accounts", {"productType": self._product_type})

    async def get_position(self, symbol: str = "") -> dict:
        params = {"productType": self._product_type}
        if symbol:
            params["symbol"] = symbol
        return await self._request("GET", "/api/v2/mix/position/all-position", params)

    # ── 주문 ──
    async def place_order(self, symbol: str, side: str, size: str,
                          order_type: str = "market", price: str = "",
                          trade_side: str = "open", leverage: str = "10",
                          margin_mode: str = "crossed") -> dict:
        body = {
            "symbol": symbol,
            "productType": self._product_type,
            "marginMode": margin_mode,
            "marginCoin": "USDT",
            "side": side,
            "tradeSide": trade_side,
            "orderType": order_type,
            "size": size,
        }
        if price and order_type == "limit":
            body["price"] = price
        # 레버리지 양방향 설정 (최초 1회)
        await self._ensure_leverage(symbol, leverage, margin_mode)
        return await self._request("POST", "/api/v2/mix/order/place-order", body=body)

    async def close_position(self, symbol: str, side: str, size: str, hold_side: str = "") -> dict:
        """포지션 청산 — close-positions API 사용 (헤지모드 호환)."""
        body = {
            "symbol": symbol,
            "productType": self._product_type,
            "holdSide": hold_side or ("short" if side == "buy" else "long"),
        }
        if size and size != "0":
            body["size"] = size
        return await self._request("POST", "/api/v2/mix/order/close-positions", body=body)

    async def _ensure_leverage(self, symbol: str, leverage: str, margin_mode: str = "crossed"):
        """롱/숏 양방향 레버리지 설정 (심볼당 1회)."""
        cache_key = f"{symbol}:{leverage}"
        if cache_key in self._leverage_cache:
            return
        for hold_side in ["long", "short"]:
            body = {
                "symbol": symbol,
                "productType": self._product_type,
                "marginCoin": "USDT",
                "leverage": leverage,
                "holdSide": hold_side,
            }
            await self._request("POST", "/api/v2/mix/account/set-leverage", body=body)
        self._leverage_cache.add(cache_key)

    # ── 시세 ──
    async def get_ticker(self, symbol: str) -> dict:
        return await self._request("GET", "/api/v2/mix/market/ticker", {"symbol": symbol, "productType": self._product_type})

    async def get_candles(self, symbol: str, granularity: str = "15m", limit: int = 300) -> dict:
        return await self._request("GET", "/api/v2/mix/market/candles", {
            "symbol": symbol, "productType": self._product_type,
            "granularity": granularity, "limit": str(limit),
        })

    async def get_open_orders(self, symbol: str):
        path = "/api/v2/mix/order/orders-pending"
        params = {"productType": self._product_type}
        if symbol: params["symbol"] = symbol
        return await self._request("GET", path, params=params)

    async def cancel_order(self, symbol: str, order_id: str):
        path = "/api/v2/mix/order/cancel-order"
        body = {"symbol": symbol, "orderId": order_id, "productType": self._product_type}
        return await self._request("POST", path, body=body)
