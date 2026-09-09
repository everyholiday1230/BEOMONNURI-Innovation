import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   레이아웃 프리셋이 스스로 모순되지 않는다.

   ★★ 왜 이 검사가 필요한가

     `standard-trader` 의 chart 는 **폭 6 인데 최소폭이 8** 이라고 선언돼 있었다.
     지켜지지 않는 최소값이다. 그 모순이 크기 조절 계산을 깨뜨렸다: 이웃이 내줄 수
     있는 여유를 `폭 - 최소폭` 으로 계산하면 음수가 나오고, 그러면 옆 창을 넓히려
     할 때 오히려 **줄어든다.** 실측으로 재현했다 — market 을 넓히자 4열에서 3열로
     줄었다.

     같은 값이 두 곳(프리셋, DEFAULT_WIDGET_META)에 따로 적혀 있어 서로 달라진
     경우도 있었다(marketWatch minH 8 vs 6, chart minW 8 vs 6). 기준이 갈리면
     어느 쪽을 믿어야 할지 알 수 없고, 계산하는 코드마다 다른 답을 낸다.

   ★ 배치를 바꾸지 않는 쪽으로 고쳤다. chart 를 8열로 넓히면 고객이 보던 기본
     화면이 달라진다. 지켜지지 않는 선언을 사실에 맞추는 것이 화면을 바꾸는 것보다
     안전하다.
*/

