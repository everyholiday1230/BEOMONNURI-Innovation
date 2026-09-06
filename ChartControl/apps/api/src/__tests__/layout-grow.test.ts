import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   패널을 넓히면 이웃이 차례로 줄어든다 (자동 재배치가 아니다).

   ★★ 왜 이 검사가 필요한가

     기본 배치는 24열을 빈틈 없이 채운다. 그래서 어떤 창을 넓히든 이웃과 겹치고,
     "겹치면 되돌린다" 만 있으면 확대가 **영구히 불가능**했다(실측: 8개 손잡이
     전부 256→256 변화 없음).

     바로 옆 이웃만 줄이면 최대 1열이 한계였다(측정: 기본 배치의 여유 0~1열).
     그래서 한 줄의 이웃을 차례로 줄인다. 위치를 다른 줄로 옮기지는 않는다 —
     이용자가 자동 재배치를 원하지 않는다고 명시했다.

   ★★ 이 계산을 여러 번 틀렸다. 그래서 결과를 **전수 검증**한다.

     양보량 공식, 최소폭 보정, 좌표계 혼용까지 네 가지 결함을 실측으로 겪었다.
     지금 구현은 만든 배치를 마지막에 검사하고(겹침·최소 크기·경계) 어긋나면 그
     확대량을 버린다. 추론이 틀려도 잘못된 배치가 나가지 않는다.
*/

type W = { id: string; type?: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number; hidden?: boolean };

/** layout-engine 에서 순수 계산부만 뽑아 실행한다. */
function loadEngine() {
  const src = read('src/layout-engine.jsx');
  const grab = (name: string) => {
    const i = src.indexOf(`function ${name}(`);
    if (i < 0) throw new Error(`${name} 을 찾지 못했다`);
    /* 중괄호 균형으로 함수 끝을 찾는다. */
    let depth = 0; let started = false; let j = i;
    for (; j < src.length; j += 1) {
      const c = src[j];
      if (c === '{') { depth += 1; started = true; }
      else if (c === '}') { depth -= 1; if (started && depth === 0) { j += 1; break; } }
    }
    return src.slice(i, j);
  };
  const metaI = src.indexOf('const DEFAULT_WIDGET_META');
  const metaJ = src.indexOf('\n  };', metaI);
  const meta = src.slice(metaI, metaJ + 4)
    .replace(/name: t\([^)]*\)/g, "name:'x'")
    .replace(/name: '[^']*'/g, "name:'x'");
  const body = [
    meta,
    grab('overlaps'),
    grab('spansAxis'),
    grab('minWOf'),
    grab('minHOf'),
    grab('buildGrowth'),
    grab('resolveGrowth'),
    'return { resolveGrowth, buildGrowth, minWOf, minHOf, DEFAULT_WIDGET_META };',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(body)() as {
    resolveGrowth: (before: W, others: W[], dir: string, want: number, cols?: number) => { target: W; others: W[] };
    DEFAULT_WIDGET_META: Record<string, { minW: number; minH: number }>;
  };
}

