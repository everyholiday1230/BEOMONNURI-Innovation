/**
 * KuCoin 캔들 페이징.
 *
 * ══ 실측으로 확정한 사실 (2026-08-04) ══════════════════════════════
 * KuCoin 선물 /api/v1/kline/query 는
 *   - `from` 시점부터 "앞으로" 최대 200행만 반환한다
 *   - `to` 파라미터를 사실상 무시한다
 *
 * 측정값 (granularity=15, XBTUSDTM, to=now 를 명시해도 동일):
 *     from=now-6h   -> 24행,  마지막 = now-5분      정상
 *     from=now-25h  -> 100행, 마지막 = now-5분      정상
 *     from=now-75h  -> 200행, 마지막 = now-25시간   ← 최신이 없다
 *     from=now-150h -> 200행, 마지막 = now-100시간  ← 더 심하다
 *
 * 즉 220개가 필요해서 범위를 넓게 주면, 최신 캔들이 아니라 "가장 오래된 200개"가
 * 온다. 그대로 쓰면 차트가 며칠 전 가격을 그리고 마지막 캔들만 현재로 튀어
 * 24시간 구멍이 생긴다. 실제로 재현하고 수정했다.
 * ═══════════════════════════════════════════════════════════════
 */

import type { Candle } from '@quantumtrade/schemas';

/** KuCoin 이 1회 응답에 담아주는 최대 행 수. 실측값. */
export const MAX_ROWS_PER_REQUEST = 200;

/** 페이징 요청 상한. 무한 루프와 레이트리밋 폭주를 막는다. */
export const MAX_PAGES = 5;

export interface KlinePage {
  from: number;
  to: number;
  rows: number;
}

/**
 * 필요한 캔들 수를 200행 이하 구간들로 쪼갠다.
 * 가장 최근 구간을 먼저 요청한다 — 첫 응답만으로도 차트를 그릴 수 있어야 한다.
 */
export function planKlinePages(granularity: number, limit: number, nowMs: number): KlinePage[] {
  const stepMs = granularity * 60 * 1000;
  const pages: KlinePage[] = [];

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
 * 여러 페이지를 합친다.
 *
 * 경계에서 같은 시각이 중복될 수 있다. 그때는 먼저 온 페이지(더 최신 요청)의
 * 값을 남긴다 — 과거 페이지가 진행 중이던 캔들의 확정값을 덮어쓰지 않게 하려는 것.
 */
export function mergeCandlePages(pages: Candle[][], limit: number): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const page of pages) {
    for (const candle of page ?? []) {
      if (!candle || !(candle.time > 0)) continue;
      if (!byTime.has(candle.time)) byTime.set(candle.time, candle);
    }
  }
  const merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  return limit > 0 ? merged.slice(-limit) : merged;
}

export interface CandleContinuity {
  ok: boolean;
  gaps: Array<{ after: number; missing: number }>;
  /** 누락된 캔들 총 개수 */
  totalMissing: number;
  /** 가장 큰 구멍의 누락 개수 */
  maxGap: number;
  /** 마지막 캔들이 얼마나 뒤처졌는지(ms). 캔들이 없으면 null. */
  staleMs: number | null;
}

/**
 * 캔들 간격이 일정한지 검사한다.
 *
 * 페이징이 잘못되면 중간에 큰 구멍이 생기고 차트가 조용히 왜곡된다.
 * 감지해서 로그로 남기기 위한 진단 함수.
 *
 * 주의: 체결이 없는 구간은 거래소가 캔들을 아예 생략한다(특히 1분봉).
 * 그건 정상이므로 판정은 isContinuitySuspicious 가 담당한다.
 */
export function inspectCandleContinuity(
  candles: Candle[],
  granularity: number,
  nowMs: number = Date.now(),
): CandleContinuity {
  const stepMs = granularity * 60 * 1000;
  const gaps: Array<{ after: number; missing: number }> = [];

  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1];
    const cur = candles[i];
    if (!prev || !cur) continue;
    const delta = cur.time - prev.time;
    if (delta > stepMs) {
      const missing = Math.round(delta / stepMs) - 1;
      if (missing > 0) gaps.push({ after: prev.time, missing });
    }
  }

  const last = candles.length > 0 ? candles[candles.length - 1] : undefined;
  const totalMissing = gaps.reduce((n, g) => n + g.missing, 0);
  const maxGap = gaps.reduce((n, g) => Math.max(n, g.missing), 0);

  return {
    ok: gaps.length === 0,
    gaps,
    totalMissing,
    maxGap,
    staleMs: last ? nowMs - last.time : null,
  };
}

/** 단일 구멍이 이보다 크면 거래 한산이 아니라 데이터 누락으로 본다. */
export const MAX_TOLERABLE_GAP = 10;

/**
 * 연속성 이상이 "의심스러운" 수준인지 판정한다.
 * 정상적인 생략(빈 캔들)과 페이징 버그를 구분하기 위한 임계값을 한 곳에 둔다.
 *
 * 판정 기준 3가지. 하나라도 걸리면 의심.
 *
 *  1) 가장 큰 구멍이 MAX_TOLERABLE_GAP 초과
 *     — 실제 겪은 버그가 "구멍 1개, 누락 98개" 형태였다. 구멍 개수만 세면
 *       이걸 놓친다. 크기를 반드시 봐야 한다.
 *  2) 누락 총합이 전체의 20% 초과
 *     — 잘게 흩어진 누락이 누적되는 경우.
 *  3) 마지막 캔들이 5구간 이상 뒤처짐
 *     — 최신 데이터가 안 오는 상태. 죽은 시세를 실시간처럼 보여주는 것을 막는다.
 */
export function isContinuitySuspicious(
  health: CandleContinuity,
  candleCount: number,
  granularity: number,
): boolean {
  if (health.maxGap > MAX_TOLERABLE_GAP) return true;
  if (candleCount > 0 && health.totalMissing > candleCount * 0.2) return true;
  const staleBudget = granularity * 60 * 1000 * 5;
  return health.staleMs !== null && health.staleMs > staleBudget;
}
