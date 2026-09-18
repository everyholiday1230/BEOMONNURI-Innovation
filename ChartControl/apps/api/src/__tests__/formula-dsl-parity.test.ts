import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateIndicatorFormula, ALLOWED_FUNCS, ALLOWED_VARS } from '../ai/indicator-formula';

/*
   **클라이언트 DSL 과 서버 검증이 같은 문법을 받는지 잠근다.**

   ★★★ 왜 필요한가 — **한쪽만 늘리면 조용히 어긋난다.**

     `src/formula-dsl.js` 는 화면에서 값을 계산하고, `apps/api/src/ai/indicator-formula.ts`
     는 서버에서 관문 역할을 한다. 문법을 늘릴 때 한쪽만 고치면:
       · 서버만 늘림 → 서버는 통과시키는데 화면이 그리지 못한다
       · 화면만 늘림 → 화면에서는 되는데 저장·AI 경로에서 거부된다(고객은 이유를 모른다)
     두 경우 다 "왜 안 되는지 알 수 없는" 상태가 된다.

   ★ 서버는 **평가하지 않는다**(문법·이름·인자수·복잡도만 본다). 그래서 값 계산까지
     비교하지는 않는다. 비교하는 것은 **받아들이는 문법의 범위**다.
*/

const ROOT = join(__dirname, '../../../..');
const dslSrc = readFileSync(join(ROOT, 'src/formula-dsl.js'), 'utf8');

/** 클라이언트 DSL 을 실제로 불러와 쓴다 — 소스를 정규식으로 훑지 않는다. */
function loadClientDsl(): {
  parse(s: string): { ok: boolean; error?: string };
  FUNCS: string[]; VARS: string[];
  MAX_LEN: number; MAX_NODES: number; MAX_CALL_DEPTH: number;
} {
  const sandbox: { window?: Record<string, unknown> } = { window: {} };
  /*
     ★ DSL 은 `window.QTFmla = {...}` 로 자기를 내보내는 브라우저 스크립트다.
       Function 으로 감싸 window 만 넘겨 실행한다 — 시험이 파일을 그대로 쓰므로
       "시험용 복사본" 이 원본과 어긋날 여지가 없다.
  */
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('window', dslSrc)(sandbox.window);
  return (sandbox.window as { QTFmla: ReturnType<typeof loadClientDsl> }).QTFmla;
}

const server = (expression: string) =>
  validateIndicatorFormula({ name: 'T', expression, pane: 'separate' });

