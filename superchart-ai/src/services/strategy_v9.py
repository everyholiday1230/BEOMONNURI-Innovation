"""전략 v9 — 역할 기반 룰 전략 v9.2 (근본 개선판).

[v9.2 핵심 변경]
① uprsi_stc 내부 signals 활용: 이미 검증된 복합 조건 신호(buy/sell) 활용
   → 5개 지표 동시 충족 신호만 진입 (uprsi>0.1, upstoch>0.1, rsi>0, mfi>0, stc red/maroon)
② 범온 방향 필터: ultra_trend signals에서 마지막 방향(buy/sell) 확인 후 동방향만 진입
③ PVI/NVI 확인 (pn > pna 동방향 유지)
④ 쿨다운 10봉: 손절/청산 후 과다재진입 방지 (기존 5봉 → 10봉)
⑤ 손절 -1.0% (가격 기준, 레버 12x = -12%): 타이트한 리스크 관리
⑥ switch 완전 제거: 이중 수수료 원천 차단
⑦ 최소 보유 3봉 후 TP 허용 (시그널 기반이라 빠른 청산도 OK)
⑧ TP1: uprsi_stc 반대 신호 or 지표 약화 + 수익 +0.3% 이상
⑨ STC 크로스 청산 (기존 유지)
⑩ 범온 반전(ss 반대) 시 즉시 청산
"""
import numpy as np
from dataclasses import dataclass


@dataclass
class V9Position:
    side: str = ""
    entry_price: float = 0
    qty: float = 0
    tp_stage: int = 0
    entry_idx: int = 0
    last_exit_idx: int = -99   # 마지막 청산 봉 인덱스 (쿨다운용)


# ─────────────────────────────────────────
COOLDOWN_BARS   = 8     # 청산 후 재진입 금지 봉 수 (5→10)
MIN_HOLD_BARS   = 3      # 최소 보유 봉 수 (TP 허용 최소)
SS_THRESHOLD    = 3      # 범온 신호합 임계값 (진입 필터)
SS_EXIT         = 3      # 범온 청산 임계값 (반전 시 즉시 청산)
STOP_LOSS_PCT   = 0.010  # 고정 손절 비율 1% (레버 12x = 12% 실손)
TP1_MIN_PNL     = 0.005  # TP1 최소 수익 0.3% (레버 12x = 3.6%)
LEV             = 12     # 레버리지
# ─────────────────────────────────────────


def _get_last_direction(ultra_signals: list, current_idx: int) -> int:
    """ultra_trend signals에서 현재 봉 이전 마지막 방향 반환 (1=bull, -1=bear, 0=unknown)."""
    direction = 0
    for s in ultra_signals:
        if s.get("index", 0) <= current_idx:
            t = s.get("type", "")
            if t in ("buy", "kalman_up"):
                direction = 1
            elif t in ("sell", "kalman_down"):
                direction = -1
    return direction


