/**
 * tickSize 로부터 가격 소수 자리수를 구하는 계산.
 *
 * ★★★ 이것이 틀려서 **손절·익절이 0 이 되어 사라졌다. 고객 돈이 걸린 결함이다.**
 *
 *   예전 코드(widgets.jsx): `String(tickSz).split('.')[1].length`
 *
 *   tickSz 는 숫자다. 자바스크립트는 **1e-7 이하를 지수표기로 문자열화한다:**
 *
 *       String(1e-7) === '1e-7'   → split('.')[1] 없음 → 자리수 0
 *
 *   그러면 snapPrice 의 `toFixed(0)` 이 가격을 정수로 반올림한다. 밈코인 가격은
 *   0.00002 수준이라 결과가 **0** 이다.
 *
 *   TP/SL 이 0 이면 hasTp/hasSl 이 false → bracketOut 이 null → 지정가는 서버가
 *   막지만 **시장가는 정상 접수되어 손절 없는 포지션이 열린다.**
 *
 * ★ 그래서 이 계산은 단위 시험으로 못을 박아 둔다. 문자열 파싱으로 되돌아가면
 *   같은 사고가 반복된다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** widgets.jsx 와 같은 계산. 구현이 갈라지면 아래 '소스 대조' 시험이 잡는다. */
function pricePrecisionOf(tickSz: number): number {
  if (!(tickSz > 0) || !Number.isFinite(tickSz)) return 0;
  const [mant, exp] = tickSz.toExponential().split('e');
  /* ★ noUncheckedIndexedAccess: split 결과는 undefined 가능이다. */
  const mantDecimals = ((mant ?? '').split('.')[1] || '').length;
  return Math.max(0, Math.min(12, mantDecimals - Number(exp)));
}

const snap = (p: number, tick: number) =>
  Number((Math.round(p / tick) * tick).toFixed(pricePrecisionOf(tick)));

describe('tickSize → 가격 소수 자리수', () => {
  it('★ 지수표기 tick(1e-7 이하)에서 자리수를 잃지 않는다', () => {
    /*
       ★★ 여기가 무너진 지점이다. 예전 구현은 이 세 경우 모두 0 을 돌려줬다.
    */
    expect(pricePrecisionOf(1e-7)).toBe(7);
    expect(pricePrecisionOf(1e-8)).toBe(8);
    expect(pricePrecisionOf(1e-9)).toBe(9);
  });

  it('10의 거듭제곱이 아닌 tick 도 맞다', () => {
    /* ★ log10 방식은 0.5 에서 0 을 돌려줘 .5 단위를 잃는다. */
    expect(pricePrecisionOf(0.5)).toBe(1);
    expect(pricePrecisionOf(0.0025)).toBe(4);
    expect(pricePrecisionOf(1.5e-5)).toBe(6);
  });

  it('부동소수 오차가 자리수를 부풀리지 않는다', () => {
    /*
       ★★ toFixed(20) 방식은 (0.001).toFixed(20) === '0.00100000000000000002' 때문에
         자리수를 12 로 부풀렸다. 가격은 맞지만 문자열이 지저분해지고 상한에 걸린다.
    */
    expect(pricePrecisionOf(0.001)).toBe(3);
    expect(pricePrecisionOf(0.01)).toBe(2);
    expect(pricePrecisionOf(1)).toBe(0);
  });

  it('잘못된 입력에서 터지지 않는다', () => {
    expect(pricePrecisionOf(0)).toBe(0);
    expect(pricePrecisionOf(-1)).toBe(0);
    expect(pricePrecisionOf(Number.NaN)).toBe(0);
    expect(pricePrecisionOf(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('★★★ 소액 단위 심볼에서 가격이 0 이 되지 않는다 — 손절 소실 방지', () => {
    /*
       ★ 이것이 이 시험 파일의 존재 이유다. 밈코인 가격대(0.00001~0.00003)에서
         tick 이 1e-9 ~ 1e-5 인 모든 조합이 0 이 아니어야 한다.
    */
    const prices = [0.00001234, 0.000021, 0.0000075, 0.00002999];
    const ticks = [1e-9, 1e-8, 1e-7, 1e-6, 1e-5];
    for (const p of prices) {
      for (const t of ticks) {
        const v = snap(p, t);
        expect(v, `price ${p} · tick ${t} 이 0 이 됐다 — 손절이 사라진다`).toBeGreaterThan(0);
      }
    }
  });

  it('tick 배수로 정확히 스냅된다', () => {
    expect(snap(0.00001234, 1e-6)).toBeCloseTo(0.000012, 9);
    expect(snap(123.456, 0.01)).toBeCloseTo(123.46, 9);
    expect(snap(100.3, 0.5)).toBeCloseTo(100.5, 9);
  });

  it('★ 소스 대조 — widgets.jsx 가 문자열 파싱으로 되돌아가지 않았는가', () => {
    /*
       ★★ 구현이 갈라지면 이 시험이 통과하는데 제품은 깨진 상태가 된다.
         그래서 실제 파일에서 옛 방식이 사라졌는지 확인한다.
    */
    const raw = readFileSync(new URL('../../../../src/widgets.jsx', import.meta.url), 'utf-8');
    /*
       ★ 주석에는 "예전에는 …였다" 설명이 남아 있다(왜 고쳤는지 기록). 검사는 **코드**만
         봐야 한다 — 주석을 함께 보면 설명을 지우게 되고, 그러면 다음 사람이 이유를
         모른다. 블록·행 주석을 먼저 걷어낸다.
    */
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src, '옛 문자열 파싱이 코드에 남아 있다').not.toContain("String(tickSz).split('.')[1]");
    expect(src, '지수표기 파싱을 쓰지 않는다').toContain('tickSz.toExponential()');
  });
});
