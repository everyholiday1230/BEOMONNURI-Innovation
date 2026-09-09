/**
 * 레이아웃 프리셋 — **빈칸·겹침이 0인지** 고정한다.
 *
 * ★★ 왜 이 테스트가 필요한가
 *
 *   좌표를 손으로 고치면 눈으로는 빈칸과 겹침을 잡을 수 없다. 실제로 `ai-workspace`
 *   에서 코파일럿을 접으면 **빈칸 25칸**이 생겼는데(채움 87%, 다른 프리셋은 93~94%)
 *   좌표만 보면 문제가 없어 보였다 — 접힘 변환이 렌더 시점에 폭을 다시 쓰기 때문이다.
 *
 *   그래서 두 상태를 모두 검사한다: **펼침**과 **접힘**.
 *
 * ★ 접힘 변환은 `src/panel-state.js` 의 `applyTo` 와 **같은 규칙**으로 재현한다.
 *   여기서 규칙을 다시 쓰면 테스트는 통과하는데 화면은 깨진 상태가 될 수 있다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const COLS = 48;
const ROWS = 16;
/** panel-state.js 의 COLLAPSED_W 와 같아야 한다. */
const COLLAPSED_W = 2;

interface W { id: string; type: string; x: number; y: number; w: number; h: number }

/** mock-data.js 에서 프리셋을 읽는다 — 소스가 단일 진상이다. */
function readPresets(): Record<string, W[]> {
  const src = readFileSync(new URL('../../../../src/mock-data.js', import.meta.url), 'utf-8');
  const start = src.indexOf('const LAYOUT_PRESETS = {');
  expect(start, 'LAYOUT_PRESETS 를 찾지 못했다').toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf('\n  };', start));

  const out: Record<string, W[]> = {};
  const nameRe = /\n {4}'([a-z-]+)': \{/g;
  const marks: Array<[string, number]> = [];
  for (let m = nameRe.exec(block); m; m = nameRe.exec(block)) marks.push([m[1]!, m.index + m[0].length]);

  marks.forEach(([name, from], i) => {
    const to = i + 1 < marks.length ? marks[i + 1]![1] : block.length;
    const body = block.slice(from, to);
    const ws: W[] = [];
    const wRe = /\{\s*id:\s*'([a-zA-Z0-9-]+)',\s*type:\s*'([a-zA-Z]+)',\s*x:\s*(\d+),\s*y:\s*(\d+),\s*w:\s*(\d+),\s*h:\s*(\d+)/g;
    for (let m = wRe.exec(body); m; m = wRe.exec(body)) {
      ws.push({ id: m[1]!, type: m[2]!, x: +m[3]!, y: +m[4]!, w: +m[5]!, h: +m[6]! });
    }
    out[name] = ws;
  });
  return out;
}

/** 격자를 채워 빈칸·겹침을 센다. */
function audit(ws: W[]) {
  const grid: string[][][] = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => [] as string[]));
  for (const p of ws) {
    for (let r = p.y; r < Math.min(p.y + p.h, ROWS); r += 1) {
      for (let c = p.x; c < Math.min(p.x + p.w, COLS); c += 1) grid[r]![c]!.push(p.id);
    }
  }
  const empty: string[] = [];
  const over: string[] = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const cell = grid[r]![c]!;
      if (cell.length === 0) empty.push(`r${r}c${c}`);
      if (cell.length > 1) over.push(`r${r}c${c}:${cell.join('+')}`);
    }
  }
  return { empty, over };
}

/**
 * `panel-state.js applyTo` 와 같은 접힘 변환.
 *
 * ★ 같은 거리의 왼쪽 이웃들이 접힌 패널의 행 범위를 **빈틈없이 덮으면 전부** 넓힌다.
 *   하나만 넓히면 나머지 행에 빈칸이 남는다 — 그것이 ai-workspace 의 버그였다.
 */
