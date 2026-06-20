"""Symmetric Market-State Ladder v1.1 — Engine 1 + Engine 2 메인 전략.

기존 strategy_ultimate.py의 점수 함수를 재활용하면서
VWAP+122 MA 클러스터, Trade Pressure, Capital Flow, Regime Classifier를 추가.

Engine 1: 추세 지속 (실주문)
Engine 2: 횡보 반전 / 충격 재테스트 (shadow-only)
"""
from src.services.strategy_ultimate import (
    score_structure, score_bimaco, score_trend, score_heat,
    score_strength, score_volume, score_imacd, score_ai_target,
)
from src.services.regime_classifier import classify_regime, get_engine_for_regime


# ═══════════════════════════════════════════
# 추가 점수 함수 (클러스터, VWAP, 압력, 자금)
# ═══════════════════════════════════════════

def score_cluster(cluster_state, direction):
    """122 MA 클러스터 점수 (16점 만점)."""
    bull = cluster_state in ('STRONG_BULL', 'WEAK_BULL')
    bear = cluster_state in ('STRONG_BEAR', 'WEAK_BEAR')
    if direction == 1:
        if cluster_state == 'STRONG_BULL': return 16
        if cluster_state == 'WEAK_BULL': return 10
        if cluster_state == 'NEUTRAL': return 4
        if cluster_state == 'WEAK_BEAR': return 1
        return 0
    else:
        if cluster_state == 'STRONG_BEAR': return 16
        if cluster_state == 'WEAK_BEAR': return 10
        if cluster_state == 'NEUTRAL': return 4
        if cluster_state == 'WEAK_BULL': return 1
        return 0


def score_vwap(vwap_state, direction):
    """VWAP 위치 점수 (8점 만점)."""
    if direction == 1:
        if vwap_state == 'RECLAIM_UP': return 8
        if vwap_state == 'ABOVE': return 6
        if vwap_state == 'NEUTRAL': return 3
        if vwap_state == 'REJECT_DOWN': return 0
        return 1
    else:
        if vwap_state == 'REJECT_DOWN': return 8
        if vwap_state == 'BELOW': return 6
        if vwap_state == 'NEUTRAL': return 3
        if vwap_state == 'RECLAIM_UP': return 0
        return 1


def score_pressure(pressure_dir, direction):
    """Trade Pressure 점수 (8점 만점)."""
    if pressure_dir == direction: return 8
    if pressure_dir == 0: return 4
    return 0


def score_capital_flow(flow_dir, direction):
    """Capital Flow 점수 (8점 만점)."""
    if flow_dir == direction: return 8
    if flow_dir == 0: return 4
    return 0


# ═══════════════════════════════════════════
# 120점 만점 종합 판정
# ═══════════════════════════════════════════

def evaluate_ladder(scores, mode='trend'):
    """120점 만점 종합 판정.

    mode: 'trend' (Engine 1), 'range' (Engine 2 횡보), 'shock' (Engine 2 충격)
    """
    total = sum(scores.values())

    # 필수 게이트 (점수와 무관하게 통과 필수)
    gates = []
    if scores.get('cluster', 0) <= 1:
        gates.append('cluster_oppose')
    if scores.get('vwap', 0) <= 1:
        gates.append('vwap_oppose')
    if scores.get('structure', 0) < 10:
        gates.append('structure_weak')
    if scores.get('heat', 0) <= 2:
        gates.append('overheat')
    if scores.get('ai_target', 0) < 5:
        gates.append('poor_rr')
    if scores.get('imacd', 0) < 4:
        gates.append('no_trigger')

    gates_pass = len(gates) == 0

    # 합격 기준 (모드별)
    thresholds = {'trend': 84, 'range': 88, 'shock': 92}
    threshold = thresholds.get(mode, 84)

    if total >= threshold + 10:
        grade = 'A'
    elif total >= threshold:
        grade = 'B'
    elif total >= threshold - 6:
        grade = 'C'
    else:
        grade = 'F'

    return total, grade, gates_pass, gates, threshold


# ═══════════════════════════════════════════
# 스냅샷 → 양방향 점수 계산
# ═══════════════════════════════════════════

