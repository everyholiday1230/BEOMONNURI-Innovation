"""V2 실전 매매 — PRO 전략 (1h메인+5m타이밍, 점수기반, Optuna최적화)."""
import asyncio
import os
import time
import json as _json
import numpy as np
import structlog
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from pathlib import Path

from src.services.bitget_client import BitgetClient
from src.services.strategy_v12 import decide_v12, calc_indicators, PARAMS
from src.services.beom_candle import compute_ultra_trend
from src.services.market import fetch_candles as binance_fetch
from src.services.symbol_resolver import get_all_symbols, get_api_symbol

logger = structlog.get_logger(__name__)
KST = timezone(timedelta(hours=9))
BASE_DIR = Path(__file__).resolve().parent.parent.parent
LOG_DIR = BASE_DIR / "logs"; LOG_DIR.mkdir(exist_ok=True)

SYMBOLS = []  # start() 시점에 DB에서 로드
LEVERAGE = "12"
ENTRY_USDT = 1000.0  # 마진 기준 (명목 = 마진 × 레버리지)

@dataclass
class Slot:
    symbol: str = ""
    side: str = ""
    entry_price: float = 0.0
    qty: float = 0.0
    ep: float = 0.0
    ep_orig: float = 0.0
    peak: float = 0.0
    atr: float = 0.0
    sl: float = 0.0
    tr: float = 0.0
    tp1: float = 0.0
    tp1_hit: bool = False
    score: float = 0.0
    trades: list = field(default_factory=list)

