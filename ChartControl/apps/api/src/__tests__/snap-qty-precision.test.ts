/**
 * `snapQty` 의 마지막 반올림이 스텝 정렬을 되돌리지 않는지 고정한다.
 *
 * ★★ 무엇이 문제였나
 *
 *   `Number(snapped.toFixed(qtyPrec))` 에서 `qtyPrec` 이 스텝의 소수 자리수보다
 *   **거칠면** 정렬해 둔 값이 다시 왜곡된다.
 *
 *     step=0.01  prec=1  0.29  → 0.3    ← **상향**
 *     step=0.1   prec=0  2.9   → 3      ← **상향**
 *     step=0.001 prec=2  0.043 → 0.04   ← 하향
 *
 *   상향이 특히 나쁘다 — 고객이 요청한 것보다 **많은 수량**이 거래소로 나간다.
 *
 * ★ 지금은 도달하지 않는다(quantityPrecision 이 stepSize 에서 파생된다). 그러나 두
 *   값을 독립적으로 정하는 어댑터가 하나 추가되면 되살아난다. 그때 이 테스트가 잡는다.
 *
 * ★ JSX 에서 함수 본문을 떼어 **실제 코드 그대로** 돌린다. 여기서 로직을 다시 쓰면
 *   테스트는 통과하는데 화면은 틀린 상태가 될 수 있다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** widgets.jsx 의 snapQty 를 꺼내 qtyStep·qtyPrec 을 주입한 함수로 만든다. */
function loadSnapQty(qtyStep: number, qtyPrec: number): (q: number) => number {
  const src = readFileSync(new URL('../../../../src/widgets.jsx', import.meta.url), 'utf-8');
  const start = src.indexOf('const snapQty = (q) => {');
  expect(start, 'widgets.jsx 에서 snapQty 를 찾지 못했다').toBeGreaterThan(-1);
  const end = src.indexOf('\n    };', start);
  const body = src.slice(start, end + 7).replace('const snapQty =', 'return ').replace(/;\s*$/, '');
  // eslint-disable-next-line no-new-func
  return new Function('qtyStep', 'qtyPrec', body)(qtyStep, qtyPrec) as (q: number) => number;
}

describe('snapQty — 마지막 반올림이 정렬을 되돌리지 않는다', () => {
  const cases: Array<[number, number, number, number]> = [
    /* [step, prec, 입력, 기대] — 감사가 실측한 세 경우 */
    [0.01, 1, 0.29, 0.29],
    [0.1, 0, 2.9, 2.9],
    [0.001, 2, 0.043, 0.043],
    /* prec 이 스텝과 맞는 정상 경우도 그대로여야 한다 */
    [0.001, 3, 0.043, 0.043],
    [0.1, 1, 0.3, 0.3],
    /* 스텝의 배수가 아니면 내린다 — 올리면 요청보다 많이 나간다 */
    [0.001, 3, 0.0435, 0.043],
    [10, 0, 15, 10],
  ];

  for (const [step, prec, input, want] of cases) {
    it(`step=${step} prec=${prec} · ${input} → ${want}`, () => {
      const got = loadSnapQty(step, prec)(input);
      expect(got).toBeCloseTo(want, 9);
    });
  }

  it('★ 어떤 조합에서도 입력보다 커지지 않는다', () => {
    /*
       상향은 하향보다 나쁘다 — 고객이 요청하지 않은 수량이 나간다.
       스텝·자리수·입력을 조합해 전수로 확인한다.
    */
    const steps = [0.001, 0.01, 0.1, 1, 10];
    const precs = [0, 1, 2, 3];
    let checked = 0;
    for (const step of steps) {
      for (const prec of precs) {
        const f = loadSnapQty(step, prec);
        for (let k = 1; k <= 40; k += 1) {
          const input = Number((k * 0.037).toFixed(4));
          const got = f(input);
          checked += 1;
          expect(got, `step=${step} prec=${prec} 입력=${input} → ${got}`)
            .toBeLessThanOrEqual(input + 1e-9);
        }
      }
    }
    expect(checked).toBe(steps.length * precs.length * 40);
  });
});
