"""ULTIMATE v2 — 구조-상태-타이밍-목표 100점 만점 퀀트 전략.

설계 원칙:
  1) 구조 확인 → 2) 상태 판정 → 3) 타이밍 진입 → 4) AI 목표 기반 청산
  세팅A: 추세 지속 눌림목 매매
  세팅B: 과열 후 실패 돌파 반전 매매

점수 체계 (100점 만점):
  추세선/구조     20점  (필수 게이트: 12점 이상)
  범온(Bimaco4) 15점
  추세전환        15점
  과열분석        10점  (실격 조건 있음)
  강도측정        10점
  거래량분석      10점
  IMACD          10점  (필수 게이트: 6점 이상)
  AI목표         10점  (필수 게이트: 6점 이상)

진입 기준: 78점 이상 + 필수 게이트 통과
"""
import numpy as np
from src.services.beom_sub import _ema, _sma


# ═══════════════════════════════════════════
# IMACD (Impulse MACD) — SMMA + ZLEMA 기반
# ═══════════════════════════════════════════
def _smma(src, length):
    r = np.empty_like(src)
    r[0] = src[0]
    for i in range(1, len(src)):
        r[i] = (r[i-1] * (length - 1) + src[i]) / length
    return r


def _zlema(src, length):
    e1 = _ema(src, length)
    e2 = _ema(e1, length)
    return 2 * e1 - e2


def calc_imacd(h, l, c, length=34, sig_len=9):
    """IMACD 계산. returns (md, signal, hist)"""
    hlc3 = (h + l + c) / 3
    hi_s = _smma(h, length)
    lo_s = _smma(l, length)
    mi = _zlema(hlc3, length)
    n = len(c)
    md = np.zeros(n)
    for i in range(n):
        if mi[i] > hi_s[i]:
            md[i] = mi[i] - hi_s[i]
        elif mi[i] < lo_s[i]:
            md[i] = mi[i] - lo_s[i]
    sig = _sma(md, sig_len)
    hist = md - sig
    return md, sig, hist


# ═══════════════════════════════════════════
# 8개 항목 점수 계산
# ═══════════════════════════════════════════

def score_structure(price, atr, trendlines, obs, direction):
    """추세선/구조 점수 (0~20).
    - 상위 추세선 방향 일치
    - 지지/저항/OB 근접
    - 바로 반대편 장벽 여유
    """
    s = 12.0  # 기본: 게이트 통과 수준

    # 추세선 근접도
    for tl in (trendlines or []):
        pts = tl.get('points', [])
        if len(pts) < 2:
            continue
        tl_price = pts[-1].get('price', 0)
        if tl_price <= 0 or atr <= 0:
            continue
        dist = (price - tl_price) / atr
        label = (tl.get('label', '') or '').lower()
        touches = min(tl.get('touches', 2), 6)

        if direction == 1 and 'support' in label:
            if -0.5 <= dist <= 1.5:  # 지지선 위 근접
                s += 3.0 * (touches / 4)
            elif dist < -1.5:  # 지지선 아래 이탈
                s -= 4.0
        elif direction == -1 and 'resist' in label:
            if -1.5 <= dist <= 0.5:  # 저항선 아래 근접
                s += 3.0 * (touches / 4)
            elif dist > 1.5:  # 저항선 위 돌파
                s -= 4.0

    # OB 근접도
    for ob in (obs or []):
        top = ob.get('top', 0)
        bot = ob.get('bottom', 0)
        if top <= 0 or bot <= 0 or atr <= 0:
            continue
        mid = (top + bot) / 2
        dist = abs(price - mid) / atr
        if dist > 3:
            continue
        ob_type = ob.get('type', '')
        if direction == 1 and ob_type == 'bull' and price <= top * 1.005:
            s += min(3.0 * (1 - dist / 3), 3.0)
        elif direction == -1 and ob_type == 'bear' and price >= bot * 0.995:
            s += min(3.0 * (1 - dist / 3), 3.0)
        # 반대 OB가 바로 앞에 있으면 감점
        if direction == 1 and ob_type == 'bear' and 0 < (top - price) / atr < 2:
            s -= 2.0
        elif direction == -1 and ob_type == 'bull' and 0 < (price - bot) / atr < 2:
            s -= 2.0

    return max(0, min(20, s))


