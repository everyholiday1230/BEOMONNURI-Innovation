import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
   **고객이 만든 신호 규칙** — 엔진과 차트 표시.

   운영 결정(2026-09-18): 매매 신호는 우리가 주는 것이 아니라 고객이 만든다.
   고객이 조건을 쓰고, 서비스는 성립한 봉을 표시한다. 주문은 발생하지 않는다.
*/

const ROOT = join(__dirname, '../../../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** 주석을 지운 소스 — 이 저장소는 주석에 실패 사례를 남기므로 검사가 헛돈다. */
const stripped = (rel: string) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

/** 브라우저 스크립트 두 개를 실제로 불러와 쓴다. */
function loadEngine() {
  const win: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('window', read('src/formula-dsl.js'))(win);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('window', read('src/signal-rules.js'))(win);
  return win as {
    QTFmla: { compute(e: string, b: unknown[]): { ok: boolean; values?: number[] } };
    QTSignalRules: {
      evaluate(e: string, bars: unknown[], opts?: Record<string, unknown>): {
        ok: boolean; error?: string; marks?: { index: number; time: number | null; price: number; direction: string | null; ruleText: string }[];
        total?: number; unknownBars?: number; truncated?: boolean;
      };
      evaluateAll(rules: unknown[], bars: unknown[]): { ok: boolean; name: string | null; total?: number; error?: string }[];
    };
  };
}

/** 하락 → 상승 캔들. 교차가 실제로 생긴다. */
function bars(n: number, turn: number) {
  const out: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  let px = 100;
  for (let i = 0; i < n; i++) {
    px += i < turn ? -1.0 : 1.5;
    out.push({ time: 1_700_000_000_000 + i * 900_000, open: px - 0.2, high: px + 0.5, low: px - 0.6, close: px, volume: 1000 });
  }
  return out;
}

describe('신호 규칙 엔진', () => {
  const { QTSignalRules: E } = loadEngine();

  it('교차 규칙이 성립한 봉을 찾는다', () => {
    const r = E.evaluate('CROSS_ABOVE(SMA(close,5), SMA(close,20))', bars(160, 80));
    expect(r.ok, r.error).toBe(true);
    expect(r.total, '교차를 하나도 찾지 못했다').toBeGreaterThan(0);
    expect(r.marks!.length).toBe(r.total);
  });

  /*
     ★★★ 표시에 **근거가 함께 있어야 한다.** 근거 없는 표시는 고객이 "우리가 사라고
       한 것" 으로 읽는다. 감지는 예측이 아니고, 그 차이는 근거를 보여줄 때만 성립한다.
  */
  it('표시마다 어떤 규칙이 언제 성립했는지 담는다', () => {
    const rule = 'CROSS_ABOVE(SMA(close,5), SMA(close,20))';
    const r = E.evaluate(rule, bars(160, 80), { label: 'SMA 골든크로스' });
    const m = r.marks![0]!;
    expect(m.ruleText, '규칙 본문이 없다').toBe(rule);
    expect(m.time, '시각이 없다').toBeTypeOf('number');
    expect(m.price, '가격이 없다').toBeTypeOf('number');
    expect(m.index, '봉 위치가 없다').toBeTypeOf('number');
  });

  /*
     ★★★ 방향을 **우리가 채워 넣지 않는다.** 채우면 그 순간 우리가 방향을 발신한 것이다.
  */
  it('방향은 고객이 준 것만 쓴다 — 없으면 null 이다', () => {
    const b = bars(160, 80);
    const none = E.evaluate('CROSS_ABOVE(SMA(close,5), SMA(close,20))', b);
    expect(none.marks![0]!.direction, '없는 방향을 채웠다').toBeNull();

    const given = E.evaluate('CROSS_ABOVE(SMA(close,5), SMA(close,20))', b, { direction: 'long' });
    expect(given.marks![0]!.direction).toBe('long');

    /* 알 수 없는 값은 방향으로 인정하지 않는다. */
    const junk = E.evaluate('CROSS_ABOVE(SMA(close,5), SMA(close,20))', b, { direction: 'up' });
    expect(junk.marks![0]!.direction, '알 수 없는 방향을 통과시켰다').toBeNull();
  });

  /*
     ★★★ 데이터가 부족해 규칙이 못 돈 것을 "신호 0건" 으로 보여주면 고객은 규칙이
       틀렸다고 오해한다. 몇 봉이 모름이었는지 함께 말한다.
  */
  it('데이터 부족을 신호 없음과 구별해 알린다', () => {
    const short = E.evaluate('CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))', bars(20, 10));
    expect(short.ok).toBe(true);
    expect(short.total).toBe(0);
    expect(short.unknownBars, '모름 봉 수를 알려주지 않는다').toBe(20);

    const long = E.evaluate('CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))', bars(400, 200));
    expect(long.unknownBars!, '충분한 데이터인데 전부 모름이다').toBeLessThan(60);
  });

  it('표시 상한을 넘으면 잘렸다고 밝힌다 — 조용히 자르지 않는다', () => {
    const r = E.evaluate('close > 0', bars(200, 100), { maxMarks: 5 });
    expect(r.marks!.length).toBe(5);
    expect(r.total, '전체 건수를 줄여 보고했다').toBeGreaterThan(5);
    expect(r.truncated, '잘린 사실을 밝히지 않았다').toBe(true);
  });

  it('잘못된 규칙과 코드 주입을 거부한다', () => {
    for (const bad of ['CROSS_ABOVE(oops,1)', 'eval(1)', 'window', 'close = open']) {
      const r = E.evaluate(bad, bars(60, 30));
      expect(r.ok, `통과시켰다: ${bad}`).toBe(false);
      expect(r.error, '오류 이유가 없다').toBeTruthy();
    }
  });

  it('규칙 하나가 틀려도 나머지는 산다', () => {
    const out = E.evaluateAll([
      { id: 'a', name: '교차', expression: 'CROSS_ABOVE(SMA(close,5), SMA(close,20))' },
      { id: 'b', name: '오타', expression: 'CROSS_ABOVE(oops,1)' },
      { id: 'c', name: 'RSI', expression: 'RSI(close,14) < 30' },
    ], bars(200, 100));
    expect(out.length).toBe(3);
    expect(out[0]!.ok, '정상 규칙이 죽었다').toBe(true);
    expect(out[1]!.ok).toBe(false);
    expect(out[2]!.ok, '뒤 규칙이 앞 오류에 끌려갔다').toBe(true);
  });
});

describe('차트가 신호 규칙을 그리는 방식', () => {
  const src = stripped('src/chart-kline.jsx');

  /*
     ★★★ **klinecharts 의 calc 서명은 `(dataList, indicator)` 다.**

       예전 커스텀 지표 코드는 `(params, bars)` 로 받아 **두 번째 인자를 캔들로** 썼다.
       두 번째는 지표 객체이므로 계산이 빈 배열을 돌려주고, 지표가 등록은 되는데
       **한 번도 계산되지 않았다.** 실측(2026-09-18): MA·VOL 의 result 는 1000개인데
       CUST_* 는 0개였다. 오류도 없이 조용히 실패했다 — AI 가 "지표를 만들었다" 고
       말해도 화면에는 아무것도 없었다.
  */
  it('calc 이 첫 인자를 캔들로 받는다 — 두 번째는 지표 객체다', () => {
    expect(src, "calc 이 아직 (params, bars) 로 받는다 — 두 번째는 캔들이 아니다")
      .not.toMatch(/calc:\s*\(params,\s{1,}bars\)/u);
    const calls = src.match(/calc:\s*\(([^)]*)\)/gu) ?? [];
    expect(calls.length, 'calc 정의를 찾지 못했다').toBeGreaterThanOrEqual(2);
    for (const c of calls) {
      expect(c, `calc 첫 인자가 dataList 가 아니다: ${c}`).toMatch(/calc:\s*\(dataList/u);
    }
  });

  /*
     ★★★ figures 에 값을 두면 **가격축 범위에 들어가 차트가 망가진다.**
       실측: 0/1 값 때문에 캔들 패널 축이 0~80,000 이 되고 캔들이 얇은 띠로 눌렸다.
  */
  it('신호 지표는 figures 를 비워 둔다 — 값이 가격축에 들어가면 안 된다', () => {
    const i = src.indexOf('addSignalRule');
    expect(i, 'addSignalRule 을 찾지 못했다').toBeGreaterThan(0);
    const body = src.slice(i, src.indexOf('removeSignalRule'));
    expect(body, 'figures 를 비우지 않았다').toMatch(/figures:\s*\[\]/u);
    expect(body, '값 계열을 두면 가격축이 망가진다')
      .not.toMatch(/figures:\s*\[\s*\{/u);
    expect(body, 'draw 훅으로 그리지 않는다').toMatch(/draw:\s*\(\{/u);
  });

  /*
     ★★★ 한글 이름이 전부 `_` 로 바뀌어 서로 충돌했다.
       실측: "MACD 골든크로스" 와 "MACD 데드크로스" 가 모두 SIG_MACD______ 가 되어
       두 번째가 첫 번째를 조용히 덮었다. 이 서비스 이용자는 한국어 이름을 쓴다.
  */
  it('지표 키가 이름별로 구별된다 — 한글 이름이 충돌하지 않는다', () => {
    expect(src, '키 생성이 한 곳에 모여 있지 않다').toMatch(/function indicatorKey\(prefix, name\)/u);
    expect(src, '원본 이름의 해시를 붙이지 않는다 — 한글 이름이 충돌한다')
      .toMatch(/charCodeAt\(i\)/u);
    /* 옛 방식이 남아 있으면 그 경로가 여전히 충돌한다. */
    expect(src, "옛 키 생성 방식이 남아 있다")
      .not.toMatch(/'(CUST|SIG)_' \+ /u);

    /* 실제로 서로 다른 키가 나오는지 확인한다 — 정규식만으로는 부족하다. */
    const m = /function indicatorKey\(prefix, name\) \{[\s\S]*?\n {2}\}/u.exec(src);
    expect(m, 'indicatorKey 본문을 찾지 못했다').not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const key = new Function(`${m![0]}; return indicatorKey;`)() as (p: string, n: string) => string;
    expect(key('SIG', 'MACD 골든크로스'), '한글 이름이 여전히 충돌한다')
      .not.toBe(key('SIG', 'MACD 데드크로스'));
    expect(key('SIG', '같은이름'), '같은 이름이 다른 키가 된다')
      .toBe(key('SIG', '같은이름'));
  });

  /*
     ★★ 내부 키를 고객에게 보여주지 않는다. 실측에서 `SIG_MACD_______U9NTX` 가
       레전드에 그대로 나왔다 — 고객이 자기가 지은 이름을 찾을 수 없다.
  */
  it('레전드가 사람이 읽을 이름을 쓴다', () => {
    expect(src, '표시 이름을 게시하지 않는다').toMatch(/title:\s*String\(i\.shortName\)/u);
    expect(src, '레전드가 title 을 쓰지 않는다').toMatch(/d\.title \? String\(d\.title\) : name/u);
  });
});
