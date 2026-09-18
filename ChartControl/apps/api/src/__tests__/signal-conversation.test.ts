import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHART_COMMAND_ARG_SCHEMAS } from '@quantumtrade/ai';
import { validateIndicatorFormula } from '../ai/indicator-formula';

/*
   **대화로 신호를 만드는 전 경로**를 지킨다.

   ★★★ 운영자 보고(2026-09-18): "MACD 골든크로스면 매수신호 만들어줘 이렇게 하면
     차트에 딱 나오게 해야 하는데... 지금 켜기만 하고 안 돼."

     원인이 둘이었다.
       ① 모델이 읽는 도구 설명에 `addSignalRule` 의 **인자 형식이 없었다.** 명령
          이름만 알고 무엇을 넣어야 하는지 몰라 부를 수 없었다.
       ② `SMA` 가 누적합을 써서 입력에 웜업(NaN)이 있으면 **영구히 NaN** 이었다.
          즉 `SMA(ATR(14),50)` · `SMA(RSI(close,14),20)` 같은 **지표 조합이 전부
          깨져 있었다.**

   ★★ 고객은 MACD 만 쓰지 않는다. RSI·이동평균·돌파·변동성·거래량 모두 같은 방식이어야
     한다. 그래서 이 시험은 **여러 지표의 대표 요청**을 함께 통과시킨다.
*/

const ROOT = join(__dirname, '../../../..');

function loadEngine() {
  const win: Record<string, unknown> = {};
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('window', readFileSync(join(ROOT, 'src/formula-dsl.js'), 'utf8'))(win);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('window', readFileSync(join(ROOT, 'src/signal-rules.js'), 'utf8'))(win);
  return win as {
    QTFmla: { compute(e: string, b: unknown[]): { ok: boolean; values: number[] } };
    QTSignalRules: { evaluate(e: string, b: unknown[], o?: unknown): { ok: boolean; total?: number; error?: string } };
  };
}

/** 급등이 섞인 실데이터에 가까운 캔들. */
function bars(n = 500) {
  let px = 100; let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  const out: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];
  for (let i = 0; i < n; i++) {
    px += rnd() * 3 + Math.sin(i / 50) * 1.1;
    const spike = i % 37 === 0 ? 6 : 1;
    out.push({
      time: 1_700_000_000_000 + i * 900_000,
      open: px - 0.2, high: px + 0.8, low: px - 0.8, close: px,
      volume: 1000 * spike * (1 + Math.abs(rnd())),
    });
  }
  return out;
}

/*
   ★★★ **지표 조합.** 이 목록이 통과하지 않으면 "우리 지표들로 대화형 신호를 만든다"
     는 서비스 설명이 사실이 아니다.
*/
const COMPOSED = [
  'SMA(ATR(14),50)',
  'SMA(RSI(close,14),20)',
  'SMA(MACD_DIF(12,26),10)',
  'STDDEV(RSI(close,14),20)',
  'SUM(RSI(close,14),5)',
  'SMA(SMA(close,5),10)',
  'HHV(RSI(close,14),20)',
  'LLV(ATR(14),30)',
];

describe('지표를 겹쳐 쓸 수 있다', () => {
  const { QTFmla: F } = loadEngine();
  const b = bars();

  it.each(COMPOSED)('%s 가 값을 낸다 — 웜업 뒤에 NaN 으로 남지 않는다', (expr) => {
    const r = F.compute(expr, b);
    expect(r.ok, `파싱 실패: ${expr}`).toBe(true);
    const finite = r.values.filter(Number.isFinite);
    /*
       ★★★ 예전에는 여기가 **0** 이었다. 누적합에 웜업 NaN 이 들어가 복구되지 않았다.
         절반 이상이 유효해야 한다 — 웜업만큼만 모름이어야 정상이다.
    */
    expect(finite.length, `${expr} 가 전부 NaN 이다 — 지표 조합이 깨졌다`)
      .toBeGreaterThan(b.length / 2);
  });

  it('창이 웜업 구간을 지나면 복구된다 — 앞은 모름, 뒤는 값', () => {
    const v = F.compute('SMA(ATR(14),50)', b).values;
    expect(Number.isFinite(v[0]), '첫 봉이 값을 가진다 — 웜업이 없다').toBe(false);
    expect(Number.isFinite(v[v.length - 1]), '마지막 봉이 여전히 모름이다 — 복구되지 않았다').toBe(true);
  });

  it('없는 값을 0 으로 메우지 않는다', () => {
    /*
       ★ 0 으로 메우면 평균이 실제보다 작아지고 그것은 조용히 틀린 숫자다.
         웜업 구간의 SMA 는 0 이 아니라 NaN 이어야 한다.
    */
    const v = F.compute('SMA(close,20)', b).values;
    for (let i = 0; i < 19; i++) {
      expect(Number.isNaN(v[i]!), `봉 ${i} 이 0 등으로 메워졌다`).toBe(true);
    }
  });
});

