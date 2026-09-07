import { DEFAULT_PLAN, planIncludes, type PlanCode } from './plans';
import type { PgSubscriptionRepo } from './subscription-repo';

/*
   요금제 권한 게이트.

   ★★ 왜 별도 파일인가

     저장 라우터·전략 라우터·결제 라우터가 같은 판단을 해야 한다. 각자 구현하면
     한 곳만 고쳐지는 일이 생기고, 그러면 요금제 문구와 실제 동작이 갈라진다 —
     가격표에는 "저장 가능" 인데 서버가 막거나, "제외" 인데 열려 있는 상태가 된다.

   ★★ 판단 근거는 **요금제 정의 하나**다(plans.ts). 별도 허용 목록을 만들지 않는다.
     가격표를 바꾸면 권한도 함께 바뀌어야 하고, 그것이 이 구조의 목적이다.

   ★★ 모르면 막는다.

     저장소가 없거나 조회가 실패하면 무료 플랜으로 본다. 반대로 하면 확인되지 않은
     상태에서 유료 기능을 열어 주게 되고, 그건 돈을 받지 않고 원가를 쓰는 것이다.
     다만 **왜 막혔는지 구별해서 알려준다** — "요금제에 없음" 과 "확인 불가" 는
     고객이 해야 할 일이 다르다.
*/

export type GateResult =
  | { allowed: true; planCode: PlanCode }
  /** 요금제가 이 기능을 포함하지 않는다. 고객은 업그레이드하면 된다. */
  | { allowed: false; reason: 'PLAN_REQUIRED'; planCode: PlanCode }
  /** 확인할 수 없다. 고객이 할 수 있는 일이 없으므로 다르게 말해야 한다. */
  | { allowed: false; reason: 'UNVERIFIED'; planCode: PlanCode; detail: string };

/**
 * 이 이용자의 요금제가 해당 기능을 포함하는가.
 *
 * @param featureKey plans.ts 의 요금제 항목 키(FEATURE_SAVES 등)
 */
export async function checkPlanFeature(
  repo: PgSubscriptionRepo | undefined,
  userId: string,
  featureKey: string,
): Promise<GateResult> {
  if (!repo) {
    /*
       ★ 저장소가 없는 배포(SQLite 개발 환경)에서는 확인할 수 없다. 무료로 보고 막되
         '확인 불가' 로 말한다 — 개발자가 "요금제 때문" 이라고 오해하지 않게.
    */
    return { allowed: false, reason: 'UNVERIFIED', planCode: DEFAULT_PLAN, detail: 'subscription store not wired' };
  }
  const read = await repo.get(userId);
  if (!read.ok) {
    return { allowed: false, reason: 'UNVERIFIED', planCode: DEFAULT_PLAN, detail: read.reason };
  }
  /*
     ★★ 유료 플랜인데 기간이 끝났으면 무료로 본다. `entitled` 가 그 판단을 이미
       담고 있다(해지했어도 기간이 남으면 true).
  */
  const effective: PlanCode = read.row.entitled ? read.row.planCode : DEFAULT_PLAN;
  if (!planIncludes(effective, featureKey)) {
    return { allowed: false, reason: 'PLAN_REQUIRED', planCode: effective };
  }
  return { allowed: true, planCode: effective };
}

/**
 * 게이트 실패를 HTTP 응답 본문으로 바꾼다.
 *
 * ★ 두 경우의 문구가 달라야 한다. "요금제를 올리세요" 와 "지금 확인할 수 없습니다"
 *   를 같게 말하면, 확인 실패인데 고객이 결제하려 한다.
 */
export function gateErrorBody(g: Exclude<GateResult, { allowed: true }>): {
  error: { code: string; message: string; planCode: string };
} {
  if (g.reason === 'PLAN_REQUIRED') {
    return {
      error: {
        code: 'PLAN_REQUIRED',
        message: 'this feature is not included in your plan',
        planCode: g.planCode,
      },
    };
  }
  return {
    error: {
      code: 'PLAN_UNVERIFIED',
      message: `could not verify your plan (${g.detail}) — nothing was charged`,
      planCode: g.planCode,
    },
  };
}
