"""백테스트 — PRO 전략 듀얼TF (1h메인+5m타이밍), 실전매매 동일 로직."""
from src.services.strategy_v12 import calc_indicators, decide_v12, PARAMS

LEVERAGE = 12
ENTRY_PCT = 0.10
TAKER_FEE = 0.0006
SLIPPAGE = 0.0002

_bt_memo = {}


def _build_1h_map(candles_1h, ind_1h):
    """1h 캔들의 open_time → index 매핑 + 지표 배열."""
    n = len(candles_1h)
    ts_map = {}
    for i in range(n):
        ot = int(candles_1h[i].get('open_time') or candles_1h[i].get('t', 0))
        ts_map[ot] = i
    return ts_map


def _find_1h_idx(ts_5m, candles_1h, ts_map):
    """5m 봉의 open_time에 해당하는 1h 봉 index 찾기."""
    # 5m 봉이 속하는 1h 봉 = floor(5m_open_time / 3600000) * 3600000
    h_ts = (ts_5m // 3600000) * 3600000
    if h_ts in ts_map:
        return ts_map[h_ts]
    # 못 찾으면 가장 가까운 이전 1h 봉
    for offset in [3600000, 7200000]:
        if (h_ts - offset) in ts_map:
            return ts_map[h_ts - offset]
    return -1


def run_backtest(candles_5m: list[dict], candles_1h: list[dict] = None, mode: str = 'v12') -> dict:
    n5 = len(candles_5m)
    n1h = len(candles_1h) if candles_1h else 0
    if n5 < 300 or n1h < 300:
        return {"markers": [], "stats": {}, "equity": []}

    key = f"{n5}:{n1h}:{candles_5m[-1].get('close')}:{mode}"
    if key in _bt_memo:
        return _bt_memo[key]

    # 1h 지표
    ind_1h = calc_indicators(candles_1h)
    n1 = ind_1h['c'].shape[0]

    # 1h ultra_trend (bss)
    from src.services.beom_candle import compute_ultra_trend
    ut_1h = compute_ultra_trend(candles_1h)
    ut_1h_bars = ut_1h.get('d', [])

    # 5m 지표
    ind_5m = calc_indicators(candles_5m)

    # 5m ultra_trend (bss, bm_buy, bm_sell)
    from src.services.beom_candle import compute_ultra_trend
    ut_5m = compute_ultra_trend(candles_5m)
    ut_bars = ut_5m.get('d', [])
    ut_sigs = ut_5m.get('s', [])

    # 1h 타임스탬프 매핑
    ts_map = {}
    for i in range(n1h):
        ot = int(candles_1h[i].get('openTime') or candles_1h[i].get('open_time') or candles_1h[i].get('t', 0))
        ts_map[ot] = i

    P = PARAMS
    bal = 10000.0; markers = []; equity = []
    wins = losses = 0; total_pnl = 0; total_fees = 0; peak_bal = 0; max_dd = 0

    # 포지션
    side = ""; entry = 0; pos_atr = 0; pos_sl = 0; pos_tr = 0
    tp1 = 0; tp1_hit = False; pos_peak = 0; pos_ep = 0

    START = 302

    for i in range(START, n5):
        price = float(ind_5m['c'][i])

        # 5m 봉의 open_time으로 1h 봉 찾기
        ts_5m = int(candles_5m[i].get('openTime') or candles_5m[i].get('open_time') or candles_5m[i].get('t', 0))
        h_ts = (ts_5m // 3600000) * 3600000
        hi = ts_map.get(h_ts)
        if hi is None:
            for off in [3600000, 7200000]:
                hi = ts_map.get(h_ts - off)
                if hi is not None:
                    break
        if hi is None or hi < 3:
            equity.append({"index": i, "value": round(bal, 2)})
            continue

        # 1h 상태 (실전매매와 동일)
        m1h = {
            'stn': float(ind_1h['stn'][hi]),
            'stn_prev': float(ind_1h['stn'][hi - 1]),
            'ur': float(ind_1h['ur'][hi]),
            'us': float(ind_1h['us'][hi]),
            'tg': float(ind_1h['tg'][hi]),
            'bss': ut_1h_bars[hi].get('v', 0) if hi < len(ut_1h_bars) else 0,
            'atr': float(ind_1h['atr'][hi]),
            'atr_ma': float(ind_1h['atr_ma'][hi]) if ind_1h['atr_ma'][hi] > 0 else float(ind_1h['atr'][hi]),
            'slope': float(ind_1h['t60_slope'][hi]),
            'tb': bool(ind_1h['t60'][hi] > ind_1h['t200'][hi]),
        }

        # 5m 상태 (실전매매와 동일)
        stn5 = float(ind_5m['stn'][i])
        stn5_prev = float(ind_5m['stn'][i - 1])
        ur5 = float(ind_5m['ur'][i])
        us5 = float(ind_5m['us'][i])
        us5_prev = float(ind_5m['us'][i - 1])
        pc = (price - float(ind_5m['c'][max(0, i - 12)])) / float(ind_5m['c'][max(0, i - 12)]) if i > 12 else 0

        # 5m bss / bm 시그널
        bss5 = ut_bars[i].get('v', 0) if i < len(ut_bars) else 0
        bm_buy = any(s.get('index') == i and s.get('type') in ('buy', 'ku') for s in ut_sigs)
        bm_sell = any(s.get('index') == i and s.get('type') in ('sell', 'kd') for s in ut_sigs)

        t5_state = {
            'price': price,
            'stn': stn5, 'stn_prev': stn5_prev,
            'ur': ur5,
            'us': us5, 'us_prev': us5_prev,
            'bss': bss5, 'bm_buy': bm_buy, 'bm_sell': bm_sell,
            'price_chg_1h': pc,
        }

        # 포지션 변환
        pos_arg = None
        if side:
            pos_arg = {
                'side': side, 'entry': entry,
                'ep': pos_ep, 'ep_orig': pos_ep,
                'peak': pos_peak, 'atr': pos_atr,
                'sl': pos_sl, 'tr': pos_tr,
                'tp1': tp1, 'tp1_hit': tp1_hit,
            }
            sd = 1 if side == 'long' else -1
            if sd == 1 and price > pos_peak:
                pos_peak = price
            elif sd == -1 and price < pos_peak:
                pos_peak = price
            pos_arg['peak'] = pos_peak

        decision = decide_v12(m1h, t5_state, pos_arg)
        act = decision['action']

        if act == 'enter' and not side:
            sd = 1 if decision['side'] == 'long' else -1
            slip = price * SLIPPAGE * sd
            side = decision['side']
            entry = price + slip
            pos_atr = m1h['atr']
            pos_sl = decision['sl']
            pos_tr = decision['tr']
            tp1 = decision['tp1']
            tp1_hit = False
            pos_peak = entry
            pos_ep = decision['ep']
            fee = bal * ENTRY_PCT * pos_ep * TAKER_FEE
            total_fees += fee; bal -= fee
            sc = decision.get('score', 0)
            markers.append({"index": i, "type": side, "price": price,
                            "label": f"{side.upper()}", "ts": ts_5m})

        elif act == 'partial_close' and side:
            sd = 1 if side == 'long' else -1
            pnl_pct = (price - entry) / entry * sd
            ratio = decision.get('ratio', P['tp1_close'])
            pnl_usd = bal * ENTRY_PCT * pos_ep * ratio * pnl_pct * LEVERAGE
            fee = bal * ENTRY_PCT * pos_ep * ratio * TAKER_FEE
            bal += pnl_usd - fee; total_fees += fee
            total_pnl += pnl_pct * 100 * LEVERAGE * ratio
            wins += 1
            tp1_hit = True
            pos_ep *= (1 - ratio)
            markers.append({"index": i, "type": "tp", "price": price,
                            "label": f"TP1 {pnl_pct * 100 * LEVERAGE:+.1f}%", "ts": ts_5m})
            if pos_ep < 0.01:
                side = ""

        elif act == 'close' and side:
            sd = 1 if side == 'long' else -1
            slip_p = price - price * SLIPPAGE * sd
            pnl_pct = (slip_p - entry) / entry * sd
            pnl_usd = bal * ENTRY_PCT * pos_ep * pnl_pct * LEVERAGE
            fee = bal * ENTRY_PCT * pos_ep * TAKER_FEE
            bal += pnl_usd - fee; total_fees += fee
            total_pnl += pnl_pct * 100 * LEVERAGE
            if pnl_usd > 0:
                wins += 1
            else:
                losses += 1
            reason = decision.get('reason', 'CL')
            markers.append({"index": i,
                            "type": "stop" if pnl_pct < 0 else "close",
                            "price": price,
                            "label": f"{reason} {pnl_pct * 100 * LEVERAGE:+.1f}%", "ts": ts_5m})
            side = ""

        equity.append({"index": i, "value": round(bal, 2)})
        if bal > peak_bal:
            peak_bal = bal
        dd = (peak_bal - bal) / peak_bal * 100 if peak_bal > 0 else 0
        if dd > max_dd:
            max_dd = dd

    total_trades = wins + losses
    result = {
        "markers": markers,
        "stats": {
            "mode": "pro",
            "strategy": "PRO",
            "total_trades": total_trades,
            "wins": wins, "losses": losses,
            "win_rate": round(wins / max(total_trades, 1) * 100, 1),
            "total_pnl": round(total_pnl, 2),
            "balance": round(bal, 2),
            "return_pct": round((bal - 10000) / 10000 * 100, 2),
            "fees": round(total_fees, 2),
            "max_drawdown": round(max_dd, 2),
        },
        "equity": equity[-200:],
    }
    if len(_bt_memo) > 50:
        _bt_memo.clear()
    _bt_memo[key] = result
    return result
