"""ULTIMATE v2 백테스트 — 100점 만점 구조-상태-타이밍-목표."""
import numpy as np
from src.services.strategy_ultimate import (
    calc_imacd, decide_ultimate_v2,
)
from src.services.beom_sub import _ema, _rsi, _stoch, _sma, _mfi, _rolling_min, _rolling_max

LEVERAGE = 12
ENTRY_PCT = 0.10
FEE = 0.0006
SLIP = 0.0002

_cache = {}


def _calc_indicators(candles):
    """기본 지표 + IMACD 계산."""
    c = np.array([float(x['close']) for x in candles])
    h = np.array([float(x['high']) for x in candles])
    l = np.array([float(x['low']) for x in candles])
    v = np.array([float(x.get('volume', 0)) for x in candles])
    n = len(c)

    # STN
    d3 = _ema(c, 12) - _ema(c, 26)
    l3 = _rolling_min(d3, 60); h3 = _rolling_max(d3, 60)
    stn = (d3 - l3) / np.maximum(h3 - l3, 1e-10) - 0.5

    # UR / US
    rv = _ema(_rsi(c, 60), 3)
    lr = _rolling_min(rv, 300); hr = _rolling_max(rv, 300)
    ur = (rv - lr) / np.maximum(hr - lr, 1e-10) - 0.5

    rs = _stoch(c, h, l, 14); ks = _sma(rs, 9)
    ls_ = _rolling_min(ks, 240); hs_ = _rolling_max(ks, 240)
    us = (ks - ls_) / np.maximum(hs_ - ls_, 1e-10) - 0.5

    # ATR
    tr = np.maximum(h[1:]-l[1:], np.maximum(np.abs(h[1:]-c[:-1]), np.abs(l[1:]-c[:-1])))
    atr = np.zeros(n); atr[1] = np.mean(tr[:min(200, len(tr))])
    for i in range(2, n):
        atr[i] = (atr[i-1]*199 + (tr[i-1] if i-1 < len(tr) else 0)) / 200

    # TEMA
    e1 = _ema(c, 60); e2 = _ema(e1, 60); e3 = _ema(e2, 60)
    t60 = 3*e1 - 3*e2 + e3
    e1b = _ema(c, 200); e2b = _ema(e1b, 200); e3b = _ema(e2b, 200)
    t200 = 3*e1b - 3*e2b + e3b

    # 과열/강도
    scaled_rsi = _rsi(c, 60) / 100 - 0.5
    scaled_mfi = _mfi(h, l, c, v, 60) / 100 - 0.5

    # 정/역배열
    sma5 = _sma(c, 5); sma20 = _sma(c, 20); sma60 = _sma(c, 60)
    bull_align = (c > sma5) & (sma5 > sma20) & (sma20 > sma60)
    bear_align = (c < sma5) & (sma5 < sma20) & (sma20 < sma60)

    # IMACD
    imacd_md, imacd_sig, imacd_hist = calc_imacd(h, l, c)

    # 거래량 비율
    vol_ma = _sma(v, 20)
    vol_ratio = np.where(vol_ma > 0, v / vol_ma, 1.0)

    return {
        'c': c, 'h': h, 'l': l, 'v': v,
        'stn': stn, 'ur': ur, 'us': us, 'atr': atr,
        't60': t60, 't200': t200,
        'scaled_rsi': scaled_rsi, 'scaled_mfi': scaled_mfi,
        'bull_align': bull_align, 'bear_align': bear_align,
        'imacd_md': imacd_md, 'imacd_sig': imacd_sig, 'imacd_hist': imacd_hist,
        'vol_ratio': vol_ratio,
    }


