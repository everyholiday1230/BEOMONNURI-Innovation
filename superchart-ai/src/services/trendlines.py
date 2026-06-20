"""자동 추세선 — 다중 스케일, 터치 검증, 관통 최소화."""
import numpy as np


def compute_trendlines(candles: list[dict], swing_len: int = 5, max_lines: int = 8) -> list[dict]:
    n = len(candles)
    if n < 50:
        return []
    h = np.array([float(x.get("high") or x.get("h", 0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l", 0)) for x in candles])
    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])

    # ATR (14)
    tr = np.maximum(h[1:] - l[1:], np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    atr_arr = np.zeros(n)
    atr_arr[1] = np.mean(tr[:min(14, len(tr))])
    for i in range(2, n):
        atr_arr[i] = (atr_arr[i-1] * 13 + (tr[i-1] if i-1 < len(tr) else 0)) / 14
    atr = float(np.mean(atr_arr[-50:])) or 1.0
    tol = atr * 0.15  # 터치 허용 오차 (매우 타이트)

    # ═══ 피봇 감지 (프랙탈 기반, 다중 스케일) ═══
    def find_pivots(lookback):
        highs, lows = [], []
        for i in range(lookback, n - max(1, lookback // 2)):
            left = slice(max(0, i - lookback), i)
            right = slice(i + 1, min(n, i + lookback + 1))
            if h[i] >= np.max(h[left]) and h[i] >= np.max(h[right]):
                highs.append((i, float(h[i])))
            if l[i] <= np.min(l[left]) and l[i] <= np.min(l[right]):
                lows.append((i, float(l[i])))
        return highs, lows

    # 3개 스케일로 피봇 수집
    all_highs, all_lows = [], []
    for lb in [3, 7, 14]:
        ph, pl = find_pivots(lb)
        all_highs.extend(ph)
        all_lows.extend(pl)

    # 중복 제거 (같은 봉 인덱스)
    seen = set()
    highs = []
    for idx, price in sorted(all_highs, key=lambda x: x[0]):
        if idx not in seen:
            seen.add(idx)
            highs.append((idx, price))
    seen = set()
    lows = []
    for idx, price in sorted(all_lows, key=lambda x: x[0]):
        if idx not in seen:
            seen.add(idx)
            lows.append((idx, price))

    # ═══ 추세선 후보 생성 + 점수 평가 ═══
    def score_line(pivots, price_data, is_upper):
        """
        is_upper=True: 저항 추세선 (고점 연결, 위에서 눌러줌)
        is_upper=False: 지지 추세선 (저점 연결, 아래서 받쳐줌)
        """
        candidates = []
        pts = pivots
        if len(pts) < 2:
            return []

        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                idx1, p1 = pts[i]
                idx2, p2 = pts[j]
                span = idx2 - idx1
                if span < 5:
                    continue

                slope = (p2 - p1) / span

                # ── 터치 횟수 (피봇이 선 위에 있는지) ──
                touches = 0
                touch_indices = []
                for idx, pp in pts:
                    expected = p1 + slope * (idx - idx1)
                    diff = pp - expected
                    if abs(diff) < tol:
                        touches += 1
                        touch_indices.append(idx)

                if touches < 3:
                    continue

                # ── 관통 체크 (p1~p2 구간만, 연장 구간은 무시) ──
                violations = 0
                for k in range(idx1, idx2 + 1):
                    expected = p1 + slope * (k - idx1)
                    if is_upper:
                        if h[k] > expected + tol * 3:
                            violations += 1
                    else:
                        if l[k] < expected - tol * 3:
                            violations += 1

                check_len = idx2 - idx1 + 1
                viol_ratio = violations / max(check_len, 1)
                if viol_ratio > 0.08:  # 8% 이상 관통 → 무효
                    continue

                # ── 점수 ──
                recency = max(touch_indices) / n  # 최근 터치일수록 높음
                length = span / n  # 긴 추세선일수록 높음
                score = (touches ** 1.5) * 3 + recency * 5 + length * 3 - violations * 2

                # 현재 가격과의 거리 (가까울수록 유효)
                cur_expected = p1 + slope * (n - 1 - idx1)
                dist_pct = abs(cur_expected - c[-1]) / c[-1]
                if dist_pct > 0.15:  # 현재가에서 15% 이상 떨어진 선 제외
                    continue
                # 가까울수록 보너스
                score += max(0, (0.05 - dist_pct) * 50)

                candidates.append({
                    "idx1": idx1, "p1": p1, "idx2": idx2, "p2": p2,
                    "slope": slope, "touches": touches, "score": score,
                    "span": span, "violations": violations
                })

        # 점수순 정렬
        candidates.sort(key=lambda x: -x["score"])

        # 중복 제거 (비슷한 기울기+위치의 선 제거)
        result = []
        for cand in candidates:
            is_dup = False
            for existing in result:
                # 기울기 유사 + 시작점 유사 → 중복
                slope_diff = abs(cand["slope"] - existing["slope"])
                price_diff = abs(cand["p1"] - existing["p1"])
                if slope_diff < atr * 0.02 and price_diff < atr * 1.0:
                    is_dup = True
                    break
            if not is_dup:
                result.append(cand)
            if len(result) >= 3:
                break
        return result

    # ═══ 저항 추세선 (고점 연결) ═══
    res_lines = score_line(highs, h, True)

    # ═══ 지지 추세선 (저점 연결) ═══
    sup_lines = score_line(lows, l, False)

    # ═══ 출력 ═══
    lines = []
    for tr in sup_lines:
        lines.append({
            "type": "support", "color": "#00bcd4", "lineWidth": 2,
            "points": [
                {"index": tr["idx1"], "price": tr["p1"]},
                {"index": tr["idx2"], "price": tr["p2"]},
            ],
            "touches": tr["touches"],
            "label": f"지지 {tr['touches']}T",
        })

    for tr in res_lines:
        lines.append({
            "type": "resistance", "color": "#ff9800", "lineWidth": 2,
            "points": [
                {"index": tr["idx1"], "price": tr["p1"]},
                {"index": tr["idx2"], "price": tr["p2"]},
            ],
            "touches": tr["touches"],
            "label": f"저항 {tr['touches']}T",
        })

    return lines
