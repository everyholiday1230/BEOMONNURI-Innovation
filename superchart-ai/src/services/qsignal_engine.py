"""Q-Signal Engine — 강건한 멀티팩터 퀀트매매 신호 엔진.

계층: 레짐 분류 → 구조 확인 → 모멘텀 확인 → 과열 필터 → 스코어링
3종 진입모델: 추세지속 / 되돌림 재진입 / 반전
확정봉 기준, 미래참조 금지, 롱/숏 대칭, 적응형 정규화.
"""
import numpy as np
from src.services.beom_sub import _ema, _rsi, _stoch, _sma, _mfi, _rolling_min, _rolling_max
from src.services.strategy_ultimate import (
    calc_imacd,
)

# ═══════════════════════════════════════════
# 타임프레임별 적응 스케일링
# ═══════════════════════════════════════════
TF_PROFILES = {
    '1m':  {'lookback': 500, 'score_th': 68, 'heat_mult': 0.8, 'vol_lb': 30, 'target_mult': 0.6, 'cooldown': 8},
    '5m':  {'lookback': 400, 'score_th': 72, 'heat_mult': 0.9, 'vol_lb': 20, 'target_mult': 1.0, 'cooldown': 5},
    '15m': {'lookback': 350, 'score_th': 74, 'heat_mult': 1.0, 'vol_lb': 20, 'target_mult': 1.2, 'cooldown': 4},
    '1h':  {'lookback': 300, 'score_th': 76, 'heat_mult': 1.1, 'vol_lb': 20, 'target_mult': 1.5, 'cooldown': 3},
    '4h':  {'lookback': 250, 'score_th': 78, 'heat_mult': 1.2, 'vol_lb': 14, 'target_mult': 2.0, 'cooldown': 2},
    '1d':  {'lookback': 200, 'score_th': 80, 'heat_mult': 1.3, 'vol_lb': 14, 'target_mult': 3.0, 'cooldown': 1},
}

# 버전별 임계값 오프셋
VER_OFFSETS = {
    'safe': {'th_add': 8, 'cooldown_add': 3, 'heat_mult_add': 0.15, 'label': '보수적'},
    'std':  {'th_add': 0, 'cooldown_add': 0, 'heat_mult_add': 0.0,  'label': '표준'},
    'aggr': {'th_add': -6, 'cooldown_add': -2, 'heat_mult_add': -0.1, 'label': '적극적'},
}

def _get_tf_profile(tf, ver='std'):
    base = dict(TF_PROFILES.get(tf, TF_PROFILES['5m']))
    off = VER_OFFSETS.get(ver, VER_OFFSETS['std'])
    base['score_th'] = base['score_th'] + off['th_add']
    base['cooldown'] = max(1, base['cooldown'] + off['cooldown_add'])
    base['heat_mult'] = max(0.5, base['heat_mult'] + off['heat_mult_add'])
    base['ver'] = ver
    base['ver_label'] = off['label']
    return base


def _atr(h, l, c, period):
    tr = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    tr = np.concatenate([[h[0] - l[0]], tr])
    a = 1.0 / period
    r = np.empty_like(tr)
    r[0] = tr[0]
    for i in range(1, len(tr)):
        r[i] = a * tr[i] + (1 - a) * r[i - 1]
    return r


def _percentile_rank(arr, lookback):
    """적응형 백분위 정규화. 최근 lookback 봉 기준 0~1."""
    n = len(arr)
    out = np.full(n, 0.5)
    for i in range(lookback, n):
        window = arr[i - lookback:i]
        out[i] = np.searchsorted(np.sort(window), arr[i]) / lookback
    return out


def _zscore_adaptive(arr, lookback):
    """적응형 z-score. 최근 lookback 봉 기준."""
    n = len(arr)
    out = np.zeros(n)
    for i in range(lookback, n):
        window = arr[i - lookback:i]
        m = np.mean(window)
        s = np.std(window)
        out[i] = (arr[i] - m) / max(s, 1e-10)
    return out


