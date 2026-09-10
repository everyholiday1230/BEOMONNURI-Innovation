/**
 * 차트에 목업 시세가 스쳐 보이지 않는다 — 소스 계약.
 *
 * ★★★ **운영자가 신고한 결함이다.** "종목이나 타임프레임 처음 누르면 장대 봉이 꼭
 *   생겼다가 실시간 차트로 돌아간다. 모든 종목이."
 *
 *   원인은 `live-market.js` 의 generateCandles 한 줄이었다. 실캔들이 캐시에 없으면
 *   **목업 캔들**을 돌려줬고, 목업은 시드 가격(68,432.5)으로 생성되므로 실제 시세와
 *   전혀 다른 가격대가 나온다.
 *
 *   실측(프로덕션, BTCUSDT):
 *       1H 최초 호출 → 65,034~68,433   ← 목업
 *       6초 뒤       → 77,880~79,661   ← 실데이터
 *   **약 1만 달러 차이**다. 그 간격이 한 봉으로 이어져 장대봉으로 보인다.
 *
 * ★★ 보기 흉한 정도가 아니라 **위험하다.** 실주문이 열린 제품에서 가짜 시세를
 *   1초라도 보여주면, 그 화면을 본 고객이 존재하지 않는 급등·급락을 근거로 판단할 수
 *   있다. 사라진 값을 사람은 기억한다.
 *
 * ★ 브라우저 없이도 지켜야 하므로 소스 계약으로 고정한다. 주석을 먼저 지운다 —
 *   설명 문장에 같은 낱말이 있어 검사가 헛통과하는 사고를 이 저장소에서 여러 번 겪었다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const strip = (src: string): string => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/[^\n]*$/gm, '');

const SRC = resolve(__dirname, '../../../..');
const liveMarket = strip(readFileSync(`${SRC}/src/live-market.js`, 'utf-8'));
const chart = strip(readFileSync(`${SRC}/src/chart-kline.jsx`, 'utf-8'));

describe('차트에 목업 시세가 스쳐 보이지 않는다', () => {
  it('[1] ★★★ generateCandles 가 목업으로 물러나기 전에 정책을 확인한다', () => {
    /*
       ★ `QTMockPolicy.allowMockData()` 가 이미 존재하고, 그 함수의 주석이 정확히 이
         상황을 말한다 — "null 은 아직 모른다. 그때 목업을 허용하면 첫 렌더에 예시가
         보이고 곧 실데이터로 바뀐다. 모르는 동안에는 보여주지 않는다."
         그런데 generateCandles 가 그 정책을 **쓰지 않고** 있었다.
    */
    const at = liveMarket.indexOf('function generateCandles');
    expect(at, 'generateCandles 를 찾지 못했다 — 시험이 낡았다').toBeGreaterThan(0);
    const body = liveMarket.slice(at, at + 2500);
    expect(body, '목업 폴백 앞에서 정책을 보지 않는다').toMatch(/allowMockData/);
    /*
       ★★ **문자열이 있는지만 보면 안 된다.** 처음 이 시험을 썼을 때 `if (!allowMock)`
         를 `if (false)` 로 바꿔도 통과했다 — 역검증에서 그것이 드러났다.
         조건이 실제로 정책 변수를 쓰는지 확인한다.
    */
    expect(body, '정책 결과를 조건으로 쓰지 않는다')
      .toMatch(/if\s*\(\s*!\s*allowMock\s*\)\s*return\s*\[\]\s*;/);
  });

  it('[2] ★★ 정책 확인이 목업 호출보다 먼저 온다', () => {
    /*
       ★ 순서가 뒤집히면 아무 의미가 없다 — 목업을 만든 뒤 정책을 봐도 이미 늦다.
         "코드는 넣었는데 동작하지 않는" 유형을 이 저장소에서 반복해 겪었다.
    */
    const at = liveMarket.indexOf('function generateCandles');
    const body = liveMarket.slice(at, at + 2500);
    const policyAt = body.indexOf('allowMockData');
    const mockAt = body.indexOf('mock.generateCandles');
    expect(policyAt, '정책 확인이 없다').toBeGreaterThan(0);
    expect(mockAt, '목업 호출을 찾지 못했다').toBeGreaterThan(0);
    expect(policyAt, '목업을 만든 뒤에 정책을 본다 — 순서가 뒤집혔다').toBeLessThan(mockAt);
  });

  it('[3] ★★ 캔들이 없으면 빈 차트가 아니라 "불러오는 중" 이다', () => {
    /*
       ★★ 목업을 막으면 빈 배열이 차트로 들어온다. 간격 검증(candlesMatchTimeframe)은
         `bars.length < 3` 이면 **true** 를 돌려주므로(판단 근거가 없으니 통과시키는
         것이 맞다) 그대로 두면 빈 배열이 통과해 **빈 차트**가 그려진다 —
         장대봉이 빈 화면으로 바뀌는 것뿐이고 여전히 고장으로 읽힌다.
       ★ 그래서 길이를 **간격 검증보다 먼저** 본다.
    */
    const lenAt = chart.indexOf('bars.length < 3');
    const matchAt = chart.indexOf('!candlesMatchTimeframe(bars, timeframe)');
    expect(lenAt, '빈 배열을 로딩으로 처리하지 않는다').toBeGreaterThan(0);
    expect(matchAt, '간격 검증을 찾지 못했다 — 시험이 낡았다').toBeGreaterThan(0);
    expect(lenAt, '길이 확인이 간격 검증보다 뒤에 있다').toBeLessThan(matchAt);
    /*
       ★ 그 분기가 로딩 표시를 켜야 한다.
       ★★ 그리고 **조건이 실제로 길이를 보는지** 확인한다 — `if (false)` 로 바꿔도
         통과했던 것이 역검증에서 드러났다.
    */
    const branch = chart.slice(lenAt, matchAt);
    expect(branch, '로딩 표시를 켜지 않는다').toMatch(/setTfLoading\(true\)/);
    expect(chart, '길이를 조건으로 쓰지 않는다')
      .toMatch(/if\s*\(\s*!Array\.isArray\(bars\)\s*\|\|\s*bars\.length\s*<\s*3\s*\)/);
  });
});
