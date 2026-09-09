/**
 * 차트 크기 따라가기 + 수평선 가격 입력.
 *
 * ★★ 무엇이 문제였나
 *
 *   1. **패널을 키워도 차트가 그대로였다.** `resize()` 문제가 아니라 flex 누락이었다.
 *      `.qt-cgrid` 에 `width: 100%` 가 없어 폭이 내용 크기에 갇혔고(704px 고정),
 *      `.qt-cgrid__body > .panel` 이 `flex: 0 1 auto` 라서 높이도 463px 에 머물렀다.
 *
 *   2. **수평선 가격을 숫자로 넣을 수 없었다.** 드래그로는 원하는 값에 정확히 못
 *      세운다. 지지·저항선을 "68,400" 에 두고 싶은데 68,412 처럼 어긋나고, 그 선을
 *      기준으로 만든 주문 초안도 함께 어긋난다.
 *
 * ★ 실제 동작은 브라우저로 확인했다(캔버스는 픽셀이라 DOM 검사로는 잡히지 않는다).
 *   이 테스트는 **되돌아가기 쉬운 CSS·배선**을 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf-8');

describe('차트가 패널 크기를 따라간다', () => {
  const css = read('../../../../src/pending.css');

  it('.qt-cgrid 가 폭을 부모에 맞춘다', () => {
    /*
       ★ 세로 flex 컨테이너인데 부모가 가로 flex 다. width 를 주지 않으면 폭이
         max-content 로 정해져, 패널을 넓혀도 격자가 704px 에 머문다(실측).
    */
    const at = css.indexOf('.qt-cgrid {');
    expect(at, '.qt-cgrid 규칙을 찾지 못했다').toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('}', at));
    expect(block, 'width: 100% 가 없다').toContain('width: 100%');
    expect(block, 'min-width: 0 이 없다 — 줄일 때 넘친다').toContain('min-width: 0');
  });

  it('.qt-cgrid__grid 가 내용 크기에 갇히지 않는다', () => {
    const at = css.indexOf('.qt-cgrid__grid {');
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('}', at));
    expect(block).toContain('min-width: 0');
  });

  it('격자 안의 패널이 칸을 꽉 채운다 (세로)', () => {
    /*
       ★ body 는 flex:1 로 늘어나는데 자식 .panel 이 flex:0 1 auto 라서 내용 높이에
         머물렀다. 그 결과 차트 캔버스가 299px 로 고정됐다(실측).
    */
    const at = css.indexOf('.qt-cgrid__body {');
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('}', at));
    expect(block, 'body 가 flex 컨테이너가 아니다').toContain('display: flex');

    const child = css.indexOf('.qt-cgrid__body > .panel {');
    expect(child, '.qt-cgrid__body > .panel 규칙이 없다').toBeGreaterThan(-1);
    const cb = css.slice(child, css.indexOf('}', child));
    expect(cb).toContain('flex: 1');
    expect(cb).toContain('min-height: 0');
  });

  it('컨테이너 크기 변화를 관찰한다', () => {
    /*
       ★ KLineChart 는 캔버스에 그리고 컨테이너가 커져도 스스로 다시 그리지 않는다.
       ★ 프레임마다 부르지 않는다(드래그 중 수십 번 발화한다).
       ★ 크기 0 이면 건너뛴다(접힌 패널에서 축 계산이 깨진다).
    */
    const src = read('../../../../src/chart-kline.jsx');
    expect(src).toContain('ResizeObserver');
    expect(src).toContain('requestAnimationFrame');
    const at = src.indexOf('new ResizeObserver');
    const seg = src.slice(at, at + 700);
    expect(seg, '크기 0 검사가 없다').toMatch(/width < 2|height < 2/);
    expect(seg, 'disconnect 를 하지 않는다').toBeTruthy();
    expect(src).toContain('ro.disconnect()');
  });
});

describe('수평선 가격 입력', () => {
  const kline = read('../../../../src/chart-kline.jsx');
  const actions = read('../../../../src/chart-actions.js');

  it('그리기 도구로 만든 선이 클릭 이벤트를 올려보낸다', () => {
    /*
       ★★ 그 선은 chart-actions.js 가 KLineChart 에 직접 만들기 때문에 컴포넌트의
         오버레이 목록에 없다. 그래서 이벤트로 연결한다.
       ★ chart-actions 는 DOM 을 만들지 않는다 — KLineChart API 를 감싸는 곳이다.
    */
    expect(actions).toContain("'qt:hline-click'");
    const at = actions.indexOf("'qt:hline-click'");
    const seg = actions.slice(Math.max(0, at - 600), at + 300);
    expect(seg, '수평선만 대상이어야 한다').toContain('horizontalStraightLine');
  });

  it('화면이 그 이벤트를 받아 편집창을 띄운다', () => {
    expect(kline).toContain("addEventListener('qt:hline-click'");
    expect(kline).toContain("removeEventListener('qt:hline-click'");
    expect(kline).toContain('chart-price-edit');
  });

  it('★ 잘못된 값을 저장하지 않고 창도 닫지 않는다', () => {
    /*
       ★ 창을 닫으면 무엇이 잘못됐는지 알 수 없고, 고객은 "적용을 눌렀는데 아무 일도
         없다" 로 겪는다. 0 이하면 선이 축 밖으로 나가 사라진 것처럼 보인다.
    */
    const at = kline.indexOf('const applyPriceEdit');
    expect(at).toBeGreaterThan(-1);
    const seg = kline.slice(at, at + 2200);
    expect(seg, '숫자 검사가 없다').toContain('Number.isFinite');
    expect(seg, '0 이하를 막지 않는다').toMatch(/n <= 0/);
    expect(seg, '실패 시 창을 닫는다').toContain('return cur;');
    expect(seg, '오류를 보여주지 않는다').toContain('setPriceEditError');
  });

  it('쉼표를 허용한다 (68,400 붙여넣기)', () => {
    const at = kline.indexOf('const applyPriceEdit');
    const seg = kline.slice(at, at + 2200);
    expect(seg).toMatch(/replace\(\/,\/g, ''\)/);
  });

  it('잠긴 선은 값을 바꾸지 못한다', () => {
    /*
       ★ 잠금은 "실수로 건드리지 않겠다" 는 뜻이다. 숫자 입력으로 우회할 수 있으면
         잠금이 무의미해진다.
    */
    const at = kline.indexOf('const applyPriceEdit');
    const seg = kline.slice(at, at + 2200);
    expect(seg).toMatch(/cur\.locked/);
  });

  it('두 경로를 구분한다 — 상위 상태 vs KLineChart 직접', () => {
    /*
       ★★ 섞으면 한쪽이 조용히 되돌아간다. 우리 상태의 오버레이를 KLineChart 에서
         직접 고치면 다음 렌더에 상위 값으로 덮인다.
    */
    const at = kline.indexOf('const applyPriceEdit');
    const seg = kline.slice(at, at + 2200);
    expect(seg).toContain('onOverlayChange');
    expect(seg).toContain('overrideOverlay');
  });

  it('문구가 3개 언어에 있다', () => {
    for (const loc of ['en', 'ja', 'zh']) {
      const dict = read(`../../../../src/locales/${loc}.js`);
      for (const key of ['chart_hline_price', 'chart_hline_locked', 'chart_hline_bad']) {
        expect(dict, `${loc} 사전에 ${key} 가 없다`).toContain(key);
      }
    }
  });
});