# ═══════════════════════════════════════════
# 레짐 분류기 (5-state)
# ═══════════════════════════════════════════
def classify_qregime(vwap_above, vwap_slope, ultra_dir, strength_score,
                     imacd_dir, imacd_hist_accel, heat_state, bimaco_ss):
    """5-state 레짐 분류.
    Returns: ('TREND_UP'|'TREND_DOWN'|'BALANCED'|'EXHAUSTED_UP'|'EXHAUSTED_DOWN', confidence, reason)
    """
    bull_votes = 0
    bear_votes = 0
    reasons = []

    # VWAP 위/아래 + 기울기
    if vwap_above and vwap_slope > 0:
        bull_votes += 2; reasons.append('vwap_bull')
    elif not vwap_above and vwap_slope < 0:
        bear_votes += 2; reasons.append('vwap_bear')
    elif vwap_above:
        bull_votes += 1
    elif not vwap_above:
        bear_votes += 1

    # 추세전환 상태
    if ultra_dir == 1:
        bull_votes += 2; reasons.append('trend_up')
    elif ultra_dir == -1:
        bear_votes += 2; reasons.append('trend_down')

    # 강도측정
    if strength_score > 6:
        bull_votes += 1 if ultra_dir >= 0 else 0
        bear_votes += 1 if ultra_dir <= 0 else 0
    elif strength_score < 3:
        reasons.append('weak_str')

    # iMACD 방향 + 히스토그램 가속도
    if imacd_dir > 0:
        bull_votes += 1
        if imacd_hist_accel > 0: bull_votes += 1; reasons.append('imacd_accel_up')
    elif imacd_dir < 0:
        bear_votes += 1
        if imacd_hist_accel < 0: bear_votes += 1; reasons.append('imacd_accel_dn')

    # 범온 방향
    if bimaco_ss >= 5:
        bull_votes += 1
    elif bimaco_ss <= -5:
        bear_votes += 1

    # 과열 상태 → Exhausted 판정
    if heat_state == 1 and bull_votes >= 3:
        return 'EXHAUSTED_UP', 0.75, 'overheat_bull|' + '|'.join(reasons)
    if heat_state == -1 and bear_votes >= 3:
        return 'EXHAUSTED_DOWN', 0.75, 'oversold_bear|' + '|'.join(reasons)

    # 추세 판정
    total = bull_votes + bear_votes
    if bull_votes >= 5 and bear_votes <= 1:
        return 'TREND_UP', min(0.6 + bull_votes * 0.05, 0.95), '|'.join(reasons)
    if bear_votes >= 5 and bull_votes <= 1:
        return 'TREND_DOWN', min(0.6 + bear_votes * 0.05, 0.95), '|'.join(reasons)
    if bull_votes >= 3 and bear_votes <= 1:
        return 'TREND_UP', 0.55 + bull_votes * 0.03, '|'.join(reasons)
    if bear_votes >= 3 and bull_votes <= 1:
        return 'TREND_DOWN', 0.55 + bear_votes * 0.03, '|'.join(reasons)

    return 'BALANCED', 0.5, 'no_consensus'


# ═══════════════════════════════════════════
# 진입모델 활성화 매핑
# ═══════════════════════════════════════════
def _active_models(regime):
    """레짐별 활성 진입모델. 동시 작동 금지."""
    if regime in ('TREND_UP', 'TREND_DOWN'):
        return ['pullback_reentry']
    elif regime in ('EXHAUSTED_UP', 'EXHAUSTED_DOWN'):
        return ['reversal']
    else:  # BALANCED
        return ['pullback_reentry']



# ═══════════════════════════════════════════
# 9-Factor 스코어링 엔진 (100점 만점)
# ═══════════════════════════════════════════
# 레짐적합도 12 | VWAP정렬 10 | 거래밀집구간 12 | iMACD모멘텀 12
# 강도측정 10 | 과열패널티 10 | 거래량확인 10 | AI목표기대보상 12 | 범온구조 12

def _score_regime_fit(regime, direction):
    """레짐 적합도 (0~12)."""
    if direction == 1:
        if regime == 'TREND_UP': return 12
        if regime == 'BALANCED': return 5
        if regime == 'EXHAUSTED_DOWN': return 3  # 반전 롱 가능
        return 0
    else:
        if regime == 'TREND_DOWN': return 12
        if regime == 'BALANCED': return 5
        if regime == 'EXHAUSTED_UP': return 3
        return 0


def _score_vwap_alignment(price, vwap_val, vwap_slope, atr_val, direction):
    """VWAP 정렬 점수 (0~10). ATR 기준 상대거리."""
    if atr_val <= 0: return 5
    dist = (price - vwap_val) / atr_val  # 양수=위, 음수=아래
    if direction == 1:
        if dist > 0 and vwap_slope > 0: return 10
        if dist > 0: return 8
        if dist > -0.5: return 5  # VWAP 근처
        if dist > -1.5: return 3  # 약간 아래
        return 1
    else:
        if dist < 0 and vwap_slope < 0: return 10
        if dist < 0: return 8
        if dist < 0.5: return 5
        if dist < 1.5: return 3
        return 1