/** 프리셋 정의를 실행해 읽는다(브라우저 전역에 의존하지 않는 부분만). */
function presets(): Record<string, { widgets: Array<Record<string, number | string | boolean>> }> {
  const md = read('src/mock-data.js');
  const i = md.indexOf('const LAYOUT_PRESETS');
  const j = md.indexOf('\n  };', i);
  const body = md.slice(i, j + 4).replace('const LAYOUT_PRESETS', 'var LAYOUT_PRESETS');
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn LAYOUT_PRESETS;`)();
}

/** 위젯 기본 메타(최소 크기)를 읽는다. */
function meta(): Record<string, { minW: number; minH: number }> {
  const le = read('src/layout-engine.jsx');
  const i = le.indexOf('const DEFAULT_WIDGET_META');
  const j = le.indexOf('\n  };', i);
  const body = le.slice(i, j + 4)
    .replace('const DEFAULT_WIDGET_META', 'var M')
    /* ★ name 은 번역 함수를 부른다. 최소 크기만 필요하므로 문자열로 바꾼다. */
    .replace(/name: t\([^)]*\)/g, "name:'x'")
    .replace(/name: '[^']*'/g, "name:'x'");
  // eslint-disable-next-line no-new-func
  return new Function(`${body}\nreturn M;`)();
}

const overlaps = (a: Record<string, number>, b: Record<string, number>) =>
  !(a.x! + a.w! <= b.x! || b.x! + b.w! <= a.x! || a.y! + a.h! <= b.y! || b.y! + b.h! <= a.y!);

describe('LAYOUT-PRESETS — 프리셋이 스스로 모순되지 않는다', () => {
  const P = presets();
  const M = meta();

  it('[1] 프리셋을 읽어낸다 — 측정 자체가 되는지 먼저 본다', () => {
    /*
       ★★ 읽기가 실패해 빈 객체가 되면 아래 검사가 모두 "검사할 것이 없어서" 통과한다.
    */
    expect(Object.keys(P).length).toBeGreaterThan(3);
    expect(Object.keys(M).length).toBeGreaterThan(5);
  });

  it('[2] 어떤 위젯도 **유효** 최소 크기를 위반하지 않는다', () => {
    /*
       ★★ inline 선언만 보면 안 된다.

         처음엔 프리셋에 적힌 minW/minH 만 검사했다. 그래서 선언이 **없는** 위젯이
         메타의 최소값을 위반하는 경우를 놓쳤다 — dual-chart 의 주문 입력이 6 행인데
         최소는 8 행이었다(다른 프리셋은 모두 8 이상을 준다). 확대 계산 테스트가
         대신 잡아냈다.

       ★ 실제로 적용되는 값은 inline ?? 메타 ?? 3 이다. 그 값으로 검사한다.
    */
    const bad: string[] = [];
    for (const [name, p] of Object.entries(P)) {
      for (const w of p.widgets ?? []) {
        const ww = w as unknown as Record<string, number | string>;
        const m = M[String(ww.type)] || { minW: 3, minH: 3 };
        const minW = (ww.minW as number) || m.minW || 3;
        const minH = (ww.minH as number) || m.minH || 3;
        if ((ww.w as number) < minW) bad.push(`${name}/${ww.id}: w=${ww.w} < ${minW}`);
        if ((ww.h as number) < minH) bad.push(`${name}/${ww.id}: h=${ww.h} < ${minH}`);
      }
    }
    expect(bad, `최소 크기 위반:\n${bad.join('\n')}`).toEqual([]);
  });

  it('[3] 프리셋과 기본 메타의 최소 크기가 일치한다', () => {
    /*
       ★★ 같은 값이 두 곳에 적혀 있으면 반드시 갈린다. 갈리면 계산하는 코드마다
         다른 답을 낸다 — 실제로 그 상태였다.
    */
    const bad: string[] = [];
    for (const [name, p] of Object.entries(P)) {
      for (const w of p.widgets ?? []) {
        const ww = w as unknown as Record<string, number | string>;
        const m = M[String(ww.type)];
        if (!m) continue;
        if (ww.minW != null && ww.minW !== m.minW) bad.push(`${name}/${ww.id}: minW ${ww.minW} vs meta ${m.minW}`);
        if (ww.minH != null && ww.minH !== m.minH) bad.push(`${name}/${ww.id}: minH ${ww.minH} vs meta ${m.minH}`);
      }
    }
    expect(bad, `최소 크기 불일치:\n${bad.join('\n')}`).toEqual([]);
  });

  it('[4] 초기 배치에 겹침이 없다', () => {
    const bad: string[] = [];
    for (const [name, p] of Object.entries(P)) {
      const ws = (p.widgets ?? []).filter((w) => !w.hidden) as unknown as Record<string, number>[];
      for (let i = 0; i < ws.length; i += 1) {
        for (let j = i + 1; j < ws.length; j += 1) {
          if (overlaps(ws[i]!, ws[j]!)) bad.push(`${name}: ${ws[i]!.id}↔${ws[j]!.id}`);
        }
      }
    }
    expect(bad, `초기 배치 겹침:\n${bad.join('\n')}`).toEqual([]);
  });

  it('[5] 선언한 열 수를 넘지 않는다', () => {
    /*
       ★★ 열 수를 24 로 박지 않는다. 프리셋의 `cols` 를 읽는다.

         그리드를 24 → **48열**로 올렸다(2026-09-09). 24열이면 1920px 화면에서 한 칸이
         약 71px 이라, 크기를 조절할 때 마우스를 71px 움직여야 한 칸이 바뀌어 뚝뚝
         끊겼다. 48열이면 약 35px 이다.

         숫자를 박아 두면 열 수를 바꿀 때마다 이 테스트가 틀린 실패를 낸다.
    */
    const bad: string[] = [];
    for (const [name, p] of Object.entries(P)) {
      const cols = (p as unknown as { cols?: number }).cols ?? 48;
      expect(cols, `${name} 의 cols 가 없다`).toBeGreaterThan(0);
      for (const w of (p.widgets ?? []) as unknown as Array<{ id: string; x: number; w: number }>) {
        if (w.x + w.w > cols) bad.push(`${name}/${w.id}: x+w=${w.x + w.w} > ${cols}`);
      }
    }
    expect(bad, `열 초과:\n${bad.join('\n')}`).toEqual([]);
  });
});