def score_bimaco(signal_sum, direction):
    """범온 점수 (0~15). signal_sum 범위: -14 ~ +14"""
    val = signal_sum * direction  # 방향 일치 시 양수
    if val >= 11:
        return 15
    elif val >= 8:
        return 13
    elif val >= 5:
        return 10
    elif val >= 2:
        return 8
    elif val >= 0:
        return 5
    elif val >= -3:
        return 3
    else:
        return 0


def score_trend(ultra_trend_dir, alignment, stn, stn_prev, direction):
    """추세전환 점수 (0~15).
    - Ultra Trend 방향 일치
    - 정/역배열 일치
    - 최근 전환 감지
    """
    s = 0
    # Ultra Trend 방향
    if ultra_trend_dir == direction:
        s += 8
    elif ultra_trend_dir == 0:
        s += 3
    else:
        s += 0  # 반대 방향 — 0점

    # 정/역배열
    if direction == 1 and alignment == 'bull':
        s += 4
    elif direction == -1 and alignment == 'bear':
        s += 4
    elif alignment == 'neutral':
        s += 2

    # 전환 감지 보너스 (STN 제로크로스)
    if direction == 1 and stn > 0 and stn_prev <= 0:
        s += 4
    elif direction == -1 and stn < 0 and stn_prev >= 0:
        s += 4
    elif stn * direction > 0.2:
        s += 2

    return min(15, s)


def score_heat(scaled_rsi, scaled_mfi, direction):
    """과열분석 점수 (0~10, 실격 가능).
    과열 추격 = 낮은 점수, 눌림 후 재출발 = 높은 점수
    """
    # 방향 기준 과열 판단
    if direction == 1:
        # 매수: RSI/MFI 둘 다 극단 과매수면 과열
        if scaled_rsi > 0.3 and scaled_mfi > 0.3:
            return 1  # 과열 추격 — 거의 실격
        elif scaled_rsi > 0.2 and scaled_mfi > 0.2:
            return 4  # 주의
        elif scaled_rsi < 0 and scaled_mfi < 0:
            return 9  # 눌림 구간 — 좋음
        else:
            return 7  # 정상
    else:
        if scaled_rsi < -0.3 and scaled_mfi < -0.3:
            return 1
        elif scaled_rsi < -0.2 and scaled_mfi < -0.2:
            return 4
        elif scaled_rsi > 0 and scaled_mfi > 0:
            return 9
        else:
            return 7


def score_strength(uprsi, upstoch, uprsi_prev, upstoch_prev, direction):
    """강도측정 점수 (0~10).
    strength 증가 + 방향 일치 = 고득점
    """
    s = 0
    val_r = uprsi * direction
    val_s = upstoch * direction

    # 방향 일치
    if val_r > 0.1 and val_s > 0.1:
        s += 5
    elif val_r > 0 and val_s > 0:
        s += 3
    elif val_r > 0 or val_s > 0:
        s += 1

    # 증가 추세
    delta_r = (uprsi - uprsi_prev) * direction
    delta_s = (upstoch - upstoch_prev) * direction
    if delta_r > 0 and delta_s > 0:
        s += 4  # 둘 다 강화
    elif delta_r > 0 or delta_s > 0:
        s += 2  # 하나 강화
    elif delta_r < -0.05 and delta_s < -0.05:
        s -= 2  # 다이버전스

    return max(0, min(10, s))


def score_volume(volume_ratio, is_breakout_bar, direction):
    """거래량분석 점수 (0~10).
    volume_ratio = current_vol / avg_vol(20)
    """
    if is_breakout_bar and volume_ratio > 1.5:
        return 10  # 돌파 + 거래량 증가
    elif is_breakout_bar and volume_ratio > 1.2:
        return 8
    elif is_breakout_bar and volume_ratio < 0.8:
        return 2  # 돌파인데 거래량 약함
    elif volume_ratio > 1.3:
        return 7
    elif volume_ratio > 1.0:
        return 6
    elif volume_ratio > 0.7:
        return 5
    else:
        return 3


