"""AI 차트 해설 서비스 — 5개 서브차트 지표 + 범온 종합 분석."""
import numpy as np


def analyze_chart(candles: list[dict], timeframe: str = "15m") -> dict:
    if len(candles) < 50:
        return {"trend": "데이터 부족", "disclaimer": "투자 판단은 본인 책임입니다."}

    closes = np.array([float(c.get("close") or c.get("c", 0)) for c in candles])
    highs = np.array([float(c.get("high") or c.get("h", 0)) for c in candles])
    lows = np.array([float(c.get("low") or c.get("l", 0)) for c in candles])
    volumes = np.array([float(c.get("volume") or c.get("v", 0)) for c in candles])
    price = closes[-1]
    n = len(closes)

    def ema(data, p):
        a = 2/(p+1); r = [data[0]]
        for i in range(1, len(data)): r.append(a*data[i]+(1-a)*r[-1])
        return np.array(r)

    def rma(data, p):
        r = np.empty_like(data); r[0] = data[0]; a = 1.0/p
        for i in range(1, len(data)): r[i] = a*data[i]+(1-a)*r[i-1]
        return r

    def sma(data, p):
        cs = np.cumsum(data); r = np.empty_like(data)
        r[:p-1] = cs[:p-1]/np.arange(1,p)
        r[p-1:] = (cs[p-1:]-np.concatenate([[0],cs[:len(data)-p]]))/p
        return r

    ema20 = ema(closes, 20); ema50 = ema(closes, 50); ema200 = ema(closes, 200)

    # === 추세 (EMA 기반, 모순 방지) ===
    ema_bull = ema20[-1] > ema50[-1] > ema200[-1]
    ema_bear = ema20[-1] < ema50[-1] < ema200[-1]
    price_above_ema20 = price > ema20[-1]

    # 구조 (20봉 기준 고점/저점)
    seg = min(20, n//3)
    hh = highs[-1] > np.max(highs[-seg*2:-seg]) if n > seg*2 else False
    hl = lows[-1] > np.min(lows[-seg*2:-seg]) if n > seg*2 else False
    lh = highs[-1] < np.max(highs[-seg*2:-seg]) if n > seg*2 else False
    ll = lows[-1] < np.min(lows[-seg*2:-seg]) if n > seg*2 else False

    # 추세와 구조를 통합 판단 (모순 제거)
    bull_score = (1 if ema_bull else 0) + (1 if price_above_ema20 else 0) + (1 if hh and hl else 0)
    bear_score = (1 if ema_bear else 0) + (1 if not price_above_ema20 else 0) + (1 if lh and ll else 0)

    if bull_score >= 2:
        trend = "상승 추세"; structure = "고점과 저점이 높아지는 상승 구조"
    elif bear_score >= 2:
        trend = "하락 추세"; structure = "고점과 저점이 낮아지는 하락 구조"
    else:
        trend = "횡보/전환 구간"; structure = "뚜렷한 방향 없이 수렴 중"

    # 추세 강도
    ema_spread = abs(ema20[-1] - ema50[-1]) / price * 100
    if ema_spread > 2: trend_strength = "강함"
    elif ema_spread > 0.5: trend_strength = "보통"
    else: trend_strength = "약함"

    trend_detail = f"EMA20 {'>' if ema20[-1]>ema50[-1] else '<'} EMA50 {'>' if ema50[-1]>ema200[-1] else '<'} EMA200 | 현재가 EMA20 {'위' if price_above_ema20 else '아래'} | 강도: {trend_strength}"

    # 범온 추세강도 추가
    try:
        from src.services.beom_candle import compute_ultra_trend
        _ut = compute_ultra_trend(candles)
        _ss = _ut.get("t", {}).get("v", 0)
        _ss_max = _ut.get("t", {}).get("max_signals", 12)
        _ss_dir = _ut.get("t", {}).get("dir", "")
        if _ss >= 7: ss_text = f"AI 추세강도 {_ss}/{_ss_max} — 강한 상승세"
        elif _ss >= 3: ss_text = f"AI 추세강도 {_ss}/{_ss_max} — 약한 상승세"
        elif _ss <= -7: ss_text = f"AI 추세강도 {_ss}/{_ss_max} — 강한 하락세"
        elif _ss <= -3: ss_text = f"AI 추세강도 {_ss}/{_ss_max} — 약한 하락세"
        else: ss_text = f"AI 추세강도 {_ss}/{_ss_max} — 중립"
        trend_detail += f" | {ss_text} | AI방향: {_ss_dir}"
    except Exception:
        _ss = 0

    # === RSI ===
    diff = np.diff(closes)
    gain = np.where(diff>0, diff, 0.0); loss = np.where(diff<0, -diff, 0.0)
    ag = rma(gain, 14); al = rma(loss, 14)
    rsi = 100 - 100/(1 + ag[-1]/max(al[-1], 1e-10))

    # === MACD ===
    e12, e26 = ema(closes, 12), ema(closes, 26)
    macd_line = e12 - e26; macd_sig = ema(macd_line, 9)
    macd_hist = macd_line[-1] - macd_sig[-1]
    macd_prev = macd_line[-2] - macd_sig[-2] if n > 2 else 0
    macd_cross = "골든크로스" if macd_hist > 0 and macd_prev <= 0 else ("데드크로스" if macd_hist < 0 and macd_prev >= 0 else "")

    # === ATR / 변동성 ===
    tr = np.maximum(highs[1:]-lows[1:], np.maximum(np.abs(highs[1:]-closes[:-1]), np.abs(lows[1:]-closes[:-1])))
    atr = np.mean(tr[-14:])
    atr_pct = atr / price * 100
    vol_avg = np.mean(volumes[-20:]); vol_ratio = volumes[-1]/vol_avg if vol_avg > 0 else 1

    if atr_pct > 3: vol_regime = "고변동성"
    elif atr_pct > 1: vol_regime = "보통"
    else: vol_regime = "저변동성"

    # === 거래량 분석 ===
    vol_sma20 = sma(volumes, 20)
    vol_trend = "증가" if volumes[-1] > vol_sma20[-1] * 1.5 else ("감소" if volumes[-1] < vol_sma20[-1] * 0.5 else "보통")
    # OBV 방향
    obv = np.cumsum(np.where(np.diff(closes) > 0, volumes[1:], np.where(np.diff(closes) < 0, -volumes[1:], 0)))
    obv_trend = "상승" if len(obv) > 20 and obv[-1] > obv[-20] else "하락"

    # === 지지/저항 ===
    swing = 5
    pivot_highs, pivot_lows = [], []
    for i in range(swing, n-swing):
        if highs[i] == max(highs[i-swing:i+swing+1]): pivot_highs.append(float(highs[i]))
        if lows[i] == min(lows[i-swing:i+swing+1]): pivot_lows.append(float(lows[i]))
    resistance = sorted([p for p in pivot_highs if p > price], key=lambda p: p-price)[:2]
    support = sorted([p for p in pivot_lows if p < price], key=lambda p: price-p)[:2]

    # === 5개 서브차트 지표 종합 ===
    # 과열분석
    from src.services.beom_sub import _stoch, _sma as _sma_fn, _rolling_min, _rolling_max, _ema, _rsi as _rsi_fn, _mfi
    raw_stoch = _stoch(closes, highs, lows, 14)
    k_stoch = _sma_fn(raw_stoch, 9)
    lo_st = _rolling_min(k_stoch, 240); hi_st = _rolling_max(k_stoch, 240)
    ud_stoch = (k_stoch - lo_st) / np.maximum(hi_st - lo_st, 1e-10) - 0.5

    # 강도측정
    rv = _ema(_rsi_fn(closes, 60), 3)
    lo_r = _rolling_min(rv, 300); hi_r = _rolling_max(rv, 300)
    ud_rsi = (rv - lo_r) / np.maximum(hi_r - lo_r, 1e-10) - 0.5

    # 추세전환
    d3 = _ema(closes, 12) - _ema(closes, 26)
    lo3 = _rolling_min(d3, 60); hi3 = _rolling_max(d3, 60)
    stc = (d3 - lo3) / np.maximum(hi3 - lo3, 1e-10) - 0.5

    # RSI/MFI 스케일
    scaled_rsi = _rsi_fn(closes, 60) / 100 - 0.5
    scaled_mfi = _mfi(highs, lows, closes, volumes, 60) / 100 - 0.5

    # 지표별 방향 집계
    ind_signals = {
        "과열분석": "매수" if ud_stoch[-1] > 0.1 else ("매도" if ud_stoch[-1] < -0.1 else "중립"),
        "강도측정": "매수" if ud_rsi[-1] > 0.1 else ("매도" if ud_rsi[-1] < -0.1 else "중립"),
        "추세전환": "매수" if stc[-1] > 0.1 else ("매도" if stc[-1] < -0.1 else "중립"),
        "매매압력": "매수" if scaled_rsi[-1] > 0.1 else ("매도" if scaled_rsi[-1] < -0.1 else "중립"),
        "자금흐름": "매수" if scaled_mfi[-1] > 0.1 else ("매도" if scaled_mfi[-1] < -0.1 else "중립"),
    }
    buy_count = sum(1 for v in ind_signals.values() if v == "매수")
    sell_count = sum(1 for v in ind_signals.values() if v == "매도")

    # === RSI/MACD 텍스트 ===
    if rsi > 70: rsi_text = f"RSI {rsi:.1f} — 과매수 구간, 단기 조정 가능성"
    elif rsi < 30: rsi_text = f"RSI {rsi:.1f} — 과매도 구간, 반등 가능성"
    else: rsi_text = f"RSI {rsi:.1f} — 중립"

    macd_text = f"MACD {'양수 (매수 모멘텀)' if macd_hist > 0 else '음수 (매도 모멘텀)'}"
    if macd_cross: macd_text += f" | {macd_cross} 발생"

    # === 시나리오 ===
    bull_scenario = f"${resistance[0]:,.2f} 돌파 시 추세 연장" if resistance else "저항선 없음, 상승 여력 있음"
    bear_scenario = f"${support[0]:,.2f} 이탈 시 추가 하락" if support else "지지선 없음, 낙폭 주의"

    return {
        "trend": trend,
        "trendDetail": trend_detail,
        "trendStrength": trend_strength,
        "structure": structure,
        "supportLevels": [round(p, 2) for p in support],
        "resistanceLevels": [round(p, 2) for p in resistance],
        "rsi": rsi_text,
        "macd": macd_text,
        "volatility": f"ATR {atr:.2f} ({atr_pct:.1f}%) | {vol_regime} | 거래량 {vol_trend} ({vol_ratio:.1f}x)",
        "volumeAnalysis": f"OBV {obv_trend} | 거래량 20MA 대비 {vol_ratio:.1f}배 | {vol_trend}",
        "indicators": ind_signals,
        "indicatorSummary": f"매수 {buy_count}/5 | 매도 {sell_count}/5 | 중립 {5-buy_count-sell_count}/5",
        "premiumDetail": f"과열분석: {ud_stoch[-1]:+.3f} | 강도측정: {ud_rsi[-1]:+.3f} | 추세전환: {stc[-1]:+.3f} | 매매압력: {scaled_rsi[-1]:+.3f} | 자금흐름: {scaled_mfi[-1]:+.3f}",
        "scenarioBullish": bull_scenario,
        "scenarioBearish": bear_scenario,
        "disclaimer": "투자 판단은 본인 책임입니다. 이 분석은 참고용이며 매매 권유가 아닙니다.",
        "signalSumRaw": _ss if '_ss' in dir() else 0,
    }
