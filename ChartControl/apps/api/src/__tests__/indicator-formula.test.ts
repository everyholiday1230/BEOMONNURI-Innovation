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

  it('과길이 표현식을 거부한다', () => {
    const r = validateIndicatorFormula({ name: 'x', expression: 'close+'.repeat(50) });
    expect(r.ok).toBe(false);
  });

  it('허용된 함수·변수 조합은 통과한다', () => {
    const r = validateIndicatorFormula({ name: 'BB', expression: 'STDDEV(close,20) * 2 + SMA(close,20)', pane: 'price' });
    expect(r.ok).toBe(true);
  });
});