def compute_scores(state, direction):
    """한 방향의 전체 점수 계산. 120점 만점."""
    return {
        'structure': score_structure(
            state['price'], state['atr'],
            state.get('trendlines'), state.get('obs'), direction),
        'bimaco': score_bimaco(state.get('bimaco_ss', 0), direction),
        'trend': score_trend(
            state.get('ultra_dir', 0), state.get('alignment', 'neutral'),
            state.get('stn', 0), state.get('stn_prev', 0), direction),
        'heat': score_heat(state.get('scaled_rsi', 0), state.get('scaled_mfi', 0), direction),
        'strength': score_strength(
            state.get('uprsi', 0), state.get('upstoch', 0),
            state.get('uprsi_prev', 0), state.get('upstoch_prev', 0), direction),
        'volume': score_volume(state.get('volume_ratio', 1), state.get('is_breakout', False), direction),
        'imacd': score_imacd(
            state.get('imacd_md', 0), state.get('imacd_md_prev', 0),
            state.get('imacd_hist', 0), state.get('imacd_hist_prev', 0),
            state.get('imacd_sig', 0), direction),
        'ai_target': score_ai_target(state.get('ai_target_pct', 0), state.get('sl_pct', 0)),
        # 새 지표
        'cluster': score_cluster(state.get('cluster_state', 'NEUTRAL'), direction),
        'vwap': score_vwap(state.get('vwap_state', 'NEUTRAL'), direction),
        'pressure': score_pressure(state.get('pressure_dir', 0), direction),
        'capital_flow': score_capital_flow(state.get('capital_flow_dir', 0), direction),
    }


# ═══════════════════════════════════════════
# Engine 1 — 추세 지속
# ═══════════════════════════════════════════

def engine1_decide(state, regime):
    """Engine 1 진입 판정. 실주문 허용."""
    expected_dir = 1 if regime == 'TREND_BULL' else -1

    scores = compute_scores(state, expected_dir)
    total, grade, gates_pass, gates, threshold = evaluate_ladder(scores, 'trend')

    side = 'long' if expected_dir == 1 else 'short'
    result = {
        'engine': 'engine1', 'mode': 'trend', 'side': side,
        'scores': scores, 'total': total, 'grade': grade,
        'gates_pass': gates_pass, 'gates': gates, 'threshold': threshold,
    }

    # 추가 금지 조건
    if state.get('pressure_dir', 0) == -expected_dir and state.get('capital_flow_dir', 0) == -expected_dir:
        return {**result, 'action': 'none', 'reason': 'HOLD_PRESSURE_FLOW_CONFLICT'}

    if state.get('cluster_state') == 'NEUTRAL' and state.get('bimaco_high_abs', 0) < 8:
        return {**result, 'action': 'none', 'reason': 'HOLD_CLUSTER_WEAK'}

    if not gates_pass:
        return {**result, 'action': 'none', 'reason': f'GATE_FAIL:{",".join(gates)}'}

    if grade in ('A', 'B'):
        ep = 1.0 if grade == 'A' else 0.7
        return {**result, 'action': 'enter', 'ep': ep,
                'sl': 0.8, 'tp1_r': 2.0, 'tp2_r': 3.5}
    elif grade == 'C' and total >= threshold - 4:
        return {**result, 'action': 'enter', 'ep': 0.3,
                'sl': 0.7, 'tp1_r': 1.8, 'tp2_r': 3.0}

    return {**result, 'action': 'none', 'reason': f'SCORE_LOW:{total}/{threshold}'}


# ═══════════════════════════════════════════
# Engine 2 — 횡보 반전 / 충격 재테스트 (shadow-only)
# ═══════════════════════════════════════════

def engine2_range_decide(state):
    """Engine 2 횡보 반전. Shadow-only."""
    results = {}
    for dr, side in [(1, 'long'), (-1, 'short')]:
        scores = compute_scores(state, dr)
        total, grade, gates_pass, gates, threshold = evaluate_ladder(scores, 'range')
        results[side] = {
            'scores': scores, 'total': total, 'grade': grade,
            'gates_pass': gates_pass, 'gates': gates, 'threshold': threshold,
        }

    # 더 높은 쪽 선택
    if results['long']['total'] > results['short']['total']:
        winner, side, dr = results['long'], 'long', 1
    else:
        winner, side, dr = results['short'], 'short', -1

    result = {
        'engine': 'engine2', 'mode': 'range', 'side': side,
        'shadow': True, **winner,
    }

    # 횡보 추가 조건: 박스 끝단이어야 함
    near_edge = (dr == 1 and (state.get('near_support') or state.get('near_bull_zone'))) or \
                (dr == -1 and (state.get('near_resistance') or state.get('near_bear_zone')))
    if not near_edge:
        return {**result, 'action': 'none', 'reason': 'HOLD_NO_RANGE_EDGE'}

    if not winner['gates_pass']:
        return {**result, 'action': 'none', 'reason': f'GATE_FAIL:{",".join(winner["gates"])}'}

    if winner['grade'] in ('A', 'B'):
        return {**result, 'action': 'shadow_enter'}

    return {**result, 'action': 'none', 'reason': f'SCORE_LOW:{winner["total"]}/{winner["threshold"]}'}