def run_backtest_ultimate(candles_exec, candles_confirm=None):
    """ULTIMATE v2 백테스트. candles_exec=실행TF, candles_confirm=확인TF."""
    n_exec = len(candles_exec)
    n_conf = len(candles_confirm) if candles_confirm else 0
    if n_exec < 300 or n_conf < 300:
        return {"markers": [], "stats": {}, "equity": []}

    key = f"ultv2:{n_exec}:{n_conf}:{candles_exec[-1].get('close')}"
    if key in _cache:
        return _cache[key]

    # 지표 계산
    ind_exec = _calc_indicators(candles_exec)
    ind_conf = _calc_indicators(candles_confirm)

    # 범온 (bimaco4)
    from src.services.bimaco4 import compute_bimaco4
    bm4_exec = compute_bimaco4(candles_exec)
    bm4_bars = bm4_exec.get('d', [])
    bm4_sigs = bm4_exec.get('s', [])

    bm4_conf = compute_bimaco4(candles_confirm)
    bm4_conf_bars = bm4_conf.get('d', [])

    # 구조 지표 (확인TF 기준)
    from src.services.trade_zone import compute_order_blocks
    from src.services.trendlines import compute_trendlines
    obs_data = compute_order_blocks(candles_confirm)
    all_obs = obs_data.get('bull', []) + obs_data.get('bear', [])
    tls = compute_trendlines(candles_confirm)

    # 확인TF 타임스탬프 매핑 (실행TF → 확인TF 인덱스)
    # 확인TF 봉 간격 자동 감지
    conf_ts = [int(candles_confirm[i].get('openTime') or candles_confirm[i].get('open_time') or candles_confirm[i].get('t', 0)) for i in range(n_conf)]
    conf_interval = conf_ts[1] - conf_ts[0] if n_conf > 1 else 300000  # default 5m

    ts_map = {}
    for i in range(n_conf):
        ts_map[conf_ts[i]] = i

    bal = 10000.0; markers = []; equity = []
    wins = losses = 0; total_pnl = 0; peak_bal = 10000.0; max_dd = 0; total_fees = 0

    side = ""; entry = 0; pos_atr = 0; pos_sl = 0
    pos_peak = 0; pos_ep = 0; bars_held = 0; entry_struct_score = 12

    START = 302

    for i in range(START, n_exec):
        price = float(ind_exec['c'][i])
        ts_exec = int(candles_exec[i].get('openTime') or candles_exec[i].get('open_time') or candles_exec[i].get('t', 0))
        # 실행TF → 확인TF 매핑
        c_ts = (ts_exec // conf_interval) * conf_interval
        ci = ts_map.get(c_ts)
        if ci is None:
            for off in [conf_interval, conf_interval * 2]:
                ci = ts_map.get(c_ts - off)
                if ci is not None:
                    break
        if ci is None or ci < 3:
            equity.append({"index": i, "value": round(bal, 2)})
            continue

        atr_conf = float(ind_conf['atr'][ci])
        if atr_conf <= 0:
            equity.append({"index": i, "value": round(bal, 2)})
            continue

        # 범온 signal_sum
        bm_ss = bm4_bars[i].get('v', 0) if i < len(bm4_bars) else 0

        # Ultra Trend 방향 (확인TF TEMA 기반)
        ultra_dir = 1 if ind_conf['t60'][ci] > ind_conf['t200'][ci] else -1

        # 정/역배열 (실행TF)
        if ind_exec['bull_align'][i]:
            alignment = 'bull'
        elif ind_exec['bear_align'][i]:
            alignment = 'bear'
        else:
            alignment = 'neutral'

        # 거래량 돌파 판단
        is_breakout = any(s.get('index') == i for s in bm4_sigs)
        vol_ratio = float(ind_exec['vol_ratio'][i])

        # AI 목표 (확인TF ATR 기반)
        ai_target_pct = atr_conf * 2.5 / price
        sl_pct = atr_conf * 1.5 / price

        state = {
            'price': price, 'atr': atr_conf,
            'bimaco_ss': bm_ss,
            'ultra_dir': ultra_dir, 'alignment': alignment,
            'stn': float(ind_exec['stn'][i]), 'stn_prev': float(ind_exec['stn'][i-1]),
            'scaled_rsi': float(ind_exec['scaled_rsi'][i]), 'scaled_mfi': float(ind_exec['scaled_mfi'][i]),
            'uprsi': float(ind_exec['ur'][i]), 'upstoch': float(ind_exec['us'][i]),
            'uprsi_prev': float(ind_exec['ur'][i-1]), 'upstoch_prev': float(ind_exec['us'][i-1]),
            'volume_ratio': vol_ratio, 'is_breakout': is_breakout,
            'imacd_md': float(ind_exec['imacd_md'][i]), 'imacd_md_prev': float(ind_exec['imacd_md'][i-1]),
            'imacd_hist': float(ind_exec['imacd_hist'][i]), 'imacd_hist_prev': float(ind_exec['imacd_hist'][i-1]),
            'imacd_sig': float(ind_exec['imacd_sig'][i]),
            'trendlines': tls, 'obs': all_obs,
            'ai_target_pct': ai_target_pct, 'sl_pct': sl_pct,
        }

        pos_arg = None
        if side:
            bars_held += 1
            sd = 1 if side == 'long' else -1
            if sd == 1 and price > pos_peak:
                pos_peak = price
            elif sd == -1 and price < pos_peak:
                pos_peak = price
            pos_arg = {
                'side': side, 'entry': entry, 'peak': pos_peak, 'atr': pos_atr,
                'sl': pos_sl,
                'entry_structure': entry_struct_score,
                'bars_held': bars_held,
            }

        decision = decide_ultimate_v2(state, pos_arg)
        act = decision['action']

        if act == 'enter' and not side:
            sd = 1 if decision['side'] == 'long' else -1
            side = decision['side']
            entry = price + price * SLIP * sd
            pos_atr = atr_conf
            pos_sl = decision.get('sl', 0.8)
            pos_ep = decision.get('ep', 0.7)
            entry_struct_score = decision.get('scores', {}).get('structure', 12)
            pos_peak = entry
            bars_held = 0
            fee = bal * ENTRY_PCT * pos_ep * FEE
            total_fees += fee; bal -= fee
            grade = decision.get('grade', '?')
            score = decision.get('score', 0)
            markers.append({"index": i, "type": side, "price": price,
                            "label": f"{side.upper()} {score}점 {grade}급", "ts": ts_exec})

        elif act == 'partial_close' and side:
            sd = 1 if side == 'long' else -1
            pnl_pct = (price - entry) / entry * sd
            ratio = decision.get('ratio', 0.3)
            pnl_usd = bal * ENTRY_PCT * pos_ep * ratio * pnl_pct * LEVERAGE
            fee = bal * ENTRY_PCT * pos_ep * ratio * FEE
            bal += pnl_usd - fee; total_fees += fee
            total_pnl += pnl_pct * 100 * LEVERAGE * ratio
            wins += 1
            reason = decision.get('reason', 'TP')
            pos_ep *= (1 - ratio)
            markers.append({"index": i, "type": "tp", "price": price,
                            "label": f"{reason} {pnl_pct*100*LEVERAGE:+.1f}%", "ts": ts_exec})
            if pos_ep < 0.01:
                side = ""

        elif act == 'close' and side:
            sd = 1 if side == 'long' else -1
            slip_p = price - price * SLIP * sd
            pnl_pct = (slip_p - entry) / entry * sd
            pnl_usd = bal * ENTRY_PCT * pos_ep * pnl_pct * LEVERAGE
            fee = bal * ENTRY_PCT * pos_ep * FEE
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
                            "label": f"{reason} {pnl_pct*100*LEVERAGE:+.1f}%", "ts": ts_exec})
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
            "mode": "ultimate",
            "strategy": "ULTIMATE",
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
    if len(_cache) > 20:
        _cache.clear()
    _cache[key] = result
    return result
