/**
 * 패널 크기 조절 — **네 방향 모두 동작하고 겹치지 않는지** 고정한다.
 *
 * ★★ 무엇이 문제였나
 *
 *   손잡이 8개(변 4 + 모서리 4)가 다 있는데 **위쪽(n)이 동작하지 않았다.** 원인은
 *   두 가지였고 둘 다 세로 방향에만 있었다:
 *
 *     1. 경계를 공유하는 이웃을 **순서대로 하나씩** 줄였다. 가로(e/w)는 한 줄에
 *        이웃이 하나씩 늘어서 있어 맞지만, 세로(n/s)는 **여러 열이 같은 y 경계를
 *        공유**한다. 하나만 줄이면 나머지가 대상과 겹쳐 전수 검증이 결과를 버렸다
 *        — 즉 아무 일도 일어나지 않았다.
 *
 *     2. 재배치를 하나의 커서로 훑었다. 세로 `line` 에는 서로 다른 열의 이웃이
 *        함께 들어오는데, 한 커서로 쌓으면 두 번째가 첫 번째 아래로 밀려
 *        **y 가 음수까지 갔다**(실측: ai 의 y 가 -10).
 *
 * ★ 이 테스트는 `layout-engine.jsx` 의 함수를 **소스에서 떼어내 그대로 실행한다.**
 *   로직을 다시 쓰면 테스트는 통과하는데 화면은 깨진 상태가 될 수 있다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

interface W { id: string; type: string; x: number; y: number; w: number; h: number }
type Growth = (before: W, others: W[], dir: string, k: number, cols: number)
  => { target: W; others: W[] } | null;

/** layout-engine.jsx 에서 계산 함수만 떼어내 실행 가능한 형태로 만든다. */
function loadEngine(): { buildGrowth: Growth; resolveGrowth: Growth } {
  const src = readFileSync(new URL('../../../../src/layout-engine.jsx', import.meta.url), 'utf-8');
  const grab = (name: string) => {
    const i = src.indexOf(`function ${name}(`);
    expect(i, `${name} 을 찾지 못했다`).toBeGreaterThan(-1);
    const end = '\n  }\n';
    const j = src.indexOf(end, i);
    return src.slice(i, j + end.length);
  };
  const metaStart = src.indexOf('const DEFAULT_WIDGET_META');
  const meta = src.slice(metaStart, src.indexOf('};', metaStart) + 2).replace('const ', 'var ');
  // eslint-disable-next-line no-new-func
  return new Function(`
    var t = function (k) { return k; };
    ${meta}
    ${grab('overlaps')}
    ${grab('minWOf')}
    ${grab('minHOf')}
    ${grab('spansAxis')}
    ${grab('buildGrowth')}
    ${grab('resolveGrowth')}
    return { buildGrowth: buildGrowth, resolveGrowth: resolveGrowth };
  `)() as { buildGrowth: Growth; resolveGrowth: Growth };
}

const { resolveGrowth } = loadEngine();

/** standard-trader 기본 배치. 24×16 을 빈틈없이 채운다. */
const BASE: W[] = [
  { id: 'market', type: 'marketWatch', x: 0, y: 0, w: 4, h: 16 },
  { id: 'chart', type: 'chart', x: 4, y: 0, w: 7, h: 11 },
  { id: 'positions', type: 'positions', x: 4, y: 11, w: 13, h: 5 },
  { id: 'ai', type: 'aiCopilot', x: 11, y: 0, w: 6, h: 11 },
  { id: 'orderbook', type: 'orderBook', x: 17, y: 0, w: 3, h: 11 },
  { id: 'trades', type: 'recentTrades', x: 17, y: 11, w: 3, h: 5 },
  { id: 'orderEntry', type: 'orderEntry', x: 20, y: 0, w: 4, h: 11 },
  { id: 'assets', type: 'assetsRisk', x: 20, y: 11, w: 4, h: 5 },
];

function grow(id: string, dir: string, want = 1) {
  const before = BASE.find((w) => w.id === id)!;
  const others = BASE.filter((w) => w.id !== id).map((w) => ({ ...w }));
  const r = resolveGrowth({ ...before }, others, dir, want, 24);
  return { before, after: r!.target, all: [r!.target, ...r!.others] };
}

/** 겹침·경계·음수 좌표를 모두 본다. */
function invariants(all: W[]) {
  const bad: string[] = [];
  for (const w of all) {
    if (w.x < 0 || w.y < 0) bad.push(`${w.id} 음수 좌표 x${w.x} y${w.y}`);
    if (w.x + w.w > 24) bad.push(`${w.id} 오른쪽 경계 초과`);
    if (w.w < 1 || w.h < 1) bad.push(`${w.id} 크기 0`);
  }
  for (let i = 0; i < all.length; i += 1) {
    for (let j = i + 1; j < all.length; j += 1) {
      const a = all[i]!; const b = all[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        bad.push(`겹침 ${a.id}↔${b.id}`);
      }
    }
  }
  return bad;
}

