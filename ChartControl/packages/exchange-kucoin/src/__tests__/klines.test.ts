/**
 * 캔들 페이징 검증.
 *
 * 배경: KuCoin 은 from 기준 앞쪽 200행만 주고 to 를 무시한다. 넓은 범위를
 * 한 번에 요청하면 최신이 아니라 가장 오래된 200개가 온다. 이 회귀가 실제로
 * 발생해 차트에 24시간 구멍이 생긴 것을 재현하고 수정했다.
 */

import { describe, expect, it } from 'vitest';
import type { Candle } from '@quantumtrade/schemas';

import {
  MAX_PAGES,
  MAX_ROWS_PER_REQUEST,
  inspectCandleContinuity,
  isContinuitySuspicious,
  mergeCandlePages,
  planKlinePages,
} from '../klines.js';

const NOW = 1785841200000; // 2026-08-04T11:00:00Z
const MIN = 60 * 1000;

function candle(minutesAgoSteps: number, close: number, stepMin = 15): Candle {
  const v = String(close);
  return {
    time: NOW - minutesAgoSteps * stepMin * MIN,
    open: v,
    high: v,
    low: v,
    close: v,
    volume: '1',
    closed: true,
  };
}

describe('페이징 계획', () => {
  it('200개 이하는 단일 페이지', () => {
    const pages = planKlinePages(15, 100, NOW);
    expect(pages).toHaveLength(1);
    expect(pages[0]!).toEqual({ from: NOW - 100 * 15 * MIN, to: NOW, rows: 100 });
  });

  it('경계값 200개도 단일 페이지', () => {
    expect(planKlinePages(15, MAX_ROWS_PER_REQUEST, NOW)).toHaveLength(1);
  });

  it('220개(프론트 차트 기본값)는 200+20 두 페이지로 쪼갠다', () => {
    const pages = planKlinePages(15, 220, NOW);
    expect(pages.map((p) => p.rows)).toEqual([200, 20]);
    // 첫 페이지가 최신이어야 한다 — 첫 응답만으로 차트를 그릴 수 있어야 하므로.
    expect(pages[0]!.to).toBe(NOW);
    expect(pages[1]!.to).toBe(pages[0]!.from);
  });

  it('모든 페이지가 200행 상한을 넘지 않는다', () => {
    for (const limit of [1, 50, 199, 200, 201, 400, 500, 1000]) {
      for (const g of [1, 5, 15, 60, 240, 1440]) {
        for (const p of planKlinePages(g, limit, NOW)) {
          expect(p.rows).toBeLessThanOrEqual(MAX_ROWS_PER_REQUEST);
          expect(p.rows).toBeGreaterThanOrEqual(1);
          expect(p.from).toBeLessThan(p.to);
        }
      }
    }
  });

  it('페이지 경계가 맞물리고 겹치지 않는다', () => {
    const pages = planKlinePages(15, 500, NOW);
    for (let i = 1; i < pages.length; i += 1) {
      expect(pages[i]!.to).toBe(pages[i - 1]!.from);
    }
  });

  it('MAX_PAGES 로 요청 폭주를 막는다', () => {
    expect(planKlinePages(1, 100000, NOW)).toHaveLength(MAX_PAGES);
  });

  it('요청 구간 총합이 필요한 캔들 수를 정확히 덮는다', () => {
    const pages = planKlinePages(15, 220, NOW);
    expect(pages.reduce((n, p) => n + p.rows, 0)).toBe(220);
    expect(pages[pages.length - 1]!.from).toBe(NOW - 220 * 15 * MIN);
  });
});

describe('페이지 병합', () => {
  it('시간 오름차순으로 정렬한다', () => {
    const recent = [candle(2, 300), candle(1, 400), candle(0, 500)];
    const older = [candle(5, 100), candle(4, 150), candle(3, 200)];
    const merged = mergeCandlePages([recent, older], 10);
    expect(merged).toHaveLength(6);
    for (let i = 1; i < merged.length; i += 1) {
      expect(merged[i]!.time).toBeGreaterThan(merged[i - 1]!.time);
    }
    expect(merged[merged.length - 1]!.close).toBe('500');
  });

  it('경계 중복 시 최신 페이지 값을 우선한다', () => {
    const recent = [candle(1, 999)];
    const older = [candle(1, 111), candle(2, 50)];
    const merged = mergeCandlePages([recent, older], 10);
    expect(merged).toHaveLength(2);
    expect(merged.find((c) => c.time === NOW - 15 * MIN)?.close).toBe('999');
  });

  it('limit 개로 자르되 최신을 남긴다', () => {
    const page = [candle(4, 1), candle(3, 2), candle(2, 3), candle(1, 4), candle(0, 5)];
    expect(mergeCandlePages([page], 3).map((c) => c.close)).toEqual(['3', '4', '5']);
  });

  it('빈 페이지와 불량 캔들을 걸러낸다', () => {
    const merged = mergeCandlePages(
      [[], null as unknown as Candle[], [{ ...candle(0, 7), time: 0 }, candle(0, 7)]],
      10,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.close).toBe('7');
  });
});

