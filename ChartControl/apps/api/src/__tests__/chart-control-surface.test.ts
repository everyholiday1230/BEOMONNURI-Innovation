import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AI_CHART_COMMANDS, AI_INDICATORS, CHART_COMMAND_ARG_SCHEMAS } from '@quantumtrade/ai';

/*
   **"AI 가 차트를 컨트롤한다" 가 사실이 되도록 조작면을 잠근다.**

   운영자: "어떤 지표를 켜든 잘 되어야 해. 켜고 그리고 끄고 지표 설정도 말로 바꾸고
   신호도 만들고. 우린 AI 가 차트를 컨트롤하는 컨셉이니까."

   ★★★ 그래서 **켜기·끄기·설정변경·신호·그리기** 다섯 가지가 모두 명령으로 있어야 하고,
     명령마다 세 곳이 함께 갖춰져야 한다:
       ① `AI_CHART_COMMANDS`        — 모델이 고를 수 있는 이름
       ② `CHART_COMMAND_ARG_SCHEMAS` — 서버가 인자를 검증
       ③ `TOOL_ARG_HINTS`(tools.ts) — **모델이 인자 형식을 아는 유일한 곳**
       ④ 화면 처리(`ai-copilot.jsx` case)
     ③ 을 빠뜨려 `addSignalRule` 이 조용히 안 됐다(2026-09-18). 그래서 시험으로 잠근다.
*/

