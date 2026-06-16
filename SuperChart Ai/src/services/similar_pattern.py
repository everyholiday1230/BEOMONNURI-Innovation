"""유사패턴 분석 — 현재 차트와 비슷한 과거 패턴 검색 + 이후 수익률 통계

고도화 포인트:
- 가격 '모양' 매칭: z-정규화된 로그수익률의 상관계수(피어슨) 기반 → 절대 가격대 무관하게 추세/굴곡 형태로 비교
- 다중 특징 결합: 가격모양(주) + 변동성(ATR) + 거래량 형태
- NMS(중복 억제): 인접한 겹치는 후보 제거로 다양성 확보
- 유사도 가중 통계 + 예상 경로 밴드(가중평균/분위수) + 신뢰도/방향 점수
- Fallback: 임계값 미달이어도 상위 N개는 반환
"""
import numpy as np

_EPS = 1e-9


def normalize(arr):
    """0~1 정규화 (하위 호환용)"""
    arr = np.asarray(arr, dtype=float)
    mn, mx = np.min(arr), np.max(arr)
    if mx - mn < _EPS:
        return np.zeros_like(arr)
    return (arr - mn) / (mx - mn)


def cosine_similarity(a, b):
    """코사인 유사도 (하위 호환용)"""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na < _EPS or nb < _EPS:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _zscore(arr):
    arr = np.asarray(arr, dtype=float)
    sd = arr.std()
    if sd < _EPS:
        return np.zeros_like(arr)
    return (arr - arr.mean()) / sd


def _log_returns(prices):
    """로그수익률 시퀀스 (길이 = len-1)"""
    prices = np.asarray(prices, dtype=float)
    prices = np.clip(prices, _EPS, None)
    return np.diff(np.log(prices))


def _shape_corr(a, b):
    """두 시퀀스의 모양 상관도를 0~1로 (피어슨 상관계수를 [0,1]로 매핑)"""
    a = _zscore(a)
    b = _zscore(b)
    if a.std() < _EPS or b.std() < _EPS:
        return 0.5
    r = float(np.clip(np.corrcoef(a, b)[0, 1], -1.0, 1.0))
    return (r + 1.0) / 2.0  # -1..1 -> 0..1


def _similarity(cur_ret, seg_ret, cur_vol, seg_vol, cur_atr, seg_atr):
    """가격모양(0.7) + 변동성(0.15) + 거래량(0.15) 결합 유사도 0~1"""
    price_sim = _shape_corr(cur_ret, seg_ret)
    vol_sim = _shape_corr(cur_vol, seg_vol) if np.any(seg_vol) else 0.5
    atr_sim = _shape_corr(cur_atr, seg_atr) if np.any(seg_atr) else 0.5
    return price_sim * 0.7 + vol_sim * 0.15 + atr_sim * 0.15


def _nms(results, period, overlap_ratio=0.5):
    """비최대 억제: 유사도 내림차순으로 보며, 이미 채택된 구간과 overlap_ratio 이상 겹치면 버림"""
    results = sorted(results, key=lambda x: -x['similarity'])
    kept = []
    min_gap = int(period * (1.0 - overlap_ratio))
    for r in results:
        if all(abs(r['start_idx'] - k['start_idx']) >= min_gap or r.get('symbol') != k.get('symbol')
               for k in kept):
            kept.append(r)
    return kept


def _projected_path(results, future):
    """유사도 가중 예상 경로 + 25/75 분위 밴드"""
    if not results:
        return [], [], []
    paths = np.array([r['future_path'][:future] for r in results if len(r['future_path']) >= future])
    if paths.size == 0:
        return [], [], []
    w = np.array([r['similarity'] for r in results if len(r['future_path']) >= future], dtype=float)
    w = w / (w.sum() + _EPS)
    mean_path = np.average(paths, axis=0, weights=w)
    lo = np.percentile(paths, 25, axis=0)
    hi = np.percentile(paths, 75, axis=0)
    return ([round(float(v), 3) for v in mean_path],
            [round(float(v), 3) for v in lo],
            [round(float(v), 3) for v in hi])


def _build_stats(results, future):
    """유사도 가중 통계 + 신뢰도/방향"""
    if not results:
        return {'count': 0, 'avg_return': 0, 'median_return': 0, 'up_ratio': 0,
                'max_up': 0, 'max_down': 0, 'confidence': 0, 'direction': 'neutral',
                'projected_path': [], 'band_low': [], 'band_high': []}
    returns = np.array([r['future_return'] for r in results], dtype=float)
    sims = np.array([r['similarity'] for r in results], dtype=float)
    w = sims / (sims.sum() + _EPS)
    mfes = [r['mfe'] for r in results]
    maes = [r['mae'] for r in results]
    w_avg = float(np.sum(returns * w))
    up_ratio = float(np.sum(w[returns > 0]) * 100)  # 유사도 가중 상승비율
    # 방향 합의도(0~1): 한 방향으로 얼마나 쏠려있나
    consensus = abs(up_ratio - 50) / 50
    # 신뢰도: 평균유사도 * 방향합의도 (0~100)
    confidence = round(float(np.mean(sims) * consensus), 1)
    direction = 'up' if up_ratio > 55 else 'down' if up_ratio < 45 else 'neutral'
    proj, lo, hi = _projected_path(results, future)
    return {
        'count': len(results),
        'avg_return': round(w_avg, 2),  # 유사도 가중 평균
        'mean_return': round(float(np.mean(returns)), 2),  # 단순 평균
        'median_return': round(float(np.median(returns)), 2),
        'up_ratio': round(up_ratio, 1),
        'max_up': round(float(np.max(returns)), 2),
        'max_down': round(float(np.min(returns)), 2),
        'avg_mfe': round(float(np.mean(mfes)), 2),
        'avg_mae': round(float(np.mean(maes)), 2),
        'confidence': confidence,
        'direction': direction,
        'projected_path': proj,
        'band_low': lo,
        'band_high': hi,
    }