def decide_v9(candles, uprsi_stc, pasr_pvi, ultra, pos: V9Position, idx: int) -> str:
    """매 봉마다 호출.
    반환: 'wait'|'long'|'short'|'tp_25'|'tp_50'|'close'|'stop_loss'
    ※ 'switch' 완전 제거
    """
    n = len(candles)
    if n < 300 or idx < 10:
        return "wait"

    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])
    price = c[idx]

    # ── 지표 배열 추출 ──────────────────────────────
    bars = ultra.get("bars", [])
    ss = bars[idx]["signal_sum"] if idx < len(bars) else 0

    uprsi_arr   = [x["value"] for x in uprsi_stc.get("uprsi",      [])]
    upstoch_arr = [x["value"] for x in uprsi_stc.get("upstoch",    [])]
    s1_arr      = [x["value"] for x in uprsi_stc.get("stc1",       [])]
    s2_arr      = [x["value"] for x in uprsi_stc.get("stc2",       [])]
    pn_arr      = [x["value"] for x in pasr_pvi.get("pn",          [])]
    pna_arr     = [x["value"] for x in pasr_pvi.get("pna",         [])]

    if idx >= len(uprsi_arr) or idx >= len(pn_arr) or idx >= len(s1_arr):
        return "wait"

    uprsi        = uprsi_arr[idx]
    upstoch      = upstoch_arr[idx]
    upstoch_prev = upstoch_arr[idx - 1] if idx > 0 else 0
    s1 = s1_arr[idx]; s2 = s2_arr[idx]
    s1_prev = s1_arr[idx - 1] if idx > 0 else 0
    s2_prev = s2_arr[idx - 1] if idx > 0 else 0
    pn = pn_arr[idx]; pna = pna_arr[idx]

    # uprsi_stc 내부 신호: buy/sell 여부 확인
    u_signals = uprsi_stc.get("signals", [])
    # 최근 3봉 이내 buy 신호가 있는지
    recent_u_buy  = any(s.get("type") == "buy"  and s.get("index", 0) >= idx - 3 for s in u_signals)
    recent_u_sell = any(s.get("type") == "sell" and s.get("index", 0) >= idx - 3 for s in u_signals)

    # ultra_trend 방향
    ultra_signals = ultra.get("signals", [])
    ut_direction = _get_last_direction(ultra_signals, idx)

    # pasr_pvi 신호: 최근 5봉 이내 buy/sell
    p_signals = pasr_pvi.get("signals", [])
    recent_p_buy  = any(s.get("type") == "buy"  and s.get("index", 0) >= idx - 5 for s in p_signals)
    recent_p_sell = any(s.get("type") == "sell" and s.get("index", 0) >= idx - 5 for s in p_signals)

    # ═══════════════════════════════════════
    # 포지션 없음 — 진입 판단
    # ═══════════════════════════════════════
    if not pos.side:
        # 쿨다운: 직전 청산 후 COOLDOWN_BARS 봉 이내 재진입 금지
        if (idx - pos.last_exit_idx) < COOLDOWN_BARS:
            return "wait"

        # 범온 ss 필터 (진입 강도 확인)
        ss_ok_bull = ss >= SS_THRESHOLD
        ss_ok_bear = ss <= -SS_THRESHOLD

        # uprsi_stc 자체 buy 신호 + 추가 조건
        # 조건1: uprsi_stc 내부 buy 신호 있음 (5개 지표 동시 충족)
        # 조건2: 범온 ss >= 5 (강한 방향성)
        # 조건3: ultra_trend 방향 = 매수
        # 조건4: pn > pna (PVI/NVI 매수 방향)
        if (recent_u_buy
                and ss_ok_bull
                and (ut_direction == 1 or ss >= 7)  # 방향 확인, 매우 강한 신호는 방향 무관
                and pn > pna):
            return "long"

        if (recent_u_sell
                and ss_ok_bear
                and (ut_direction == -1 or ss <= -7)
                and pn < pna):
            return "short"

        # 보조 진입: uprsi_stc 신호 없어도 pasr_pvi + 범온 매우 강한 경우
        # (ss >= 8 이상 + pasr_pvi 신호 + uprsi/stoch 방향 일치)
        if (ss >= 8
                and recent_p_buy
                and uprsi > 0.1 and upstoch > 0
                and pn > pna
                and ut_direction == 1):
            return "long"

        if (ss <= -8
                and recent_p_sell
                and uprsi < -0.1 and upstoch < 0
                and pn < pna
                and ut_direction == -1):
            return "short"

        return "wait"

    # ═══════════════════════════════════════
    # 포지션 있음 — 관리
    # ═══════════════════════════════════════
    side  = 1 if pos.side == "long" else -1
    raw_loss = (price - pos.entry_price) / pos.entry_price * side
    held  = idx - pos.entry_idx

    # ── 손절 ────────────────────────────────
    # 고정 손절: -STOP_LOSS_PCT (가격 기준 1%)
    if raw_loss <= -STOP_LOSS_PCT:
        return "stop_loss"

    # 지표 반전 손절: uprsi + upstoch 둘 다 반대 + 미수익
    uprsi_opp   = (side == 1 and uprsi < -0.05)   or (side == -1 and uprsi > 0.05)
    upstoch_opp = (side == 1 and upstoch < -0.05) or (side == -1 and upstoch > 0.05)
    if raw_loss < 0 and uprsi_opp and upstoch_opp:
        return "stop_loss"

    # ── 범온 강한 반전 → 즉시 청산 ─────────
    if side == 1 and ss <= -SS_EXIT:
        return "close"
    if side == -1 and ss >= SS_EXIT:
        return "close"

    # ── STC1/STC2 크로스 청산 ───────────────
    stc_exit = (
        (side == 1 and s1 < s2 and s1_prev >= s2_prev) or
        (side == -1 and s1 > s2 and s1_prev <= s2_prev)
    )
    if stc_exit and held >= 2:  # 최소 2봉 보유 후 STC 청산
        return "close"

    # ── uprsi_stc 반대 신호 → 청산 ──────────
    if side == 1 and recent_u_sell:
        return "close"
    if side == -1 and recent_u_buy:
        return "close"

    # ── TP1: 지표 약화 + 최소 수익 ──────────
    if pos.tp_stage == 0 and held >= MIN_HOLD_BARS and pos.qty > 0.3:
        raw_profit = raw_loss  # 이미 부호 반영됨
        # uprsi 또는 upstoch가 꺾이기 시작할 때 + 수익 보호
        stoch_weakening = (
            (side == 1 and upstoch < upstoch_prev and upstoch > 0) or
            (side == -1 and upstoch > upstoch_prev and upstoch < 0)
        )
        if stoch_weakening and raw_profit >= TP1_MIN_PNL:
            return "tp_25"

    # ── TP2: Stoch 반대 돌파 ────────────────
    if pos.tp_stage >= 1 and pos.qty > 0.3:
        tp2 = (
            (side == 1 and upstoch < 0 and upstoch_prev >= 0) or
            (side == -1 and upstoch > 0 and upstoch_prev <= 0)
        )
        if tp2:
            return "tp_50"

    return "hold"
