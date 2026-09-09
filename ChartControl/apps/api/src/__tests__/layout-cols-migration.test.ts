/**
 * 저장된 레이아웃 열 수 환산 — **기존 고객 화면이 절반만 차는 것**을 막는다.
 *
 * ★★ 무엇이 문제였나
 *
 *   격자를 24 → 48 열로 올렸다(크기 조절이 71px 단위로 뚝뚝 끊겨서). 그런데 이용자가
 *   손으로 맞춘 배치는 `localStorage['qt.layout']` 에 **24열 좌표로** 저장돼 있다.
 *   그것을 48열 격자에 그대로 그리면 모든 패널이 절반 폭이 되고 오른쪽 절반이 빈다.
 *
 *   실측으로 확인했다(프로덕션, 실제 브라우저):
 *     · 48열 저장본 → `grid-column: 9 / span 30`, 채움 **91%**
 *     · 24열 저장본 → `grid-column: 5 / span 15`, 채움 **46%**  ← 절반이 빈다
 *
 * ★ 이 검증에서 방법론 실수도 있었다. 처음에는 `p.goto('…/#/trade')` 로 확인했는데
 *   해시만 바뀌면 **같은 문서**라 앱이 재실행되지 않는다. 그래서 저장본이 무시되는
 *   것처럼 보였다. `reload()` 로 바꾸자 실제 동작이 드러났다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../../../src/layout-engine.jsx', import.meta.url), 'utf-8');

/** layout-engine.jsx 의 환산 함수를 소스에서 떼어내 실행한다. */
function loadMigrate() {
  const i = src.indexOf('function migrateLayoutCols(');
  expect(i, 'migrateLayoutCols 를 찾지 못했다').toBeGreaterThan(-1);
  const end = '\n  }\n';
  const body = src.slice(i, src.indexOf(end, i) + end.length);
  const colsLine = src.slice(src.indexOf('const GRID_COLS'), src.indexOf('\n', src.indexOf('const GRID_COLS')));
  // eslint-disable-next-line no-new-func
  return new Function(`${colsLine}\n${body}\nreturn migrateLayoutCols;`)() as
    (l: unknown) => { cols: number; widgets: Array<{ id: string; x: number; w: number; minW?: number }> };
}

const migrate = loadMigrate();

/** 예전 24열 저장본(standard-trader 를 손으로 조절한 모습). */
const OLD_24 = {
  id: 'standard-trader',
  cols: 24,
  widgets: [
    { id: 'market', type: 'marketWatch', x: 0, y: 0, w: 4, h: 16, minW: 3, minH: 6 },
    { id: 'chart', type: 'chart', x: 4, y: 0, w: 7, h: 11, minW: 6, minH: 6 },
    { id: 'positions', type: 'positions', x: 4, y: 11, w: 13, h: 5, minW: 8, minH: 3 },
    { id: 'ai', type: 'aiCopilot', x: 11, y: 0, w: 6, h: 11, minW: 5, minH: 10 },
    { id: 'orderbook', type: 'orderBook', x: 17, y: 0, w: 3, h: 11, minW: 3, minH: 6 },
    { id: 'trades', type: 'recentTrades', x: 17, y: 11, w: 3, h: 5, minW: 3, minH: 3 },
    { id: 'orderEntry', type: 'orderEntry', x: 20, y: 0, w: 4, h: 11, minW: 3, minH: 8 },
    { id: 'assets', type: 'assetsRisk', x: 20, y: 11, w: 4, h: 5, minW: 3, minH: 3 },
  ],
};