describe('연속성 진단', () => {
  it('연속 캔들은 구멍 없음으로 판정한다', () => {
    const list = [candle(3, 1), candle(2, 2), candle(1, 3), candle(0, 4)].sort((a, b) => a.time - b.time);
    const health = inspectCandleContinuity(list, 15, NOW);
    expect(health.ok).toBe(true);
    expect(health.gaps).toEqual([]);
    expect(health.staleMs).toBe(0);
  });

  it('24시간 구멍을 감지한다 (실제 발생했던 버그)', () => {
    // 재현: REST 가 08-03 10:15 까지만 주고 WS 진행 캔들이 08-04 11:15 로 붙었다.
    const list: Candle[] = [
      { ...candle(0, 1), time: NOW - 25 * 3600 * 1000 },
      { ...candle(0, 1), time: NOW - 25 * 3600 * 1000 + 15 * MIN },
      { ...candle(0, 2), time: NOW },
    ];
    const health = inspectCandleContinuity(list, 15, NOW);
    expect(health.ok).toBe(false);
    expect(health.gaps).toHaveLength(1);
    // 간격 24h45m = 1485분 = 15분 구간 99개 → 사이에 없는 캔들 98개
    expect(health.gaps[0]!.missing).toBe(98);
    expect(health.maxGap).toBe(98);
    expect(health.totalMissing).toBe(98);
    // 구멍이 1개뿐이라 "개수" 기준으로는 안 걸린다. "크기" 기준이 잡아야 한다.
    expect(isContinuitySuspicious(health, list.length, 15)).toBe(true);
  });

  it('구멍 개수가 아니라 크기로 판정한다 (개수 기준의 맹점)', () => {
    // 220개 캔들 중 구멍 1개인데 그 구멍에 98개가 누락된 경우.
    // 개수 기준(gaps.length > budget)이면 1 > 11 이 거짓이라 놓친다.
    const list: Candle[] = [];
    for (let i = 219; i >= 0; i -= 1) {
      if (i <= 150 && i >= 53) continue; // 연속 98개 누락
      list.push({ ...candle(0, 1), time: NOW - i * 15 * MIN });
    }
    const health = inspectCandleContinuity(list, 15, NOW);
    expect(health.gaps).toHaveLength(1);
    expect(health.maxGap).toBe(98);
    expect(isContinuitySuspicious(health, list.length, 15)).toBe(true);
  });

  it('체결이 없어 생략된 소수의 캔들은 의심으로 보지 않는다', () => {
    // 1분봉에서 거래가 한산한 분은 거래소가 캔들을 아예 주지 않는다. 정상이다.
    const list: Candle[] = [];
    for (let i = 200; i >= 0; i -= 1) {
      if (i === 137) continue; // 1개 생략
      list.push({ ...candle(0, 1), time: NOW - i * MIN });
    }
    const health = inspectCandleContinuity(list, 1, NOW);
    expect(health.ok).toBe(false); // 구멍은 있다
    expect(isContinuitySuspicious(health, list.length, 1)).toBe(false); // 그러나 정상 범위
  });

  it('마지막 캔들이 크게 뒤처지면 의심으로 판정한다', () => {
    const list = [{ ...candle(0, 1), time: NOW - 3 * 3600 * 1000 }];
    const health = inspectCandleContinuity(list, 15, NOW);
    expect(health.staleMs).toBe(3 * 3600 * 1000);
    expect(isContinuitySuspicious(health, list.length, 15)).toBe(true);
  });

  it('빈 배열에 안전하다', () => {
    const health = inspectCandleContinuity([], 15, NOW);
    expect(health.ok).toBe(true);
    expect(health.staleMs).toBeNull();
  });
});