def engine2_shock_decide(state, regime):
    """Engine 2 충격 재테스트. Shadow-only."""
    # 급락 후 롱 재테스트 / 급등 후 숏 재테스트
    dr = 1 if regime == 'SHOCK_DOWN' else -1
    side = 'long' if dr == 1 else 'short'

    scores = compute_scores(state, dr)
    total, grade, gates_pass, gates, threshold = evaluate_ladder(scores, 'shock')

    result = {
        'engine': 'engine2', 'mode': 'shock', 'side': side,
        'shadow': True, 'scores': scores, 'total': total, 'grade': grade,
        'gates_pass': gates_pass, 'gates': gates, 'threshold': threshold,
    }

    # 첫 충격 추격 금지
    if state.get('is_first_shock_bar'):
        return {**result, 'action': 'none', 'reason': 'HOLD_FIRST_SHOCK'}

    # VWAP 재장악/재이탈 필수
    vwap = state.get('vwap_state', 'NEUTRAL')
    if dr == 1 and vwap != 'RECLAIM_UP':
        return {**result, 'action': 'none', 'reason': 'HOLD_VWAP_NOT_RECLAIMED'}
    if dr == -1 and vwap != 'REJECT_DOWN':
        return {**result, 'action': 'none', 'reason': 'HOLD_VWAP_NOT_REJECTED'}

    # Pressure/Flow 회복 필수
    p_dir = state.get('pressure_dir', 0)
    f_dir = state.get('capital_flow_dir', 0)
    if dr == 1 and (p_dir < 0 or f_dir < 0):
        return {**result, 'action': 'none', 'reason': 'HOLD_FORCE_NOT_RECOVERED'}
    if dr == -1 and (p_dir > 0 or f_dir > 0):
        return {**result, 'action': 'none', 'reason': 'HOLD_FORCE_NOT_WEAKENED'}

    if not gates_pass:
        return {**result, 'action': 'none', 'reason': f'GATE_FAIL:{",".join(gates)}'}

    if grade in ('A', 'B'):
        return {**result, 'action': 'shadow_enter'}

    return {**result, 'action': 'none', 'reason': f'SCORE_LOW:{total}/{threshold}'}


# ═══════════════════════════════════════════
# 청산 판정 (Engine 1 포지션)
# ═══════════════════════════════════════════

def manage_exit(state, position):
    """포지션 청산 판정. Engine 1 실포지션용."""
    sd = 1 if position['side'] == 'long' else -1
    price = state['price']
    entry = position['entry']
    atr = state['atr']
    pnl = (price - entry) / entry * sd

    # 1. 구조 이탈 손절
    struct_score = score_structure(price, atr, state.get('trendlines'), state.get('obs'), sd)
    entry_struct = position.get('entry_structure', 12)
    if struct_score < 6 and struct_score < entry_struct - 6:
        return {'action': 'close', 'reason': 'struct_break'}

    # 2. 범온 반전
    bm = state.get('bimaco_ss', 0)
    if sd == 1 and bm <= -8:
        return {'action': 'close', 'reason': 'bimaco_reverse'}
    if sd == -1 and bm >= 8:
        return {'action': 'close', 'reason': 'bimaco_reverse'}

    # 3. VWAP 실패 + iMACD 반전
    vwap = state.get('vwap_state', 'NEUTRAL')
    if sd == 1 and vwap == 'REJECT_DOWN' and state.get('imacd_cross_down'):
        return {'action': 'close', 'reason': 'vwap_fail'}
    if sd == -1 and vwap == 'RECLAIM_UP' and state.get('imacd_cross_up'):
        return {'action': 'close', 'reason': 'vwap_fail'}

    # 4. 과열 도달 → 수익 중이면 부분 청산
    heat = score_heat(state.get('scaled_rsi', 0), state.get('scaled_mfi', 0), sd)
    if pnl > 0.005 and heat <= 3:
        return {'action': 'partial_close', 'ratio': 0.40, 'reason': 'heat_tp1'}

    # 5. 강도 둔화 → 수익 중이면 부분 청산
    strength = score_strength(state.get('uprsi', 0), state.get('upstoch', 0),
                              state.get('uprsi_prev', 0), state.get('upstoch_prev', 0), sd)
    if pnl > 0.003 and strength <= 2:
        return {'action': 'partial_close', 'ratio': 0.30, 'reason': 'strength_fade'}

    # 6. iMACD 반전 크로스
    md = state.get('imacd_md', 0)
    md_prev = state.get('imacd_md_prev', 0)
    sig = state.get('imacd_sig', 0)
    if sd == 1 and md < sig and md_prev >= sig:
        if pnl > 0: return {'action': 'close', 'reason': 'imacd_cross'}
        if pnl < -0.005: return {'action': 'close', 'reason': 'imacd_sl'}
    if sd == -1 and md > sig and md_prev <= sig:
        if pnl > 0: return {'action': 'close', 'reason': 'imacd_cross'}
        if pnl < -0.005: return {'action': 'close', 'reason': 'imacd_sl'}

    # 7. 추세 전환
    if state.get('ultra_dir', 0) == -sd:
        trend_score = score_trend(state.get('ultra_dir', 0), state.get('alignment', 'neutral'),
                                  state.get('stn', 0), state.get('stn_prev', 0), sd)
        if trend_score <= 3:
            return {'action': 'close', 'reason': 'trend_reverse'}

    # 8. Pressure + Flow 동시 역행
    if state.get('pressure_dir', 0) == -sd and state.get('capital_flow_dir', 0) == -sd:
        if pnl > 0: return {'action': 'close', 'reason': 'force_reverse'}
        if pnl < -0.003: return {'action': 'close', 'reason': 'force_sl'}

    # 9. 비상 손절 (ATR 기반)
    max_sl = position.get('sl', 0.8)
    if sd == 1 and price < entry - atr * max_sl:
        return {'action': 'close', 'reason': 'emergency_sl'}
    if sd == -1 and price > entry + atr * max_sl:
        return {'action': 'close', 'reason': 'emergency_sl'}

    # 10. 모멘텀 소진 (수익 중 + IMACD 약화 + 강도 약화)
    if pnl > 0.01:
        imacd_weak = (sd == 1 and state.get('imacd_hist', 0) < state.get('imacd_hist_prev', 0)) or \
                     (sd == -1 and state.get('imacd_hist', 0) > state.get('imacd_hist_prev', 0))
        if imacd_weak and strength <= 3:
            return {'action': 'close', 'reason': 'momentum_fade'}

    return {'action': 'hold'}


