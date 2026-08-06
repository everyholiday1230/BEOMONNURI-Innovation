/**
 * 캔들 페이징 로직 검증.
 *
 * 배경: KuCoin 은 from 기준 앞쪽 200행만 주고 to 를 무시한다.
 * 넓은 범위를 한 번에 요청하면 최신 캔들이 아니라 가장 오래된 200개가 온다.
 * 이 회귀가 실제로 발생해 차트에 24시간 구멍이 생긴 것을 재현/수정했다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PAGES,
  MAX_ROWS_PER_REQUEST,
  inspectCandleContinuity,
  mergeCandlePages,
  planKlinePages,
} from '../src/exchanges/kucoin/klines.js';

const NOW = 1785841200000; // 2026-08-04T11:00:00Z
const MIN = 60 * 1000;

test('200개 이하 요청은 단일 페이지', () => {
  const pages = planKlinePages(15, 100, NOW);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].rows, 100);
  assert.equal(pages[0].to, NOW);
  assert.equal(pages[0].from, NOW - 100 * 15 * MIN);
});

test('경계값 200개도 단일 페이지', () => {
  const pages = planKlinePages(15, MAX_ROWS_PER_REQUEST, NOW);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].rows, 200);
});

test('220개(프론트엔드 차트 기본값)는 200+20 두 페이지로 쪼갠다', () => {
  const pages = planKlinePages(15, 220, NOW);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].rows, 200);
  assert.equal(pages[1].rows, 20);

  // 첫 페이지가 최신 구간이어야 한다. 사용자는 최신을 먼저 봐야 하기 때문.
  assert.equal(pages[0].to, NOW);
  // 두 번째 페이지는 첫 페이지보다 과거이고 경계가 맞물린다.
  assert.equal(pages[1].to, pages[0].from);
});

test('모든 페이지가 200행 상한을 넘지 않는다', () => {
  for (const limit of [1, 50, 199, 200, 201, 400, 500, 1000]) {
    for (const g of [1, 5, 15, 60, 240, 1440]) {
      for (const p of planKlinePages(g, limit, NOW)) {
        assert.ok(p.rows <= MAX_ROWS_PER_REQUEST, `rows=${p.rows} limit=${limit} g=${g}`);
        assert.ok(p.rows >= 1);
        assert.ok(p.from < p.to);
      }
    }
  }
});

test('페이지들이 연속되고 겹치지 않는다', () => {
  const pages = planKlinePages(15, 500, NOW);
  for (let i = 1; i < pages.length; i += 1) {
    assert.equal(pages[i].to, pages[i - 1].from, `페이지 ${i} 경계 불일치`);
  }
});

test('MAX_PAGES 로 요청 폭주를 막는다', () => {
  const pages = planKlinePages(1, 100000, NOW);
  assert.equal(pages.length, MAX_PAGES);
});

test('요청 구간 총합이 필요한 캔들 수를 덮는다', () => {
  const limit = 220;
  const pages = planKlinePages(15, limit, NOW);
  const total = pages.reduce((n, p) => n + p.rows, 0);
  assert.equal(total, limit);
  // 가장 과거 경계가 limit 개 만큼 뒤로 가 있어야 한다.
  assert.equal(pages[pages.length - 1].from, NOW - limit * 15 * MIN);
});

// ---------------------------------------------------------------------------
// 병합
// ---------------------------------------------------------------------------

function candle(timeMin, close) {
  return { time: NOW - timeMin * 15 * MIN, open: close, high: close, low: close, close, volume: 1 };
}

test('페이지 병합: 시간 오름차순 정렬', () => {
  const recent = [candle(2, 300), candle(1, 400), candle(0, 500)];
  const older = [candle(5, 100), candle(4, 150), candle(3, 200)];
  const merged = mergeCandlePages([recent, older], 10);

  assert.equal(merged.length, 6);
  for (let i = 1; i < merged.length; i += 1) {
    assert.ok(merged[i].time > merged[i - 1].time, '정렬 실패');
  }
  assert.equal(merged[merged.length - 1].close, 500);
});

test('페이지 병합: 경계 중복 시 최신 페이지 값을 우선한다', () => {
  // 같은 시각에 대해 최신 페이지는 close=999, 과거 페이지는 close=111
  const recent = [candle(1, 999)];
  const older = [candle(1, 111), candle(2, 50)];
  const merged = mergeCandlePages([recent, older], 10);

  assert.equal(merged.length, 2);
  const dup = merged.find((c) => c.time === NOW - 15 * MIN);
  assert.equal(dup.close, 999, '과거 페이지가 최신 값을 덮어썼다');
});

test('페이지 병합: limit 개로 잘라내되 최신을 남긴다', () => {
  const page = [candle(4, 1), candle(3, 2), candle(2, 3), candle(1, 4), candle(0, 5)];
  const merged = mergeCandlePages([page], 3);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.map((c) => c.close), [3, 4, 5]);
});

test('페이지 병합: 빈 페이지와 불량 캔들을 걸러낸다', () => {
  const merged = mergeCandlePages([[], null, [{ time: 0 }, candle(0, 7)]], 10);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].close, 7);
});

// ---------------------------------------------------------------------------
// 연속성 진단 — 실제로 겪은 버그를 고정한다
// ---------------------------------------------------------------------------

test('연속 캔들은 구멍이 없다고 판정한다', () => {
  const list = [candle(3, 1), candle(2, 2), candle(1, 3), candle(0, 4)].sort((a, b) => a.time - b.time);
  const health = inspectCandleContinuity(list, 15, NOW);
  assert.equal(health.ok, true);
  assert.deepEqual(health.gaps, []);
  assert.equal(health.staleMs, 0);
});

test('24시간 구멍을 감지한다 (실제 발생했던 버그)', () => {
  // 재현: REST 가 08-03 10:15 까지만 주고, WS 진행 캔들이 08-04 11:15 로 붙었다.
  const oldPart = [
    { time: NOW - 25 * 3600 * 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    { time: NOW - 25 * 3600 * 1000 + 15 * MIN, open: 1, high: 1, low: 1, close: 1, volume: 1 },
  ];
  const livePart = [{ time: NOW, open: 2, high: 2, low: 2, close: 2, volume: 1 }];
  const health = inspectCandleContinuity([...oldPart, ...livePart], 15, NOW);

  assert.equal(health.ok, false);
  assert.equal(health.gaps.length, 1);
  // 간격 = 25시간 - 15분 = 24시간45분 = 1485분 = 15분 구간 99개.
  // 그 사이에 "없는" 캔들은 99 - 1 = 98개.
  assert.equal(health.gaps[0].missing, 98);
});

test('마지막 캔들이 오래되었으면 staleMs 로 드러난다', () => {
  const list = [{ time: NOW - 3 * 3600 * 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
  const health = inspectCandleContinuity(list, 15, NOW);
  assert.equal(health.staleMs, 3 * 3600 * 1000);
});

test('빈 배열에도 안전하다', () => {
  const health = inspectCandleContinuity([], 15, NOW);
  assert.equal(health.ok, true);
  assert.equal(health.staleMs, null);
});
