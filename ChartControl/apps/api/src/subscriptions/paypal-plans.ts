/**
 * PayPal 구독 플랜 ID 매핑.
 *
 * ★★ 왜 코드에 박지 않고 환경변수로 두는가
 *
 *   PayPal 플랜은 **sandbox 와 live 에서 ID 가 다르다.** 코드에 박으면 시험 환경에서
 *   운영 플랜을 부르거나 그 반대가 된다. 전자는 시험 중에 실제 돈이 청구되는 사고다.
 *
 * ★★ 왜 금액을 다시 검사하는가
 *
 *   PayPal 대시보드에서 플랜 금액을 바꿀 수 있다. 그러면 우리 화면은 $19 를 보여주고
 *   실제로는 $49 가 청구되는 상태가 된다. 고객은 화면을 보고 결제하므로 이 어긋남은
 *   우리 책임이다. 그래서 **부팅 때 PayPal 에 물어 대조하고, 어긋나면 결제를 막는다.**
 *
 * ★ ID 가 없는 플랜은 결제할 수 없다고 정직하게 말한다. "준비 중" 을 숨기고 버튼을
 *   띄우면 고객이 결제를 시도하다 실패한다.
 */
import type { PlanCode } from './plans';
import { PLANS } from './plans';

/** 유료 플랜만 PayPal 플랜이 필요하다. free 는 결제가 없다. */
export const PAID_PLAN_CODES = ['basic', 'pro', 'premium', 'elite'] as const;
export type PaidPlanCode = (typeof PAID_PLAN_CODES)[number];

/** 플랜별 환경변수 이름. */
const ENV_KEY: Record<PaidPlanCode, string> = {
  basic: 'PAYPAL_PLAN_BASIC',
  pro: 'PAYPAL_PLAN_PRO',
  premium: 'PAYPAL_PLAN_PREMIUM',
  elite: 'PAYPAL_PLAN_ELITE',
};

export interface PlanMapping {
  /** 플랜 코드 → PayPal 플랜 id. 값이 없는 플랜은 키가 없다. */
  byCode: Partial<Record<PaidPlanCode, string>>;
  /** 설정이 빠진 플랜 코드. 결제를 막고 로그에 남긴다. */
  missing: PaidPlanCode[];
}

/**
 * 환경변수에서 매핑을 읽는다.
 *
 * ★ 공백만 있는 값은 없는 것으로 다룬다. Render 에서 실수로 빈 값을 넣으면
 *   `'  '` 같은 문자열이 들어오고, 그것을 플랜 id 로 PayPal 에 보내면 400 이 난다.
 */
export function readPlanMapping(env: NodeJS.ProcessEnv = process.env): PlanMapping {
  const byCode: Partial<Record<PaidPlanCode, string>> = {};
  const missing: PaidPlanCode[] = [];
  for (const code of PAID_PLAN_CODES) {
    const v = (env[ENV_KEY[code]] ?? '').trim();
    if (v) byCode[code] = v;
    else missing.push(code);
  }
  return { byCode, missing };
}

/** 이 플랜을 지금 결제할 수 있나. */
export function isPurchasable(m: PlanMapping, code: PlanCode): code is PaidPlanCode {
  return (PAID_PLAN_CODES as readonly string[]).includes(code)
    && Boolean(m.byCode[code as PaidPlanCode]);
}

/** 우리가 화면에 표시하는 월 금액(USD 문자열). PayPal 과 대조할 기준값이다. */
export function expectedMonthlyUsd(code: PaidPlanCode): string {
  const plan = PLANS.find((p) => p.code === code);
  if (!plan) throw new Error(`unknown plan: ${code}`);
  /*
     ★ 소수점을 붙여 비교한다. PayPal 은 '19.00' 으로 돌려주는데 우리 정의가 19 라면
       문자열 비교가 어긋나 "금액 불일치" 로 오판한다.
  */
  return Number(plan.priceUsd).toFixed(2);
}

export interface PlanAmountCheck {
  code: PaidPlanCode;
  planId: string;
  ok: boolean;
  /** 우리 화면 금액. */
  expected: string;
  /** PayPal 에 설정된 금액. 조회 실패면 null. */
  actual: string | null;
  detail: string;
}

/**
 * PayPal 플랜의 실제 금액·주기를 우리 정의와 대조한다.
 *
 * ★★ 이것이 "화면과 청구가 어긋나는" 사고를 막는 유일한 장치다.
 *
 * ★ 조회 실패를 **통과로 다루지 않는다.** 확인하지 못한 것과 맞는 것은 다르다.
 *   호출부가 ok=false 를 보고 결제를 막을 수 있어야 한다.
 */
export async function verifyPlanAmounts(
  m: PlanMapping,
  fetchPlan: (planId: string) => Promise<{
    ok: boolean; amount?: string; currency?: string; intervalUnit?: string; intervalCount?: number; status?: string;
  }>,
): Promise<PlanAmountCheck[]> {
  const out: PlanAmountCheck[] = [];
  for (const code of PAID_PLAN_CODES) {
    const planId = m.byCode[code];
    if (!planId) continue;
    const expected = expectedMonthlyUsd(code);
    try {
      const r = await fetchPlan(planId);
      if (!r.ok) {
        out.push({ code, planId, ok: false, expected, actual: null, detail: `조회 실패 (${r.status ?? '?'})` });
        continue;
      }
      const actual = r.amount ? Number(r.amount).toFixed(2) : null;
      const amountOk = actual === expected;
      const currencyOk = (r.currency ?? 'USD') === 'USD';
      /* ★ 주기도 본다. 금액이 같아도 '1시간마다' 면 전혀 다른 상품이다. */
      const cycleOk = (r.intervalUnit ?? 'MONTH').toUpperCase() === 'MONTH'
        && (r.intervalCount ?? 1) === 1;
      const active = (r.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE';
      const ok = amountOk && currencyOk && cycleOk && active;
      const problems = [
        amountOk ? '' : `금액 ${actual ?? '?'} ≠ ${expected}`,
        currencyOk ? '' : `통화 ${r.currency}`,
        cycleOk ? '' : `주기 ${r.intervalCount ?? '?'} ${r.intervalUnit ?? '?'}`,
        active ? '' : `상태 ${r.status}`,
      ].filter(Boolean);
      out.push({ code, planId, ok, expected, actual, detail: ok ? '일치' : problems.join(' · ') });
    } catch (e) {
      out.push({ code, planId, ok: false, expected, actual: null, detail: `오류: ${(e as Error).message}` });
    }
  }
  return out;
}
