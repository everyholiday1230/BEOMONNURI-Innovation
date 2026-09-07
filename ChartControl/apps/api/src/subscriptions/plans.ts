/*
   구독 플랜 — **서버가 유일한 진상(single source of truth)** 이다.

   ★★ 왜 포인트를 없애지 않고 남기는가

     사용량을 세는 장치가 이미 전부 있다: AI 실행 300pt(출력 초과분 1K당 200pt),
     전략 저장 300pt, 지표 저장 100pt, 저장항목 연장 50pt. 원장(point_ledger)과
     차감(spendMetered)도 멱등 처리까지 되어 있고 운영에서 동작한다.

     구독제로 바꾼다는 것은 **포인트를 파는 것을 그만두고, 구독이 매달 포인트를
     충전하는 것**이다. 계량 장치를 버리고 새로 만들면 이미 검증된 것을 버리는
     셈이다.

   ★★ 왜 여기 한 곳에만 적는가

     금액·포함량·기능 제한이 화면과 서버에 따로 적히면 반드시 갈라진다. 이 파일이
     유일한 정의이고, 화면은 API 로 받아 그린다. 요금제를 바꾸려면 이 파일만 고친다.

   ★★ 무엇을 넣지 않았는가 (중요)

     없는 기능을 요금제에 넣지 않는다. 고객은 그것을 사고, 없다는 것을 나중에 안다.
     제외한 것: 상시 감시 에이전트(미착수), 종목 스캐너(미착수), 자동 주문(규제상
     하지 않는다), 데이터 내보내기·프로필 사진·차트설정 저장(서버 경로가 없다),
     BitMart 연결(이 배포에서 불가능).

   ★ 무료 플랜의 포인트는 가입 지급(SIGNUP_GRANT_POINTS)으로 이미 나간다. 여기서
     매달 주지 않는다 — 매달 무료로 주면 유료 전환 이유가 사라지고 남용된다.
*/

/** 플랜 코드. 원장·구독 행에 저장되므로 함부로 바꾸면 기존 구독이 깨진다. */
export type PlanCode = 'free' | 'basic' | 'pro';

export interface PlanFeature {
  /** 화면 문구의 사전 키. 서버가 문장을 만들지 않는다 — 언어가 4종이다. */
  key: string;
  /** 이 플랜에서 쓸 수 있는가. false 면 화면이 '제외'로 표시한다. */
  included: boolean;
  /** 숫자를 문구에 끼울 때 쓴다(예: 월 포함 분석 횟수). */
  params?: Record<string, string>;
}

export interface Plan {
  code: PlanCode;
  /** 화면 표시 이름의 사전 키. */
  nameKey: string;
  /** 월 요금(USD). 문자열 — 금액은 부동소수로 다루지 않는다. */
  priceUsd: string;
  /**
   * 매달 충전되는 포인트.
   *
   * ★ 이월하지 않는다. 이월하면 미사용분이 부채로 쌓이고, 해지 시 환불 분쟁이 된다.
   *   갱신일에 남은 잔액을 이 값으로 **덮어쓴다**(늘리지 않는다).
   */
  monthlyPoints: number;
  /** 대략 몇 번의 AI 분석에 해당하는가. 화면에 그대로 보여준다. */
  approxAiRuns: number;
  features: PlanFeature[];
  /** 가장 많이 고르게 할 플랜. 화면이 강조한다. */
  highlight?: boolean;
}

/*
   AI 한 번 실행에 드는 기본 포인트. ai-metering.ts 의 AI_BASE_POINTS 와 같아야 한다.
   ★ 두 곳에 적으면 갈라진다 — 테스트가 두 값의 일치를 검사한다.
*/
export const PLAN_AI_RUN_POINTS = 300;

export const PLANS: Plan[] = [
  {
    code: 'free',
    nameKey: 'plan_free_name',
    priceUsd: '0',
    /*
       ★ 0 이다. 가입 시 한 번 지급되는 것과 다르다 — 무료 플랜은 매달 충전되지 않는다.
         화면이 "가입 시 1회 지급" 이라고 정확히 말한다.
    */
    monthlyPoints: 0,
    approxAiRuns: 0,
    features: [
      { key: 'plan_f_chart', included: true },
      { key: 'plan_f_exchange', included: true },
      { key: 'plan_f_orders', included: true },
      { key: 'plan_f_liquidation', included: true },
      { key: 'plan_f_alerts', included: true },
      { key: 'plan_f_backtest', included: true },
      { key: 'plan_f_mfa', included: true },
      { key: 'plan_f_ai_signup_only', included: true },
      { key: 'plan_f_saves', included: false },
    ],
  },
  {
    code: 'basic',
    nameKey: 'plan_basic_name',
    priceUsd: '19',
    /* 30회 × 300pt. 넉넉하게 잡지 않는다 — 실제로 쓸 수 있는 양을 말한다. */
    monthlyPoints: 9000,
    approxAiRuns: 30,
    highlight: true,
    features: [
      { key: 'plan_f_chart', included: true },
      { key: 'plan_f_exchange', included: true },
      { key: 'plan_f_orders', included: true },
      { key: 'plan_f_liquidation', included: true },
      { key: 'plan_f_alerts', included: true },
      { key: 'plan_f_backtest', included: true },
      { key: 'plan_f_mfa', included: true },
      { key: 'plan_f_ai_monthly', included: true, params: { n: '30' } },
      { key: 'plan_f_review', included: true },
      { key: 'plan_f_saves', included: true },
    ],
  },
  {
    code: 'pro',
    nameKey: 'plan_pro_name',
    priceUsd: '49',
    /* 100회 × 300pt. */
    monthlyPoints: 30000,
    approxAiRuns: 100,
    features: [
      { key: 'plan_f_chart', included: true },
      { key: 'plan_f_exchange', included: true },
      { key: 'plan_f_orders', included: true },
      { key: 'plan_f_liquidation', included: true },
      { key: 'plan_f_alerts', included: true },
      { key: 'plan_f_backtest', included: true },
      { key: 'plan_f_mfa', included: true },
      { key: 'plan_f_ai_monthly', included: true, params: { n: '100' } },
      { key: 'plan_f_review', included: true },
      { key: 'plan_f_saves', included: true },
      { key: 'plan_f_priority', included: true },
    ],
  },
];

export const PLAN_BY_CODE: Record<PlanCode, Plan> = PLANS.reduce((acc, p) => {
  acc[p.code] = p;
  return acc;
}, {} as Record<PlanCode, Plan>);

/** 코드가 실제 플랜인가. 저장된 값이 오래돼 없어진 플랜일 수 있다. */
export function isPlanCode(v: unknown): v is PlanCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PLAN_BY_CODE, v);
}

/**
 * 구독이 없거나 만료됐을 때의 플랜.
 *
 * ★ 알 수 없으면 무료로 떨어뜨린다 — 확인되지 않은 상태에서 유료 기능을 열어 주는 것이
 *   막는 것보다 나쁘다(돈을 받지 않고 원가를 쓴다).
 */
export const DEFAULT_PLAN: PlanCode = 'free';