def _score_ob_position(price, bull_obs, bear_obs, atr_val, direction):
    """거래밀집구간 위치 점수 (0~12). 지지/저항 근접도 + 반대 장벽 여유."""
    s = 6.0  # 기본
    if atr_val <= 0: return s
    for ob in (bull_obs or []):
        if ob.get('breaker'): continue
        mid = (ob['top'] + ob['bottom']) / 2
        dist = abs(price - mid) / atr_val
        if dist > 4: continue
        if direction == 1 and price >= ob['bottom'] and price <= ob['top'] * 1.01:
            s += min(3.0 * (1 - dist / 4), 3.0)  # 지지 근처
        elif direction == -1 and price <= ob['top'] and dist < 2:
            s -= 2.0  # 반대 장벽
    for ob in (bear_obs or []):
        if ob.get('breaker'): continue
        mid = (ob['top'] + ob['bottom']) / 2
        dist = abs(price - mid) / atr_val
        if dist > 4: continue
        if direction == -1 and price <= ob['top'] and price >= ob['bottom'] * 0.99:
            s += min(3.0 * (1 - dist / 4), 3.0)
        elif direction == 1 and price >= ob['bottom'] and dist < 2:
            s -= 2.0
    return max(0, min(12, s))


def _score_imacd_momentum(md, md_prev, hist, hist_prev, sig, direction):
    """iMACD 모멘텀 점수 (0~12)."""
    s = 0
    cross_up = md > sig and md_prev <= sig
    cross_dn = md < sig and md_prev >= sig
    if direction == 1:
        if cross_up: s += 5
        elif md > sig: s += 3
        if md > 0 and md > md_prev: s += 2
        if hist > hist_prev: s += 2
        if hist > 0 and hist > hist_prev: s += 1
        # 다이버전스 감점
        if md < md_prev and hist < hist_prev: s -= 2
    else:
        if cross_dn: s += 5
        elif md < sig: s += 3
        if md < 0 and md < md_prev: s += 2
        if hist < hist_prev: s += 2
        if hist < 0 and hist < hist_prev: s += 1
        if md > md_prev and hist > hist_prev: s -= 2
    # 과확장 감점
    if abs(md) > abs(sig) * 4: s -= 2
    return max(0, min(12, s))


def _score_strength(uprsi, upstoch, uprsi_prev, upstoch_prev, direction):
    """강도측정 점수 (0~10)."""
    s = 0
    vr = uprsi * direction
    vs = upstoch * direction
    if vr > 0.1 and vs > 0.1: s += 5
    elif vr > 0 and vs > 0: s += 3
    elif vr > 0 or vs > 0: s += 1
    dr = (uprsi - uprsi_prev) * direction
    ds = (upstoch - upstoch_prev) * direction
    if dr > 0 and ds > 0: s += 4
    elif dr > 0 or ds > 0: s += 2
    elif dr < -0.05 and ds < -0.05: s -= 2
    return max(0, min(10, s))


def _score_heat_penalty(scaled_rsi, scaled_mfi, direction, heat_mult=1.0):
    """과열 패널티 (0~10). 높을수록 과열 아님(좋음)."""
    if direction == 1:
        if scaled_rsi > 0.3 * heat_mult and scaled_mfi > 0.3 * heat_mult: return 1
        if scaled_rsi > 0.2 * heat_mult and scaled_mfi > 0.2 * heat_mult: return 4
        if scaled_rsi < 0 and scaled_mfi < 0: return 10  # 눌림
        return 7
    else:
        if scaled_rsi < -0.3 * heat_mult and scaled_mfi < -0.3 * heat_mult: return 1
        if scaled_rsi < -0.2 * heat_mult and scaled_mfi < -0.2 * heat_mult: return 4
        if scaled_rsi > 0 and scaled_mfi > 0: return 10
        return 7


def _score_volume_confirm(vol_ratio, vol_ratio_prev, direction):
    """거래량 확인 점수 (0~10)."""
    if vol_ratio > 1.5: return 10
    if vol_ratio > 1.2: return 8
    if vol_ratio > 1.0: return 6
    if vol_ratio > 0.7: return 4
    return 2


def _score_ai_reward(ai_target_pct, sl_pct):
    """AI목표 기대보상 점수 (0~12)."""
    if sl_pct <= 0: return 6
    r = ai_target_pct / sl_pct
    if r >= 3.0: return 12
    if r >= 2.5: return 10
    if r >= 2.0: return 8
    if r >= 1.5: return 6
    if r >= 1.0: return 4
    return 2