describe('DSL 문법이 화면과 서버에서 같다', () => {
  const dsl = loadClientDsl();

  it('허용 함수 목록이 정확히 같다', () => {
    expect([...dsl.FUNCS].sort(), '함수 목록이 어긋난다')
      .toEqual([...ALLOWED_FUNCS].sort());
  });

  it('허용 변수 목록이 정확히 같다', () => {
    expect([...dsl.VARS].sort(), '변수 목록이 어긋난다')
      .toEqual([...ALLOWED_VARS].sort());
  });

  it('한도가 같다 — 다르면 한쪽에서만 통과한다', () => {
    const ts = readFileSync(join(ROOT, 'apps/api/src/ai/indicator-formula.ts'), 'utf8');
    const num = (re: RegExp) => {
      const m = re.exec(ts);
      expect(m, `서버에서 ${re} 를 찾지 못했다`).not.toBeNull();
      return Number(m![1]);
    };
    expect(dsl.MAX_NODES, '노드 상한이 어긋난다').toBe(num(/const MAX_NODES = (\d+)/u));
    expect(dsl.MAX_CALL_DEPTH, '중첩 상한이 어긋난다').toBe(num(/const MAX_CALL_DEPTH = (\d+)/u));
    /* 길이 상한은 스키마의 max() 와 상수 둘 다에 있다 — 셋이 모두 같아야 한다. */
    expect(dsl.MAX_LEN, '길이 상한이 어긋난다').toBe(num(/MAX_EXPRESSION_LEN = (\d+)/u));
    expect(dsl.MAX_LEN, '스키마 max 가 상수와 다르다')
      .toBe(num(/expression: z\.string\(\)\.trim\(\)\.min\(1\)\.max\((\d+)\)/u));
  });

  /*
     ★★ 실제 식으로 양쪽을 함께 돌린다. 목록 비교만으로는 **문법**(연산자·우선순위)이
       어긋난 것을 잡지 못한다 — 함수 이름이 같아도 `AND` 를 한쪽만 알면 갈린다.
  */
  const ACCEPT = [
    'close',
    'SMA(close,20)',
    'EMA(close,12) - EMA(close,26)',
    'close > open',
    'close >= open',
    'close != open',
    'close > open AND volume > 1000',
    'close > open OR close < low',
    'NOT (close > open)',
    'RSI(close,14)',
    'RSI(close,14) < 30',
    'ATR(14)',
    'MACD_DIF(12,26)',
    'MACD_DEA(12,26,9)',
    'MACD_HIST(12,26,9)',
    'CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))',
    'CROSS_BELOW(MACD_DIF(12,26), MACD_DEA(12,26,9))',
    'CROSS_ABOVE(SMA(close,5), SMA(close,20))',
    'CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9)) AND RSI(close,14) < 70',
    'close > REF(HHV(high,20),1)',
    'close < REF(LLV(low,20),1)',
    'RISING(close,3)',
    'FALLING(close,3)',
    'COUNT(close > open, 20)',
    'COUNT(close > open, 20) >= 15',
    'SUM(volume,10)',
    'STDDEV(close,20)',
    'SMA(close,20) + 2 * STDDEV(close,20)',
  ];

  const REJECT: [string, string][] = [
    ['close = open', '대입 기호'],
    ['close < high < 200', '비교 연쇄'],
    ['close AND', '뒤가 빈 논리'],
    ['AND close', '앞이 빈 논리'],
    ['eval(1)', '화이트리스트 밖 이름'],
    ['process.exit(1)', '코드 주입'],
    ['window', '화이트리스트 밖 변수'],
    ['RSI(close)', '인자 부족'],
    ['ATR(close,14)', 'ATR 인자 개수'],
    ['MACD_DEA(12,26)', 'MACD_DEA 인자 부족'],
    ['close +', '식이 끊김'],
    ['(close', '괄호 불균형'],
    ['close!', '단독 느낌표'],
  ];

  it.each(ACCEPT)('양쪽이 함께 허용한다: %s', (expr) => {
    const c = dsl.parse(expr);
    const s = server(expr);
    expect(c.ok, `화면이 거부했다: ${c.error}`).toBe(true);
    expect(s.ok, `서버가 거부했다: ${s.ok ? '' : s.code}`).toBe(true);
  });

  it.each(REJECT)('양쪽이 함께 거부한다: %s (%s)', (expr) => {
    const c = dsl.parse(expr);
    const s = server(expr);
    expect(c.ok, '화면이 통과시켰다').toBe(false);
    expect(s.ok, '서버가 통과시켰다').toBe(false);
  });

  it('비교 연쇄는 **연쇄라고** 알려주며 거부한다', () => {
    /*
       ★★★ 거부되는 것만으로는 부족하다 — 역검증에서 드러났다.

         연쇄 금지 검사를 지워도 `close < high < 200` 은 여전히 거부된다. 남은 `<` 가
         어디에도 맞지 않아 `TRAILING_TOKENS` 가 되기 때문이다. 즉 "거부됐다" 만
         확인하는 시험은 그 규칙이 사라진 것을 **잡지 못했다.**

       ★ 그런데 오류 문구가 다르면 고객 경험이 달라진다. "식 뒤에 남는 기호가 있다"
         는 무엇을 고쳐야 하는지 알려주지 않는다. `a < b AND b < c` 로 쓰라고
         말해야 한다. 그래서 **오류의 종류까지** 잠근다.
    */
    const c = dsl.parse('close < high < 200');
    expect(c.ok).toBe(false);
    expect(c.error, '화면 오류가 연쇄를 지목하지 않는다').toBe('CHAINED_COMPARISON');

    const s = server('close < high < 200');
    expect(s.ok).toBe(false);
    expect(s.ok ? '' : s.code, '서버 오류가 연쇄를 지목하지 않는다').toBe('CHAINED_COMPARISON');
    expect(s.ok ? '' : s.message, '고칠 방법을 알려주지 않는다').toMatch(/AND/u);
  });

  it('상한을 넘는 식을 양쪽이 함께 거부한다', () => {
    /* 길이: 상한 + 여유 */
    const long = 'close+'.repeat(Math.ceil((dsl.MAX_LEN + 20) / 6)) + 'close';
    expect(dsl.parse(long).ok, '화면이 긴 식을 통과시켰다').toBe(false);
    expect(server(long).ok, '서버가 긴 식을 통과시켰다').toBe(false);

    /* 중첩: 상한 + 1 단계 */
    let deep = 'close';
    for (let i = 0; i <= dsl.MAX_CALL_DEPTH; i++) deep = `SMA(${deep},2)`;
    expect(dsl.parse(deep).ok, '화면이 깊은 중첩을 통과시켰다').toBe(false);
    expect(server(deep).ok, '서버가 깊은 중첩을 통과시켰다').toBe(false);

    /* 상한 안쪽 중첩은 양쪽이 통과해야 한다 — 상한이 정상 사용을 막지 않는다. */
    let okDeep = 'close';
    for (let i = 0; i < dsl.MAX_CALL_DEPTH; i++) okDeep = `SMA(${okDeep},2)`;
    expect(dsl.parse(okDeep).ok, '화면이 허용 범위 중첩을 거부했다').toBe(true);
    expect(server(okDeep).ok, '서버가 허용 범위 중첩을 거부했다').toBe(true);
  });
});
