"""Entry2 지표 — v9 전략 기반 진입/TP/손절/청산 시그널."""
from src.services.strategy_v9 import decide_v9, V9Position
from src.services.beom_candle import compute_ultra_trend
from src.services.beom_sub import compute_uprsi_stc
from src.services.beom_pasr import compute_pasr_pvi


def compute_entry2(candles: list[dict]) -> dict:
    n = len(candles)
    if n < 300:
        return {"signals": [], "states": []}

    ut = compute_ultra_trend(candles)
    u = compute_uprsi_stc(candles)
    p = compute_pasr_pvi(candles)

    signals = []
    pos = V9Position()

    for i in range(300, n):
        action = decide_v9(candles, u, p, ut, pos, i)
        price = float(candles[i].get("close") or candles[i].get("c", 0))
        pct = 0.0

        if action == "long" and not pos.side:
            pos = V9Position(side="long", entry_price=price, qty=1.0, entry_idx=i)
            signals.append({"index": i, "type": "entry_long", "price": price})

        elif action == "short" and not pos.side:
            pos = V9Position(side="short", entry_price=price, qty=1.0, entry_idx=i)
            signals.append({"index": i, "type": "entry_short", "price": price})

        elif action == "tp_25" and pos.side:
            if pos.entry_price > 0:
                pct = (price - pos.entry_price) / pos.entry_price * 100 if pos.side == "long" else (pos.entry_price - price) / pos.entry_price * 100
            pos.tp_stage += 1
            pos.qty -= 0.25
            signals.append({"index": i, "type": "tp1", "price": price, "pct": round(pct, 2)})
            if pos.qty <= 0: pos = V9Position()

        elif action == "tp_50" and pos.side:
            if pos.entry_price > 0:
                pct = (price - pos.entry_price) / pos.entry_price * 100 if pos.side == "long" else (pos.entry_price - price) / pos.entry_price * 100
            signals.append({"index": i, "type": "tp2", "price": price, "pct": round(pct, 2)})
            pos = V9Position()

        elif action == "close" and pos.side:
            if pos.entry_price > 0:
                pct = (price - pos.entry_price) / pos.entry_price * 100 if pos.side == "long" else (pos.entry_price - price) / pos.entry_price * 100
            signals.append({"index": i, "type": "close", "price": price, "pct": round(pct, 2)})
            pos = V9Position()

        elif action == "stop_loss" and pos.side:
            if pos.entry_price > 0:
                pct = (price - pos.entry_price) / pos.entry_price * 100 if pos.side == "long" else (pos.entry_price - price) / pos.entry_price * 100
            signals.append({"index": i, "type": "stop_loss", "price": price, "pct": round(pct, 2)})
            pos = V9Position()

        elif action == "switch" and pos.side:
            if pos.entry_price > 0:
                pct = (price - pos.entry_price) / pos.entry_price * 100 if pos.side == "long" else (pos.entry_price - price) / pos.entry_price * 100
            signals.append({"index": i, "type": "switch", "price": price, "pct": round(pct, 2)})
            new_side = "short" if pos.side == "long" else "long"
            pos = V9Position(side=new_side, entry_price=price, qty=1.0, entry_idx=i)

    return {"signals": signals}