function presets(): Record<string, { widgets: W[] }> {
  const md = read('src/mock-data.js');
  const i = md.indexOf('const LAYOUT_PRESETS');
  const j = md.indexOf('\n  };', i);
  const body = md.slice(i, j + 4).replace('const LAYOUT_PRESETS', 'var LAYOUT_PRESETS');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn LAYOUT_PRESETS;`)();
}

const ov = (a: W, b: W) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

describe('LAYOUT-GROW — 넓히면 이웃이 줄어든다', () => {
  const E = loadEngine();
  const P = presets();

  it('[1] 계산부를 실제로 불러왔다 — 측정이 되는지 먼저 본다', () => {
    /* ★★ 추출이 실패하면 아래 검사가 "검사할 것이 없어서" 통과한다. */
    expect(typeof E.resolveGrowth).toBe('function');
    expect(Object.keys(E.DEFAULT_WIDGET_META).length).toBeGreaterThan(5);
    expect(Object.keys(P).length).toBeGreaterThan(3);
  });

  it('[2] 모든 프리셋·모든 위젯·네 방향에서 겹침이 생기지 않는다', () => {
    const bad: string[] = [];
    let cases = 0;
    for (const [name, p] of Object.entries(P)) {
      const ws = (p.widgets || []).filter((w) => !w.hidden);
      for (const w of ws) {
        for (const dir of ['e', 'w', 's', 'n']) {
          const others = ws.filter((o) => o.id !== w.id).map((o) => ({ ...o }));
          const r = E.resolveGrowth({ ...w }, others, dir, 4);
          const all = [r.target, ...r.others];
          cases += 1;
          for (let i = 0; i < all.length; i += 1) {
            for (let j = i + 1; j < all.length; j += 1) {
              if (ov(all[i]!, all[j]!)) bad.push(`${name}/${w.id} ${dir}: ${all[i]!.id}↔${all[j]!.id}`);
            }
          }
          if (all.some((x) => x.x < 0 || x.y < 0 || x.x + x.w > 24)) bad.push(`${name}/${w.id} ${dir}: 경계 초과`);
        }
      }
    }
    expect(cases).toBeGreaterThan(100);   // ★ 시나리오가 실제로 돌았는지
    expect(bad, `겹침/경계 위반:\n${bad.slice(0, 10).join('\n')}`).toEqual([]);
  });

  it('[3] 넓히려는 위젯이 대신 작아지는 일은 없다', () => {
    /*
       ★★ 실제로 겪은 결함이다. 양보량 공식이 음수가 되어 넓히려는 창이 4열에서
         3열로 줄었다. 넓히기를 요청했는데 좁아지는 것은 최악의 반응이다.
    */
    const bad: string[] = [];
    for (const [name, p] of Object.entries(P)) {
      const ws = (p.widgets || []).filter((w) => !w.hidden);
      for (const w of ws) {
        for (const dir of ['e', 'w', 's', 'n']) {
          const others = ws.filter((o) => o.id !== w.id).map((o) => ({ ...o }));
          const r = E.resolveGrowth({ ...w }, others, dir, 4);
          if (r.target.w < w.w || r.target.h < w.h) bad.push(`${name}/${w.id} ${dir}: ${w.w}x${w.h} → ${r.target.w}x${r.target.h}`);
        }
      }
    }
    expect(bad, `요청과 반대로 축소:\n${bad.join('\n')}`).toEqual([]);
  });

  it('[4] 이웃을 최소 크기 아래로 줄이지 않는다', () => {
    const bad: string[] = [];
    for (const [name, p] of Object.entries(P)) {
      const ws = (p.widgets || []).filter((w) => !w.hidden);
      for (const w of ws) {
        for (const dir of ['e', 'w', 's', 'n']) {
          const others = ws.filter((o) => o.id !== w.id).map((o) => ({ ...o }));
          const r = E.resolveGrowth({ ...w }, others, dir, 4);
          for (const o of r.others) {
            const m = E.DEFAULT_WIDGET_META[String(o.type)];
            const minW = o.minW || (m && m.minW) || 3;
            const minH = o.minH || (m && m.minH) || 3;
            if (o.w < minW || o.h < minH) bad.push(`${name}/${w.id} ${dir}: ${o.id} ${o.w}x${o.h} < ${minW}x${minH}`);
          }
        }
      }
    }
    expect(bad, `이웃이 최소 크기 미달:\n${bad.slice(0, 10).join('\n')}`).toEqual([]);
  });

  it('[5] 실제로 넓어지는 경우가 있다 — 항상 0 을 돌려주면 통과해버린다', () => {
    /*
       ★★ 위 검사들은 "아무것도 하지 않는" 구현으로도 전부 통과한다.
         되돌리기만 하던 이전 상태가 정확히 그랬다. 그래서 확대가 실제로
         일어나는지 따로 센다.
    */
    let grown = 0;
    let maxGain = 0;
    for (const p of Object.values(P)) {
      const ws = (p.widgets || []).filter((w) => !w.hidden);
      for (const w of ws) {
        for (const dir of ['e', 'w', 's', 'n']) {
          const others = ws.filter((o) => o.id !== w.id).map((o) => ({ ...o }));
          const r = E.resolveGrowth({ ...w }, others, dir, 4);
          const gain = Math.max(r.target.w - w.w, r.target.h - w.h);
          if (gain > 0) grown += 1;
          if (gain > maxGain) maxGain = gain;
        }
      }
    }
    expect(grown).toBeGreaterThan(20);
    /* ★ 연쇄가 동작하는지: 이웃 하나만 줄이면 1열이 한계였다. */
    expect(maxGain, '연쇄 축소가 동작하지 않는다(2열 이상 확대가 없다)').toBeGreaterThanOrEqual(2);
  });

  it('[6] 접힘 변환이 겹침을 만들지 않는다', () => {
    /*
       ★★ panel-state 의 applyTo 는 그리기 직전에 기하를 바꾼다(접힌 패널의 폭을
         왼쪽 이웃에게 넘긴다). 겹침 검사가 없어서, 넘긴 결과가 다른 위젯 위로
         겹쳐 그려질 수 있었다. 그리고 '정확히 맞닿음' 만 이웃으로 인정해서
         크기 조절로 한 열이라도 틈이 생기면 변환이 사라지고 화면이 튀었다.
    */
    const ps = read('src/panel-state.js');
    expect(ps, 'applyTo 에 겹침 검사가 없다').toMatch(/collide/);
    expect(ps, "'정확히 맞닿음' 조건이 남아 있다").not.toMatch(/const touchesLeft = other\.x \+ other\.w === target\.x/);
    /* ★ 되돌리기가 있어야 검사가 의미를 가진다. */
    expect(ps).toMatch(/if \(collide\)/);
  });
});