def _score_bimaco_structure(bimaco_ss, direction):
    """범온 캔들 구조 점수 (0~12)."""
    val = bimaco_ss * direction
    if val >= 10: return 12
    if val >= 7: return 10
    if val >= 4: return 8
    if val >= 1: return 6
    if val >= -2: return 3
    return 0


def compute_total_score(regime, direction, state, tf_profile):
    """9개 팩터 종합 점수 계산. 100점 만점."""
    scores = {
        'regime_fit': _score_regime_fit(regime, direction),
        'vwap_align': _score_vwap_alignment(
            state['price'], state['vwap_val'], state['vwap_slope'],
            state['atr'], direction),
        'ob_position': _score_ob_position(
            state['price'], state.get('bull_obs'), state.get('bear_obs'),
            state['atr'], direction),
        'imacd_momentum': _score_imacd_momentum(
            state['imacd_md'], state['imacd_md_prev'],
            state['imacd_hist'], state['imacd_hist_prev'],
            state['imacd_sig'], direction),
        'strength': _score_strength(
            state['uprsi'], state['upstoch'],
            state['uprsi_prev'], state['upstoch_prev'], direction),
        'heat_penalty': _score_heat_penalty(
            state['scaled_rsi'], state['scaled_mfi'],
            direction, tf_profile['heat_mult']),
        'volume_confirm': _score_volume_confirm(
            state['vol_ratio'], state.get('vol_ratio_prev', 1.0), direction),
        'ai_reward': _score_ai_reward(
            state.get('ai_target_pct', 2.0), state.get('sl_pct', 1.0)),
        'bimaco_struct': _score_bimaco_structure(state['bimaco_ss'], direction),
    }
    scores['total'] = sum(scores.values())
    return scores


def classify_signal_grade(total, tf_profile):
    """점수 → 등급. 적응형 임계값."""
    th = tf_profile['score_th']
    if total >= th + 7: return 'STRONG'
    if total >= th: return 'VALID'
    if total >= th - 10: return 'WATCHLIST'
    return 'REJECT'


# ═══════════════════════════════════════════
# 3종 진입모델 조건 검증
# ═══════════════════════════════════════════

def _check_trend_continuation(state, direction, scores, tf_profile):
    """추세지속형 진입 조건. 레짐=TREND_UP/DOWN 전용."""
    fails = []
    # 필수: VWAP 정렬
    if direction == 1 and state['price'] < state['vwap_val']:
        fails.append('vwap_below')
    elif direction == -1 and state['price'] > state['vwap_val']:
        fails.append('vwap_above')
    # 필수: 추세전환 유지
    if state.get('ultra_dir', 0) != direction:
        fails.append('trend_not_aligned')
    # 필수: 강도 임계치
    if scores['strength'] < 4:
        fails.append('weak_strength')
    # 필수: iMACD 히스토그램 개선 (2봉 연속)
    if direction == 1 and state['imacd_hist'] <= state['imacd_hist_prev']:
        if state['imacd_md'] <= state['imacd_sig']:
            fails.append('imacd_no_improve')
    elif direction == -1 and state['imacd_hist'] >= state['imacd_hist_prev']:
        if state['imacd_md'] >= state['imacd_sig']:
            fails.append('imacd_no_improve')
    # 필수: 과열 아닐 것
    if scores['heat_penalty'] <= 2:
        fails.append('overheated')
    # 필수: 거래량 평균 이상
    if state['vol_ratio'] < 0.8:
        fails.append('low_volume')
    # 거래밀집구간: 바로 위/아래 강한 반대 OB 없을 것
    if scores['ob_position'] < 4:
        fails.append('ob_blocked')
    # AI목표 기대보상
    if scores['ai_reward'] < 4:
        fails.append('poor_rr')
    return fails


def _check_pullback_reentry(state, direction, scores, tf_profile):
    """되돌림 재진입형 조건. TREND + BALANCED 레짐."""
    fails = []
    # 가격이 VWAP 또는 OB 지지 근처로 되돌림
    vwap_dist = abs(state['price'] - state['vwap_val']) / max(state['atr'], 1e-10)
    near_vwap = vwap_dist < 1.5
    near_ob = scores['ob_position'] >= 8
    if not near_vwap and not near_ob:
        fails.append('not_pullback_zone')
    # 범온: 하락 둔화 후 재상승 전환
    if direction == 1 and state['bimaco_ss'] < -3:
        fails.append('bimaco_still_falling')
    elif direction == -1 and state['bimaco_ss'] > 3:
        fails.append('bimaco_still_rising')
    # iMACD 약세 둔화 또는 재상향
    if direction == 1:
        improving = state['imacd_hist'] > state['imacd_hist_prev']
        if not improving and state['imacd_md'] < state['imacd_sig']:
            fails.append('imacd_still_weak')
    else:
        improving = state['imacd_hist'] < state['imacd_hist_prev']
        if not improving and state['imacd_md'] > state['imacd_sig']:
            fails.append('imacd_still_weak')
    # 과열 해소 후 정상화
    if scores['heat_penalty'] <= 3:
        fails.append('still_overheated')
    # 되돌림 구간 거래량 감소 확인
    if state['vol_ratio'] > 1.5:
        fails.append('vol_too_high_for_pullback')
    # AI목표 위쪽 열림
    if scores['ai_reward'] < 4:
        fails.append('poor_rr')
    return fails


