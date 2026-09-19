/*
   포지션 TP/SL 을 **진입가 대비 가격 %** 로 잡는 기능을 잠근다.

   운영자 요청(2026-09-19): "몇 % +- 로 tpsl 설정할 수 있도록 해줘야 할 것 같은데."
   드래그는 이미 됐지만(초안 선 → 끌기 → 25/50/100% 로 확정), 정확히 −1.5% 같은
   자리를 마우스로 맞추는 것은 어렵다.

   ★★★ 가장 위험한 부분은 **방향**이다. 부호를 고객에게 맡기면 반대로 넣는 사고가
     난다 — 손절을 익절 자리에 걸면 **이익 구간에서 즉시 체결**된다.

         롱  TP → 위(+)    ·  롱  SL → 아래(−)
         숏  TP → 아래(−)  ·  숏  SL → 위(+)

   ★ 그래서 부호는 묻지 않고 side 와 kind 로 우리가 정한다.
*/
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** 화면 코드와 **같은 식**을 여기에 옮겨 두고, 소스가 그 식을 쓰는지 따로 검사한다. */
function draftPrice(base: number, side: 'long' | 'short', kind: 'tp' | 'sl', pct: number): number {
  const isLong = side === 'long';
  const up = kind === 'tp' ? isLong : !isLong;
  return base * (1 + (up ? pct : -pct) / 100);
}

describe('가격 %로 TP/SL 자리를 잡는다 — 방향', () => {
  const E = 100;

  it('롱: TP 는 위, SL 은 아래', () => {
    expect(draftPrice(E, 'long', 'tp', 2)).toBeCloseTo(102, 9);
    expect(draftPrice(E, 'long', 'sl', 2)).toBeCloseTo(98, 9);
  });

  it('숏: TP 는 아래, SL 은 위', () => {
    expect(draftPrice(E, 'short', 'tp', 2)).toBeCloseTo(98, 9);
    expect(draftPrice(E, 'short', 'sl', 2)).toBeCloseTo(102, 9);
  });

  /*
     ★★★ 이 시험이 이 기능의 존재 이유다. TP 와 SL 이 **진입가 반대편**에 있어야 한다.
       같은 쪽에 놓이면 하나는 즉시 체결된다.
  */
  it('TP 와 SL 은 항상 진입가 반대편에 놓인다', () => {
    for (const side of ['long', 'short'] as const) {
      for (const pct of [0.1, 1, 2.5, 10, 50]) {
        const tp = draftPrice(E, side, 'tp', pct);
        const sl = draftPrice(E, side, 'sl', pct);
        expect((tp - E) * (sl - E), `${side} ${pct}% — TP 와 SL 이 같은 쪽에 있다`).toBeLessThan(0);
      }
    }
  });

  it('소수 %도 정확히 계산한다', () => {
    /* ★ 0.5% · 1.5% 는 실제로 쓰는 폭이다. 정수만 되면 쓸 수 없는 기능이다. */
    expect(draftPrice(80000, 'long', 'sl', 1.5)).toBeCloseTo(78800, 6);
    expect(draftPrice(80000, 'short', 'tp', 0.5)).toBeCloseTo(79600, 6);
  });
});

describe('화면 코드가 그 식을 쓴다', () => {
  const app = read('src/app.jsx');

  it('side 와 kind 로 방향을 정한다 (부호를 고객에게 묻지 않는다)', () => {
    const i = app.indexOf('onSetBracket={(posId, kind, pctFromEntry)');
    expect(i, 'onSetBracket 이 % 를 받지 않는다').toBeGreaterThan(-1);
    const block = app.slice(i, i + 3000);
    expect(block, '방향 계산식이 없다')
      .toMatch(/const up = kind === 'tp' \? isLong : !isLong;/u);
    expect(block, '% 적용식이 없다')
      .toMatch(/base \* \(1 \+ \(up \? pct : -pct\) \/ 100\)/u);
  });

  /*
     ★★ 0 이하 가격을 만들지 않는다. 손절 100% 이상이면 가격이 0·음수가 되고,
       거래소가 거부하기 전에 이상한 선이 차트에 남는다.
  */
  it('0 이하 가격이면 만들지 않는다', () => {
    const i = app.indexOf('onSetBracket={(posId, kind, pctFromEntry)');
    const block = app.slice(i, i + 3000);
    expect(block, '0 이하 가격을 걸러내지 않는다').toMatch(/if \(!\(px > 0\)\)/u);
  });

  /*
     ★★★ **기본값을 넣지 않는다.** ±2% 를 미리 채우면 그 폭을 우리가 권한 것으로
       읽힌다 — 이 서비스는 조언을 하지 않는다(기존 결정, 주석에 남아 있다).
       % 가 없으면 진입가 그대로여야 한다.
  */
  it('% 가 없으면 진입가 그대로다', () => {
    const i = app.indexOf('onSetBracket={(posId, kind, pctFromEntry)');
    const block = app.slice(i, i + 3000);
    expect(block, '% 없이도 가격을 옮긴다').toMatch(/let px = base;/u);
    expect(block, '조건 없이 % 를 적용한다')
      .toMatch(/if \(Number\.isFinite\(pct\) && pct > 0\)/u);
  });

  it('입력칸에 기본값이 없다', () => {
    const w = read('src/widgets.jsx');
    const i = w.indexOf("placeholder=\"%\"");
    expect(i, '% 입력칸이 없다').toBeGreaterThan(-1);
    const block = w.slice(Math.max(0, i - 500), i + 400);
    /* ★ 빈 문자열로 시작해야 한다 — 숫자를 미리 넣으면 권유가 된다. */
    expect(block, '% 칸에 기본값이 채워져 있다').toMatch(/value=\{brPct\[p\.id\] \?\? ''\}/u);
    /* ★ 소수를 받아야 한다. */
    expect(block, '소수 % 를 입력할 수 없다').toMatch(/step="0\.1"/u);
  });

  it('문구가 9개 언어에 있다', () => {
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (!s.includes('pos_set_tp')) continue;
      if (!s.includes('pos_br_pct_hint')) missing.push(f);
    }
    expect(missing, `문구가 빠진 사전: ${missing.join(', ')}`).toEqual([]);
  });
});