describe('저장 레이아웃 열 수 환산', () => {
  it('24열 저장본을 48열로 환산한다', () => {
    const out = migrate(OLD_24);
    expect(out.cols).toBe(96);
    const by = (id: string) => out.widgets.find((w) => w.id === id)!;
    expect(by('market').w).toBe(16);
    expect(by('chart').x).toBe(16);
    expect(by('chart').w).toBe(28);
    expect(by('orderEntry').x).toBe(80);
    expect(by('assets').w).toBe(16);
  });

  it('★ 환산 후 오른쪽 끝까지 채운다 (절반만 차지 않는다)', () => {
    const out = migrate(OLD_24);
    const right = Math.max(...out.widgets.map((w) => w.x + w.w));
    expect(right, `오른쪽 끝이 ${right} 이다 — 48 이어야 화면을 꽉 채운다`).toBe(96);
  });

  it('minW 도 함께 환산한다', () => {
    /*
       ★ minW 를 그대로 두면 최소폭이 절반이 되어, 패널을 원래보다 훨씬 좁게 줄일 수
         있게 된다(주문 패널이 읽을 수 없을 만큼 좁아진다).
    */
    const out = migrate(OLD_24);
    expect(out.widgets.find((w) => w.id === 'chart')!.minW).toBe(24);
    expect(out.widgets.find((w) => w.id === 'ai')!.minW).toBe(20);
  });

  it('이미 48열이면 그대로 둔다 (반올림 누적 방지)', () => {
    const already = { id: 'x', cols: 96, widgets: [{ id: 'a', x: 3, y: 0, w: 7, h: 5, minW: 5 }] };
    const out = migrate(already);
    expect(out).toBe(already as unknown as typeof out);
  });

  it('cols 가 없는 아주 예전 저장본은 24열로 본다', () => {
    /* 48열 도입 전에는 전부 24열이었다. cols 가 없다고 손대지 않으면 절반만 찬다. */
    const noCols = { id: 'x', widgets: [{ id: 'a', x: 0, y: 0, w: 24, h: 16 }] };
    const out = migrate(noCols);
    expect(out.cols).toBe(96);
    expect(out.widgets[0]!.w).toBe(96);
  });

  it('격자 밖으로 나가지 않는다', () => {
    /*
       ★ 반올림으로 1칸 넘칠 수 있다. 넘치면 CSS 격자가 열을 새로 만들어 배치가
         무너진다 — 잘라내는 편이 안전하다.
    */
    const edge = { id: 'x', cols: 24, widgets: [{ id: 'a', x: 23, y: 0, w: 2, h: 5 }] };
    const out = migrate(edge);
    for (const w of out.widgets) {
      expect(w.x + w.w, `${w.id} 가 격자를 넘는다`).toBeLessThanOrEqual(96);
      expect(w.x).toBeGreaterThanOrEqual(0);
      expect(w.w).toBeGreaterThanOrEqual(1);
    }
  });

  it('깨진 값에도 죽지 않는다', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate({ cols: 24 })).toEqual({ cols: 24 });
  });

  it('읽는 즉시 다시 저장한다 (매번 환산하지 않게)', () => {
    /* 저장하지 않으면 매 부팅마다 환산하고, 반올림이 누적될 위험이 있다. */
    const at = src.indexOf('const saved = localStorage.getItem(\'qt.layout\')');
    expect(at).toBeGreaterThan(-1);
    const seg = src.slice(at, at + 900);
    expect(seg).toContain('migrateLayoutCols');
    expect(seg).toContain("localStorage.setItem('qt.layout'");
  });

  it('GRID_COLS 가 CSS 와 프리셋과 같다', () => {
    /*
       ★★ 세 곳이 어긋나면 배치가 무너진다. 한 곳만 고치는 실수를 막는다.
    */
    expect(src).toMatch(/const GRID_COLS = 96;/);
    const css = readFileSync(new URL('../../../../src/widgets.css', import.meta.url), 'utf-8');
    expect(css).toContain('grid-template-columns: repeat(96, 1fr)');
    const mock = readFileSync(new URL('../../../../src/mock-data.js', import.meta.url), 'utf-8');
    expect((mock.match(/cols: 96,/g) ?? []).length, '프리셋 cols 가 48 이 아니다').toBeGreaterThanOrEqual(4);
  });
});
