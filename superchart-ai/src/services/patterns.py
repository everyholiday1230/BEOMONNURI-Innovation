"""캔들 패턴 + 차트 패턴 자동 인식."""
import numpy as np


def detect_patterns(candles: list[dict]) -> list[dict]:
    if len(candles) < 50:
        return []
    o = np.array([float(x.get("open") or x.get("o", 0)) for x in candles])
    h = np.array([float(x.get("high") or x.get("h", 0)) for x in candles])
    l = np.array([float(x.get("low") or x.get("l", 0)) for x in candles])
    c = np.array([float(x.get("close") or x.get("c", 0)) for x in candles])
    n = len(candles)
    avg_range = np.mean(h - l)
    signals = []

    def _body(i):
        return abs(c[i] - o[i])

    def _upper_wick(i):
        return h[i] - max(o[i], c[i])

    def _lower_wick(i):
        return min(o[i], c[i]) - l[i]

    def _is_bull(i):
        return c[i] > o[i]

    def _is_bear(i):
        return c[i] < o[i]

    def _range(i):
        return h[i] - l[i] if h[i] > l[i] else 0.001

    # ═══ 캔들 패턴 (최근 100봉만 스캔) ═══
    start = max(3, n - 100)
    for i in range(start, n):
        body = _body(i)
        rng = _range(i)
        uw = _upper_wick(i)
        lw = _lower_wick(i)

        # 도지 (Doji) — 몸통이 레인지의 10% 이하, 의미 있는 크기
        if avg_range > 0 and body < rng * 0.1 and rng > avg_range * 0.5:
            signals.append({"index": i, "price": float(h[i]), "pattern": "도지", "type": "neutral", "side": "top"})
            continue

        # 해머 (Hammer) — 하락 추세 후, 긴 아래꼬리
        if lw > body * 2 and uw < body * 0.5 and i >= 3:
            if c[i-1] < c[i-3]:  # 이전 하락 추세
                signals.append({"index": i, "price": float(l[i]), "pattern": "해머", "type": "bullish", "side": "bottom"})
                continue

        # 슈팅스타 (Shooting Star) — 상승 추세 후, 긴 위꼬리
        if uw > body * 2 and lw < body * 0.5 and i >= 3:
            if c[i-1] > c[i-3]:  # 이전 상승 추세
                signals.append({"index": i, "price": float(h[i]), "pattern": "슈팅스타", "type": "bearish", "side": "top"})
                continue

        # 상승 잉글핑 (Bullish Engulfing)
        if i >= 1 and _is_bull(i) and _is_bear(i-1):
            if o[i] <= c[i-1] and c[i] >= o[i-1] and body > _body(i-1) * 1.2:
                signals.append({"index": i, "price": float(l[i]), "pattern": "상승잉글핑", "type": "bullish", "side": "bottom"})
                continue

        # 하락 잉글핑 (Bearish Engulfing)
        if i >= 1 and _is_bear(i) and _is_bull(i-1):
            if o[i] >= c[i-1] and c[i] <= o[i-1] and body > _body(i-1) * 1.2:
                signals.append({"index": i, "price": float(h[i]), "pattern": "하락잉글핑", "type": "bearish", "side": "top"})
                continue

        # 쓰리 화이트 솔져 (Three White Soldiers)
        if i >= 2 and _is_bull(i) and _is_bull(i-1) and _is_bull(i-2):
            if c[i] > c[i-1] > c[i-2] and o[i] > o[i-1] > o[i-2]:
                if _body(i) > avg_range * 0.3 and _body(i-1) > avg_range * 0.3:
                    signals.append({"index": i, "price": float(l[i-2]), "pattern": "쓰리솔져", "type": "bullish", "side": "bottom"})
                    continue

        # 쓰리 블랙 크로우 (Three Black Crows)
        if i >= 2 and _is_bear(i) and _is_bear(i-1) and _is_bear(i-2):
            if c[i] < c[i-1] < c[i-2] and o[i] < o[i-1] < o[i-2]:
                if _body(i) > avg_range * 0.3 and _body(i-1) > avg_range * 0.3:
                    signals.append({"index": i, "price": float(h[i-2]), "pattern": "쓰리크로우", "type": "bearish", "side": "top"})
                    continue

        # 모닝스타 (Morning Star) — 하락+작은몸통+상승
        if i >= 2 and _is_bear(i-2) and _is_bull(i):
            if _body(i-1) < avg_range * 0.2 and _body(i-2) > avg_range * 0.4 and _body(i) > avg_range * 0.4:
                if c[i] > (o[i-2] + c[i-2]) / 2:
                    signals.append({"index": i-1, "price": float(l[i-1]), "pattern": "모닝스타", "type": "bullish", "side": "bottom"})
                    continue

        # 이브닝스타 (Evening Star) — 상승+작은몸통+하락
        if i >= 2 and _is_bull(i-2) and _is_bear(i):
            if _body(i-1) < avg_range * 0.2 and _body(i-2) > avg_range * 0.4 and _body(i) > avg_range * 0.4:
                if c[i] < (o[i-2] + c[i-2]) / 2:
                    signals.append({"index": i-1, "price": float(h[i-1]), "pattern": "이브닝스타", "type": "bearish", "side": "top"})
                    continue

    # ═══ 차트 패턴 (전체 데이터) ═══
    # 스윙 피봇
    swing = 5
    sh, sl = [], []
    for i in range(swing, n - swing):
        if h[i] == max(h[i-swing:i+swing+1]):
            sh.append((i, float(h[i])))
        if l[i] == min(l[i-swing:i+swing+1]):
            sl.append((i, float(l[i])))

    tol = avg_range * 0.3

    # 더블탑 (Double Top) — 최근 것만
    for i in range(max(0, len(sh) - 4), len(sh) - 1):
        for j in range(i + 1, min(i + 4, len(sh))):
            if abs(sh[i][1] - sh[j][1]) < tol and sh[j][0] - sh[i][0] > 15:
                mid_low = min(l[sh[i][0]:sh[j][0]+1])
                neckline_depth = sh[i][1] - mid_low
                if neckline_depth > avg_range * 3:
                    signals.append({"index": sh[j][0], "price": float(sh[j][1]),
                                    "pattern": "더블탑", "type": "bearish", "side": "top",
                                    "span": [sh[i][0], sh[j][0]]})
                    break

    # 더블바텀 (Double Bottom) — 최근 것만
    for i in range(max(0, len(sl) - 4), len(sl) - 1):
        for j in range(i + 1, min(i + 4, len(sl))):
            if abs(sl[i][1] - sl[j][1]) < tol and sl[j][0] - sl[i][0] > 15:
                mid_high = max(h[sl[i][0]:sl[j][0]+1])
                neckline_depth = mid_high - sl[i][1]
                if neckline_depth > avg_range * 3:
                    signals.append({"index": sl[j][0], "price": float(sl[j][1]),
                                    "pattern": "더블바텀", "type": "bullish", "side": "bottom",
                                    "span": [sl[i][0], sl[j][0]]})
                    break

    # 삼각수렴 (Triangle) — 고점 하강 + 저점 상승 (최소 4 터치)
    if len(sh) >= 4 and len(sl) >= 4:
        recent_h = sh[-4:]
        recent_l = sl[-4:]
        h_desc = all(recent_h[i][1] > recent_h[i+1][1] for i in range(len(recent_h)-1))
        l_asc = all(recent_l[i][1] < recent_l[i+1][1] for i in range(len(recent_l)-1))
        if h_desc and l_asc:
            apex_idx = max(recent_h[-1][0], recent_l[-1][0])
            signals.append({"index": apex_idx, "price": float((recent_h[-1][1] + recent_l[-1][1]) / 2),
                            "pattern": "삼각수렴", "type": "neutral", "side": "top",
                            "span": [min(recent_h[0][0], recent_l[0][0]), apex_idx]})

    # 헤드앤숄더 (Head & Shoulders) — 최근 스윙만
    if len(sh) >= 3:
        search_start = max(0, len(sh) - 6)
        for i in range(search_start, len(sh) - 2):
            left, head, right = sh[i], sh[i+1], sh[i+2]
            if head[1] > left[1] and head[1] > right[1]:
                if abs(left[1] - right[1]) < tol:
                    if head[1] - left[1] > avg_range * 1.5:
                        signals.append({"index": head[0], "price": float(head[1]),
                                        "pattern": "헤드앤숄더", "type": "bearish", "side": "top",
                                        "span": [left[0], right[0]]})
                        break

    # 역 헤드앤숄더 (Inverse H&S) — 최근 스윙만
    if len(sl) >= 3:
        search_start = max(0, len(sl) - 6)
        for i in range(search_start, len(sl) - 2):
            left, head, right = sl[i], sl[i+1], sl[i+2]
            if head[1] < left[1] and head[1] < right[1]:
                if abs(left[1] - right[1]) < tol:
                    if left[1] - head[1] > avg_range * 1.5:
                        signals.append({"index": head[0], "price": float(head[1]),
                                        "pattern": "역헤드앤숄더", "type": "bullish", "side": "bottom",
                                        "span": [left[0], right[0]]})
                        break

    # 중복 제거: 같은 위치 근처(±3봉)에 여러 패턴 → 우선순위 높은 것만
    priority = {"헤드앤숄더": 10, "역헤드앤숄더": 10, "삼각수렴": 9,
                "더블탑": 8, "더블바텀": 8, "쓰리솔져": 7, "쓰리크로우": 7,
                "모닝스타": 6, "이브닝스타": 6, "상승잉글핑": 5, "하락잉글핑": 5,
                "해머": 4, "슈팅스타": 4, "도지": 3}
    signals.sort(key=lambda s: -priority.get(s["pattern"], 0))
    used_idx = set()
    filtered = []
    for s in signals:
        key = s["index"] // 3  # 3봉 단위 그룹
        if key not in used_idx:
            used_idx.add(key)
            filtered.append(s)
    # 최근 20개만
    filtered.sort(key=lambda s: -s["index"])
    return filtered[:20]
