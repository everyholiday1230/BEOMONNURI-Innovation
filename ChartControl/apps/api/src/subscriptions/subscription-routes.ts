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
  /** 정기결제가 실제로 가능한가. PayPal 플랜 ID 가 있고 금액 대조를 통과했을 때만 true. */
  recurringAvailable?: () => boolean;
  /**
   * PayPal 구독 연동.
   *
   * ★ 없으면 checkout 이 503 을 돌려준다. 빈 구현으로 200 을 주면 "구독됐다" 고
   *   믿게 되는데 실제로는 아무 일도 일어나지 않는다.
   */
  paypal?: {
    /** 이 플랜을 지금 결제할 수 있나(ID 설정 + 금액 대조 통과). */
    planIdFor(code: PlanCode): string | null;
    /**
     * PayPal 플랜 id → 우리 플랜 코드. **역방향 조회가 필요하다.**
     *
     * ★ 승인 확인에서 화면이 보낸 planCode 를 믿지 않고, PayPal 이 알려준 plan_id 로
     *   우리 코드를 되짚는다. 그래야 $19 결제로 $199 권한을 받는 것을 막을 수 있다.
     */
    planCodeFor(planId: string): PlanCode | null;
    createSubscription(input: {
      planId: string; userId: string; returnUrl: string; cancelUrl: string;
    }): Promise<{ providerRef: string; approveUrl: string; status: string }>;
    getSubscription(providerRef: string): Promise<{
      ok: boolean; status: string; customId?: string; planId?: string; nextBillingAt?: string;
    }>;
    cancelSubscription(providerRef: string, reason: string): Promise<{ ok: boolean; status: string }>;
  };
  /** 승인 후 고객이 돌아올 앱 주소(https://…). */
  appBaseUrl?: string;
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
      /*
         ★★ **지금 결제할 수 있는 플랜 목록을 서버가 정한다.**

           PayPal 플랜 ID 가 설정되고 **금액 대조를 통과한** 플랜만 들어간다. 화면이
           스스로 목록을 만들면, PayPal 에서 금액이 바뀌었을 때 $19 를 보여주고 다른
           금액을 청구하게 된다.

         ★ 빈 배열도 의미가 있다 — 화면이 "결제 준비 중" 을 말할 수 있다. 목록을 아예
           내려보내지 않으면 화면은 "아직 못 받았다" 와 "팔 것이 없다" 를 구분할 수 없다.
      */
      purchasablePlans: PLANS
        .filter((pl) => pl.code !== 'free' && Boolean(d.paypal?.planIdFor(pl.code)))
        .map((pl) => ({ code: pl.code, name: pl.nameKey, priceUsd: pl.priceUsd, monthlyPoints: pl.monthlyPoints })),
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
    if (!d.paypal) return c.json(err('RECURRING_NOT_CONFIGURED', 'payment provider not wired'), 503);

    /*
       ★★ 플랜 id 는 **서버가 정한다.** 화면이 보내는 값을 쓰면 고객이 $199 플랜의
         권한을 $19 플랜 id 로 살 수 있다.
    */
    const planId = d.paypal.planIdFor(body.planCode);
    if (!planId) {
      return c.json(
        err('PLAN_NOT_PURCHASABLE',
          'this plan cannot be purchased right now — its billing plan is not configured or its price does not match'),
        503,
      );
    }

    /*
       ★★★ 절대 URL 이 없으면 **결제를 시작하지 않는다.**

         예전에는 `(d.appBaseUrl ?? '')` 였다. 값이 없으면 base 가 빈 문자열이 되어
         return_url 이 `/#/points?sub=return` — **상대 경로**가 된다. PayPal 은 그것을
         거부하는데, 돌려주는 오류가 `400 INVALID_REQUEST "Request is not well-formed"`
         뿐이라 **어느 필드가 문제인지 알 수 없다.** 샌드박스로 실제 호출해 보고서야
         원인을 찾았다.

       ★ 그러므로 여기서 먼저 막고 이유를 분명히 말한다. 고객에게는 "결제를 시작할 수
         없다" 를, 로그에는 어느 환경변수가 없는지를 남긴다. PayPal 에 잘못된 요청을
         보내 알 수 없는 오류를 받는 것보다 낫다.
    */
    const base = (d.appBaseUrl ?? '').replace(/\/$/, '');
    if (!/^https?:\/\//i.test(base)) {
      console.error(
        '[subscription] ★ APP_BASE_URL 이 없어 결제를 시작할 수 없다 — '
        + 'PayPal 은 return_url 에 절대 URL 을 요구한다. 환경변수를 설정할 것.',
      );
      return c.json(
        err('BASE_URL_NOT_CONFIGURED', 'the server is missing its public address — payment cannot start'),
        503,
      );
    }

    try {
      const sub = await d.paypal.createSubscription({
        planId,
        userId: a.user.id,
        /*
           ★ 승인 후 돌아오는 곳. 여기서 **바로 구독을 켜지 않는다** — 이 URL 은
             고객이 직접 열 수 있다. 화면이 /me/subscription/confirm 을 불러
             서버가 PayPal 에 물어 ACTIVE 인지 확인한 뒤에만 켠다.
        */
        returnUrl: `${base}/#/points?sub=return`,
        cancelUrl: `${base}/#/points?sub=cancel`,
      });
      /*
         ★★★ 승인 대기를 **기록한다.** 접근권은 주지 않는다.

           예전에는 아무것도 저장하지 않고 구독 id 를 화면에만 돌려줬다. 승인 전
           상태를 'active' 로 저장하면 안 된다는 판단은 맞았지만, 반대쪽에 구멍이
           있었다 — 고객이 PayPal 에서 승인을 마친 뒤 브라우저를 닫으면 **요금은
           청구되는데 우리에겐 기록도 단서도 없었다.** 되찾을 방법이 없었다.

         ★ 'pending' 은 entitled 를 켜지 않는다(active + 기간으로만 판단). 이 기록의
           목적은 나중에 PayPal 에 대조해 되찾는 것이다.

         ★ 기록 실패가 결제를 막지는 않는다 — 이미 PayPal 쪽 구독은 만들어졌다.
           대신 로그를 남긴다(markPending 안에서).
      */
      if (d.repo && sub.providerRef) {
        await d.repo.markPending({
          userId: a.user.id,
          planCode: body.planCode,
          provider: 'paypal',
          providerRef: sub.providerRef,
        });
      }

      return c.json({
        ok: true,
        provider: 'paypal',
        providerRef: sub.providerRef,
        approveUrl: sub.approveUrl,
        status: sub.status,
        /** 화면이 이 값을 confirm 에 그대로 돌려준다. */
        note: 'open approveUrl; the subscription starts only after PayPal reports ACTIVE',
      });
    } catch (e) {
      /* ★ 실패를 성공으로 포장하지 않는다. 이유를 남기고 그대로 알린다. */
      console.warn(`[subscription] PayPal 구독 생성 실패 user=${a.user.id} plan=${body.planCode}: ${(e as Error).message}`);
      return c.json(err('CHECKOUT_FAILED', 'could not start the subscription — no payment was taken'), 502);
    }
  });

  /**
   * 승인 확인 — 구독을 실제로 켜는 유일한 경로.
   *
   * ★★ 왜 return_url 만으로 켜지 않는가
   *
   *   그 URL 은 고객이 브라우저에 직접 입력할 수 있다. 그것만으로 켜면 **결제하지 않고
   *   유료 기능을 쓸 수 있다.** 그래서 PayPal 에 물어 상태가 ACTIVE 인지 확인한다.
   *
   * ★ `custom_id` 로 소유자를 대조한다. 남의 구독 id 를 보내 자기 계정에 붙이는 것을
   *   막는다 — 이 검사가 없으면 한 사람이 결제한 구독을 여러 계정이 나눠 쓸 수 있다.
   */
  app.post('/me/subscription/confirm', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.paypal) return c.json(err('RECURRING_NOT_CONFIGURED', 'payment provider not wired'), 503);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', 'subscription store not wired'), 503);

    const body = (await c.req.json().catch(() => ({}))) as { providerRef?: unknown };
    const ref = typeof body.providerRef === 'string' ? body.providerRef.trim() : '';
    if (!ref) return c.json(err('BAD_REQUEST', 'providerRef required'), 400);

    const sub = await d.paypal.getSubscription(ref);
    if (!sub.ok) {
      /* 아직 승인 전이거나 실패다. 켜지 않고 상태를 그대로 알린다. */
      return c.json(err('NOT_ACTIVE', `PayPal reports ${sub.status}`), 409);
    }
    /* ★ 소유자 대조. 다르면 남의 구독이다. */
    if (sub.customId && sub.customId !== a.user.id) {
      console.warn(`[subscription] ★ 소유자 불일치 — ref=${ref} custom_id=${sub.customId} 요청자=${a.user.id}`);
      return c.json(err('NOT_YOURS', 'this subscription belongs to another account'), 403);
    }
    /* ★ 플랜도 서버가 되짚는다. PayPal 이 알려준 plan_id 로 우리 코드를 찾는다. */
    const code = sub.planId ? d.paypal.planCodeFor(sub.planId) : null;
    if (!code) {
      console.warn(`[subscription] ★ 알 수 없는 PayPal 플랜 plan_id=${sub.planId} ref=${ref}`);
      return c.json(err('UNKNOWN_PLAN', 'could not match the PayPal plan to a subscription tier'), 409);
    }

    const now = Date.now();
    /*
       ★ 기간 끝을 PayPal 의 다음 청구일로 잡는다. 우리가 30일을 더하면 실제 청구일과
         어긋나 권한이 하루 먼저 끊기거나 하루 더 열린다.
       ★ 알 수 없으면 31일로 둔다 — 짧게 잡아 덜 열리는 쪽이 안전하다.
    */
    const nextMs = sub.nextBillingAt ? Date.parse(sub.nextBillingAt) : NaN;
    const periodEnd = Number.isFinite(nextMs) && nextMs > now ? nextMs : now + 31 * 24 * 3600 * 1000;

    /*
       ★★★ **두 번 불러도 포인트가 두 번 지급되지 않게** 한다.

         이 경로는 실제로 두 번 불린다:
           · 고객이 복귀 화면을 새로고침한다
           · 프런트엔드가 재시도한다(네트워크 불안정)
           · sessionStorage 와 URL 양쪽에서 단서를 찾아 각각 호출된다

         예전에는 매 호출이 `periodStart: now` 로 upsert 했다. claimMonthlyGrant 는
         `last_grant_period <> current_period_start` 로 중복을 막는데, period_start 가
         매번 바뀌면 **새 주기로 오해해 또 지급한다.**

         샌드박스 실측에서 실제로 발생했다 — 같은 사용자에게 30,000pt 가 7초 간격으로
         두 번 지급됐다(원장 ref_id 가 서로 달랐다).

       ★ 그래서 **이미 이 구독으로 활성 상태면 아무것도 하지 않는다.** 기간을 다시
         쓰지 않으므로 지급도 일어나지 않는다. 갱신(기간 연장)은 대조 작업이 맡는다.

       ★ 플랜을 바꾼 경우는 PayPal 구독 id 가 새로 발급되므로 여기 걸리지 않는다 —
         정상적으로 새 구독이 기록된다.
    */
    const existing = await d.repo.findByProviderRef(ref);
    if (existing && existing.userId === a.user.id && existing.status === 'active') {
      return c.json({
        ok: true,
        planCode: existing.planCode,
        periodEnd: existing.periodEnd,
        provider: 'paypal',
        /* ★ 이미 처리된 요청임을 분명히 한다. 화면이 "또 지급됐다" 고 오해하면 안 된다. */
        alreadyActive: true,
        granted: 0,
      });
    }

    const ok = await d.repo.upsert({
      userId: a.user.id,
      planCode: code,
      periodStart: now,
      periodEnd,
      provider: 'paypal',
      providerRef: ref,
    });
    if (!ok) {
      /*
         ★★ 결제는 됐는데 기록에 실패한 상태다. 성공이라고 답하면 고객은 돈을 냈는데
           권한이 없고, 우리는 그 사실을 모른다. 크게 남기고 실패로 답한다.
      */
      console.error(`[subscription] ★ 결제는 승인됐으나 기록 실패 user=${a.user.id} ref=${ref} plan=${code}`);
      return c.json(err('RECORD_FAILED', 'payment was approved but we could not record it — contact support'), 500);
    }

    /*
       ★★ **여기서 포인트를 충전한다.** 이 호출이 없으면 돈은 받고 고객은 AI 를 쓸 수
         없다 — 유료 플랜의 실체가 매달 충전되는 포인트이기 때문이다.

       ★ 멱등하다. claimMonthlyGrant 가 주기당 한 번만 양수를 돌려주므로, 고객이
         confirm 을 두 번 불러도 두 배 들어가지 않는다.

       ★ 충전 실패로 **구독을 실패로 만들지 않는다.** 결제와 기록은 이미 끝났고,
         구독을 실패로 답하면 고객이 다시 결제를 시도한다. 대신 크게 남기고
         응답에 사실을 담아 화면이 안내할 수 있게 한다.
    */
    let granted = 0;
    let grantFailed: string | null = null;
    if (d.points) {
      const g = await grantMonthlyPointsIfDue(d.repo, d.points, a.user.id, now);
      if ('granted' in g) granted = g.granted;
      else {
        grantFailed = g.failed;
        console.error(
          `[subscription] ★ 구독은 시작됐으나 포인트 충전 실패 user=${a.user.id} plan=${code}: ${g.failed} `
          + '— 고객이 결제했는데 AI 를 쓸 수 없다.',
        );
      }
    } else {
      grantFailed = 'points store not wired';
      console.error('[subscription] ★ 포인트 저장소가 없어 구독 충전을 하지 못했다.');
    }

    return c.json({
      ok: true,
      planCode: code,
      periodEnd,
      provider: 'paypal',
      granted,
      ...(grantFailed ? { grantFailed } : {}),
    });
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