def _scan_symbol(closes, volumes, atr, cur_ret, cur_vol, cur_atr, period, future, step,
                 symbol=None, threshold=0.7):
    """한 종목 시계열에서 유사 구간 수집"""
    n = len(closes)
    out = []
    for i in range(0, n - period - future, step):
        seg_ret = _log_returns(closes[i:i + period])
        seg_vol = volumes[i:i + period]
        seg_atr = atr[i:i + period]
        sim = _similarity(cur_ret, seg_ret, cur_vol, seg_vol, cur_atr, seg_atr)
        entry = closes[i + period - 1]
        future_prices = closes[i + period:i + period + future]
        if len(future_prices) < future or entry <= 0:
            continue
        future_return = (future_prices[-1] - entry) / entry * 100
        future_path = ((future_prices - entry) / entry * 100).tolist()
        rec = {
            'start_idx': i,
            'end_idx': i + period,
            'similarity': round(float(sim) * 100, 1),
            'future_return': round(float(future_return), 2),
            'future_path': [round(float(v), 3) for v in future_path],
            'entry_price': float(entry),
            'mfe': round(float(np.max(future_prices - entry) / entry * 100), 2),
            'mae': round(float(np.min(future_prices - entry) / entry * 100), 2),
        }
        if symbol is not None:
            rec['symbol'] = symbol
        rec['_pass'] = sim >= threshold
        out.append(rec)
    return out


def _finalize(candidates, period, future, top_n, threshold):
    """임계값 필터 → 부족하면 fallback → NMS → 상위 N → 통계"""
    passed = [c for c in candidates if c.get('_pass')]
    pool = passed if len(passed) >= 3 else candidates  # fallback: 매칭 적으면 상위 후보라도
    pool = _nms(pool, period)
    pool.sort(key=lambda x: -x['similarity'])
    pool = pool[:top_n]
    for c in pool:
        c.pop('_pass', None)
    return {'patterns': pool, 'stats': _build_stats(pool, future)}


def find_similar_patterns(candles: list[dict], period: int = 100, future: int = 20, top_n: int = 10) -> dict:
    """현재 차트의 최근 period봉과 유사한 과거 구간을 찾고, 이후 future봉 수익률 분석."""
    if not candles or len(candles) < period + future + 10:
        return {'patterns': [], 'stats': _build_stats([], future)}

    closes = np.array([float(c.get('close', c.get('c', 0))) for c in candles])
    volumes = np.array([float(c.get('volume', c.get('v', 0))) for c in candles])
    highs = np.array([float(c.get('high', c.get('h', 0))) for c in candles])
    lows = np.array([float(c.get('low', c.get('l', 0))) for c in candles])
    atr = highs - lows
    n = len(closes)

    cur_ret = _log_returns(closes[-period:])
    cur_vol = volumes[-period:]
    cur_atr = atr[-period:]
    step = max(period // 10, 5)

    # 현재 구간과 겹치지 않도록 마지막 period는 제외
    candidates = _scan_symbol(closes[:n - period], volumes[:n - period], atr[:n - period],
                              cur_ret, cur_vol, cur_atr, period, future, step, threshold=0.7)
    return _finalize(candidates, period, future, top_n, threshold=0.7)


def find_similar_across_symbols(current_candles: list[dict], all_symbol_candles: dict,
                                period: int = 100, future: int = 20, top_n: int = 10) -> dict:
    """여러 종목에서 유사 패턴 검색. all_symbol_candles: {symbol: [candles]}"""
    if not current_candles or len(current_candles) < period + 2:
        return {'patterns': [], 'stats': _build_stats([], future)}

    closes_cur = np.array([float(c.get('close', c.get('c', 0))) for c in current_candles])
    vols_cur = np.array([float(c.get('volume', c.get('v', 0))) for c in current_candles])
    highs_cur = np.array([float(c.get('high', c.get('h', 0))) for c in current_candles])
    lows_cur = np.array([float(c.get('low', c.get('l', 0))) for c in current_candles])
    cur_ret = _log_returns(closes_cur[-period:])
    cur_vol = vols_cur[-period:]
    cur_atr = (highs_cur - lows_cur)[-period:]
    step = max(period // 10, 5)

    candidates = []
    for symbol, candles in all_symbol_candles.items():
        if not candles or len(candles) < period + future:
            continue
        closes = np.array([float(c.get('close', c.get('c', 0))) for c in candles])
        volumes = np.array([float(c.get('volume', c.get('v', 0))) for c in candles])
        highs = np.array([float(c.get('high', c.get('h', 0))) for c in candles])
        lows = np.array([float(c.get('low', c.get('l', 0))) for c in candles])
        atr = highs - lows
        candidates += _scan_symbol(closes, volumes, atr, cur_ret, cur_vol, cur_atr,
                                   period, future, step, symbol=symbol, threshold=0.7)
    return _finalize(candidates, period, future, top_n, threshold=0.7)