function collapse(ws: W[], id: string): W[] {
  const out = ws.map((w) => ({ ...w }));
  const t = out.find((w) => w.id === id);
  if (!t) return out;
  const freed = t.w - COLLAPSED_W;
  if (freed <= 0) return out;

  let bestGap = Infinity;
  let bestOverlap = 0;
  let best: W | null = null;
  for (const o of out) {
    if (o === t) continue;
    const right = o.x + o.w;
    if (right > t.x) continue;
    const ov = Math.min(o.y + o.h, t.y + t.h) - Math.max(o.y, t.y);
    if (ov <= 0) continue;
    const gap = t.x - right;
    if (gap < bestGap || (gap === bestGap && ov > bestOverlap)) { best = o; bestGap = gap; bestOverlap = ov; }
  }
  if (!best) return out;

  const sameGap = out.filter((o) => o !== t
    && t.x - (o.x + o.w) === bestGap
    && Math.min(o.y + o.h, t.y + t.h) - Math.max(o.y, t.y) > 0);

  const rows = sameGap
    .map((o) => [Math.max(o.y, t.y), Math.min(o.y + o.h, t.y + t.h)] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let edge = t.y;
  let covered = true;
  for (const [a, b] of rows) {
    if (a > edge) { covered = false; break; }
    edge = Math.max(edge, b);
  }
  if (covered && edge < t.y + t.h) covered = false;

  const grow = covered ? sameGap : [best];
  for (const g of grow) g.w += freed;
  t.x += freed;
  t.w = COLLAPSED_W;
  return out;
}

const presets = readPresets();

describe('레이아웃 프리셋', () => {
  it('프리셋은 정확히 4개다', () => {
    /*
       ★ 예전에는 8개였다. dual-chart·multi-chart 는 miniChart 로 같은 심볼을 여러 번
         그려 쓸모가 적었고, beginner·risk 는 다른 프리셋의 부분집합이었다.
         선택지가 많은 것보다 각각이 분명한 것이 낫다.
    */
    expect(Object.keys(presets).sort()).toEqual(
      ['ai-workspace', 'chart-focus', 'scalper', 'standard-trader'],
    );
  });

  it('삭제한 프리셋이 되살아나지 않는다', () => {
    for (const gone of ['dual-chart', 'multi-chart', 'beginner', 'risk']) {
      expect(presets[gone], `${gone} 가 되살아났다`).toBeUndefined();
    }
  });

  for (const [name, ws] of Object.entries(presets)) {
    it(`${name} — 펼침 상태에서 24×16 을 빈칸·겹침 없이 덮는다`, () => {
      expect(ws.length, '위젯이 없다').toBeGreaterThan(0);
      const { empty, over } = audit(ws);
      expect(over, `겹침: ${over.slice(0, 5).join(', ')}`).toEqual([]);
      expect(empty, `빈칸 ${empty.length}칸: ${empty.slice(0, 8).join(', ')}`).toEqual([]);
    });

    const ai = ws.find((w) => w.type === 'aiCopilot');
    if (ai) {
      it(`${name} — 코파일럿을 접어도 빈칸이 생기지 않는다`, () => {
        /*
           ★★ 이것이 실제 버그였다. 좌표만 보면 문제가 없는데, 접히면 폭이 1칸으로
             줄고 남은 폭을 왼쪽 이웃이 받는다. 그 이웃이 행 범위를 다 덮지 못하면
             빈칸이 남는다 — ai-workspace 에서 25칸이 생겼다.
        */
        const { empty, over } = audit(collapse(ws, ai.id));
        expect(over, `접힘 겹침: ${over.slice(0, 5).join(', ')}`).toEqual([]);
        expect(empty, `접힘 빈칸 ${empty.length}칸: ${empty.slice(0, 8).join(', ')}`).toEqual([]);
      });
    }
  }

  it('모든 패널이 최소 크기보다 크다', () => {
    /*
       ★ 딱 최소값이면 줄일 수 없고, 최소값보다 작으면 크기 조절 계산이 음수가 되어
         옆 창을 넓히려 할 때 오히려 줄어든다(실제로 겪은 버그다).
    */
    const engine = readFileSync(new URL('../../../../src/layout-engine.jsx', import.meta.url), 'utf-8');
    const mins: Record<string, [number, number]> = {};
    const re = /(\w+):\s*\{\s*minW:\s*(\d+),\s*minH:\s*(\d+)/g;
    for (let m = re.exec(engine); m; m = re.exec(engine)) mins[m[1]!] = [+m[2]!, +m[3]!];
    expect(Object.keys(mins).length, 'minW 표를 읽지 못했다').toBeGreaterThan(4);

    for (const [name, ws] of Object.entries(presets)) {
      for (const p of ws) {
        const min = mins[p.type];
        if (!min) continue;
        expect(p.w, `${name}/${p.id} 폭 ${p.w} < 최소 ${min[0]}`).toBeGreaterThanOrEqual(min[0]);
        expect(p.h, `${name}/${p.id} 높이 ${p.h} < 최소 ${min[1]}`).toBeGreaterThanOrEqual(min[1]);
      }
    }
  });

  it('삭제한 프리셋 별칭이 존재하는 프리셋을 가리킨다', () => {
    /*
       ★ 별칭이 없는 프리셋을 가리키면 옛 링크가 빈 배치를 열어 화면이 깨진다.
    */
    const app = readFileSync(new URL('../../../../src/app.jsx', import.meta.url), 'utf-8');
    const at = app.indexOf('QUERY_PRESET_ALIAS = {');
    expect(at).toBeGreaterThan(-1);
    const block = app.slice(at, app.indexOf('}', at));
    const re = /'([a-z-]+)'/g;
    for (let m = re.exec(block); m; m = re.exec(block)) {
      expect(presets[m[1]!], `별칭이 없는 프리셋 '${m[1]}' 을 가리킨다`).toBeDefined();
    }
  });
});