def score_imacd(md, md_prev, hist, hist_prev, sig, direction):
    """IMACD 점수 (0~10).
    cross + 0선 근처 재가속 = 고득점
    """
    s = 0

    # 크로스 감지
    cross_up = md > sig and md_prev <= sig
    cross_dn = md < sig and md_prev >= sig

    if direction == 1 and cross_up:
        s += 5
    elif direction == -1 and cross_dn:
        s += 5
    elif direction == 1 and md > sig:
        s += 3  # 이미 위에 있음
    elif direction == -1 and md < sig:
        s += 3

    # 0선 근처 재가속
    if direction == 1 and md > 0 and md > md_prev:
        s += 2
    elif direction == -1 and md < 0 and md < md_prev:
        s += 2

    # 히스토그램 기울기
    if direction == 1 and hist > hist_prev:
        s += 2
    elif direction == -1 and hist < hist_prev:
        s += 2

    # 방향 일치 기본점
    if direction == 1 and md > 0:
        s += 1
    elif direction == -1 and md < 0:
        s += 1

    # 과확장 감점
    if abs(md) > abs(sig) * 4:
        s -= 2

    return max(0, min(10, s))


def score_ai_target(ai_target_pct, sl_pct):
    """AI목표 점수 (0~10).
    R배수 = 목표수익 / 손절폭
    """
    if sl_pct <= 0:
        return 5  # 판단 불가
    r_ratio = ai_target_pct / sl_pct
    if r_ratio >= 2.5:
        return 10
    elif r_ratio >= 2.0:
        return 9
    elif r_ratio >= 1.5:
        return 7
    elif r_ratio >= 1.0:
        return 5
    elif r_ratio >= 0.5:
        return 3
    else:
        return 1


# ═══════════════════════════════════════════
# 종합 판정
# ═══════════════════════════════════════════

def evaluate_setup(scores):
    """100점 만점 종합 판정.
    scores: dict with keys structure, bimaco, trend, heat, strength, volume, imacd, ai_target
    returns: (total, grade, gates_pass, reason)
    """
    total = sum(scores.values())

    # 필수 게이트
    gates = []
    if scores['structure'] < 12:
        gates.append('구조 불량')
    if scores['imacd'] < 6:
        gates.append('타이밍 약함')
    if scores['ai_target'] < 6:
        gates.append('손익비 불리')
    if scores['heat'] <= 2:
        gates.append('과열 추격')

    gates_pass = len(gates) == 0

    if total >= 85:
        grade = 'A'
    elif total >= 78:
        grade = 'B'
    elif total >= 70:
        grade = 'C'
    elif total >= 64:
        grade = 'D'
    else:
        grade = 'F'

    return total, grade, gates_pass, gates


# ═══════════════════════════════════════════
# 메인 전략 결정 함수
# ═══════════════════════════════════════════