const ROOT = join(__dirname, '../../../..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const tools = read('packages/ai/src/tools.ts');
const copilot = read('src/ai-copilot.jsx');
const kline = read('src/chart-kline.jsx');

describe('조작면이 다 갖춰져 있다', () => {
  it('다섯 가지 조작이 모두 명령으로 있다', () => {
    for (const [what, cmd] of [
      ['지표 켜기', 'addIndicator'],
      ['지표 끄기', 'removeIndicator'],
      ['지표 설정 변경', 'setIndicatorParams'],
      ['신호 만들기', 'addSignalRule'],
      ['신호 지우기', 'removeSignalRule'],
      ['선 그리기', 'createTrendLine'],
      ['수평선', 'createHorizontalLevel'],
      ['지지·저항', 'createSupportResistance'],
      ['피보나치', 'createFibonacci'],
      ['선 지우기', 'deleteOverlay'],
      ['선 숨기기', 'hideOverlay'],
    ] as const) {
      expect(AI_CHART_COMMANDS, `${what}(${cmd}) 명령이 없다`).toContain(cmd);
    }
  });

  /*
     ★★★ 네 곳이 함께 갖춰졌는지 본다. 하나라도 빠지면 조용히 안 된다 —
       ③ 을 빠뜨려 실제로 그렇게 됐다.
  */
  it.each([...AI_CHART_COMMANDS])('%s 가 인자 스키마·도구 설명·화면 처리를 모두 가진다', (cmd) => {
    expect(CHART_COMMAND_ARG_SCHEMAS[cmd], `${cmd} 인자 스키마가 없다`).toBeDefined();
    /* 도구 설명에 이름이 있어야 모델이 인자를 만든다. */
    expect(tools, `${cmd} 가 도구 설명에 없다 — 모델이 인자 형식을 모른다`).toContain(cmd);
    /* 화면이 처리해야 실제로 반영된다. */
    expect(copilot, `${cmd} 를 화면이 처리하지 않는다`).toMatch(
      new RegExp(`case '${cmd}'`, 'u'),
    );
  });

  it('지표 27종이 목록·화면에서 일치한다', () => {
    expect(AI_INDICATORS.length, '지표 개수가 27이 아니다').toBe(27);
    /* ★ 설정 변경 명령도 같은 목록을 써야 한다 — 다르면 켤 수는 있는데 못 바꾸는 지표가 생긴다. */
    const schema = read('packages/ai/src/schemas.ts');
    const i = schema.indexOf('setIndicatorParams: z.object');
    expect(schema.slice(i, i + 200), '설정 변경이 지표 목록을 쓰지 않는다')
      .toMatch(/indicator: z\.enum\(AI_INDICATORS\)/u);
  });
});

describe('피보나치', () => {
  /*
     ★★★ 여태 프롬프트가 "그릴 수 없다" 고 답하도록 지시했는데 **사실이 아니었다.**
       klinecharts 에 `fibonacciLine` 내장 오버레이가 있고, 화면 그리기 도구
       (`chart-actions.js` 의 `fib`)도 이미 그것을 쓰고 있었다. 못 하는 것과 안 만든
       것은 다르다 — 못 한다고 말한 것이 거짓이었으므로 만들었다.
  */
  it('내장 오버레이를 쓴다 — 우리가 다시 구현하지 않는다', () => {
    expect(kline, '피보나치 매핑이 없다').toMatch(/fibonacci: 'fibonacciLine'/u);
    /* ★ 손으로 그린 것과 같은 도형이어야 값이 어긋나지 않는다. */
    const actions = read('src/chart-actions.js');
    expect(actions, '화면 도구가 다른 것을 쓴다').toMatch(/fib: 'fibonacciLine'/u);
  });

  it('두 점을 요구한다 — 한 점으로는 비율이 뜻이 없다', () => {
    const ok = CHART_COMMAND_ARG_SCHEMAS.createFibonacci.safeParse({
      points: [{ time: 1_700_000_000_000, price: '64000' }, { time: 1_700_009_000_000, price: '68000' }],
    });
    expect(ok.success, ok.success ? '' : JSON.stringify(ok.error.issues)).toBe(true);
    for (const [why, args] of [
      ['한 점', { points: [{ time: 1_700_000_000_000, price: '64000' }] }],
      ['세 점', { points: [1, 2, 3].map(() => ({ time: 1_700_000_000_000, price: '64000' })) }],
      ['빈 배열', { points: [] }],
    ] as const) {
      expect(CHART_COMMAND_ARG_SCHEMAS.createFibonacci.safeParse(args).success, `${why} 가 통과됐다`).toBe(false);
    }
    /* 화면도 두 점이 아니면 그리지 않고 그 사실을 말한다. */
    expect(copilot, '두 점 검사가 없다').toMatch(/if \(pts\.length !== 2\) return t\('ai_fib_needs_two'\)/u);
  });

  it('비율을 우리가 지정하지 않는다', () => {
    /*
       ★ 비율(23.6/38.2/50/61.8/78.6/100)은 라이브러리가 그린다. 우리가 넘기면
         화면 도구로 그린 것과 달라질 수 있다.
    */
    expect(tools, '비율을 넘기지 말라는 안내가 없다').toMatch(/do not pass them/u);
  });

  it('"못 그린다" 는 옛 지시가 사라졌다', () => {
    const prompts = read('packages/ai/src/prompts.ts');
    expect(prompts, '못 그린다고 답하도록 여전히 지시한다')
      .not.toMatch(/You CANNOT draw Fibonacci/u);
    expect(prompts, '그릴 수 있다고 알려주지 않는다').toMatch(/FIBONACCI: you CAN draw it/u);
  });
});

describe('지표 설정 변경', () => {
  /*
     ★★★ 이 경로가 없어서 "RSI 를 7 로 바꿔줘" 가 **지표를 하나 더 켰다.**
       실측(2026-09-18): addIndicator('RSI',[14]) 뒤 addIndicator('RSI',[7]) →
       RSI[14] 와 RSI[7] 두 창.
  */
  it('켜져 있으면 다시 켜지 않고 설정만 바꾼다', () => {
    const i = kline.indexOf('addIndicator(name, params)');
    const body = kline.slice(i, kline.indexOf('setIndicatorParams(name, params)'));
    expect(body, '이미 켜져 있는지 확인하지 않는다 — 중복으로 켜진다')
      .toMatch(/const already = \(chart\.getIndicators\(\) \|\| \[\]\)\.some/u);
    expect(body, '켜져 있을 때 설정을 갱신하지 않는다').toMatch(/overrideIndicator\(\{ name: kName, calcParams \}\)/u);
  });

  it('전용 함수가 있고 양의 정수만 받는다', () => {
    expect(kline, 'setIndicatorParams 가 없다').toMatch(/setIndicatorParams\(name, params\)/u);
    const i = kline.indexOf('setIndicatorParams(name, params)');
    const body = kline.slice(i, i + 2600);
    /* ★ 0·음수·소수는 klinecharts 가 계산에서 멈출 수 있고 그때 화면이 굳는다. */
    expect(body, '양의 정수 검사가 없다').toMatch(/n > 0 && n === Math\.floor\(n\)/u);
    expect(body, '빈 인자를 거부하지 않는다').toMatch(/BAD_PARAMS/u);
    /* ★ 켜져 있지 않으면 켜지 않고 정직하게 말한다. */
    expect(body, '안 켜진 지표를 조용히 켠다').toMatch(/NOT_ON/u);
  });

  /*
     ★★★ **반환값을 믿지 않고 실제 상태를 다시 읽는다.**
       실측: MA 를 [10,30,60] 으로 바꿨더니 차트에는 반영됐는데 `overrideIndicator` 는
       false 를 돌려줬다. 그 값을 믿으면 AI 가 "바꾸지 못했다" 고 말하는데 화면은
       바뀐 상태가 된다.
  */
  it('적용 여부를 되읽어 확인한다 — 라이브러리 반환값을 믿지 않는다', () => {
    const i = kline.indexOf('setIndicatorParams(name, params)');
    const body = kline.slice(i, i + 2600);
    expect(body, '되읽어 확인하지 않는다')
      .toMatch(/const now = \(chart\.getIndicators\(\) \|\| \[\]\)\.find/u);
    expect(body, '설정값을 비교하지 않는다')
      .toMatch(/got\.every\(\(v, k\) => Number\(v\) === calcParams\[k\]\)/u);
    /* 옛 방식(반환값 신뢰)이 남아 있으면 안 된다. */
    expect(body, '반환값을 그대로 믿는 코드가 남아 있다')
      .not.toMatch(/overrideIndicator\([^)]*\) !== false/u);
  });

  it('도구 설명이 설정 변경 방법을 알려준다', () => {
    expect(tools, 'setIndicatorParams 인자 형식이 없다')
      .toMatch(/- setIndicatorParams: \{"indicator":"RSI","params":\[7\]\}/u);
    /* ★ 모델이 addIndicator 로 설정을 바꾸려 하면 다시 중복이 생긴다. 미리 막는다. */
    expect(tools, 'addIndicator 로 설정을 바꾸지 말라고 하지 않는다')
      .toMatch(/Do NOT call addIndicator again to change settings/u);
    /* ★ 안 켜진 지표는 addIndicator 를 쓰라고 안내해야 한다. */
    expect(tools, '안 켜진 경우 안내가 없다').toMatch(/If the indicator is not on yet, call addIndicator/u);
  });

  it('문구가 9개 언어에 있다', () => {
    const dir = join(ROOT, 'src/locales');
    const missing: string[] = [];
    for (const f of readdirSync(dir).filter((x) => /^[a-z]{2,3}\.js$/u.test(x))) {
      const s = readFileSync(join(dir, f), 'utf8');
      if (!s.includes('ai_indicator_added')) continue;
      for (const k of ['ai_indicator_params_set', 'ai_indicator_not_on', 'ai_indicator_params_failed']) {
        if (!s.includes(k)) missing.push(`${f} ${k}`);
      }
    }
    expect(missing, `문구가 빠진 사전:\n${missing.join('\n')}`).toEqual([]);
  });

  it('인자 스키마가 잘못된 값을 거부한다', () => {
    const ok = CHART_COMMAND_ARG_SCHEMAS.setIndicatorParams.safeParse({ indicator: 'RSI', params: [7] });
    expect(ok.success, ok.success ? '' : JSON.stringify(ok.error.issues)).toBe(true);
    for (const [why, args] of [
      ['0', { indicator: 'RSI', params: [0] }],
      ['음수', { indicator: 'RSI', params: [-5] }],
      ['소수', { indicator: 'RSI', params: [1.5] }],
      ['빈 배열', { indicator: 'RSI', params: [] }],
      ['목록 밖 지표', { indicator: 'NOPE', params: [7] }],
      ['봉 수 초과', { indicator: 'RSI', params: [5000] }],
    ] as const) {
      expect(CHART_COMMAND_ARG_SCHEMAS.setIndicatorParams.safeParse(args).success, `${why} 가 통과됐다`).toBe(false);
    }
  });
});