/*
   고객이 실제로 말할 만한 요청 → 모델이 낼 인자 → 세 관문을 통과하는가.
     ① 명령 인자 스키마  ② 서버 DSL 검증  ③ 화면 평가(마커가 실제로 나오나)
*/
const REQUESTS: { ask: string; args: { name: string; rule: string; direction?: 'long' | 'short' } }[] = [
  { ask: 'MACD 골든크로스면 매수', args: { name: 'MACD golden', rule: 'CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))', direction: 'long' } },
  { ask: 'MACD 데드크로스면 매도', args: { name: 'MACD dead', rule: 'CROSS_BELOW(MACD_DIF(12,26), MACD_DEA(12,26,9))', direction: 'short' } },
  { ask: 'RSI 50 돌파', args: { name: 'RSI 50', rule: 'CROSS_ABOVE(RSI(close,14), 50)' } },
  { ask: 'RSI 과매도', args: { name: 'RSI low', rule: 'RSI(close,14) < 30' } },
  { ask: '5/20 골든크로스', args: { name: 'MA cross', rule: 'CROSS_ABOVE(SMA(close,5), SMA(close,20))', direction: 'long' } },
  { ask: '20봉 돌파', args: { name: 'breakout', rule: 'close > REF(HHV(high,20),1)' } },
  { ask: '볼린저 상단', args: { name: 'BOLL up', rule: 'close > SMA(close,20) + 2 * STDDEV(close,20)' } },
  { ask: 'MACD 히스토그램 전환', args: { name: 'hist up', rule: 'CROSS_ABOVE(MACD_HIST(12,26,9), 0)' } },
  { ask: '변동성 확대', args: { name: 'ATR up', rule: 'ATR(14) > SMA(ATR(14),50)' } },
  { ask: '3봉 연속 상승', args: { name: '3 up', rule: 'RISING(close,3)' } },
  { ask: 'RSI가 자기 평균 위로', args: { name: 'RSI vs MA', rule: 'CROSS_ABOVE(RSI(close,14), SMA(RSI(close,14),20))' } },
  { ask: '거래량 급등', args: { name: 'vol spike', rule: 'volume > 2 * SMA(volume,10)' } },
  { ask: '20봉 중 15봉 양봉', args: { name: 'mostly up', rule: 'COUNT(close > open, 20) >= 15' } },
  { ask: 'MACD + RSI 조합', args: { name: 'combo', rule: 'CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9)) AND RSI(close,14) < 70', direction: 'long' } },
];

describe('대화 요청이 실제 신호가 된다', () => {
  const { QTSignalRules: E } = loadEngine();
  const b = bars();

  it.each(REQUESTS.map((r) => [r.ask, r.args] as const))('%s', (_ask, args) => {
    const argOk = CHART_COMMAND_ARG_SCHEMAS.addSignalRule.safeParse(args);
    expect(argOk.success, `인자 스키마가 거부했다: ${argOk.success ? '' : JSON.stringify(argOk.error.issues)}`).toBe(true);

    const srv = validateIndicatorFormula({ name: 'r', expression: args.rule, pane: 'separate' });
    expect(srv.ok, `서버가 거부했다: ${srv.ok ? '' : srv.code}`).toBe(true);

    const ev = E.evaluate(args.rule, b, { direction: args.direction });
    expect(ev.ok, `평가 실패: ${ev.error}`).toBe(true);
    /*
       ★★★ **0건이면 통과로 보지 않는다.** 규칙이 문법만 맞고 아무 봉도 못 잡으면
         고객 화면에는 아무것도 안 나온다 — 그것이 지금 문제였다.
    */
    expect(ev.total, `한 봉도 잡지 못했다 — 화면에 아무것도 안 나온다`).toBeGreaterThan(0);
  });
});