class LiveTraderV2:
    def __init__(self):
        self._client = None
        self.running = False
        self.start_time = 0.0
        self._task = None
        self.slots: dict[str, Slot] = {}
        self.logs: list = []
        self.action_markers: list = []
        self._cached_positions: list = []
        self._order_locks: dict = {}
        self._ordering: set = set()  # 주문 진행 중인 종목
        self._restored = False  # 포지션 복원 완료 여부
        # 1h 지표 캐시 (종목별)
        self._1h_cache: dict = {}
        self._1h_last_update: dict = {}

    def _log(self, msg, **kw):
        now = datetime.now(KST).strftime("%H:%M:%S")
        entry = {"time": now, "msg": msg, **kw}
        self.logs.append(entry)
        if len(self.logs) > 500: self.logs = self.logs[-300:]
        logger.info("live_v2", msg=msg, **kw)
        try:
            with open(LOG_DIR / f"live_v2_{datetime.now(KST).strftime('%Y%m%d')}.jsonl", "a") as f:
                f.write(_json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception as _e: pass  # non-critical

    def _save_state(self, running: bool):
        try:
            with open(BASE_DIR / "data" / "live_state.json", "w") as f:
                _json.dump({"running": running}, f)
        except Exception: pass  # non-critical

    @staticmethod
    def was_running() -> bool:
        try:
            with open(BASE_DIR / "data" / "live_state.json") as f:
                return _json.load(f).get("running", False)
        except Exception:
            return False

    def _mark(self, sym, action, price, label):
        self.action_markers.append({"symbol": sym, "action": action, "price": price,
            "label": label, "time": time.time(), "time_str": datetime.now(KST).strftime("%H:%M:%S")})
        if len(self.action_markers) > 500: self.action_markers = self.action_markers[-300:]

    def start(self, balance=10000.0):
        global SYMBOLS
        if self.running: return {"status": "already_running"}
        SYMBOLS = get_all_symbols()
        env_path = BASE_DIR / ".env"
        if env_path.exists():
            from dotenv import load_dotenv
            load_dotenv(env_path, override=False)
        key = os.getenv("BITGET_API_KEY", "")
        secret = os.getenv("BITGET_API_SECRET", "")
        passphrase = os.getenv("BITGET_PASSPHRASE", "")
        if not all([key, secret, passphrase]):
            return {"status": "error", "msg": "API 키 없음"}
        self._client = BitgetClient(key, secret, passphrase)
        self.running = True; self.start_time = time.time()
        self.slots = {sym: Slot(symbol=sym) for sym in SYMBOLS}
        self._ordering = set()
        self._restored = False
        asyncio.create_task(self._restore_positions())
        asyncio.create_task(self._cancel_pending_orders())
        self._task = asyncio.create_task(self._loop())
        self._log("PRO 실전 시작", symbols=len(SYMBOLS), leverage=LEVERAGE)
        self._save_state(True)
        return {"status": "started", "symbols": list(self.slots.keys()), "leverage": LEVERAGE}

    async def _restore_positions(self):
        try:
            resp = await self._client.get_position("")
            for p in resp.get("data", []):
                total = float(p.get("total", 0))
                if total <= 0: continue
                sym = p.get("symbol", "")
                if sym not in self.slots: continue
                slot = self.slots[sym]
                slot.side = p.get("holdSide", "")
                slot.entry_price = float(p.get("openPriceAvg", 0))
                slot.qty = total
                slot.peak = slot.entry_price
                # 1h ATR 계산하여 sl/tr/tp1 복원
                try:
                    m1h = await self._update_1h(sym)
                    if m1h:
                        slot.atr = m1h['atr']
                        slot.sl = PARAMS['sl']
                        slot.tr = PARAMS['tr']
                        sd = 1 if slot.side == 'long' else -1
                        slot.tp1 = slot.entry_price + sd * slot.atr * PARAMS['tp1_r']
                        slot.ep = 1.0; slot.ep_orig = 1.0
                        self._log(f"포지션 복원: {sym} {slot.side} @ ${slot.entry_price} atr={slot.atr:.1f} sl={slot.sl:.1f}")
                    else:
                        self._log(f"포지션 복원 (ATR 없음): {sym} {slot.side} @ ${slot.entry_price}")
                except Exception as e2:
                    self._log(f"포지션 ATR 복원 실패 {sym}: {e2}")
        except Exception as e:
            self._log(f"포지션 복원 에러: {e}")
        self._restored = True

    async def _cancel_pending_orders(self):
        """서버 시작 시 미체결 주문 자동 취소."""
        if not self._client: return
        try:
            resp = await self._client.get_open_orders("")
            orders = resp.get("data", {}).get("entrustedList", [])
            for o in orders:
                oid = o.get("orderId", "")
                sym = o.get("symbol", "")
                if oid:
                    await self._client.cancel_order(sym, oid)
                    self._log(f"미체결 주문 취소: {sym} {oid}")
        except Exception as e:
            self._log(f"미체결 주문 취소 에러: {e}")

    async def stop(self):
        self.running = False
        if self._task: self._task.cancel(); self._task = None
        self._log("PRO 실전 중지")
        self._save_state(False)
        return {"status": "stopped"}

    def get_status(self):
        return {
            "running": self.running,
            "uptime_sec": int(time.time() - self.start_time) if self.running else 0,
            "symbols": list(self.slots.keys()), "leverage": LEVERAGE, "entry_usdt": ENTRY_USDT,
            "strategy": "PRO:점수+시너지+분할청산",
            "active_positions": self._cached_positions,
            "total_trades": sum(len(s.trades) for s in self.slots.values()),
            "logs": self.logs[-30:],
            "action_markers": self.action_markers[-200:],
        }

    async def _sync_positions(self):
        if not self._client: return
        try:
            resp = await self._client.get_position("")
            self._cached_positions = [
                {"symbol": p.get("symbol"), "side": p.get("holdSide"),
                 "entry": float(p.get("openPriceAvg", 0)),
                 "pnl": float(p.get("unrealizedPL", 0)),
                 "pnl_pct": round(float(p.get("unrealizedPL", 0)) / max(float(p.get("margin", 1)), 0.01) * 100, 2),
                 "leverage": p.get("leverage"),
                 "margin": round(float(p.get("margin", 0)), 2),
                 "mark": float(p.get("markPrice", 0))}
                for p in resp.get("data", []) if float(p.get("total", 0)) > 0
            ]
        except Exception as _e: pass  # non-critical

    async def _update_1h(self, sym):
        """1h 지표 업데이트 (5분마다)"""
        now = time.time()
        if sym in self._1h_last_update and now - self._1h_last_update[sym] < 120:
            return self._1h_cache.get(sym)
        try:
            bsym = get_api_symbol(sym)
            candles = await binance_fetch(bsym, 0, '1h', 2000)
            if not candles or len(candles) < 300: return None
            ind = calc_indicators(candles)
            n = ind['c'].shape[0]
            ut = compute_ultra_trend(candles)
            bars = ut.get('d', [])
            bss = bars[-1].get('v', 0) if bars else 0
            state = {
                'stn': float(ind['stn'][n-1]), 'stn_prev': float(ind['stn'][n-2]),
                'ur': float(ind['ur'][n-1]), 'us': float(ind['us'][n-1]),
                'tg': float((ind['t60'][n-1]-ind['t200'][n-1])/max(ind['atr'][n-1],1)),
                'bss': bss, 'atr': float(ind['atr'][n-1]),
                'atr_ma': float(ind['atr_ma'][n-1]) if ind['atr_ma'][n-1] > 0 else float(ind['atr'][n-1]),
                'slope': float(ind['t60_slope'][n-1]) if hasattr(ind,'__contains__') or 't60_slope' in ind else 0,
                'tb': bool(ind['t60'][n-1] > ind['t200'][n-1]),
            }
            self._1h_cache[sym] = state
            self._1h_last_update[sym] = now
            return state
        except Exception: return self._1h_cache.get(sym)

    async def _loop(self):
        await asyncio.sleep(5)
        self._log("루프 시작됨")
        while self.running:
            try:
                self._log(f"루프 틱 시작 ({len(SYMBOLS)}종목)")
                for sym in SYMBOLS:
                    if not self.running: break
                    await self._tick(sym)
                    await asyncio.sleep(1)
            except Exception as e:
                self._log(f"루프 에러: {e}")
            await self._sync_positions()
            await asyncio.sleep(15)

    async def _tick(self, sym):
        if sym not in self._order_locks:
            self._order_locks[sym] = asyncio.Lock()
        async with self._order_locks[sym]:
            await self._tick_inner(sym)

    async def _tick_inner(self, sym):
        slot = self.slots.get(sym)
        if not slot: return

        # 5m 캔들
        bsym = get_api_symbol(sym)
        try:
            candles = await binance_fetch(bsym, 0, '5m', 2000)
        except Exception: return
        if not candles or len(candles) < 300: return

        c = np.array([float(x['close']) for x in candles])
        n = len(c); price = c[-1]

        # 5m 지표
        ind5 = calc_indicators(candles)
        ut5 = compute_ultra_trend(candles)
        bars5 = ut5.get('d', [])
        sigs5 = ut5.get('s', [])
        bss5 = bars5[n-1].get('v', 0) if n-1 < len(bars5) else 0
        bm_buy = any(s.get('index') == n-1 and s.get('type') in ('buy','ku') for s in sigs5)
        bm_sell = any(s.get('index') == n-1 and s.get('type') in ('sell','kd') for s in sigs5)

        # 1h 지표
        m1h = await self._update_1h(sym)
        if not m1h: return

        # price change 1h
        pc = (price - c[max(0,n-13)]) / c[max(0,n-13)] if n > 13 else 0

        t5_state = {
            'price': price,
            'stn': float(ind5['stn'][n-1]), 'stn_prev': float(ind5['stn'][n-2]),
            'ur': float(ind5['ur'][n-1]),
            'us': float(ind5['us'][n-1]), 'us_prev': float(ind5['us'][n-2]),
            'bss': bss5, 'bm_buy': bm_buy, 'bm_sell': bm_sell,
            'price_chg_1h': pc,
        }

        # 포지션 변환
        pos_arg = None
        if slot.side:
            # atr=0이면 1h에서 복구
            if slot.atr <= 0 and m1h:
                slot.atr = m1h['atr']
                slot.sl = PARAMS['sl']
                slot.tr = PARAMS['tr']
                sd = 1 if slot.side == 'long' else -1
                slot.tp1 = slot.entry_price + sd * slot.atr * PARAMS['tp1_r']
                if slot.ep <= 0: slot.ep = 1.0; slot.ep_orig = 1.0
                self._log(f"ATR 복구: {sym} atr={slot.atr:.1f}")
            # peak 업데이트 (decide 전에 최신화)
            if slot.side == 'long' and price > slot.peak: slot.peak = price
            elif slot.side == 'short' and price < slot.peak: slot.peak = price
            pos_arg = {
                'side': slot.side, 'entry': slot.entry_price,
                'ep': slot.ep, 'ep_orig': slot.ep_orig,
                'peak': slot.peak, 'atr': slot.atr,
                'sl': slot.sl, 'tr': slot.tr,
                'tp1': slot.tp1, 'tp1_hit': slot.tp1_hit,
            }

        decision = decide_v12(m1h, t5_state, pos_arg)

        if decision['action'] == 'enter' and not slot.side:
            # 중복 진입 방지: 이미 주문 중이면 스킵
            if sym in self._ordering:
                return
            # Bitget 실제 포지션 이중 체크
            try:
                resp = await self._client.get_position(sym)
                for p in resp.get("data", []):
                    if float(p.get("total", 0)) > 0 and p.get("symbol") == sym:
                        slot.side = p.get("holdSide", "")
                        slot.entry_price = float(p.get("openPriceAvg", 0))
                        slot.qty = float(p.get("total", 0))
                        self._log(f"중복방지: {sym} 이미 포지션 있음 {slot.side}")
                        return
            except Exception as _e:
                logger.debug("services.live_trader_v2.silent_except", error=str(_e)[:100])
            self._ordering.add(sym)
            side_str = decision['side']
            order_side = "buy" if side_str == "long" else "sell"
            ep = decision['ep']

            # 잔고 체크
            try:
                bal_resp = await self._client.get_balance()
                available = float(bal_resp.get("data", [{}])[0].get("available", 0))
                margin_needed = ENTRY_USDT * ep
                if available < margin_needed * 1.1:
                    self._log(f"잔고 부족 {sym}: ${available:.0f}")
                    return
            except Exception as _e: pass  # non-critical

            # 수량 계산
            try:
                ticker = await self._client.get_ticker(sym)
                bp = float(ticker.get("data", [{}])[0].get("lastPr", 0))
                if bp > 0: price_for_qty = bp
                else: price_for_qty = price
            except Exception: price_for_qty = price

            coin_qty = ENTRY_USDT * float(LEVERAGE) * ep / price_for_qty
            if price_for_qty >= 1000: coin_qty = round(coin_qty, 3)
            elif price_for_qty >= 1: coin_qty = round(coin_qty, 1)
            elif price_for_qty >= 0.01: coin_qty = round(coin_qty, 0)
            else: coin_qty = int(coin_qty)

            if coin_qty * price_for_qty < 5: return

            try:
                resp = await self._client.place_order(sym, order_side, str(coin_qty),
                    leverage=LEVERAGE, trade_side="open")
                if resp.get("code") == "00000":
                    slot.side = side_str; slot.entry_price = price_for_qty
                    slot.qty = coin_qty; slot.ep = ep; slot.ep_orig = ep
                    slot.peak = price_for_qty; slot.atr = m1h['atr']
                    slot.sl = decision['sl']; slot.tr = decision['tr']
                    slot.tp1 = decision['tp1']; slot.tp1_hit = False
                    slot.score = decision['score']
                    slot.trades.append({"action": "open", "side": side_str, "price": price_for_qty,
                        "time": datetime.now(KST).isoformat(), "score": decision['score']})
                    self._log(f"진입 {sym} {side_str} @ ${price_for_qty:.2f} score={decision['score']:.1f} ep={ep:.0%}")
                    self._mark(sym, side_str, price_for_qty, f"PRO {side_str} s={decision['score']:.1f}")
                else:
                    self._log(f"주문 실패 {sym}: {resp}")
            except Exception as e:
                self._log(f"주문 에러 {sym}: {e}")
            finally:
                self._ordering.discard(sym)

        elif decision['action'] == 'partial_close' and slot.side:
            # TP1 분할 청산
            close_side = "sell" if slot.side == "long" else "buy"
            close_qty = round(slot.qty * decision['ratio'], 3)
            if close_qty * price < 5: return
            try:
                resp = await self._client.place_order(sym, close_side, str(close_qty),
                    leverage=LEVERAGE, trade_side="close")
                if resp.get("code") == "00000":
                    slot.qty -= close_qty; slot.tp1_hit = True
                    slot.ep *= (1 - decision['ratio'])
                    self._log(f"TP1 {sym} {decision['ratio']:.0%} 청산 @ ${price:.2f}")
                    self._mark(sym, "tp1", price, f"TP1 {decision['ratio']:.0%}")
            except Exception as e:
                self._log(f"TP1 에러 {sym}: {e}")

        elif decision['action'] == 'close' and slot.side:
            close_side = "sell" if slot.side == "long" else "buy"
            try:
                resp = await self._client.place_order(sym, close_side, str(slot.qty),
                    leverage=LEVERAGE, trade_side="close")
                if resp.get("code") == "00000":
                    pnl = (price - slot.entry_price) / slot.entry_price * (1 if slot.side == "long" else -1)
                    slot.trades.append({"action": "close", "reason": decision['reason'],
                        "price": price, "pnl_pct": round(pnl * 100, 2),
                        "time": datetime.now(KST).isoformat()})
                    self._log(f"청산 {sym} {decision['reason']} pnl={pnl*100:+.2f}% @ ${price:.2f}")
                    self._mark(sym, "close", price, f"{decision['reason']} {pnl*100:+.1f}%")
                    slot.side = ""; slot.qty = 0; slot.tp1_hit = False
            except Exception as e:
                self._log(f"청산 에러 {sym}: {e}")


live_trader_v2 = LiveTraderV2()
