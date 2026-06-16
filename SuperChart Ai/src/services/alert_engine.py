"""알림 엔진 — 가격/지표 조건 평가 (DB 영속화 지원).

- DB(`alert_rules`) 를 source of truth 로 사용.
- 프로세스 메모리에는 활성 룰만 캐시해 실시간 평가 속도를 확보.
- 시작 시 `load_from_db()` 로 캐시 초기화, CRUD 시점에 캐시 즉시 갱신.
"""
from __future__ import annotations

import asyncio
import time
import uuid

import structlog
from sqlalchemy import select

logger = structlog.get_logger(__name__)


class AlertEngine:
    """실시간 알림 조건 평가."""

    def __init__(self):
        self._rules: list[dict] = []
        self._triggered: dict[str, float] = {}
        self._ws_manager = None
        self._tasks: set[asyncio.Task] = set()
        self._last_prices: dict[str, float] = {}
        self._loaded = False
        self._eval_lock = asyncio.Lock()

    def set_ws_manager(self, mgr):
        self._ws_manager = mgr

    # ── DB ↔ 메모리 동기화 ──
    async def load_from_db(self):
        """서버 시작 시 DB에서 활성 알림 규칙을 메모리로 로드."""
        from src.db.session import SessionLocal
        from src.models.tables import AlertRule, Symbol

        try:
            async with SessionLocal() as db:
                res = await db.execute(
                    select(AlertRule, Symbol.symbol_code)
                    .join(Symbol, AlertRule.symbol_id == Symbol.id)
                    .where(AlertRule.is_active == True)  # noqa: E712
                )
                rows = res.all()
                rules: list[dict] = []
                for r, sym_code in rows:
                    rule_json = r.rule_json or {}
                    rules.append({
                        "id": str(r.id),
                        "user_id": str(r.user_id),
                        "symbol": sym_code,
                        "symbol_id": str(r.symbol_id),
                        "rule_type": r.rule_type,
                        "timeframe": r.timeframe,
                        "target_price": float(rule_json.get("target_price", 0) or 0),
                        "threshold": float(rule_json.get("threshold", 0) or 0),
                        "cooldown_sec": int(rule_json.get("cooldown_sec", 300) or 300),
                        "is_active": r.is_active,
                    })
                self._rules = rules
                self._loaded = True
                logger.info("alert.loaded_from_db", count=len(rules))
        except Exception as e:
            # DB 준비 전이거나 마이그레이션 중이면 메모리 모드로 폴백
            logger.warning("alert.load_db_failed", error=str(e))
            self._loaded = False

    # ── CRUD (DB 경유) ──
    async def create_rule(self, user_id: str, symbol_id: str, symbol_code: str,
                          rule_type: str, target_price: float = 0, threshold: float = 0,
                          cooldown_sec: int = 300, timeframe: str | None = None) -> dict:
        """DB에 알림 규칙 생성 후 메모리 캐시에 추가."""
        from src.db.session import SessionLocal
        from src.models.tables import AlertRule

        # 입력 검증
        rule_type = (rule_type or "").strip().upper()
        valid_types = {"PRICE_CROSS_UP", "PRICE_CROSS_DOWN", "RSI_ABOVE", "RSI_BELOW", "BEOM_SIGNAL"}
        if rule_type not in valid_types:
            raise ValueError(f"Invalid rule_type. Must be one of: {valid_types}")
        target_price = max(0.0, float(target_price or 0))
        threshold = max(0.0, float(threshold or 0))
        cooldown_sec = max(10, min(86400, int(cooldown_sec or 300)))

        rule_json = {
            "target_price": target_price,
            "threshold": threshold,
            "cooldown_sec": cooldown_sec,
                "timeframe": timeframe,
        }
        async with SessionLocal() as db:
            ar = AlertRule(
                user_id=uuid.UUID(user_id),
                symbol_id=uuid.UUID(symbol_id),
                timeframe=timeframe,
                rule_type=rule_type,
                rule_json=rule_json,
                is_active=True,
            )
            db.add(ar)
            await db.commit()
            await db.refresh(ar)
            rec = {
                "id": str(ar.id),
                "user_id": user_id,
                "symbol": symbol_code,
                "symbol_id": symbol_id,
                "rule_type": rule_type,
                "target_price": target_price,
                "threshold": threshold,
                "cooldown_sec": cooldown_sec,
                "timeframe": timeframe,
                "is_active": True,
            }
            self._rules.append(rec)
            logger.info("alert.created", rule_id=rec["id"], user=user_id, type=rule_type)
            return rec

    async def delete_rule(self, user_id: str, rule_id: str) -> bool:
        """본인 소유 알림만 삭제 가능."""
        from src.db.session import SessionLocal
        from src.models.tables import AlertRule

        async with SessionLocal() as db:
            try:
                res = await db.execute(select(AlertRule).where(AlertRule.id == uuid.UUID(rule_id)))
            except ValueError:
                return False
            ar = res.scalar()
            if not ar or str(ar.user_id) != user_id:
                return False
            await db.delete(ar)
            await db.commit()
        # 메모리 캐시에서도 제거
        self._rules = [r for r in self._rules if r["id"] != rule_id]
        self._triggered.pop(rule_id, None)
        logger.info("alert.deleted", rule_id=rule_id, user=user_id)
        return True

    def list_user_rules(self, user_id: str) -> list[dict]:
        """특정 사용자의 활성 알림만 반환."""
        return [r for r in self._rules if r.get("user_id") == user_id and r.get("is_active")]

    # ── 평가 ──
    async def evaluate(self, symbol: str, price: float, indicators: dict | None = None):
        if self._eval_lock.locked():
            return  # 이미 평가 중이면 스킵 (동시성 보호)
        async with self._eval_lock:
            await self._do_evaluate(symbol, price, indicators)

    async def _do_evaluate(self, symbol, price, indicators):
        """현재 가격/지표로 모든 룰 평가."""
        prev_price = self._last_prices.get(symbol, price)
        self._last_prices[symbol] = price
        now = time.time()

        for rule in self._rules:
            if not rule.get("is_active"):
                continue
            if rule.get("symbol") != symbol:
                continue
            rid = rule["id"]
            cooldown = rule.get("cooldown_sec", 300)
            last = self._triggered.get(rid, 0)
            if last and now - last < cooldown:
                continue

            triggered = False
            rt = rule.get("rule_type", "")

            if rt == "PRICE_CROSS_UP":
                target = float(rule.get("target_price", 0) or 0)
                if target > 0 and prev_price < target <= price:
                    triggered = True

            elif rt == "PRICE_CROSS_DOWN":
                target = float(rule.get("target_price", 0) or 0)
                if target > 0 and prev_price > target >= price:
                    triggered = True

            elif rt == "RSI_ABOVE" and indicators:
                threshold = float(rule.get("threshold", 70) or 70)
                rsi = indicators.get("rsi", 50)
                if rsi >= threshold:
                    triggered = True

            elif rt == "RSI_BELOW" and indicators:
                threshold = float(rule.get("threshold", 30) or 30)
                rsi = indicators.get("rsi", 50)
                if rsi <= threshold:
                    triggered = True

            # BEOM_SIGNAL — 별도 evaluate_beom()에서 처리
            if triggered:
                self._triggered[rid] = now
                event = {
                    "alertId": rid,
                    "userId": rule.get("user_id"),
                    "symbol": symbol,
                    "ruleType": rt,
                    "triggerPrice": price,
                    "triggeredAt": now,
                }
                logger.info("alert.triggered", **event)

                # WS 브로드캐스트
                if self._ws_manager:
                    try:
                        await self._ws_manager.broadcast("alert", symbol, "", event)
                    except Exception as e:
                        logger.warning("alert.broadcast_error", error=str(e))

                # 이메일 알림 (delivery_channel이 email이거나 all인 경우)
                if rule.get("delivery_channel") in ("email", "all"):
                    try:
                        from src.services.email_service import send_email
                        user_email = rule.get("user_email", "")
                        if user_email:
                            send_email(user_email, f"[범온 AI 슈퍼차트] 알림: {symbol} {rule.get('rule_type','')}",
                                f"<div style='font-family:sans-serif'><h3>🔔 알림 발생</h3><p>{symbol} — {rule.get('rule_type','')} @ ${price:,.2f}</p></div>")
                    except Exception as e:
                        logger.warning("alert.email_error", error=str(e))

                # DB에 이벤트 기록 + last_triggered_at 업데이트
                task = asyncio.create_task(self._persist_event(rid, rule, price))
                self._tasks.add(task)
                task.add_done_callback(self._tasks.discard)

    async def _persist_event(self, rule_id: str, rule: dict, price: float):
        """알림 발생 이벤트를 DB에 기록."""
        from src.db.session import SessionLocal
        from src.models.tables import AlertEvent, AlertRule
        from datetime import datetime, timezone

        try:
            async with SessionLocal() as db:
                ev = AlertEvent(
                    alert_rule_id=uuid.UUID(rule_id),
                    user_id=uuid.UUID(rule["user_id"]) if rule.get("user_id") else uuid.uuid4(),
                    symbol_id=uuid.UUID(rule["symbol_id"]) if rule.get("symbol_id") else uuid.uuid4(),
                    event_status="triggered",
                    trigger_price=price,
                    trigger_snapshot={"rule_type": rule.get("rule_type"), "symbol": rule.get("symbol")},
                )
                db.add(ev)
                # last_triggered_at 업데이트
                res = await db.execute(select(AlertRule).where(AlertRule.id == uuid.UUID(rule_id)))
                ar = res.scalar()
                if ar:
                    ar.last_triggered_at = datetime.now(timezone.utc)
                await db.commit()
        except Exception as e:
            logger.warning("alert.persist_event_failed", error=str(e), rule_id=rule_id)
    async def evaluate_beom(self, symbol: str, timeframe: str, signal_type: str):
        """BEOM AI 시그널 발생 시 호출 — 해당 종목+TF 구독자에게 알림."""
        import time
        now = time.time()
        for rule in self._rules:
            if not rule.get("is_active"):
                continue
            if rule.get("rule_type") != "BEOM_SIGNAL":
                continue
            if rule.get("symbol") != symbol:
                continue
            # TF 필터 (설정된 경우만)
            rule_tf = rule.get("timeframe")
            if rule_tf and rule_tf != timeframe:
                continue
            rid = rule["id"]
            cooldown = rule.get("cooldown_sec", 300)
            last = self._triggered.get(rid, 0)
            if last and now - last < cooldown:
                continue
            self._triggered[rid] = now
            event = {
                "alertId": rid,
                "userId": rule.get("user_id"),
                "symbol": symbol,
                "ruleType": "BEOM_SIGNAL",
                "triggerPrice": 0,
                "message": f"{symbol} {timeframe} {signal_type}",
                "timeframe": timeframe,
                "signalType": signal_type,
            }
            if self._ws_manager:
                await self._ws_manager.send_to_user(rule.get("user_id"), {"type": "alert", "data": event})

    async def check_ob_on_close(self, symbol: str, timeframe: str, candle: dict):
        """봉 마감(is_final=true) 시 OB매매 시그널 체크.

        ingest에서 정확한 타임프레임과 함께 호출됨.
        등록된 알림 규칙 중 이 종목+TF를 구독하는 것이 있을 때만 계산.
        """
        # 이 종목+TF를 구독하는 규칙이 있는지
        has_sub = any(
            r.get("rule_type") == "BEOM_SIGNAL" and r.get("symbol") == symbol
            and (not r.get("timeframe") or r.get("timeframe") == timeframe)
            for r in self._rules if r.get("is_active")
        )
        if not has_sub:
            return

        try:
            from src.services.market import fetch_candles
            from src.services.symbol_resolver import resolve_symbol
            from src.services.trade_zone import compute_order_blocks, compute_ob_entry_signals

            api_sym, exchange_id = resolve_symbol(symbol)
            candles = await fetch_candles(api_sym, exchange_id, timeframe, 500)
            if not candles or len(candles) < 50:
                return

            ob_data = compute_order_blocks(candles)
            sigs = compute_ob_entry_signals(candles, ob_data)
            if not sigs:
                # 시그널 없으면 대기 상태 초기화
                if hasattr(self, '_ob_pending'):
                    self._ob_pending.pop(f"{symbol}:{timeframe}", None)
                return

            last_sig = sigs[-1]
            # 마지막 시그널이 최신 3봉 이내인지
            if last_sig.get("bar_idx", 0) < len(candles) - 3:
                return

            # 2봉 연속 확인: 첫 감지 시 pending, 다음 봉에서도 유지되면 트리거
            pending_key = f"{symbol}:{timeframe}"
            if not hasattr(self, '_ob_pending'):
                self._ob_pending = {}
            prev = self._ob_pending.get(pending_key)
            if not prev or prev.get("direction") != last_sig.get("direction"):
                # 첫 감지 — pending에 저장, 아직 트리거 안 함
                self._ob_pending[pending_key] = {"bar_idx": last_sig.get("bar_idx"), "direction": last_sig.get("direction"), "price": last_sig.get("price", 0)}
                return
            # 2봉 연속 유지 확인됨 — 트리거
            self._ob_pending.pop(pending_key, None)

            # 중복 방지 — 동일 시그널 1회만
            sig_key = f"{symbol}:{timeframe}:{last_sig.get('bar_idx')}:{last_sig.get('direction')}"
            if not hasattr(self, '_ob_triggered'):
                self._ob_triggered = set()
            if sig_key in self._ob_triggered:
                return
            self._ob_triggered.add(sig_key)
            if len(self._ob_triggered) > 1000:
                self._ob_triggered = set(list(self._ob_triggered)[-500:])

            sig_type = "buy" if last_sig.get("direction") == "long" else "sell"

            # 알림 전송
            await self.evaluate_beom(symbol, timeframe, sig_type)

            # 이력 저장 (정확한 현재 시간)
            from src.db.session import SessionLocal
            import sqlalchemy
            async with SessionLocal() as db:
                await db.execute(
                    sqlalchemy.text("INSERT INTO beom_signal_history (symbol, timeframe, signal_type, price) VALUES (:s, :tf, :st, :p)"),
                    {"s": symbol, "tf": timeframe, "st": sig_type, "p": float(last_sig.get("price", 0))}
                )
                await db.commit()
        except Exception as e:
            import structlog
            structlog.get_logger().warning("ob_check_error", symbol=symbol, tf=timeframe, error=str(e)[:100])


# 싱글톤
alert_engine = AlertEngine()
