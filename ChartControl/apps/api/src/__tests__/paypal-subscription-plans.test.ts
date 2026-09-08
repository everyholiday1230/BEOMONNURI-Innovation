/**
 * PayPal 정기결제 — **화면 금액과 실제 청구가 어긋나지 않는지** 고정한다.
 *
 * ★★ 무엇을 막는 테스트인가
 *
 *   PayPal 대시보드에서 플랜 금액을 바꿀 수 있다. 그러면 우리 화면은 $19 를 보여주고
 *   실제로는 다른 금액이 청구된다. **고객은 화면을 보고 결제하므로 그 어긋남은 우리
 *   책임이다.** 그래서 부팅 때 대조하고, 어긋난 플랜은 팔지 않는다.
 *
 *   그리고 sandbox/live 플랜 ID 가 다르다. 코드에 박으면 시험 중에 실제 돈이 청구되는
 *   사고가 난다 — 그래서 환경변수로만 받는다.
 */
import { describe, it, expect } from 'vitest';

import {
  readPlanMapping, isPurchasable, expectedMonthlyUsd, verifyPlanAmounts,
  PAID_PLAN_CODES,
} from '../subscriptions/paypal-plans.js';
import { PLANS } from '../subscriptions/plans.js';

const FULL = {
  PAYPAL_PLAN_BASIC: 'P-BASIC',
  PAYPAL_PLAN_PRO: 'P-PRO',
  PAYPAL_PLAN_PREMIUM: 'P-PREM',
  PAYPAL_PLAN_ELITE: 'P-ELITE',
} as NodeJS.ProcessEnv;

/** PayPal 플랜 조회를 흉내낸다. */
const stub = (over: Record<string, Partial<{
  ok: boolean; amount: string; currency: string; intervalUnit: string; intervalCount: number; status: string;
}>> = {}) => async (planId: string) => ({
  ok: true,
  amount: { 'P-BASIC': '19.00', 'P-PRO': '49.00', 'P-PREM': '99.00', 'P-ELITE': '199.00' }[planId] ?? '0',
  currency: 'USD',
  intervalUnit: 'MONTH',
  intervalCount: 1,
  status: 'ACTIVE',
  ...(over[planId] ?? {}),
});

describe('플랜 매핑', () => {
  it('환경변수에서 읽는다 — 코드에 박지 않는다', () => {
    const m = readPlanMapping(FULL);
    expect(m.missing).toEqual([]);
    expect(m.byCode.basic).toBe('P-BASIC');
  });

  it('설정이 빠진 플랜은 missing 에 들어가고 팔 수 없다', () => {
    const m = readPlanMapping({ PAYPAL_PLAN_BASIC: 'P-BASIC' } as NodeJS.ProcessEnv);
    expect(m.missing).toEqual(['pro', 'premium', 'elite']);
    expect(isPurchasable(m, 'pro')).toBe(false);
    expect(isPurchasable(m, 'basic')).toBe(true);
  });

  it('공백만 있는 값은 없는 것으로 본다', () => {
    /* Render 에서 실수로 빈 값을 넣으면 '  ' 가 들어오고, 그것을 PayPal 에 보내면 400 이다. */
    const m = readPlanMapping({ ...FULL, PAYPAL_PLAN_PRO: '   ' } as NodeJS.ProcessEnv);
    expect(m.missing).toContain('pro');
  });

  it('free 플랜은 결제 대상이 아니다', () => {
    expect(isPurchasable(readPlanMapping(FULL), 'free')).toBe(false);
    expect(PAID_PLAN_CODES).not.toContain('free' as never);
  });

  it('기대 금액은 plans.ts 의 정의를 그대로 쓴다 (두 곳에 적지 않는다)', () => {
    for (const code of PAID_PLAN_CODES) {
      const plan = PLANS.find((p) => p.code === code)!;
      expect(expectedMonthlyUsd(code)).toBe(Number(plan.priceUsd).toFixed(2));
    }
  });
});

describe('금액 대조', () => {
  it('전부 맞으면 통과한다', async () => {
    const checks = await verifyPlanAmounts(readPlanMapping(FULL), stub());
    expect(checks).toHaveLength(4);
    expect(checks.every((c) => c.ok), JSON.stringify(checks)).toBe(true);
  });

  it('★ 금액이 다르면 잠근다 — 화면 $19, 실제 $29 를 막는다', async () => {
    const checks = await verifyPlanAmounts(readPlanMapping(FULL), stub({ 'P-BASIC': { amount: '29.00' } }));
    const basic = checks.find((c) => c.code === 'basic')!;
    expect(basic.ok).toBe(false);
    expect(basic.detail).toContain('29.00');
    /* 나머지는 영향받지 않는다 — 한 플랜 문제로 전부 막으면 매출이 멈춘다. */
    expect(checks.filter((c) => c.ok)).toHaveLength(3);
  });

  it('★ 주기가 다르면 잠근다 — 금액이 같아도 1시간마다면 전혀 다른 상품이다', async () => {
    const checks = await verifyPlanAmounts(readPlanMapping(FULL),
      stub({ 'P-PRO': { intervalUnit: 'HOUR' } }));
    const pro = checks.find((c) => c.code === 'pro')!;
    expect(pro.ok).toBe(false);
    expect(pro.detail).toMatch(/주기/);
  });

  it('통화가 다르면 잠근다', async () => {
    const checks = await verifyPlanAmounts(readPlanMapping(FULL), stub({ 'P-ELITE': { currency: 'EUR' } }));
    expect(checks.find((c) => c.code === 'elite')!.ok).toBe(false);
  });

  it('비활성 플랜은 잠근다', async () => {
    const checks = await verifyPlanAmounts(readPlanMapping(FULL), stub({ 'P-PREM': { status: 'INACTIVE' } }));
    expect(checks.find((c) => c.code === 'premium')!.ok).toBe(false);
  });

  it('★ 조회 실패를 통과로 다루지 않는다 — 확인 못 한 것과 맞는 것은 다르다', async () => {
    const checks = await verifyPlanAmounts(readPlanMapping(FULL),
      stub({ 'P-BASIC': { ok: false, status: 'http_500' } }));
    const basic = checks.find((c) => c.code === 'basic')!;
    expect(basic.ok).toBe(false);
    expect(basic.actual).toBeNull();
  });

  it('★ 조회가 던져도 통과시키지 않는다', async () => {
    const checks = await verifyPlanAmounts(readPlanMapping(FULL), async (id) => {
      if (id === 'P-PRO') throw new Error('network down');
      return { ok: true, amount: '0', currency: 'USD', intervalUnit: 'MONTH', intervalCount: 1, status: 'ACTIVE' };
    });
    expect(checks.find((c) => c.code === 'pro')!.ok).toBe(false);
    expect(checks.find((c) => c.code === 'pro')!.detail).toContain('network down');
  });

  it('소수점 표기 차이는 불일치가 아니다 (19 vs 19.00)', async () => {
    const checks = await verifyPlanAmounts(readPlanMapping(FULL), stub({ 'P-BASIC': { amount: '19' } }));
    expect(checks.find((c) => c.code === 'basic')!.ok).toBe(true);
  });
});
