import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { STRATEGY_CATALOG, macdCross, macd } from '@quantumtrade/strategy';

/*
   **MACD 교차 전략** — 내장 카탈로그에 넣은 다섯 번째 전략.

   ★★★ 이 시험의 핵심은 **화면 DSL 과 숫자가 같다**는 것이다.
     고객은 같은 규칙("MACD 골든크로스")을 두 곳에서 본다 — 차트 마커(DSL)와
     이 백테스트. 교차 위치가 다르면 어느 쪽도 믿을 수 없다.
*/

const ROOT = join(__dirname, '../../../..');

/** 잡음 있는 캔들 — 실데이터에 가깝게 교차가 여러 번 나오게 만든다. */
function noisyBars(n: number) {
  let px = 100; let seed = 42;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  const out: { time: number; open: string; high: string; low: string; close: string; volume: string }[] = [];
  for (let i = 0; i < n; i++) {
    px += rnd() * 3 + Math.sin(i / 40) * 0.8;
    out.push({
      time: 1_700_000_000_000 + i * 900_000,
      open: String(px - 0.2), high: String(px + 0.8), low: String(px - 0.8),
      close: String(px), volume: '1000',
    });
  }
  return out;
}

/** 화면 DSL 을 실제로 불러온다 — 시험용 복사본을 두지 않는다. */
function loadDsl() {
  const win: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('window', readFileSync(join(ROOT, 'src/formula-dsl.js'), 'utf8'))(win);
  return (win as { QTFmla: { compute(e: string, b: unknown[]): { ok: boolean; values: number[] } } }).QTFmla;
}