# ═══════════════════════════════════════════
# 메인 결정 함수
# ═══════════════════════════════════════════

def decide_ladder(state, position=None, combo='5m/15m'):
    """Symmetric Market-State Ladder v1.1 메인 결정.

    state: strategy_ultimate.py의 state + 추가 필드:
        cluster_state, vwap_state, pressure_dir, capital_flow_dir,
        ultra_high_dir, master_high_dir, bimaco_high_abs,
        overheat_state, volume_ratio, trend_change_dir,
        near_support, near_resistance, near_bull_zone, near_bear_zone,
        is_first_shock_bar, imacd_cross_up, imacd_cross_down,
        risk: {daily_loss_block, cooldown_block, ...}

    position: None or {side, entry, sl, entry_structure, ...}
    combo: '1m/5m' | '5m/15m' | '15m/1h'
    """
    # 글로벌 차단
    risk = state.get('risk', {})
    if risk.get('stale_data_block') or risk.get('daily_loss_block') or \
       risk.get('cooldown_block') or risk.get('duplicate_order_block'):
        return {'action': 'block', 'reason': 'GLOBAL_BLOCK', 'engine': 'none'}

    # 레짐 분류
    regime_result = classify_regime({
        'ultra_high_dir': state.get('ultra_high_dir', state.get('ultra_dir', 0)),
        'master_high_dir': state.get('master_high_dir', 0),
        'cluster_state': state.get('cluster_state', 'NEUTRAL'),
        'overheat_state': state.get('overheat_state', 0),
        'volume_ratio': state.get('volume_ratio', 1.0),
        'trend_change_dir': state.get('trend_change_dir', 0),
        'bimaco_high_abs': state.get('bimaco_high_abs', 0),
        'risk': risk,
    }, combo)

    regime = regime_result['regime']
    engine, mode = get_engine_for_regime(regime)

    # 포지션 있으면 청산 판정 우선
    if position is not None:
        exit_result = manage_exit(state, position)
        exit_result['regime'] = regime
        exit_result['regime_confidence'] = regime_result['confidence']
        return exit_result

    # 엔진별 진입 판정
    if engine == 'engine1':
        result = engine1_decide(state, regime)
    elif engine == 'engine2' and mode == 'range':
        result = engine2_range_decide(state)
    elif engine == 'engine2' and mode == 'shock':
        result = engine2_shock_decide(state, regime)
    else:
        result = {'action': 'none', 'engine': 'none', 'reason': 'BLOCKED'}

    result['regime'] = regime
    result['regime_confidence'] = regime_result['confidence']
    return result
