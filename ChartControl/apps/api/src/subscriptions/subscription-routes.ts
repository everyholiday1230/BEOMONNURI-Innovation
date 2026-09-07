import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AuthService } from '@quantumtrade/auth';

import { PLANS, PLAN_BY_CODE, isPlanCode, PLAN_AI_RUN_POINTS, type PlanCode } from './plans';
import type { PgSubscriptionRepo } from './subscription-repo';
import type { PgPointsRepo } from '../db/points-repo';

/*
   구독 API.

   ★★ 이 라우터가 하지 않는 것을 먼저 적는다.

     **정기결제(recurring billing)를 만들지 않는다.** PayPal 정기결제 연동이 아직
     없다(providers.ts 에 createOrder/capture 만 있고 구독 API 는 없다). 그래서
     이 라우터는:
       · 요금제를 알려준다 (되는 것)
       · 현재 구독 상태를 알려준다 (되는 것)
       · 해지 요청을 받는다 (되는 것 — 우리 기록만 바꾼다)
       · 결제로 구독을 **시작하는 것은 하지 않는다** (안 되는 것)

     그래서 `checkout` 은 "아직 준비되지 않았다" 를 명확한 코드로 돌려준다. 되는 척
     하는 엔드포인트를 두면 화면이 결제 버튼을 띄우고 고객이 돈을 보낼 방법을 찾는다.

   ★ 운영자가 수동으로 구독을 부여하는 경로는 관리자 API 에 둔다(여기 아님).
*/

const err = (code: string, message: string) => ({ error: { code, message } });

export interface SubscriptionRouterDeps {
  service: AuthService;
  repo?: PgSubscriptionRepo;
  points?: PgPointsRepo;
  cookieName: string;
  /** 정기결제가 실제로 가능한가. 지금은 항상 false 다 — 구현되면 여기만 바꾼다. */
  recurringAvailable?: () => boolean;
}

