import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   지표 이름이 차트에 표시된다.

   ★★ 운영자 신고: "무슨 지표인지 모르겠다."

     처음에는 왼쪽 그리기 도구 막대가 차트를 덮는 문제로 이해했다. 실측해 보니
     아니었다 — 도구 막대는 flex 형제 요소로 나란히 놓여 있고 캔버스를 덮지 않는다.

     진짜 원인은 **이름을 아무도 표시하지 않는 것**이었다:

       · KLineCharts 내장 툴팁을 껐다
         (candle: tooltip.showRule='none', indicator: tooltip.showRule='none')
         주석에는 "우리 .chart-hud DOM 이 그 역할을 하며", "지표 툴팁도 우리
         레전드로 대체한다" 고 적혀 있었다.

       · 그런데 그 레전드는 `MA20 · MA60 · MA120` 세 문자열이 박혀 있었고,
         showMA 일 때만 나왔다. RSI·MACD·PSY 를 켜도 이름이 없었다.

     즉 대체한다고 적어 두고 실제로는 대체하지 못한 상태였다. 끄기만 하고 대신할
     것을 만들지 않으면, 주석이 사실과 달라진다.

   ★★ 두 번째 결함: 알리지 않는 게시

     `publishIndicatorDetail` 은 값을 저장만 하고 구독자에게 알리지 않았다. 그래서
     지표를 추가해도 레전드가 **다음 조작 때** 갱신됐다(실측: 한 박자 밀림).
     이름 목록(`publishIndicators`)만 알리는 것으로는 부족하다 — 설정값만 바뀐
     경우 이름이 같아서 그쪽이 알림을 건너뛴다.

   ★ 실측 결과
       기본 상태 : MA20 · MA60 · MA120 · VOL
       RSI 추가  : … · RSI(6,12,24)              (즉시)
       3개 추가  : … · RSI(6,12,24) · MACD(12,26,9) · PSY(12,6)
       RSI 제거  : … · MACD(12,26,9) · PSY(12,6)  (즉시 사라짐)
*/
describe('CHART-LEGEND — 켜둔 지표의 이름이 보인다', () => {
  const kline = read('src/chart-kline.jsx');
  const panel = read('src/chart-indicators.jsx');

  it('[1] 레전드가 하드코딩이 아니라 활성 지표를 그린다', () => {
    /*
       ★★ 예전에는 MA20·MA60·MA120 이 문자열로 박혀 있었다. 그래서 다른 지표를
         켜도 화면에 이름이 없었다.
    */
    expect(kline).toMatch(/activeIndicators\.map\(/);
    expect(kline).toMatch(/showLegend && activeIndicators\.length > 0/);
    // 하드코딩된 세 줄이 돌아오면 실패한다.
    expect(kline).not.toMatch(/>MA20<\/div>/);
  });

  it('[2] 설정값을 함께 보여준다', () => {
    /*
       ★ `MA` 만으로는 20일선인지 120일선인지 알 수 없고, 그 둘은 완전히 다른
         판단이다. RSI(6,12,24) 처럼 기간을 함께 적는다.
    */
    expect(kline).toMatch(/\$\{name\}\(\$\{params\.join\(','\)\}\)/);
  });

  it('[3] 지표 목록 변화를 구독한다', () => {
    expect(kline).toMatch(/cs\.subscribe\(/);
    expect(kline).toMatch(/setActiveIndicators/);
  });

  it('[4] 상세 게시가 구독자에게 알린다 — 저장만 하면 화면이 모른다', () => {
    /*
       ★★ 예전에는 currentDetail 에 저장만 했다. 데이터는 있는데 화면이 갱신되지
         않는 상태이고, 이 프로젝트가 반복해서 고쳐온 실패 방식이다.
    */
    const start = panel.indexOf('publishIndicatorDetail(list)');
    expect(start).toBeGreaterThan(0);
    const block = panel.slice(start, start + 1600);
    expect(block).toMatch(/listeners\.forEach/);
  });

  it('[5] 값이 바뀔 때마다 알리지는 않는다 — 매 틱 재렌더는 낭비다', () => {
    const start = panel.indexOf('publishIndicatorDetail(list)');
    const block = panel.slice(start, start + 1600);
    /*
       ★ 계산값은 매 틱 바뀐다. 그대로 알리면 초당 재렌더가 일어난다. 레전드가
         쓰는 것은 이름과 설정값이므로 그 둘만 비교한다.
    */
    expect(block).toMatch(/const shape = /);
    expect(block).toMatch(/if \(changed\)/);
  });

  it('[6] 이름은 즉시, 값은 계산 후 — 두 번 게시한다', () => {
    /*
       ★★ 계산이 한 프레임 뒤에 끝나므로 즉시 게시하면 값이 비어 있고, 지연만 하면
         이름이 늦게 나타난다(실측: 레전드가 다음 조작 때 갱신됐다).
    */
    const addStart = kline.indexOf('addIndicator(name, params)');
    const block = kline.slice(addStart, addStart + 2600);
    const calls = block.match(/publishState\(\)/g) ?? [];
    expect(calls.length, 'addIndicator 가 즉시+지연 2회 게시하지 않는다').toBeGreaterThanOrEqual(2);
  });

  it('[7] 내장 툴팁을 끈 사실이 유지되는지 확인한다', () => {
    /*
       ★ 내장 툴팁을 다시 켜면 우리 레전드와 이중으로 표시된다. 끈 상태를 전제로
         레전드를 만들었으므로, 그 전제가 바뀌면 이 검사가 알려준다.
    */
    expect(kline).toMatch(/tooltip: \{ showRule: 'none' \}/);
  });
});
