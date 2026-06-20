"""Regime Classifier — 장세 분류기.

시장을 6가지 레짐으로 분류:
  TREND_BULL, TREND_BEAR, RANGE, SHOCK_UP, SHOCK_DOWN, BLOCKED

판정 우선순위:
  1. 글로벌 차단 → BLOCKED
  2. 충격 감지 → SHOCK_UP / SHOCK_DOWN
  3. 추세 확인 → TREND_BULL / TREND_BEAR
  4. 나머지 → RANGE
"""


def classify_regime(snapshot, combo='5m/15m'):
    """장세 분류.

    snapshot: {
        'ultra_high_dir': 1/0/-1,
        'master_high_dir': 1/0/-1,
        'cluster_state': 'STRONG_BULL'/'WEAK_BULL'/'NEUTRAL'/'WEAK_BEAR'/'STRONG_BEAR',
        'overheat_state': -1/0/1,  # -1 과매도, 0 중립, 1 과열
        'volume_ratio': float,
        'trend_change_dir': -1/0/1,
        'bimaco_high_abs': float,
        'risk': {daily_loss_block, cooldown_block, duplicate_order_block, stale_data_block, funding_block},
    }

    Returns: {
        'regime': str,
        'reason': str,
        'confidence': float,  # 0~1
    }
    """
    risk = snapshot.get('risk', {})

    # ── 1. 글로벌 차단 ──
    if risk.get('stale_data_block') or risk.get('daily_loss_block') or \
       risk.get('cooldown_block') or risk.get('duplicate_order_block') or \
       risk.get('funding_block'):
        reasons = [k for k, v in risk.items() if v]
        return {'regime': 'BLOCKED', 'reason': ','.join(reasons), 'confidence': 1.0}

    ultra_dir = snapshot.get('ultra_high_dir', 0)
    master_dir = snapshot.get('master_high_dir', 0)
    cluster = snapshot.get('cluster_state', 'NEUTRAL')
    overheat = snapshot.get('overheat_state', 0)
    vol_ratio = snapshot.get('volume_ratio', 1.0)
    tc_dir = snapshot.get('trend_change_dir', 0)
    bimaco_abs = snapshot.get('bimaco_high_abs', 0)

    # 충격 볼륨 임계값 (조합별)
    shock_vol = {'1m/5m': 1.8, '5m/15m': 1.6, '15m/1h': 1.4}.get(combo, 1.6)

    # ── 2. 충격 감지 ──
    if overheat == 1 and vol_ratio >= shock_vol and tc_dir == 1:
        return {'regime': 'SHOCK_UP', 'reason': 'overheat+vol_spike+tc_up', 'confidence': 0.85}

    if overheat == -1 and vol_ratio >= shock_vol and tc_dir == -1:
        return {'regime': 'SHOCK_DOWN', 'reason': 'oversold+vol_spike+tc_down', 'confidence': 0.85}

    # ── 3. 추세 확인 ──
    bull_cluster = cluster in ('STRONG_BULL', 'WEAK_BULL')
    bear_cluster = cluster in ('STRONG_BEAR', 'WEAK_BEAR')

    # 상승 추세: ultra 상승 + master 상승 + 클러스터 상승
    if ultra_dir == 1 and master_dir == 1 and bull_cluster:
        conf = 0.9 if cluster == 'STRONG_BULL' else 0.7
        if bimaco_abs > 5:
            conf = min(conf + 0.1, 1.0)
        return {'regime': 'TREND_BULL', 'reason': 'ultra+master+cluster_bull', 'confidence': conf}

    # 하락 추세: ultra 하락 + master 하락 + 클러스터 하락
    if ultra_dir == -1 and master_dir == -1 and bear_cluster:
        conf = 0.9 if cluster == 'STRONG_BEAR' else 0.7
        if bimaco_abs > 5:
            conf = min(conf + 0.1, 1.0)
        return {'regime': 'TREND_BEAR', 'reason': 'ultra+master+cluster_bear', 'confidence': conf}

    # 부분 추세 (2/3 일치)
    bull_count = (ultra_dir == 1) + (master_dir == 1) + bull_cluster
    bear_count = (ultra_dir == -1) + (master_dir == -1) + bear_cluster

    if bull_count >= 2 and bear_count == 0:
        return {'regime': 'TREND_BULL', 'reason': 'partial_bull_consensus', 'confidence': 0.55}

    if bear_count >= 2 and bull_count == 0:
        return {'regime': 'TREND_BEAR', 'reason': 'partial_bear_consensus', 'confidence': 0.55}

    # ── 4. 나머지 → 횡보 ──
    return {'regime': 'RANGE', 'reason': 'no_clear_trend', 'confidence': 0.5}


def get_engine_for_regime(regime):
    """레짐에 따른 엔진 선택.

    Returns: ('engine1'|'engine2'|'none', 'trend'|'range'|'shock'|'blocked')
    """
    if regime in ('TREND_BULL', 'TREND_BEAR'):
        return 'engine1', 'trend'
    elif regime == 'RANGE':
        return 'engine2', 'range'
    elif regime in ('SHOCK_UP', 'SHOCK_DOWN'):
        return 'engine2', 'shock'
    else:
        return 'none', 'blocked'
