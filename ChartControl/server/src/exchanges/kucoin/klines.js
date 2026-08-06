/**
 * KuCoin 캔들 페이징 계획.
 *
 * ── 반드시 알아야 할 실측 사실 (2026-08-04 확인) ─────────────────────
 * KuCoin 선물 /api/v1/kline/query 는
 *   - `from` 시점부터 "앞으로" 최대 200행만 반환한다.
 *   - `to` 파라미터를 사실상 무시한다.
 *
 * 측정값 (granularity=15, symbol=XBTUSDTM, to=now 지정):
 *     from=now-6h    -> 24행,  마지막 = now-5분      (정상)
 *     from=now-25h   -> 100행, 마지막 = now-5분      (정상)
 *     from=now-75h   -> 200행, 마지막 = now-25시간   ← 최신이 없다
 *     from=now-150h  -> 200행, 마지막 = now-100시간  ← 더 심함
 *
 * 즉 220개를 한 번에 받으려고 넓은 범위를 주면, 최신 캔들이 아니라
 * "가장 오래된 200개"가 온다. 그대로 쓰면 차트가 며칠 전 가격을 그리고
 * 마지막 캔들만 현재로 튀어 24시간 구멍이 생긴다. (실제로 재현했다)
 *
 * 그래서 200행 이하로 쪼개 과거 방향으로 페이징한다.
 * ─────────────────────────────────────────────────────────────────
 */

/** KuCoin 이 1회 응답에 담아주는 최대 행 수. 실측값. */
export const MAX_ROWS_PER_REQUEST = 200;

/** 페이징 요청 상한. 무한 루프 및 레이트리밋 폭주 방지. */
export const MAX_PAGES = 5;

/**
 * 필요한 캔들 수를 200행 이하 구간들로 쪼갠다.
 *
 * 가장 최근 구간을 먼저 요청한다. 사용자는 최신 캔들을 먼저 보기 때문에,
 * 첫 응답만으로도 차트를 그릴 수 있어야 한다.
 *
 * @param {number} granularity 분 단위 (1,5,15,...)
 * @param {number} limit       필요한 캔들 수
 * @param {number} nowMs       기준 시각
 * @returns {Array<{from:number, to:number, rows:number}>} 최신 -> 과거 순
 */
export function planKlinePages(granularity, limit, nowMs) {
  const stepMs = granularity * 60 * 1000;
  const pages = [];

  let remaining = Math.max(1, Math.floor(limit));
  let cursorTo = nowMs;

  for (let i = 0; i < MAX_PAGES && remaining > 0; i += 1) {
    const rows = Math.min(MAX_ROWS_PER_REQUEST, remaining);
    const from = cursorTo - rows * stepMs;
    pages.push({ from, to: cursorTo, rows });
    cursorTo = from;
    remaining -= rows;
  }

  return pages;
}

/**
 * 여러 페이지의 캔들을 합친다.
 *
 * 경계에서 같은 시각의 캔들이 중복될 수 있으므로 time 을 키로 중복을 제거하고,
 * 시간 오름차순으로 정렬해 마지막 limit 개만 남긴다.
 *
 * @param {Array<Array<object>>} pages 페이지별 캔들 배열
 * @param {number} limit
 */
export function mergeCandlePages(pages, limit) {
  const byTime = new Map();
  for (const page of pages) {
    for (const candle of page || []) {
      if (!candle || !(candle.time > 0)) continue;
      // 뒤에 온 페이지(더 과거)가 이미 있는 최신 값을 덮어쓰지 않게 한다.
      if (!byTime.has(candle.time)) byTime.set(candle.time, candle);
    }
  }

  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  return limit > 0 ? merged.slice(-limit) : merged;
}

/**
 * 캔들 배열의 시간 간격이 일정한지 검사한다.
 *
 * 페이징이 잘못되면 중간에 큰 구멍이 생기고 차트가 조용히 왜곡된다.
 * 조용히 넘기지 않고 감지해서 로그로 남기기 위한 진단 함수.
 *
 * @returns {{ok:boolean, gaps:Array<{after:number, missing:number}>, staleMs:number|null}}
 */
export function inspectCandleContinuity(candles, granularity, nowMs = Date.now()) {
  const stepMs = granularity * 60 * 1000;
  const gaps = [];

  for (let i = 1; i < candles.length; i += 1) {
    const delta = candles[i].time - candles[i - 1].time;
    if (delta > stepMs) {
      const missing = Math.round(delta / stepMs) - 1;
      if (missing > 0) gaps.push({ after: candles[i - 1].time, missing });
    }
  }

  const last = candles[candles.length - 1];
  const staleMs = last ? nowMs - last.time : null;

  return { ok: gaps.length === 0, gaps, staleMs };
}