describe('MACD 교차 전략', () => {
  it('카탈로그에 등록돼 있다', () => {
    const e = STRATEGY_CATALOG.find((x) => x.id === 'macd-cross-12-26-9');
    expect(e, '카탈로그에 없다').toBeTruthy();
    expect(e!.category).toBe('trend');
    expect(e!.author).toBe('built-in');
    /* ★ 번역 키가 없으면 다른 언어 화면에 한국어 이름이 그대로 나간다. */
    expect(e!.nameKey, '이름 번역 키가 없다').toBe('strat_macd_cross_12_26_9_name');
    expect(e!.descriptionKey, '설명 번역 키가 없다').toBe('strat_macd_cross_12_26_9_desc');
  });

  it('웜업이 DEA 가 유효해지는 시점보다 넉넉하다', () => {
    const bars = noisyBars(200);
    let first = -1;
    for (let i = 0; i < bars.length; i++) if (macd(bars as never, i)) { first = i; break; }
    /*
       ★ DIF 는 25(slow 26), DEA 는 33(+signal 9)부터 유효하다. 웜업을 그보다 짧게
         잡으면 백테스트가 웜업 구간을 거래 구간으로 세어 표본이 실제보다 짧아진다.
    */
    expect(first, 'MACD 첫 유효 봉이 33 이 아니다').toBe(33);
    expect(macdCross.warmup, '웜업이 DEA 유효 시점보다 짧다').toBeGreaterThan(first);
  });

  it('값을 지어내지 않는다 — 웜업 구간에서는 신호가 없다', () => {
    const bars = noisyBars(200);
    for (let i = 0; i < 33; i++) {
      expect(macdCross.evaluate(bars as never, i), `웜업 봉 ${i} 에서 신호가 났다`).toBeNull();
    }
  });

  /*
     ★★★ 이 시험이 이 파일의 이유다.
  */
  it('교차 위치가 화면 DSL 과 정확히 같다', () => {
    const bars = noisyBars(400);
    const up: number[] = []; const down: number[] = [];
    for (let i = 0; i < bars.length; i++) {
      const sig = macdCross.evaluate(bars as never, i);
      if (!sig) continue;
      (sig.side === 'long' ? up : down).push(i);
    }

    const F = loadDsl();
    const plain = bars.map((b) => ({ open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: +b.volume }));
    const idx = (expr: string) => F.compute(expr, plain).values
      .map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);
    const dslUp = idx('CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))');
    const dslDown = idx('CROSS_BELOW(MACD_DIF(12,26), MACD_DEA(12,26,9))');

    /* 먼저 검사 자체가 헛돌지 않는지 본다 — 둘 다 0건이면 아무것도 비교하지 않는다. */
    expect(up.length, '상향 교차를 하나도 찾지 못했다').toBeGreaterThan(0);
    expect(down.length, '하향 교차를 하나도 찾지 못했다').toBeGreaterThan(0);

    expect(up, '상향 교차 위치가 화면과 다르다').toEqual(dslUp);
    expect(down, '하향 교차 위치가 화면과 다르다').toEqual(dslDown);
  });

  /*
     ★★★ **처음 비교 가능한 봉은 교차가 아니다 — 유령 교차를 막는다.**

       잡음 데이터로는 이 규칙이 사라진 것을 잡지 못했다(역검증에서 드러났다).
       그 데이터에는 첫 비교 봉에 교차가 없어서 차이가 나타나지 않는다.

       **선형 데이터가 그것을 드러낸다.** 일정하게 하락하면 DIF 와 DEA 가 정확히
       같아지고(실측: 둘 다 -7.000), DEA 가 처음 유효해지는 봉에서 씨앗값과 아직
       수렴 중인 DIF 를 비교해 **없는 교차가 하나 잡힌다.** 실제로 그렇게 잡혔다
       (봉 34, 추세가 계속 하락하던 구간인데 상향 교차).
  */
  it('웜업 직후 유령 교차를 만들지 않는다 — 선형 데이터로 확인', () => {
    const linear: { time: number; open: string; high: string; low: string; close: string; volume: string }[] = [];
    let px = 100;
    for (let i = 0; i < 160; i++) {
      px += i < 80 ? -1.0 : 1.5;
      linear.push({
        time: 1_700_000_000_000 + i * 900_000,
        open: String(px - 0.2), high: String(px + 0.5), low: String(px - 0.6),
        close: String(px), volume: '1000',
      });
    }
    const fired: { i: number; side: string }[] = [];
    for (let i = 0; i < linear.length; i++) {
      const sig = macdCross.evaluate(linear as never, i);
      if (sig) fired.push({ i, side: sig.side });
    }

    /* 화면 DSL 도 같은 결과여야 한다. */
    const F = loadDsl();
    const plain = linear.map((b) => ({ open: +b.open, high: +b.high, low: +b.low, close: +b.close, volume: +b.volume }));
    const idx = (expr: string) => F.compute(expr, plain).values
      .map((v, i) => (v === 1 ? i : -1)).filter((i) => i >= 0);
    const dslUp = idx('CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))');
    const dslDown = idx('CROSS_BELOW(MACD_DIF(12,26), MACD_DEA(12,26,9))');

    expect(fired.filter((f) => f.side === 'long').map((f) => f.i), '상향 교차가 화면과 다르다')
      .toEqual(dslUp);
    expect(fired.filter((f) => f.side === 'short').map((f) => f.i), '하향 교차가 화면과 다르다')
      .toEqual(dslDown);

    /*
       ★ 이 데이터에서는 웜업 후 DIF 가 DEA 아래로 내려간 적이 없으므로 교차가 없다.
         숫자를 못박는다 — "같기만 하면 된다" 로 두면 양쪽이 함께 틀려도 통과한다.
    */
    const firstComparable = 35;
    expect(fired.filter((f) => f.i <= firstComparable), `웜업 직후(${firstComparable}봉 이내)에 신호가 났다`)
      .toEqual([]);
  });

  it('보호주문 거리가 SMA 교차 전략과 같다 — 성과 차이가 신호에서만 나오게', () => {
    const src = readFileSync(join(ROOT, 'packages/strategy/src/strategies.ts'), 'utf8');
    const i = src.indexOf('export const macdCross');
    const body = src.slice(i, src.indexOf('\n};', i));
    expect(body, 'ATR 2배/3배 보호주문을 쓰지 않는다')
      .toMatch(/protectiveLevels\(side, close, a, 2, 3\)/u);
  });

  it('번역 키가 9개 언어 사전에 모두 있다', () => {
    /*
       ★★ 한 언어라도 빠지면 그 언어 화면에 키 이름이나 한국어가 나온다.
         사전 목록을 손으로 적지 않고 폴더에서 읽는다 — 언어가 늘면 자동으로 따라간다.
    */
    const dir = join(ROOT, 'src/locales');
    const base = readdirSync(dir).filter((f) => /^[a-z]{2,3}\.js$/u.test(f));
    expect(base.length, '사전 파일을 찾지 못했다').toBeGreaterThanOrEqual(9);
    const missing: string[] = [];
    for (const f of base) {
      const s = readFileSync(join(dir, f), 'utf8');
      /* 기존 전략 키가 있는 사전에만 새 키를 요구한다 — 부분 사전을 억지로 채우지 않는다. */
      if (!s.includes('strat_sma_cross_20_50_name')) continue;
      if (!s.includes('strat_macd_cross_12_26_9_name')) missing.push(`${f} name`);
      if (!s.includes('strat_macd_cross_12_26_9_desc')) missing.push(`${f} desc`);
    }
    expect(missing, `번역 키가 빠진 사전:\n${missing.join('\n')}`).toEqual([]);
  });

  it('새 문구에 다른 언어 문자가 섞이지 않았다', () => {
    /*
       ★★★ 실제로 겪었다 — 일본어 법적 문서에 러시아어 단어가 섞여 들어갔다.
         내가 여러 언어를 한 번에 쓸 때 나는 오류이고, 문법 검사로는 안 잡힌다.
    */
    const dir = join(ROOT, 'src/locales');
    const CYRILLIC = /[\u0400-\u04FF]/u;
    const HANGUL = /[\uAC00-\uD7A3]/u;
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('strat_macd_cross')) return;
        if (CYRILLIC.test(line)) bad.push(`${f}:${i + 1} 키릴`);
        /* 한국어 사전은 없다(기본이 영어) — 어느 사전에도 한글이 있어서는 안 된다. */
        if (HANGUL.test(line)) bad.push(`${f}:${i + 1} 한글`);
      });
    }
    expect(bad, `다른 언어 문자가 섞였다:\n${bad.join('\n')}`).toEqual([]);
  });
});
