import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { contractsFromQuantity } from '@quantumtrade/exchange-kucoin';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/*
   수량이 고객이 요청한 것보다 적게 나가는 문제.

   ★★ 무엇이 잘못돼 있었는가

     같은 결함이 **두 곳**에 있었고, 둘을 거치면 두 번 줄어들었다.

     1) 주문 패널(widgets.jsx snapQty): `Math.floor(q / step) * step`
          0.3   (스텝 0.1)   → 0.2
          2.9   (스텝 0.1)   → 2.8
          0.043 (스텝 0.001) → 0.042
        입력칸은 고객이 넣은 값을 그대로 보여주므로 **고객은 모른다.**

     2) 거래소 어댑터(private-rest.ts): `Number(qty) / multiplier` 후 `Math.floor`
          0.043 / 0.001 = 42.99999999999999 → 42계약 (정답 43)
          0.3   / 0.1   = 2.9999999999999996 → 2계약 (정답 3)

     곱셈은 이미 십진 문자열로 처리하고 있었는데 나눗셈과 내림만 float 로 남아 있었다.

   ★★ 방향이 중요하다

     오차를 없애려고 반올림으로 바꾸면 안 된다. 스텝의 배수가 아닌 입력을 **올리면**
     고객이 의도한 것보다 많이 주문된다 — 잔고를 넘겨 거부되거나, 더 나쁘게는 그대로
     체결된다. 확장은 반올림, 나눗셈은 내림이어야 한다.
*/

/** widgets.jsx 의 snapQty 를 소스에서 그대로 뽑아 실행한다. */
function loadSnapQty(qtyStep: number, qtyPrec: number): (q: number) => number {
  const src = read('src/widgets.jsx');
  const at = src.indexOf('const snapQty = (q) => {');
  if (at < 0) throw new Error('snapQty 를 찾지 못했다 — 구현이 바뀌었다');
  /* 함수 본문 끝(`};`)까지 잘라낸다. */
  const end = src.indexOf('\n    };', at);
  const body = src.slice(at, end + '\n    };'.length);
  // eslint-disable-next-line no-new-func
  return new Function('qtyStep', 'qtyPrec', `${body}\nreturn snapQty;`)(qtyStep, qtyPrec) as (q: number) => number;
}

describe('ORDER-QUANTITY — 요청한 수량이 그대로 나간다', () => {
  it('[1] 주문 패널이 배수 입력을 줄이지 않는다', () => {
    /*
       ★★ 이것이 실제로 겪던 결함이다. 0.3 을 넣으면 0.2 가 나갔다.
    */
    const snap = loadSnapQty(0.1, 1);
    for (const q of [0.1, 0.2, 0.3, 0.7, 1.1, 2.9, 10.5]) {
      expect(snap(q), `${q} 가 줄었다`).toBeCloseTo(q, 10);
    }
    const snap3 = loadSnapQty(0.001, 3);
    for (const q of [0.043, 0.001, 0.123, 1.007]) {
      expect(snap3(q), `${q} 가 줄었다`).toBeCloseTo(q, 10);
    }
  });

  it('[2] 배수가 아닌 입력은 내림한다 — 절대 올리지 않는다', () => {
    /*
       ★★ 올리면 고객이 의도한 것보다 많이 주문된다. 이쪽이 더 위험하다.
    */
    const snap = loadSnapQty(0.1, 1);
    expect(snap(0.15)).toBeCloseTo(0.1, 10);
    expect(snap(0.19)).toBeCloseTo(0.1, 10);
    expect(snap(2.99)).toBeCloseTo(2.9, 10);
    /* ★ 스텝 미달은 0 이 된다. 별도 경고가 그것을 잡아 고객에게 말한다. */
    expect(snap(0.05)).toBe(0);
  });

  it('[3] 정수 스텝에서도 맞는다', () => {
    const snap10 = loadSnapQty(10, 0);
    expect(snap10(20)).toBe(20);
    expect(snap10(15)).toBe(10);
    expect(snap10(9)).toBe(0);
    const snap1 = loadSnapQty(1, 0);
    expect(snap1(2)).toBe(2);
    expect(snap1(1.7)).toBe(1);
  });

  it('[4] 계약 변환이 부동소수 오차로 1계약을 잃지 않는다', () => {
    /*
       ★★ 실측 사례를 그대로 고정한다. 0.043 / 0.001 은 float 로 42.99999999999999 다.
    */
    expect(contractsFromQuantity('0.043', '0.001')).toBe(43);
    expect(contractsFromQuantity('0.3', '0.1')).toBe(3);
    expect(contractsFromQuantity('2.9', '0.1')).toBe(29);
    expect(contractsFromQuantity('0.07', '0.01')).toBe(7);
    expect(contractsFromQuantity('100', '1')).toBe(100);
  });

  it('[5] 계약 변환이 배수 아닌 입력을 내림한다', () => {
    expect(contractsFromQuantity('0.15', '0.1')).toBe(1);
    expect(contractsFromQuantity('0.0435', '0.001')).toBe(43);
    /* ★ 1계약 미달은 0 — 호출자가 최소 미달로 거부한다. */
    expect(contractsFromQuantity('0.0005', '0.001')).toBe(0);
  });

  it('[6] 계산할 수 없으면 null 이다 — 0 으로 떨어뜨리지 않는다', () => {
    /*
       ★ 0 을 돌려주면 "최소 미달" 로 읽혀 원인을 찾기 어렵다. 잘못된 입력과 미달은
         다른 사실이다.
    */
    expect(contractsFromQuantity('abc', '0.1')).toBeNull();
    expect(contractsFromQuantity('0.1', '0')).toBeNull();
    expect(contractsFromQuantity('0.1', '-1')).toBeNull();
    expect(contractsFromQuantity('-1', '0.1')).toBeNull();
  });

  it('[7] float 나눗셈·내림이 주문 경로에서 사라졌다', () => {
    /*
       ★ 같은 실수가 다시 들어오는 것을 막는다. 이 파일에서 Math.floor 로 계약을
         계산하면 안 된다.
    */
    const src = read('packages/exchange-kucoin/src/private-rest.ts');
    expect(src, '정확한 변환을 쓰지 않는다').toMatch(/contractsFromQuantity/);
    expect(src, 'float 나눗셈이 남아 있다').not.toMatch(/qty \/ \(multiplier/);
    expect(src, 'Math.floor 로 계약을 계산한다').not.toMatch(/Math\.floor\(rawContracts\)/);
  });
});