def decide_ultimate_v2(state, position=None):
    """ULTIMATE v2 매매 결정.

    state: {
        'price', 'atr',
        # 범온
        'bimaco_ss': signal_sum (-14~+14),
        # 추세
        'ultra_dir': 1/-1/0, 'alignment': 'bull'/'bear'/'neutral',
        'stn', 'stn_prev',
        # 과열/강도
        'scaled_rsi', 'scaled_mfi',
        'uprsi', 'upstoch', 'uprsi_prev', 'upstoch_prev',
        # 거래량
        'volume_ratio', 'is_breakout',
        # IMACD
        'imacd_md', 'imacd_md_prev', 'imacd_hist', 'imacd_hist_prev', 'imacd_sig',
        # 구조
        'trendlines': [], 'obs': [],
        # AI
        'ai_target_pct': float, 'sl_pct': float,
    }
    """
    price = state['price']
    atr = state['atr']

    # 양방향 점수 계산
    results = {}
    for dr, label in [(1, 'long'), (-1, 'short')]:
        scores = {
            'structure': score_structure(price, atr, state.get('trendlines'), state.get('obs'), dr),
            'bimaco': score_bimaco(state.get('bimaco_ss', 0), dr),
            'trend': score_trend(state.get('ultra_dir', 0), state.get('alignment', 'neutral'),
                                 state.get('stn', 0), state.get('stn_prev', 0), dr),
            'heat': score_heat(state.get('scaled_rsi', 0), state.get('scaled_mfi', 0), dr),
            'strength': score_strength(state.get('uprsi', 0), state.get('upstoch', 0),
                                       state.get('uprsi_prev', 0), state.get('upstoch_prev', 0), dr),
            'volume': score_volume(state.get('volume_ratio', 1), state.get('is_breakout', False), dr),
            'imacd': score_imacd(state.get('imacd_md', 0), state.get('imacd_md_prev', 0),
                                  state.get('imacd_hist', 0), state.get('imacd_hist_prev', 0),
                                  state.get('imacd_sig', 0), dr),
            'ai_target': score_ai_target(state.get('ai_target_pct', 0), state.get('sl_pct', 0)),
        }
        total, grade, gates_pass, gates = evaluate_setup(scores)
        results[label] = {'scores': scores, 'total': total, 'grade': grade, 'gates_pass': gates_pass, 'gates': gates}

    # ── 충돌 규칙 ──
    long_r = results['long']
    short_r = results['short']

    # 양쪽 다 70 이상이면 보류
    if long_r['total'] >= 70 and short_r['total'] >= 70:
        return {'action': 'none', 'reason': '매수/매도 접전', 'long': long_r, 'short': short_r}

    # 점수 차이 10 미만이면 보류
    if abs(long_r['total'] - short_r['total']) < 10:
        return {'action': 'none', 'reason': '점수 차이 부족', 'long': long_r, 'short': short_r}

    # 승자 결정
    if long_r['total'] > short_r['total']:
        winner, side, dr = long_r, 'long', 1
    else:
        winner, side, dr = short_r, 'short', -1

    # ── 진입 판정 ──
    if position is None:
        if not winner['gates_pass']:
            return {'action': 'none', 'reason': f'게이트 실패: {", ".join(winner["gates"])}',
                    'long': long_r, 'short': short_r}

        # 추세 점수가 낮으면 보류 (상위 구조 반대)
        if winner['scores']['trend'] < 7:
            return {'action': 'none', 'reason': '추세 불일치',
                    'long': long_r, 'short': short_r}

        # 범온 약하면 보류 (상태 불명확)
        if winner['scores']['bimaco'] < 8:
            return {'action': 'none', 'reason': '범온 약함',
                    'long': long_r, 'short': short_r}

        if winner['grade'] in ('A', 'B'):
            ep = 1.0 if winner['grade'] == 'A' else 0.7
            sl_mult = 0.8  # ATR×0.8 (12x에서 약 -6~7%)
            tp1_mult = 2.0
            tp2_mult = 3.5
            return {
                'action': 'enter', 'side': side, 'ep': ep,
                'sl': sl_mult, 'tp1_r': tp1_mult, 'tp2_r': tp2_mult,
                'score': winner['total'], 'grade': winner['grade'],
                'scores': winner['scores'],
                'long': long_r, 'short': short_r,
            }
        elif winner['grade'] == 'C' and winner['total'] >= 74:
            # C급 상위(74~77): 소량 분할 진입
            return {
                'action': 'enter', 'side': side, 'ep': 0.3,
                'sl': 0.7, 'tp1_r': 1.8, 'tp2_r': 3.0,
                'score': winner['total'], 'grade': 'C',
                'scores': winner['scores'],
                'long': long_r, 'short': short_r,
            }
        else:
            return {'action': 'none', 'reason': f'점수 부족 ({winner["total"]}점 {winner["grade"]}급)',
                    'long': long_r, 'short': short_r}

    # ── 청산 판정 (전면 지표 기반) ──
    else:
        sd = 1 if position['side'] == 'long' else -1
        entry = position['entry']
        pnl = (price - entry) / entry * sd
        pk = position.get('peak', price)
        my_scores = winner['scores'] if (sd == 1 and long_r['total'] >= short_r['total']) or (sd == -1 and short_r['total'] >= long_r['total']) else (long_r['scores'] if sd == 1 else short_r['scores'])
        my_total = long_r['total'] if sd == 1 else short_r['total']
        opp_total = short_r['total'] if sd == 1 else long_r['total']
        opp = short_r if sd == 1 else long_r

        # ─── 1. 구조 이탈 손절 (지지/저항 붕괴) ───
        # 내 방향 구조 점수가 진입 시보다 크게 하락하면 구조 붕괴
        entry_struct = position.get('entry_structure', 12)
        if my_scores.get('structure', 12) < 6 and my_scores.get('structure', 12) < entry_struct - 6:
            return {'action': 'close', 'reason': 'struct_break', 'long': long_r, 'short': short_r}

        # ─── 2. 범온 반전 손절 (상태 붕괴) ───
        bm_ss = state.get('bimaco_ss', 0)
        if sd == 1 and bm_ss <= -8:  # 롱인데 범온 강한 음수
            return {'action': 'close', 'reason': 'bimaco_reverse', 'long': long_r, 'short': short_r}
        if sd == -1 and bm_ss >= 8:  # 숏인데 범온 강한 양수
            return {'action': 'close', 'reason': 'bimaco_reverse', 'long': long_r, 'short': short_r}

        # ─── 3. 과열 도달 → 수익 중이면 1차 청산 ───
        heat_score = my_scores.get('heat', 7)
        if pnl > 0.005 and heat_score <= 3:
            # 내 방향이 과열 → 수익 보호 청산
            return {'action': 'partial_close', 'ratio': 0.50, 'reason': 'heat_tp',
                    'long': long_r, 'short': short_r}

        # ─── 4. 강도 둔화 → 수익 중이면 2차 청산 ───
        if pnl > 0.003 and my_scores.get('strength', 5) <= 2:
            return {'action': 'partial_close', 'ratio': 0.30, 'reason': 'strength_fade',
                    'long': long_r, 'short': short_r}

        # ─── 5. IMACD 반전 크로스 ───
        md = state.get('imacd_md', 0)
        md_prev = state.get('imacd_md_prev', 0)
        sig = state.get('imacd_sig', 0)
        if sd == 1 and md < sig and md_prev >= sig:
            if pnl > 0:
                return {'action': 'close', 'reason': 'imacd_cross', 'long': long_r, 'short': short_r}
            elif pnl < -0.005:
                # IMACD도 반대 + 손실 → 손절
                return {'action': 'close', 'reason': 'imacd_sl', 'long': long_r, 'short': short_r}
        if sd == -1 and md > sig and md_prev <= sig:
            if pnl > 0:
                return {'action': 'close', 'reason': 'imacd_cross', 'long': long_r, 'short': short_r}
            elif pnl < -0.005:
                return {'action': 'close', 'reason': 'imacd_sl', 'long': long_r, 'short': short_r}

        # ─── 6. 추세 전환 (Ultra Trend 반전) ───
        if state.get('ultra_dir', 0) == -sd:
            # 추세가 반대로 전환
            if my_scores.get('trend', 7) <= 3:
                return {'action': 'close', 'reason': 'trend_reverse', 'long': long_r, 'short': short_r}

        # ─── 7. 반대 방향 종합 점수 강세 → 반전 청산 ───
        if opp['total'] >= 74 and opp['gates_pass'] and opp['total'] > my_total + 10:
            return {'action': 'close', 'reason': 'reversal_signal', 'long': long_r, 'short': short_r}

        # ─── 8. 비상 손절 (최후 방어선 — ATR 기반) ───
        # 모든 지표 청산이 실패해도 최대 손실 제한
        max_sl = position.get('sl', 0.8)
        if sd == 1 and price < entry - atr * max_sl:
            return {'action': 'close', 'reason': 'emergency_sl', 'long': long_r, 'short': short_r}
        if sd == -1 and price > entry + atr * max_sl:
            return {'action': 'close', 'reason': 'emergency_sl', 'long': long_r, 'short': short_r}

        # ─── 9. 수익 보호 트레일링 (지표 기반 강화) ───
        # 수익 중 + 강도/IMACD 둘 다 약화 → 청산
        if pnl > 0.01:
            imacd_weakening = (sd == 1 and state.get('imacd_hist', 0) < state.get('imacd_hist_prev', 0)) or \
                              (sd == -1 and state.get('imacd_hist', 0) > state.get('imacd_hist_prev', 0))
            strength_weak = my_scores.get('strength', 5) <= 3
            if imacd_weakening and strength_weak:
                return {'action': 'close', 'reason': 'momentum_fade', 'long': long_r, 'short': short_r}

        # ─── 10. 장기 보유 + 지표 중립 ───
        if position.get('bars_held', 0) > 120 and my_total < 55:
            return {'action': 'close', 'reason': 'stale_position', 'long': long_r, 'short': short_r}

    return {'action': 'none', 'long': long_r, 'short': short_r}