export function createSubscriptionRouter(d: SubscriptionRouterDeps): Hono {
  const app = new Hono();

  const authed = async (c: Context) => {
    const raw = getCookie(c, d.cookieName);
    if (!raw) return null;
    const v = await d.service.validateSession(raw);
    return v ?? null;
  };

  /*
     요금제 목록. **로그인 없이도 볼 수 있다** — 랜딩 페이지가 이걸 읽어 그린다.

     ★ 금액·포함량을 화면에 박아 두지 않는다. 그러면 서버와 갈라지고, 고객은 화면에
       적힌 금액과 다른 금액을 결제하게 된다.
  */
  app.get('/plans', (c) => c.json({
    plans: PLANS,
    aiRunPoints: PLAN_AI_RUN_POINTS,
    /*
       ★★ 지금 정말로 결제할 수 있는지 그대로 말한다. 화면이 이 값을 보고 결제 버튼을
         띄울지 결정한다 — 없는 결제를 버튼으로 만들지 않는다.
    */
    recurringAvailable: Boolean(d.recurringAvailable?.()),
  }));

  /** 내 구독. */
  app.get('/me/subscription', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.repo) {
      /* ★ 저장소가 없으면 '무료' 라고 단정하지 않는다 — 읽을 수 없다고 말한다. */
      return c.json({ available: false, reason: 'subscription store not wired' });
    }
    const read = await d.repo.get(a.user.id);
    const plan = PLAN_BY_CODE[read.row.planCode];
    return c.json({
      available: read.ok,
      ...(read.ok ? {} : { reason: read.reason }),
      subscription: {
        planCode: read.row.planCode,
        planNameKey: plan.nameKey,
        priceUsd: plan.priceUsd,
        monthlyPoints: plan.monthlyPoints,
        status: read.row.status,
        currentPeriodEnd: read.row.currentPeriodEnd || null,
        entitled: read.row.entitled,
        provider: read.row.provider,
      },
    });
  });

  /*
     구독 시작(결제).

     ★★ 지금은 되지 않는다. 되는 척하지 않고 이유와 대안을 말한다.
       화면은 `/plans` 의 recurringAvailable 을 보고 이 버튼을 아예 띄우지 않아야 한다.
       그래도 누군가 직접 호출할 수 있으니 서버도 같은 사실을 말한다.
  */
  app.post('/me/subscription/checkout', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    const body = (await c.req.json().catch(() => ({}))) as { planCode?: unknown };
    if (!isPlanCode(body.planCode)) return c.json(err('BAD_REQUEST', 'unknown planCode'), 400);
    if (body.planCode === 'free') return c.json(err('BAD_REQUEST', 'the free plan needs no payment'), 400);

    if (!d.recurringAvailable?.()) {
      return c.json(
        err(
          'RECURRING_NOT_CONFIGURED',
          'monthly billing is not connected yet — no payment was taken and no subscription was created',
        ),
        503,
      );
    }
    /*
       ★ 여기까지 오면 정기결제가 붙은 뒤다. 그때 구현한다 — 지금 빈 구현을 두면
         "성공했다" 고 돌려주고 구독이 생기지 않는 상태가 된다.
    */
    return c.json(err('NOT_IMPLEMENTED', 'checkout is not implemented'), 501);
  });

  /*
     해지.

     ★★ 즉시 끊지 않는다. 이미 낸 달은 끝까지 쓴다 — 그렇지 않으면 돈을 받고 서비스를
       멈추는 것이다.
     ★ 우리 기록만 바꾼다. 결제 대행사 쪽 정기결제는 별도로 멈춰야 하고, 응답이 그
       사실을 말한다 — 고객이 "해지했는데 또 결제됐다" 를 겪지 않게.
  */
  app.post('/me/subscription/cancel', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', 'subscription store not wired'), 503);

    const read = await d.repo.get(a.user.id);
    if (!read.ok) return c.json(err('READ_FAILED', read.reason), 503);
    if (read.row.planCode === 'free') return c.json(err('NO_SUBSCRIPTION', 'nothing to cancel'), 400);

    const ok = await d.repo.cancel(a.user.id);
    if (!ok) return c.json(err('CANCEL_FAILED', 'could not cancel — nothing was changed'), 500);

    return c.json({
      ok: true,
      /** 이 시각까지는 그대로 쓸 수 있다. 화면이 반드시 표시해야 한다. */
      activeUntil: read.row.currentPeriodEnd || null,
      /**
       * 결제 대행사 쪽 정기결제가 우리 기록과 별개라는 사실.
       * ★ provider 가 null 이면 결제로 만든 구독이 아니므로 멈출 것도 없다.
       */
      providerStopRequired: read.row.provider !== null,
    });
  });

  return app;
}

/**
 * 갱신 시 포인트를 충전한다. 스케줄러나 요청 경로에서 부른다.
 *
 * ★★ 멱등하다 — claimMonthlyGrant 가 주기당 한 번만 양수를 돌려준다. 두 번 돌아도
 *   포인트가 두 배 들어가지 않는다.
 *
 * ★ 충전 실패는 삼키지 않고 알린다. 실패하면 유료 고객이 AI 를 쓸 수 없고, 그 사실을
 *   아무도 모르는 상태가 이 제품에서 반복된 실패 유형이다.
 */
export async function grantMonthlyPointsIfDue(
  repo: PgSubscriptionRepo,
  points: PgPointsRepo,
  userId: string,
  periodStart: number,
): Promise<{ granted: number } | { failed: string }> {
  const amount = await repo.claimMonthlyGrant(userId);
  if (amount <= 0) return { granted: 0 };
  try {
    await points.grant({
      userId,
      amount,
      /* ★ DB CHECK 가 사유를 고정 목록으로 제한한다. 구분은 refType 으로 한다. */
      reason: 'event_reward',
      refType: 'subscription_grant',
      /* ★ 주기 시작 시각을 키에 넣어 같은 달에 두 번 적립되지 않게 한다. */
      refId: `${userId}:${periodStart}`,
      memo: `subscription monthly grant (${amount}pt)`,
    });
    return { granted: amount };
  } catch (e) {
    return { failed: (e as Error).message };
  }
}

export type { PlanCode };
