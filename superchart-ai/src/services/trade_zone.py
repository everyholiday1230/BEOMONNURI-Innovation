"""Volumized Order Blocks — Pine Script (Flux Charts) 포팅."""
import numpy as np


def compute_order_blocks(candles: list[dict], swing_length: int = 10, max_atr_mult: float = 3.5,
                         max_obs: int = 5, ob_end_method: str = 'Wick', combine: bool = True) -> dict:
    n = len(candles)
    if n < swing_length * 3:
        return {"bull": [], "bear": []}

    o = np.array([float(x.get("open", 0)) for x in candles])
    h = np.array([float(x.get("high", 0)) for x in candles])
    l = np.array([float(x.get("low", 0)) for x in candles])
    c = np.array([float(x.get("close", 0)) for x in candles])
    v = np.array([float(x.get("volume", 0)) for x in candles])

    # ATR(10)
    tr = np.maximum(h - l, np.maximum(np.abs(h - np.roll(c, 1)), np.abs(l - np.roll(c, 1))))
    tr[0] = h[0] - l[0]
    atr = np.zeros(n); atr[0] = tr[0]
    for i in range(1, n): atr[i] = (atr[i-1] * 9 + tr[i]) / 10

    sl = swing_length
    swing_type = -1; prev_swing = -1
    top_x = 0; top_y = h[0]; top_crossed = False
    btm_x = 0; btm_y = l[0]; btm_crossed = False

    bull_obs = []
    bear_obs = []

    for i in range(sl * 2, n):
        check_idx = i - sl
        re = min(check_idx + sl + 1, n)
        upper = max(h[check_idx+1:re]) if check_idx+1 < re else h[check_idx]
        lower = min(l[check_idx+1:re]) if check_idx+1 < re else l[check_idx]

        if h[check_idx] > upper: swing_type = 0
        elif l[check_idx] < lower: swing_type = 1

        if swing_type == 0 and prev_swing != 0:
            top_x = check_idx; top_y = h[check_idx]; top_crossed = False
        if swing_type == 1 and prev_swing != 1:
            btm_x = check_idx; btm_y = l[check_idx]; btm_crossed = False
        prev_swing = swing_type

        # --- Bullish OB 무효화 ---
        for ob in list(bull_obs):
            if not ob.get("breaker"):
                tv = l[i] if ob_end_method == 'Wick' else min(o[i], c[i])
                if tv < ob["bottom"]:
                    ob["breaker"] = True; ob["break_idx"] = i
            else:
                # breaker 후 가격이 top 위로 가면 완전 제거
                if h[i] > ob["top"]:
                    bull_obs.remove(ob)

        # --- Bearish OB 무효화 ---
        for ob in list(bear_obs):
            if not ob.get("breaker"):
                tv = h[i] if ob_end_method == 'Wick' else max(o[i], c[i])
                if tv > ob["top"]:
                    ob["breaker"] = True; ob["break_idx"] = i
            else:
                # breaker 후 가격이 bottom 아래로 가면 완전 제거
                if l[i] < ob["bottom"]:
                    bear_obs.remove(ob)

        # --- Bullish OB 생성 ---
        if c[i] > top_y and not top_crossed and top_x > 0:
            top_crossed = True
            box_btm = h[i-1]; box_top = l[i-1]; box_idx = i-1
            for j in range(1, max(1, i - top_x)):
                if i-j < 0: break
                if l[i-j] < box_btm:
                    box_btm = l[i-j]; box_top = h[i-j]; box_idx = i-j
            ob_vol = float(v[i] + v[max(0,i-1)] + v[max(0,i-2)])
            ob_high = float(v[i] + v[max(0,i-1)])
            ob_low = float(v[max(0,i-2)])
            sz = abs(box_top - box_btm)
            if 0 < sz <= atr[i] * max_atr_mult:
                bull_obs.insert(0, _mk_ob(box_top, box_btm, "bull", box_idx, ob_vol, ob_high, ob_low))
                if len(bull_obs) > 30: bull_obs.pop()

        # --- Bearish OB 생성 ---
        if c[i] < btm_y and not btm_crossed and btm_x > 0:
            btm_crossed = True
            box_top = h[i-1]; box_btm = l[i-1]; box_idx = i-1
            for j in range(1, max(1, i - btm_x)):
                if i-j < 0: break
                if h[i-j] > box_top:
                    box_top = h[i-j]; box_btm = l[i-j]; box_idx = i-j
            ob_vol = float(v[i] + v[max(0,i-1)] + v[max(0,i-2)])
            ob_low = float(v[i] + v[max(0,i-1)])
            ob_high = float(v[max(0,i-2)])
            sz = abs(box_top - box_btm)
            if 0 < sz <= atr[i] * max_atr_mult:
                bear_obs.insert(0, _mk_ob(box_top, box_btm, "bear", box_idx, ob_vol, ob_high, ob_low))
                if len(bear_obs) > 30: bear_obs.pop()

    if combine:
        bull_obs = _combine(bull_obs)
        bear_obs = _combine(bear_obs)

    active_b = [ob for ob in bull_obs if not ob["breaker"]][-max_obs:]
    active_e = [ob for ob in bear_obs if not ob["breaker"]][-max_obs:]
    brk_b = [ob for ob in bull_obs if ob["breaker"]][-2:]
    brk_e = [ob for ob in bear_obs if ob["breaker"]][-2:]
    return {"bull": active_b + brk_b, "bear": active_e + brk_e}