def _check_reversal(state, direction, scores, tf_profile):
    """반전형 조건. EXHAUSTED 레짐 전용. 가장 보수적."""
    fails = []
    # 과열 극단 필수
    if scores['heat_penalty'] > 3:
        fails.append('not_extreme_heat')
    # iMACD 다이버전스 또는 모멘텀 둔화
    if direction == 1:
        if not (state['imacd_hist'] > state['imacd_hist_prev']):
            fails.append('no_momentum_shift')
    else:
        if not (state['imacd_hist'] < state['imacd_hist_prev']):
            fails.append('no_momentum_shift')
    # 범온 2단계 이상 반전 확인
    if direction == 1 and state['bimaco_ss'] < -5:
        fails.append('bimaco_no_reversal')
    elif direction == -1 and state['bimaco_ss'] > 5:
        fails.append('bimaco_no_reversal')
    # VWAP 복귀 또는 재돌파
    vwap_dist = (state['price'] - state['vwap_val']) / max(state['atr'], 1e-10)
    if direction == 1 and vwap_dist < -2:
        fails.append('too_far_below_vwap')
    elif direction == -1 and vwap_dist > 2:
        fails.append('too_far_above_vwap')
    # 거래량 클라이맥스 후 감소 또는 반전봉 특이점
    if state['vol_ratio'] < 0.5:
        fails.append('no_volume_event')
    # 거래밀집구간 + 거래량 동의 필수
    if scores['ob_position'] < 5 and scores['volume_confirm'] < 5:
        fails.append('ob_vol_disagree')
    return fails


# ═══════════════════════════════════════════
# 청산/무효화 조건
# ═══════════════════════════════════════════

def check_exit(state, pos_dir, entry_price, bars_held, tf_profile):
    """청산 조건 체크. Returns: (should_exit, reason) or (False, None)."""
    pnl = (state['price'] - entry_price) / max(entry_price, 1e-10) * pos_dir

    # AI목표 도달
    if pnl > state.get('ai_target_pct', 2.0) / 100:
        return True, 'ai_target_reached'
    # 과열 재진입
    if pos_dir == 1 and state['scaled_rsi'] > 0.35 and state['scaled_mfi'] > 0.35:
        if pnl > 0: return True, 'heat_tp'
    if pos_dir == -1 and state['scaled_rsi'] < -0.35 and state['scaled_mfi'] < -0.35:
        if pnl > 0: return True, 'heat_tp'
    # 강도 급락
    str_score = _score_strength(state['uprsi'], state['upstoch'],
                                state['uprsi_prev'], state['upstoch_prev'], pos_dir)
    if str_score <= 1 and pnl > 0:
        return True, 'strength_collapse'
    # iMACD 역전
    if pos_dir == 1 and state['imacd_md'] < state['imacd_sig'] and state['imacd_md_prev'] >= state['imacd_sig']:
        return True, 'imacd_cross_exit'
    if pos_dir == -1 and state['imacd_md'] > state['imacd_sig'] and state['imacd_md_prev'] <= state['imacd_sig']:
        return True, 'imacd_cross_exit'
    # VWAP 재이탈
    if pos_dir == 1 and state['price'] < state['vwap_val'] and state.get('prev_price', state['price']) >= state['vwap_val']:
        return True, 'vwap_lost'
    if pos_dir == -1 and state['price'] > state['vwap_val'] and state.get('prev_price', state['price']) <= state['vwap_val']:
        return True, 'vwap_lost'
    # 추세전환 반대
    if state.get('ultra_dir', 0) == -pos_dir:
        return True, 'trend_reversed'
    # 범온 반전
    if pos_dir == 1 and state['bimaco_ss'] <= -8:
        return True, 'bimaco_reversed'
    if pos_dir == -1 and state['bimaco_ss'] >= 8:
        return True, 'bimaco_reversed'
    # 비상 손절 (ATR 기반)
    if pos_dir == 1 and state['price'] < entry_price - state['atr'] * 2.5:
        return True, 'emergency_sl'
    if pos_dir == -1 and state['price'] > entry_price + state['atr'] * 2.5:
        return True, 'emergency_sl'
    return False, None