describe('패널 크기 조절 — 네 방향', () => {
  const cases: Array<[string, string, 'w' | 'h']> = [
    ['chart', 'e', 'w'],
    ['chart', 'w', 'w'],
    ['chart', 's', 'h'],
    ['positions', 'n', 'h'],
    ['trades', 'n', 'h'],
    ['assets', 'n', 'h'],
    ['market', 'e', 'w'],
  ];

  /*
     ★ orderEntry 를 w 로 넓히는 것은 **정상적으로 불가능하다.** 왼쪽에 맞닿은
       orderBook 이 이미 최소폭(3)이라 내줄 여유가 0 이다. 이것은 버그가 아니라
       제약이므로, "넓혀진다" 를 요구하지 않고 **겹치지 않는지만** 확인한다.
       (여유가 없을 때 억지로 밀어내면 그게 사고다)
  */

  for (const [id, dir, axis] of cases) {
    it(`${id} 을 ${dir} 방향으로 넓힐 수 있다`, () => {
      const { before, after, all } = grow(id, dir);
      expect(after[axis], `${id} ${dir}: ${axis} 가 늘어나지 않았다 (${before[axis]} → ${after[axis]})`)
        .toBeGreaterThan(before[axis]);
      expect(invariants(all)).toEqual([]);
    });
  }

  it('★ positions 를 위로 넓힐 때 이웃 둘이 함께 줄어든다', () => {
    /*
       위쪽에 chart(여유5)와 ai(여유1)가 **같은 y11 경계**를 공유한다. 하나만 줄이면
       나머지가 겹쳐 결과가 버려진다 — 그래서 위쪽 조절이 전혀 되지 않았다.
    */
    const { all } = grow('positions', 'n');
    const chart = all.find((w) => w.id === 'chart')!;
    const ai = all.find((w) => w.id === 'ai')!;
    expect(chart.h, 'chart 가 줄지 않았다').toBe(10);
    expect(ai.h, 'ai 가 줄지 않았다').toBe(10);
    expect(invariants(all)).toEqual([]);
  });

  it('★ 세로 조절이 이웃을 음수 좌표로 밀어내지 않는다', () => {
    /*
       예전에는 세로 `line` 을 하나의 커서로 훑어, 다른 열의 이웃이 위로 밀려
       y 가 -10 까지 갔다. 음수 좌표는 화면 밖이라 패널이 사라진 것처럼 보인다.
    */
    for (const id of ['positions', 'trades', 'assets']) {
      const { all } = grow(id, 'n');
      for (const w of all) {
        expect(w.y, `${id} n → ${w.id} 의 y 가 음수다`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('여유가 없는 방향은 배치를 바꾸지 않는다 — orderEntry 왼쪽', () => {
    /*
       왼쪽 orderBook 이 이미 최소폭 3 이다. 넓힐 수 없는 것이 맞고, 그때 겹치거나
       음수 좌표가 나오면 안 된다.
    */
    const before = BASE.find((w) => w.id === 'orderEntry')!;
    const others = BASE.filter((w) => w.id !== 'orderEntry').map((w) => ({ ...w }));
    const r = resolveGrowth({ ...before }, others, 'w', 1, 24)!;
    expect(r.target.w).toBe(before.w);
    expect(invariants([r.target, ...r.others])).toEqual([]);
  });

  it('여유가 없으면 배치를 바꾸지 않는다 (억지로 겹치지 않는다)', () => {
    /*
       ai 는 최소 높이 10 이고 지금 11 이다. 2행을 요구하면 성립할 수 없으므로
       1행으로 줄여 적용하거나 그대로 둔다 — 어느 쪽이든 겹치면 안 된다.
    */
    const before = BASE.find((w) => w.id === 'positions')!;
    const others = BASE.filter((w) => w.id !== 'positions').map((w) => ({ ...w }));
    const r = resolveGrowth({ ...before }, others, 'n', 5, 24)!;
    expect(invariants([r.target, ...r.others])).toEqual([]);
  });

  it('대각선은 두 방향으로 나눠 처리한다', () => {
    /*
       ★ 손잡이는 'se' 처럼 두 글자를 보낸다. 호출부가 그것을 e·s 로 나눠 각각
         resolveGrowth 를 부른다 — buildGrowth 에 'se' 를 그대로 넘기면 어느
         분기에도 걸리지 않아 아무 일도 일어나지 않는다.
    */
    const src = readFileSync(new URL('../../../../src/layout-engine.jsx', import.meta.url), 'utf-8');
    expect(src).toMatch(/_dir\.includes\('e'\)/);
    expect(src).toMatch(/_dir\.includes\('s'\)/);
    expect(src).toMatch(/_dir\.includes\('n'\)/);
    expect(src).toMatch(/_dir\.includes\('w'\)/);
  });

  it('손잡이 8개(변 4 + 모서리 4)가 모두 렌더된다', () => {
    const src = readFileSync(new URL('../../../../src/layout-engine.jsx', import.meta.url), 'utf-8');
    for (const d of ['e', 's', 'w', 'n', 'se', 'sw', 'ne', 'nw']) {
      expect(src, `resize-handle--${d} 가 없다`).toContain(`resize-handle--${d}`);
    }
  });
});