def _mk_ob(top, btm, typ, idx, vol, hi_vol, lo_vol):
    total = max(vol, 1e-10)
    return {"top": float(top), "bottom": float(btm), "obType": typ, "start_idx": idx,
            "volume": vol, "obHighVolume": hi_vol, "obLowVolume": lo_vol,
            "breaker": False, "break_idx": 0, "bbVolume": 0,
            "buy_pct": int(hi_vol / total * 100), "sell_pct": int(lo_vol / total * 100)}


def _combine(obs):
    changed = True
    while changed:
        changed = False
        for i in range(len(obs)):
            if obs[i].get("_d"): continue
            for j in range(i+1, len(obs)):
                if obs[j].get("_d"): continue
                a, b = obs[i], obs[j]
                if a["obType"] != b["obType"]: continue
                if a["top"] >= b["bottom"] and a["bottom"] <= b["top"]:
                    m = _mk_ob(max(a["top"],b["top"]), min(a["bottom"],b["bottom"]), a["obType"],
                               min(a["start_idx"],b["start_idx"]),
                               a["volume"]+b["volume"], a["obHighVolume"]+b["obHighVolume"], a["obLowVolume"]+b["obLowVolume"])
                    m["breaker"] = a["breaker"] or b["breaker"]
                    m["break_idx"] = max(a.get("break_idx",0), b.get("break_idx",0))
                    a["_d"] = True; b["_d"] = True
                    obs.append(m); changed = True; break
            if changed: break
    return [ob for ob in obs if not ob.get("_d")]


def compute_ob_entry_signals(candles: list[dict], ob_result: dict,
                              max_age_bars: int = 50,
                              cooldown_bars: int = 5) -> list[dict]:
    """거래밀집구간 (Order Block) 되돌림 진입 시그널 계산.

    전략 (OB 전용, 다른 지표 사용 안 함):
      1. 활성 OB (breaker=False) 만 대상
      2. 봉의 고저가(hi/lo) 가 박스 범위 안에 첫 진입 = 터치
      3. 리젝션 확인:
         - Bull OB → 터치 봉이 양봉 (close >= open)
         - Bear OB → 터치 봉이 음봉 (close <= open)
      4. 유효기간: OB 생성 후 max_age_bars 이내만
      5. 쿨다운: 같은 OB 는 cooldown_bars 내 재시그널 차단
      6. 한 OB 에 대해 최대 1회 시그널

    Args:
        candles: 캔들 리스트 (open/high/low/close 포함)
        ob_result: compute_order_blocks() 반환값 {"bull": [...], "bear": [...]}
        max_age_bars: OB 유효기간 (봉 개수)
        cooldown_bars: 같은 봉 근처 중복 차단

    Returns:
        [{bar_idx: int, direction: "long"|"short", ob_top, ob_bottom,
          price: 진입 가격 (해당 봉 종가)}, ...]
    """
    n = len(candles)
    if n < 3:
        return []

    signals: list[dict] = []
    seen_obs: set = set()   # 중복 방지 (ob key = (type, start_idx))
    last_signal_idx = -999  # 쿨다운

    def _ob_key(ob: dict) -> tuple:
        return (ob.get("obType"), ob.get("start_idx"))

    # Bull / Bear OB 합친 뒤 생성 순(start_idx) 정렬
    all_obs = []
    for ob in ob_result.get("bull", []):
        if not ob.get("breaker"):
            all_obs.append(ob)
    for ob in ob_result.get("bear", []):
        if not ob.get("breaker"):
            all_obs.append(ob)

    for ob in all_obs:
        start = int(ob.get("start_idx", 0))
        top = float(ob.get("top", 0))
        bottom = float(ob.get("bottom", 0))
        typ = ob.get("obType")
        if top <= bottom:
            continue

        # start_idx + 1 부터 유효기간 이내만 검사
        lo_scan = start + 1
        hi_scan = min(n, start + 1 + max_age_bars)

        for i in range(lo_scan, hi_scan):
            # 쿨다운
            if i - last_signal_idx < cooldown_bars:
                continue

            c = candles[i]
            try:
                o = float(c.get("open", 0))
                h = float(c.get("high", 0))
                l = float(c.get("low", 0))
                cl = float(c.get("close", 0))
            except (TypeError, ValueError):
                continue

            # 박스와 겹치는지
            touched = (l <= top) and (h >= bottom)
            if not touched:
                continue

            # 리젝션 확인
            if typ == "bull":
                if cl < o:
                    continue  # 음봉 = 지지 실패, 스킵
                direction = "long"
            elif typ == "bear":
                if cl > o:
                    continue  # 양봉 = 저항 실패, 스킵
                direction = "short"
            else:
                continue

            # 시그널 기록 (OB 당 1회)
            key = _ob_key(ob)
            if key in seen_obs:
                break
            seen_obs.add(key)
            last_signal_idx = i

            signals.append({
                "bar_idx": i,
                "direction": direction,
                "ob_top": top,
                "ob_bottom": bottom,
                "price": cl,
                "ob_type": typ,
            })
            break  # 같은 OB 한 번만

    # bar_idx 오름차순
    signals.sort(key=lambda s: s["bar_idx"])
    return signals

compute_trade_zone = compute_order_blocks
compute_trade_zone_signals = compute_ob_entry_signals