def check_invalidation(state, pos_dir, entry_idx, current_idx, tf_profile):
    """무효화 조건. Returns: (invalid, reason) or (False, None)."""
    bars_since = current_idx - entry_idx
    # N봉 이내 추세 미진행
    max_wait = tf_profile['cooldown'] * 3
    if bars_since > max_wait:
        return True, 'time_decay'
    # 거래량 확인 실패 (진입 후 거래량 계속 감소)
    if bars_since > 3 and state['vol_ratio'] < 0.3:
        return True, 'volume_dried'
    # 범온 구조 붕괴
    if pos_dir == 1 and state['bimaco_ss'] <= -6:
        return True, 'bimaco_collapse'
    if pos_dir == -1 and state['bimaco_ss'] >= 6:
        return True, 'bimaco_collapse'
    return False, None


# ═══════════════════════════════════════════
# 메인 엔진: 전체 봉 스캔 → 신호 생성
# ═══════════════════════════════════════════

def compute_qsignals(candles, timeframe='5m', bull_obs=None, bear_obs=None,
                     ai_pred=None, ver='std'):
    """Q-Signal 엔진 메인. 확정봉 기준 신호 생성.

    ver: 'safe' (보수적) / 'std' (표준) / 'aggr' (적극적)
    """
    n = len(candles)
    tf = _get_tf_profile(timeframe, ver)
    warmup = max(tf['lookback'], 300)
    if n < warmup + 50:
        return {'signals': [], 'regime_history': [], 'debug': {'error': 'insufficient_data'}}

    # OHLCV 추출
    o = np.array([float(x.get('open') or x.get('o', 0)) for x in candles])
    h = np.array([float(x.get('high') or x.get('h', 0)) for x in candles])
    l = np.array([float(x.get('low') or x.get('l', 0)) for x in candles])
    c = np.array([float(x.get('close') or x.get('c', 0)) for x in candles])
    v = np.array([float(x.get('volume') or x.get('v', 0)) for x in candles])

    # ── 지표 사전 계산 (전체 시계열) ──
    atr14 = _atr(h, l, c, 14)

    # VWAP
    from src.services.vwap_ma_cluster import _vwap_session, _slope as _vwap_slope_fn
    vwap = _vwap_session(c, h, l, v)
    vwap_slopes = _vwap_slope_fn(vwap, 3)

    # iMACD
    md, sig, hist = calc_imacd(h, l, c)

    # 범온 (ultra_trend signal_sum 사용)
    from src.services.beom_candle import compute_ultra_trend
    ut = compute_ultra_trend(candles)
    ut_bars = ut.get('d', [])
    bimaco_ss = np.array([b.get('v', 0) for b in ut_bars]) if ut_bars else np.zeros(n)
    if len(bimaco_ss) < n:
        bimaco_ss = np.concatenate([bimaco_ss, np.zeros(n - len(bimaco_ss))])

    # 과열/강도
    rsi_raw = _rsi(c, 60)
    scaled_rsi = rsi_raw / 100 - 0.5
    mfi_raw = _mfi(h, l, c, v, 60)
    scaled_mfi = mfi_raw / 100 - 0.5
    rsi_smooth = _ema(scaled_rsi, 3)
    mfi_smooth = _ema(scaled_mfi, 3)

    # 강도 (uprsi, upstoch)
    rsi_ema = _ema(_rsi(c, 60), 3)
    lo_r = _rolling_min(rsi_ema, 300); hi_r = _rolling_max(rsi_ema, 300)
    uprsi = (rsi_ema - lo_r) / np.maximum(hi_r - lo_r, 1e-10) - 0.5
    raw_stoch = _stoch(c, h, l, 14); k_stoch = _sma(raw_stoch, 9)
    lo_st = _rolling_min(k_stoch, 240); hi_st = _rolling_max(k_stoch, 240)
    upstoch = (k_stoch - lo_st) / np.maximum(hi_st - lo_st, 1e-10) - 0.5

    # 거래량 비율
    vol_sma = _sma(v, tf['vol_lb'])

    # Ultra Trend 방향
    ultra_dir_arr = np.zeros(n, dtype=int)
    for i in range(n):
        ss = int(bimaco_ss[i])
        ultra_dir_arr[i] = 1 if ss >= 5 else (-1 if ss <= -5 else 0)

    # AI 목표 (간이: ATR 기반 기대보상)
    ai_target_pct = atr14 * tf['target_mult'] * 2 / np.maximum(c, 1e-10) * 100
    sl_pct = atr14 * 1.5 / np.maximum(c, 1e-10) * 100

    # ── 봉별 스캔 ──
    signals = []
    regime_history = []
    sim_pos = None  # {'dir': 1/-1, 'entry': float, 'entry_idx': int, 'model': str}
    last_signal_idx = {1: -999, -1: -999}  # 쿨다운 추적

    for i in range(warmup, n):
        # 확정봉 기준: i-1 봉의 데이터로 판단, i 봉 시가에 진입
        ci = i - 1  # confirmed index
        if ci < 2: continue

        vol_r = float(v[ci] / vol_sma[ci]) if vol_sma[ci] > 0 else 1.0
        vol_r_prev = float(v[ci-1] / vol_sma[ci-1]) if ci > 0 and vol_sma[ci-1] > 0 else 1.0

        # 과열 상태
        heat_state = 0
        if rsi_smooth[ci] > 0.3 and mfi_smooth[ci] > 0.3: heat_state = 1
        elif rsi_smooth[ci] < -0.3 and mfi_smooth[ci] < -0.3: heat_state = -1

        # iMACD 방향
        imacd_dir = 1 if md[ci] > sig[ci] else (-1 if md[ci] < sig[ci] else 0)
        imacd_hist_accel = hist[ci] - hist[ci-1] if ci > 0 else 0

        # 강도 점수 (간이)
        str_s = _score_strength(uprsi[ci], upstoch[ci],
                                uprsi[ci-1], upstoch[ci-1], 1)

        # VWAP
        vwap_above = c[ci] > vwap[ci]
        vwap_slope = vwap_slopes[ci]

        # ── 레짐 분류 ──
        regime, regime_conf, regime_reason = classify_qregime(
            vwap_above, vwap_slope, ultra_dir_arr[ci], str_s,
            imacd_dir, imacd_hist_accel, heat_state, int(bimaco_ss[ci]))
        regime_history.append({'index': i, 'regime': regime, 'confidence': round(regime_conf, 2)})

        # 봉 상태 스냅샷
        bar_state = {
            'price': float(c[ci]), 'prev_price': float(c[ci-1]),
            'atr': float(atr14[ci]),
            'vwap_val': float(vwap[ci]), 'vwap_slope': float(vwap_slope),
            'bimaco_ss': int(bimaco_ss[ci]),
            'ultra_dir': int(ultra_dir_arr[ci]),
            'imacd_md': float(md[ci]), 'imacd_md_prev': float(md[ci-1]),
            'imacd_hist': float(hist[ci]), 'imacd_hist_prev': float(hist[ci-1]),
            'imacd_sig': float(sig[ci]),
            'scaled_rsi': float(rsi_smooth[ci]), 'scaled_mfi': float(mfi_smooth[ci]),
            'uprsi': float(uprsi[ci]), 'upstoch': float(upstoch[ci]),
            'uprsi_prev': float(uprsi[ci-1]), 'upstoch_prev': float(upstoch[ci-1]),
            'vol_ratio': vol_r, 'vol_ratio_prev': vol_r_prev,
            'bull_obs': bull_obs, 'bear_obs': bear_obs,
            'ai_target_pct': float(ai_target_pct[ci]),
            'sl_pct': float(sl_pct[ci]),
        }

        # ── 포지션 있으면 청산 판정 ──
        if sim_pos is not None:
            should_exit, exit_reason = check_exit(
                bar_state, sim_pos['dir'], sim_pos['entry'],
                i - sim_pos['entry_idx'], tf)
            if not should_exit:
                should_exit, exit_reason = check_invalidation(
                    bar_state, sim_pos['dir'], sim_pos['entry_idx'], i, tf)
            if should_exit:
                side = 'long' if sim_pos['dir'] == 1 else 'short'
                signals.append({
                    'index': i, 'type': 'q_exit',
                    'side': side, 'price': float(c[ci]),
                    'reason': exit_reason,
                    'pnl_pct': round((c[ci] - sim_pos['entry']) / sim_pos['entry'] * sim_pos['dir'] * 100, 2),
                })
                sim_pos = None
            continue  # 포지션 있으면 진입 스킵

        # ── 진입 판정 ──
        active = _active_models(regime)

        for direction in [1, -1]:
            # 쿨다운 체크
            if i - last_signal_idx[direction] < tf['cooldown']:
                continue

            scores = compute_total_score(regime, direction, bar_state, tf)
            total = scores['total']
            grade = classify_signal_grade(total, tf)

            if grade == 'REJECT':
                continue

            # 진입모델별 조건 검증
            model_name = None
            model_fails = []

            if 'trend_continuation' in active:
                fails = _check_trend_continuation(bar_state, direction, scores, tf)
                if not fails:
                    model_name = 'trend_continuation'
                else:
                    model_fails.extend(fails)

            if model_name is None and 'pullback_reentry' in active:
                fails = _check_pullback_reentry(bar_state, direction, scores, tf)
                if not fails:
                    model_name = 'pullback_reentry'
                else:
                    model_fails.extend(fails)

            if model_name is None and 'reversal' in active:
                fails = _check_reversal(bar_state, direction, scores, tf)
                if not fails:
                    model_name = 'reversal'
                else:
                    model_fails.extend(fails)

            if model_name is None:
                # WATCHLIST는 작은 점으로만 표시
                if grade == 'WATCHLIST' and not model_fails:
                    signals.append({
                        'index': i, 'type': 'q_watch',
                        'side': 'long' if direction == 1 else 'short',
                        'price': float(l[ci] if direction == 1 else h[ci]),
                        'score': total, 'grade': grade,
                    })
                continue

            # 거래밀집구간 + 거래량 동의 체크
            if scores['ob_position'] < 4 and scores['volume_confirm'] < 4:
                continue  # 둘 다 약하면 억제

            # 과열 극단 시 추세지속형 억제
            if heat_state != 0 and model_name == 'trend_continuation':
                if (direction == 1 and heat_state == 1) or (direction == -1 and heat_state == -1):
                    continue

            # ── 신호 생성 ──
            side = 'long' if direction == 1 else 'short'
            entry_price = float(c[ci])
            atr_v = float(atr14[ci])
            sl_price = entry_price - atr_v * 2.0 * direction
            tp1_price = entry_price + atr_v * 2.5 * direction * tf['target_mult']
            tp2_price = entry_price + atr_v * 4.0 * direction * tf['target_mult']
            invalidation = entry_price - atr_v * 3.0 * direction

            # 신호 라벨
            label_map = {
                'trend_continuation': f'Q {"LONG" if direction == 1 else "SHORT"}',
                'pullback_reentry': f'Q PULLBACK {"LONG" if direction == 1 else "SHORT"}',
                'reversal': 'Q REVERSAL',
            }

            # 1문장 이유
            reason_parts = []
            if regime in ('TREND_UP', 'TREND_DOWN'): reason_parts.append(f'레짐:{regime}')
            if scores['vwap_align'] >= 8: reason_parts.append('VWAP정렬')
            if scores['imacd_momentum'] >= 8: reason_parts.append('iMACD가속')
            if scores['bimaco_struct'] >= 8: reason_parts.append('범온확인')
            if scores['volume_confirm'] >= 8: reason_parts.append('거래량동의')
            if model_name == 'pullback_reentry': reason_parts.append('눌림목반등')
            if model_name == 'reversal': reason_parts.append('과열반전')
            reason_summary = ' + '.join(reason_parts[:4]) if reason_parts else regime

            signal = {
                'index': i,
                'type': f'q_{model_name}',
                'side': side,
                'label': label_map[model_name],
                'price': float(l[ci] if direction == 1 else h[ci]),
                'entry': entry_price,
                'sl': round(sl_price, 2),
                'tp1': round(tp1_price, 2),
                'tp2': round(tp2_price, 2),
                'invalidation': round(invalidation, 2),
                'score': total,
                'grade': grade,
                'confidence': total,
                'regime': regime,
                'model': model_name,
                'reason': reason_summary,
                'scores_detail': {k: v for k, v in scores.items() if k != 'total'},
            }
            signals.append(signal)

            # 시뮬레이션 포지션 등록
            sim_pos = {'dir': direction, 'entry': entry_price, 'entry_idx': i, 'model': model_name}
            last_signal_idx[direction] = i
            break  # 한 봉에 한 방향만

    # 디버그 정보
    debug = {
        'total_bars': n,
        'warmup': warmup,
        'scanned_bars': n - warmup,
        'total_signals': len([s for s in signals if s['type'].startswith('q_') and s['type'] != 'q_exit' and s['type'] != 'q_watch']),
        'total_exits': len([s for s in signals if s['type'] == 'q_exit']),
        'total_watchlist': len([s for s in signals if s['type'] == 'q_watch']),
        'timeframe': timeframe,
        'ver': ver,
        'tf_profile': tf,
    }

    return {'signals': signals, 'regime_history': regime_history, 'debug': debug}
