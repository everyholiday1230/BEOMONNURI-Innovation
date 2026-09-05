import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   지표 값이 AI 까지 도달한다.

   ★★ 이전 상태

     `calculate_indicator_set` 도구는 아무것도 계산하지 않으면서 "계산했다" 고
     응답했다(제거함). 그리고 AI 에게 전달되던 화면 정보는 지표 **이름**뿐이었다.
     그래서 AI 는 "RSI 가 켜져 있다" 만 알고 값은 몰랐고, 수치를 말하려면 스스로
     추정해야 했다 — 출처 없는 숫자다.

   ★★ 해결 방식: 서버에서 다시 계산하지 않는다.

     KLineCharts 가 이미 27종을 브라우저에서 계산하고 `result` 배열로 들고 있다
     (실측: RSI 220개, 마지막 항목 {rsi1, rsi2, rsi3}). 그 값을 그대로 넘긴다.
     서버에서 따로 구현하면 화면 숫자와 미세하게 달라질 수 있고, 그러면 고객이
     보는 값과 AI 가 말하는 값이 어긋나 **둘 다 못 믿게 된다.**

   ★★ 게시 위치를 옮긴 것이 핵심이다.

     게시가 지표 패널 컴포넌트 안에만 있었다. 그래서 이용자가 Indicators 패널을
     한 번도 열지 않으면 값이 전달되지 않았다 — 화면에는 MA·VOL 이 그려져 있는데
     AI 는 지표 정보가 없는 상태다. 실측으로 확인했고(패널 열기 전 상세 목록이
     비어 있었다), 차트가 스스로 게시하도록 옮겼다.

   ★ 실측 결과(패널을 열지 않은 상태):
       상세 2개, 값있음 2개: MA, VOL
       전송 형태: {"name":"MA","latest":{"ma1":72894.34,"ma2":73291.08,"ma3":72721.42}}
       RSI 추가 직후: RSI 값 있음 {"rsi1":7.85,...}
*/
describe('INDICATOR-VALUES — 화면이 계산한 값이 AI 까지 간다', () => {
  const kline = read('src/chart-kline.jsx');
  const panel = read('src/chart-indicators.jsx');
  const app = read('src/app.jsx');
  const copilot = read('src/ai-copilot.jsx');
  const api = read('apps/api/src/index.ts');

  it('[1] 차트가 계산 결과(result)를 읽는다', () => {
    /*
       ★ KLineCharts 는 지표 계산 결과를 `result` 로 들고 있다. 이름·설정만 읽으면
         값이 없다 — 그게 고치기 전 상태였다.
    */
    expect(kline).toMatch(/Array\.isArray\(i\.result\) \? i\.result : null/);
  });

  it('[2] 마지막 값과 직전 값만 보낸다 — 전체 계열은 비용이다', () => {
    /*
       ★ 지표당 수백 개를 보내면 프롬프트가 비대해지고 토큰 비용이 오른다. 해석에
         필요한 것은 현재 값과 방향이다.
    */
    expect(kline).toMatch(/res\[res\.length - 1\]/);
    expect(kline).toMatch(/res\[res\.length - 2\]/);
  });

  it('[3] 값이 없으면 필드를 넣지 않는다', () => {
    /*
       ★★ null·0 을 넣으면 모델이 그것을 값으로 읽는다. 이 프로젝트가 반복해서
         고쳐온 실패 방식이다(측정 불가를 0 으로 기록).
    */
    expect(kline).toMatch(/last && typeof last === 'object' \? \{ latest: last \} : \{\}/);
    expect(panel).toMatch(/lastVal && typeof lastVal === 'object' \? \{ latest: lastVal \} : \{\}/);
  });

  it('[4] 차트가 스스로 게시한다 — 패널을 열지 않아도 값이 간다', () => {
    /*
       ★★ 게시가 패널 컴포넌트 안에만 있으면, 패널을 열지 않은 이용자의 AI 는
         지표 값을 받지 못한다. 화면에는 보이는데 AI 만 모르는 상태다.
    */
    expect(kline).toMatch(/publishState\(\) \{/);
    expect(kline).toMatch(/cs\.publishIndicatorDetail/);
    // 차트 준비 시점과 지표 변경 시점 모두에서 부른다.
    const calls = kline.match(/publishState\(\)/g) ?? [];
    expect(calls.length, '게시 호출이 부족하다(정의 + 준비 + 추가 + 제거)').toBeGreaterThanOrEqual(4);
  });

  it('[5] 앱이 값 목록을 문맥에 넣는다', () => {
    expect(app).toMatch(/getIndicatorDetail/);
    expect(app).toMatch(/indicatorDetail: chartIndicatorDetail/);
    /*
       ★ 값이 아직 없으면 null 이다(빈 배열이 아니다). 빈 배열은 "지표를 하나도
         켜지 않았다" 로 읽히고, 그건 모르는 것과 다른 사실이다.
    */
    expect(app).toMatch(/: null;/);
  });

  it('[6] 코파일럿이 값을 서버로 보낸다', () => {
    expect(copilot).toMatch(/indicatorValues:/);
    expect(copilot).toMatch(/context\.indicatorDetail/);
  });

  it('[7] 서버가 값을 통과시키고 출처를 밝힌다', () => {
    /*
       ★★ 이 숫자는 서버가 계산·검증한 것이 아니라 고객 브라우저가 계산한 것이다.
         그 사실을 프롬프트에 적지 않으면 모델은 서버 검증값으로 착각하고, 로그에서도
         구분할 수 없다.
    */
    expect(api).toMatch(/indicatorValues: vals/);
    expect(api).toMatch(/indicatorValuesNote/);
    expect(api).toMatch(/Computed by the chart in the user/);
    expect(api).toMatch(/not server-verified/);
    // ★ 인용해도 된다는 것까지 적어야 모델이 규칙과 충돌하지 않는다.
    expect(api).toMatch(/you may quote them/);
  });

  it('[8] 빈 값 배열은 넣지 않는다', () => {
    /*
       ★ 빈 배열을 넣으면 모델이 "지표를 켰는데 값이 없다" 로 읽을 수 있다.
    */
    expect(api).toMatch(/rawVals && rawVals\.length > 0 \? rawVals : undefined/);
  });

  it('[9] 안전 규칙과 모순되지 않는다 — 출처가 있으면 인용 허용', () => {
    const prompts = read('packages/ai/src/prompts.ts');
    /*
       ★★ 규칙이 "절대 금지" 였다면 값을 넘겨도 모델이 말하지 못한다. "출처가 있을
         때만" 으로 적어 두었기 때문에 이번 변경으로 바로 쓸 수 있다.
    */
    expect(prompts).toMatch(/unless that number appears in a tool result or in MARKET_DATA/);
  });
});
