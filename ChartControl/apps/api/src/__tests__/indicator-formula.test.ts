import { describe, it, expect } from 'vitest';
import { validateIndicatorFormula } from '../ai/indicator-formula';

/**
 * 커스텀 지표 수식 검증 테스트 — AI 출력·사용자 입력이 같은 관문을 통과한다.
 */
describe('indicator formula validation', () => {
  it('정상 수식을 통과시킨다', () => {
    const r = validateIndicatorFormula({ name: 'MyVol', expression: 'SMA(close,20) / SMA(close,50)', pane: 'separate' });
    expect(r.ok).toBe(true);
  });

  it('화이트리스트 밖 이름을 거부한다 (코드 주입 차단)', () => {
    for (const bad of ['fetch(close,10)', 'constructor.length', 'process.exit', 'eval(close)']) {
      const r = validateIndicatorFormula({ name: 'x', expression: bad });
      if (r.ok) expect.fail(`should reject: ${bad}`);
      expect(['UNKNOWN_NAME', 'BAD_CHAR']).toContain(r.code);
    }
  });

  it('균형 깨진 괄호를 거부한다', () => {
    const r = validateIndicatorFormula({ name: 'x', expression: 'SMA(close,10' });
    expect(r.ok).toBe(false);
  });

  /*
     ★★ 예전 이 시험은 `'close+'.repeat(50)`(=300자)로 "과길이" 를 확인한다고 적혀
       있었다. 상한은 **400자**이므로 길이를 넘지 않는다. 실제로 이 입력이 걸러져야
       하는 이유는 길이가 아니라 **문법**이다 — 끝이 `+` 로 끊긴다.

       그런데 그때 서버는 문법을 보지 않았기 때문에 이 식을 통과시켰고, 시험은
       "과길이를 막는다" 는 **틀린 이유로** 실패하고 있었다. 두 가지를 나눠서 본다.
  */
  it('길이 상한(600자)을 넘으면 거부한다', () => {
    /*
       ★ 상한을 400 → 600 으로 올렸다(2026-09-18). 조건식은 지표식보다 길다:
         `CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9)) AND RSI(close,14) < 70`
         한 줄이 이미 70자다. 클라이언트 DSL 의 MAX_LEN 과 같은 값이어야 한다
         (formula-dsl-parity.test.ts 가 셋을 함께 잠근다).
    */
    const tooLong = `${'close+'.repeat(110)}close`;  // 110*6+5 = 665자
    expect(tooLong.length).toBeGreaterThan(600);
    const r = validateIndicatorFormula({ name: 'x', expression: tooLong });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_FORMULA');
  });

  it('길이는 넘지 않지만 문법이 깨진 식을 거부한다 — 서버가 직접 파싱한다', () => {
    /*
       ★ 짧은 식을 쓴다. `'close+'.repeat(50)` 은 노드 99개라 길이보다 **복잡도**
         상한에 먼저 걸려서(TOO_COMPLEX) 문법 검사를 시험하지 못한다.
    */
    for (const [bad, code] of [
      ['close+', 'UNEXPECTED_END'],
      ['SMA(close,20) *', 'UNEXPECTED_END'],
      ['close close', 'TRAILING_TOKENS'],
      ['close,20', 'TRAILING_TOKENS'],
      ['*close', 'UNEXPECTED_TOKEN'],
    ] as const) {
      const r = validateIndicatorFormula({ name: 'x', expression: bad });
      expect(r.ok, `문법이 깨진 식이 서버를 통과했다: ${bad}`).toBe(false);
      if (!r.ok) expect(r.code, `${bad} 의 사유`).toBe(code);
    }
  });

  it('노드 상한을 넘는 식을 거부한다', () => {
    /* 600자 안에서 노드 160개를 넘긴다 — 'close+' 는 노드 2개씩 늘린다. */
    const many = `${'close+'.repeat(90)}close`;      // 545자, 노드 약 181개
    expect(many.length).toBeLessThanOrEqual(600);
    const r = validateIndicatorFormula({ name: 'x', expression: many });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_COMPLEX');
  });

  /*
     ★★ 인자 개수를 서버가 봐야 하는 이유: 평가기(src/formula-dsl.js evalNode)는
       `MIN(close)` 를 받으면 `node.args[1]` 이 undefined 인 채로 재귀해 터진다.
       이름 화이트리스트만으로는 이 입력을 막을 수 없다.
  */
  it('함수 인자 개수가 틀리면 거부한다', () => {
    for (const bad of ['MIN(close)', 'SMA(close)', 'ABS(close,10)', 'STDDEV(close)', 'MAX(close)']) {
      const r = validateIndicatorFormula({ name: 'x', expression: bad });
      expect(r.ok, `통과해서는 안 된다: ${bad}`).toBe(false);
      if (!r.ok) expect(r.code).toBe('BAD_ARITY');
    }
  });

  it('선언한 중첩 상한(4단계)을 넘으면 거부한다', () => {
    const deep = 'SMA(EMA(SMA(EMA(SMA(close,5),5),5),5),5)';   // 5단계
    const r = validateIndicatorFormula({ name: 'x', expression: deep });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('TOO_DEEP');
  });

  it('중첩 4단계는 통과한다 — 상한이 정상 사용을 막지 않는다', () => {
    const r = validateIndicatorFormula({ name: 'x', expression: 'SMA(EMA(SMA(EMA(close,5),5),5),5)' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });

  /*
     ★★ 조건식(2026-09-18) — 고객이 **자기 신호 규칙**을 쓰는 경로다.

       여기가 막히면 "MACD 골든크로스면 매수" 같은 규칙을 아예 저장할 수 없다.
       문법이 실제로 통과하는지 대표 식으로 확인한다.
  */
  it('조건식을 통과시킨다 — 비교·논리·교차·지표', () => {
    for (const expr of [
      'close > open',
      'RSI(close,14) < 30',
      'close > open AND volume > 1000',
      'NOT (close > open)',
      'CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9))',
      'CROSS_BELOW(SMA(close,5), SMA(close,20))',
      'CROSS_ABOVE(MACD_DIF(12,26), MACD_DEA(12,26,9)) AND RSI(close,14) < 70',
      'close > REF(HHV(high,20),1)',
      'RISING(close,3)',
      'COUNT(close > open, 20) >= 15',
      'ATR(14) > 0',
    ]) {
      const r = validateIndicatorFormula({ name: 'x', expression: expr });
      expect(r.ok, `거부됐다: ${expr} → ${r.ok ? '' : r.code}`).toBe(true);
    }
  });

  it('대입 기호와 비교 연쇄를 거부한다 — 조용히 엉뚱한 값이 되는 것을 막는다', () => {
    const eq = validateIndicatorFormula({ name: 'x', expression: 'close = open' });
    expect(eq.ok).toBe(false);
    if (!eq.ok) expect(eq.code).toBe('BAD_OPERATOR');

    /*
       ★★★ `a < b < c` 는 수학처럼 읽히지만 왼쪽부터 접으면 `(a<b) < c` 가 되어
         **0 또는 1 을 c 와 비교한다.** 조용히 틀린 결과가 나오므로 거부한다.
    */
    const chain = validateIndicatorFormula({ name: 'x', expression: 'close < high < 200' });
    expect(chain.ok).toBe(false);
    if (!chain.ok) {
      expect(chain.code).toBe('CHAINED_COMPARISON');
      expect(chain.message, '고칠 방법을 알려주지 않는다').toMatch(/AND/u);
    }
  });

  it('논리 낱말이 값 자리에 오면 원인을 지목해 거부한다', () => {
    const r = validateIndicatorFormula({ name: 'x', expression: 'AND close' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('UNEXPECTED_LOGIC');
  });

  it('통과한 식은 AST 를 함께 돌려준다 — 통과 사실이 파싱 성공을 뜻한다', () => {
    const r = validateIndicatorFormula({ name: 'x', expression: 'SMA(close,20) - SMA(close,50)' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.descriptor.ast).toBeTruthy();
  });

  it('POW 는 지수를 생략해도 된다 (평가기가 2 로 본다)', () => {
    expect(validateIndicatorFormula({ name: 'x', expression: 'POW(close)' }).ok).toBe(true);
    expect(validateIndicatorFormula({ name: 'x', expression: 'POW(close,3)' }).ok).toBe(true);
  });

  it('허용된 함수·변수 조합은 통과한다', () => {
    const r = validateIndicatorFormula({ name: 'BB', expression: 'STDDEV(close,20) * 2 + SMA(close,20)', pane: 'price' });
    expect(r.ok).toBe(true);
  });
});