describe('모델이 신호 명령을 부를 수 있다', () => {
  const tools = readFileSync(join(ROOT, 'packages/ai/src/tools.ts'), 'utf8');

  /*
     ★★★ 명령 이름은 열거값이지만 `argsJson` 은 문자열이다. 어떤 키를 넣어야 하는지는
       **도구 설명에서만** 알 수 있다. 여기를 빠뜨리면 모델은 명령이 있는 줄 알면서도
       부를 수 없다 — 실제로 그래서 "지표만 켜고 끝" 이 됐다.
  */
  it('도구 설명에 addSignalRule 인자 형식이 있다', () => {
    expect(tools, 'addSignalRule 설명이 없다 — 모델이 인자를 모른다')
      .toMatch(/- addSignalRule: \{"name":/u);
    expect(tools, 'rule 이 DSL 이라고 알려주지 않는다').toMatch(/indicator-DSL condition, NOT JavaScript/u);
    expect(tools, 'removeSignalRule 설명이 없다').toMatch(/- removeSignalRule: \{"name":/u);
  });

  it('DSL 문법과 여러 지표 예시를 준다 — MACD 하나만 주면 그것만 흉내낸다', () => {
    expect(tools, '함수 목록이 없다').toMatch(/CROSS_ABOVE\(a,b\) CROSS_BELOW\(a,b\)/u);
    expect(tools, '연산자를 알려주지 않는다').toMatch(/> >= < <= == != AND OR NOT/u);
    for (const [name, must] of [
      ['RSI 교차', /CROSS_ABOVE\(RSI\(close,14\), 50\)/u],
      ['이동평균 교차', /CROSS_ABOVE\(SMA\(close,5\), SMA\(close,20\)\)/u],
      ['돌파', /close > REF\(HHV\(high,20\),1\)/u],
      ['볼린저', /STDDEV\(close,20\)/u],
      ['변동성', /ATR\(14\) > SMA\(ATR\(14\),50\)/u],
    ] as const) {
      expect(tools, `${name} 예시가 없다`).toMatch(must);
    }
    /* ★ 연쇄 비교는 거부되므로 미리 알려준다 — 모르면 계속 거부당한다. */
    expect(tools, '연쇄 비교 금지를 알려주지 않는다').toMatch(/Do NOT chain comparisons/u);
    /* ★ 없는 것을 있다고 하지 않는다. */
    expect(tools, '다이버전스가 없다는 안내가 없다').toMatch(/no divergence function/u);
  });

  /*
     ★★★ 운영자 보고의 핵심: "지표도 켜져 있는데 새로 켜기만" 한다.
  */
  it('신호 요청에 지표만 켜고 끝내지 말라고 못박는다', () => {
    expect(tools, '신호 요청의 동작이 addSignalRule 이라고 못박지 않는다')
      .toMatch(/THE ACTION IS addSignalRule — NOT addIndicator/u);
    expect(tools, '이미 켜진 지표를 다시 켜지 말라고 하지 않는다')
      .toMatch(/already appears in\s*\\n' \+\s*'MARKET_DATA screen\.indicators, do NOT add it again|screen\.indicators, do NOT add it again/u);
  });

  it('review_setup 설명이 새 정책을 담는다', () => {
    expect(tools, '옛 문장이 남아 있다').not.toMatch(/If the user gave no direction, do not call this tool/u);
    expect(tools, '세 경우를 설명하지 않는다').toMatch(/THREE CASES/u);
    expect(tools, 'AI 견해 기록 방법을 알려주지 않는다').toMatch(/directionByAi=true/u);
    expect(tools, '고지 값을 알려주지 않는다').toMatch(/aiOpinionDisclosed=true/u);
    expect(tools, '반대 근거 필수를 알려주지 않는다').toMatch(/contradictingEvidence filled in/u);
  });
});
