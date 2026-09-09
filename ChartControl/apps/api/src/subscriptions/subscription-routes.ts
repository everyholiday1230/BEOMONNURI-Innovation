import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AuthService } from '@quantumtrade/auth';
/*
   ★ 값으로 쓰므로 `import type` 이 아니다. 위 AuthService 는 타입만 쓰이므로 그대로 둔다.
*/
import { verifyCsrf, originAllowed } from '@quantumtrade/auth';

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
  /*
     ★★★ CSRF 검증. **이 라우터에만 없었다**(감사 확인: verifyCsrf·originAllowed 0건).
       payment·trading·ai·mfa·admin 은 전부 적용돼 있다.

     ★ 돈이 나가는 경로다 — checkout·confirm·change·cancel 넷 다. 검증이 없으면 다른
       사이트가 고객 브라우저로 우리 API 를 부를 수 있다(쿠키가 함께 나간다).
       화면은 이미 x-csrf-token 을 보내므로 서버만 붙이면 된다.

     ★ 선택(?)이 아니라 **필수**로 둔다. 선택이면 배선을 빠뜨렸을 때 조용히 무방비가
       되고, 그것이 이 라우터가 이렇게 된 가장 그럴듯한 경로다.
  */
  verifyCsrf: typeof verifyCsrf;
  originAllowed: typeof originAllowed;
  corsOrigins: string[];
  csrfKey: string;
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
    /** 플랜 변경. 승인이 필요하므로 approveUrl 을 돌려준다. */
    reviseSubscription(input: {
      providerRef: string; planId: string; returnUrl: string; cancelUrl: string;
    }): Promise<{ ok: boolean; approveUrl?: string; status: string }>;
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
     ★ payment-routes 와 **같은 방식**이다. 라우터마다 다르게 만들면 한 곳이 빠져도
       눈에 띄지 않는다 — 실제로 이 라우터가 빠져 있었다.
  */
  const csrfOk = (c: Context, secret: string) =>
    d.originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins)
    && d.verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, 'qt_csrf'), secret, d.csrfKey);

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
    /* ★★ CSRF 검증. 돈이 나가는 경로다 — 없으면 다른 사이트가 고객 브라우저로 이 API 를 부를 수 있다. */
    if (!csrfOk(c, a.session.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    const body = (await c.req.json().catch(() => ({}))) as { planCode?: unknown };
    if (!isPlanCode(body.planCode)) return c.json(err('BAD_REQUEST', 'unknown planCode'), 400);
    if (body.planCode === 'free') return c.json(err('BAD_REQUEST', 'the free plan needs no payment'), 400);

    /*
       ★★★ **이미 구독 중이면 새 결제를 시작하지 않는다.**

         이 검사가 없어서 기존 구독자가 결제를 다시 하면 **PayPal 구독이 2개** 만들어졌다:

           · PayPal 은 두 건 모두 매달 청구한다
           · 우리 DB 의 provider_ref 는 첫 번째뿐이다(markPending 이 활성 구독을 덮지
             않으려고 의도적으로 no-op 한다)
           · 그래서 두 번째는 **대조 대상도 아니고, 해지해도 멈지 않는다**

         3091717 이 화면에서만 막았다(구독 중이면 버튼이 '변경' 으로 바뀐다). 서버는
         무방비였다 — API 를 직접 부르거나 화면이 낡은 상태면 그대로 통과한다.

       ★ 플랜을 바꾸려는 것이면 `/me/subscription/change` 가 맞는 경로다. 그쪽은
         PayPal 의 revise 를 써서 구독을 하나로 유지한다.
    */
    if (d.repo) {
      const cur = await d.repo.get(a.user.id);
      if (cur.ok && cur.row.entitled && cur.row.planCode !== 'free') {
        return c.json(
          err('ALREADY_SUBSCRIBED', 'you already have an active subscription — use plan change instead'),
          400,
        );
      }
    }

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
        const recorded = await d.repo.markPending({
          userId: a.user.id,
          planCode: body.planCode,
          provider: 'paypal',
          providerRef: sub.providerRef,
        });
        /*
           ★★★ **기록하지 못했으면 PayPal 구독을 되돌린다.**

             markPending 은 이미 활성 구독이 있으면 의도적으로 아무 일도 하지 않는다.
             위에서 활성 구독을 막았지만 **경합**은 남는다 — 같은 고객이 두 창에서
             동시에 누르거나, 대조 작업이 그 사이에 활성화하는 경우다.

             그때 기록 없이 넘어가면 PayPal 에는 구독이 있고 우리에겐 단서가 없다.
             대조도 못 하고 해지도 못 멈추는 **유령 구독**이 되어 매달 청구된다.

           ★ 그래서 방금 만든 PayPal 구독을 즉시 취소하고 실패로 답한다. 고객은
             다시 시도하거나 플랜 변경으로 가면 된다. **청구는 시작되지 않는다.**

           ★ 취소마저 실패하면 크게 남긴다 — 사람이 PayPal 대시보드에서 지워야 한다.
        */
        if (!recorded) {
          let undone = false;
          try {
            const stop = await d.paypal.cancelSubscription(sub.providerRef, 'duplicate subscription — not recorded');
            undone = stop.ok;
          } catch (e) {
            console.error(`[subscription] ★ 유령 구독 취소 실패 ref=${sub.providerRef}: ${(e as Error).message}`);
          }
          console.error(
            `[subscription] ★ 승인 대기 기록 실패로 결제를 되돌렸다 user=${a.user.id} `
            + `ref=${sub.providerRef} PayPal취소=${undone ? '성공' : '★실패 — 대시보드에서 수동 삭제 필요'}`,
          );
          return c.json(
            err('ALREADY_SUBSCRIBED', 'you already have an active subscription — use plan change instead'),
            400,
          );
        }
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
    /* ★ CSRF 검증(위 checkout 과 같은 규칙). */
    if (!csrfOk(c, a.session.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
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
  /**
   * 플랜 변경(업그레이드/다운그레이드).
   *
   * ★★ 샌드박스 실측으로 확인한 PayPal 동작:
   *     승인 필요 → 승인 후 plan_id 는 즉시 바뀌지만 **청구는 다음 결제일**이다
   *     (basic $19 → elite 변경 후에도 last_payment=19.0, next_billing 그대로).
   *
   * ★★★ 그래서 **포인트를 지금 지급하지 않는다.** 고객은 아직 $19 만 냈는데
   *   elite 150,000pt 를 받고 다음 청구 전에 해지하면 그대로 가져간다.
   *   새 플랜 포인트는 다음 결제일에 지급된다(대조 작업의 갱신 경로).
   *
   * ★ 기능 접근은 플랜을 기준으로 하므로 승인 직후부터 새 플랜 기능을 쓸 수 있다.
   *   PayPal 자신이 plan_id 를 즉시 바꾸므로 그 의미를 따른다. 화면이 "요금과
   *   포인트는 다음 결제일부터" 를 반드시 말해야 한다.
   */
  app.post('/me/subscription/change', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    /* ★ CSRF 검증(위 checkout 과 같은 규칙). */
    if (!csrfOk(c, a.session.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', 'subscription store not wired'), 503);
    if (!d.paypal) return c.json(err('RECURRING_NOT_CONFIGURED', 'payment provider not wired'), 503);

    const body = await c.req.json().catch(() => null) as { planCode?: string } | null;
    const wanted = String(body?.planCode ?? '');
    if (!isPlanCode(wanted) || wanted === 'free') {
      return c.json(err('BAD_PLAN', 'unknown plan'), 400);
    }

    const read = await d.repo.get(a.user.id);
    if (!read.ok) return c.json(err('READ_FAILED', read.reason), 503);
    /*
       ★ 활성 구독이 없으면 변경이 아니라 **신규 결제**다. checkout 으로 보낸다 —
         여기서 조용히 새 구독을 만들면 고객은 "변경" 을 눌렀는데 새로 결제된다.
    */
    if (!read.row.entitled || read.row.planCode === 'free') {
      return c.json(err('NO_ACTIVE_SUBSCRIPTION', 'start a subscription first'), 400);
    }
    if (read.row.planCode === wanted) {
      return c.json(err('SAME_PLAN', 'already on this plan'), 400);
    }

    const planId = d.paypal.planIdFor(wanted);
    if (!planId) {
      return c.json(
        err('PLAN_NOT_PURCHASABLE', 'this plan cannot be selected right now — its billing plan is not configured or its price does not match'),
        503,
      );
    }

    /* ★ APP_BASE_URL 이 없으면 PayPal 이 상대 URL 을 거부한다(구독 생성에서 겪었다). */
    const base = (d.appBaseUrl ?? '').replace(/\/$/, '');
    if (!/^https?:\/\//i.test(base)) {
      console.error('[subscription] ★ APP_BASE_URL 이 없어 플랜 변경을 시작할 수 없다.');
      return c.json(err('BASE_URL_NOT_CONFIGURED', 'the server is missing its public address'), 503);
    }

    let ref: string | null = null;
    try {
      ref = await d.repo.providerRefOf(a.user.id);
    } catch (e) {
      console.error(`[subscription] ★ 플랜 변경 중 provider_ref 조회 실패 user=${a.user.id}: ${(e as Error).message}`);
      return c.json(err('CHANGE_FAILED', 'could not read your subscription — nothing was changed'), 503);
    }
    if (!ref) return c.json(err('NO_PROVIDER_REF', 'this subscription was not created through a payment provider'), 400);

    try {
      const rv = await d.paypal.reviseSubscription({
        providerRef: ref,
        planId,
        returnUrl: `${base}/#/points?sub=changed`,
        cancelUrl: `${base}/#/points?sub=change-cancel`,
      });
      if (!rv.ok || !rv.approveUrl) {
        console.error(`[subscription] ★ 플랜 변경 실패 user=${a.user.id} ref=${ref} → ${wanted}: ${rv.status}`);
        return c.json(err('CHANGE_FAILED', 'could not start the plan change — nothing was changed'), 502);
      }
      return c.json({
        ok: true,
        approveUrl: rv.approveUrl,
        from: read.row.planCode,
        to: wanted,
        /*
           ★ 화면이 반드시 말해야 하는 것. 이것을 숨기면 고객은 지금 포인트가
             들어올 줄 알고 기다린다.
        */
        note: 'the new price and points start on your next billing date',
      });
    } catch (e) {
      console.error(`[subscription] ★ 플랜 변경 예외 user=${a.user.id}: ${(e as Error).message}`);
      return c.json(err('CHANGE_FAILED', 'could not start the plan change — nothing was changed'), 502);
    }
  });

  app.post('/me/subscription/cancel', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    /* ★ CSRF 검증(위 checkout 과 같은 규칙). */
    if (!csrfOk(c, a.session.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', 'subscription store not wired'), 503);

    const read = await d.repo.get(a.user.id);
    if (!read.ok) return c.json(err('READ_FAILED', read.reason), 503);
    if (read.row.planCode === 'free') return c.json(err('NO_SUBSCRIPTION', 'nothing to cancel'), 400);

    /*
       ★★ **이미 해지된 구독은 그대로 알려준다.** PayPal 을 다시 부르지 않는다.

         예전에는 상태를 보지 않고 늘 PayPal 해지를 시도했다. 이미 해지된 구독이면
         PayPal 이 422(SUBSCRIPTION_STATUS_INVALID) 를 주고, 그것을 실패로 다뤄
         **502 를 돌려줬다**(실측). 고객이 해지를 두 번 누르면 오류를 본다 —
         이미 해지됐는데도.

       ★ 청구는 이미 멈춰 있다. 그러므로 성공으로 답하는 것이 사실이다. 다만
         `alreadyCanceled` 로 구별해 화면이 "이미 해지되었습니다" 를 말할 수 있게 한다.
    */
    if (read.row.status === 'canceled') {
      return c.json({
        ok: true,
        activeUntil: read.row.currentPeriodEnd || null,
        alreadyCanceled: true,
        providerStopped: true,
        providerStopRequired: false,
      });
    }

    /*
       ★★★ **PayPal 쪽 정기결제를 먼저 멈춘다.** 이것이 없었다.

         예전에는 우리 DB 만 'canceled' 로 바꾸고 `providerStopRequired: true` 를
         돌려줬다. 즉 고객이 해지를 눌러도 **PayPal 은 매달 계속 청구한다.**
         화면은 "결제사에서도 멈추세요" 라고 안내했지만, 그 부담을 고객에게 넘기는
         것이고 대부분은 하지 않는다. 결과는 "해지했는데 또 결제됐다" → 분쟁·차지백.

         provider 에 cancelSubscription 은 이미 구현돼 있었다(204 성공, 422
         '이미 해지됨' 도 성공). 라우터가 부르지 않았을 뿐이다.

       ★★ **순서가 중요하다.** PayPal 을 먼저 멈추고 그 다음 우리 기록을 바꾼다.
           · PayPal 성공 → DB 실패 : 청구는 멈췄고 기간까지 접근권 유지. 대조 작업이
             다음 회차에 PayPal=CANCELLED 를 보고 정리한다. 안전하다.
           · DB 먼저 성공 → PayPal 실패 : 고객은 해지됐다고 믿는데 **청구가 계속된다.**
             절대 이 순서로 두면 안 된다.

       ★ PayPal 해지가 실패하면 **성공이라고 답하지 않는다.** 고객이 다시 시도하거나
         문의할 수 있어야 한다. 조용히 넘기면 청구가 계속되는 것을 아무도 모른다.
    */
    let providerStopped = false;
    if (d.paypal && read.row.provider === 'paypal') {
      let ref: string | null = null;
      try {
        ref = await d.repo.providerRefOf(a.user.id);
      } catch (e) {
        console.error(`[subscription] ★ 해지 중 provider_ref 조회 실패 user=${a.user.id}: ${(e as Error).message}`);
        return c.json(
          err('CANCEL_FAILED', 'could not reach the payment provider — nothing was changed, please try again'),
          503,
        );
      }
      if (ref) {
        try {
          const stop = await d.paypal.cancelSubscription(ref, 'customer requested cancellation');
          if (!stop.ok) {
            /* ★ 크게 남긴다 — 청구가 계속되는 상태다. */
            console.error(`[subscription] ★ PayPal 정기결제 정지 실패 user=${a.user.id} ref=${ref} status=${stop.status}`);
            return c.json(
              err('PROVIDER_STOP_FAILED', 'we could not stop the recurring payment at PayPal — nothing was changed, please try again or contact support'),
              502,
            );
          }
          providerStopped = true;
        } catch (e) {
          console.error(`[subscription] ★ PayPal 정기결제 정지 예외 user=${a.user.id} ref=${ref}: ${(e as Error).message}`);
          return c.json(
            err('PROVIDER_STOP_FAILED', 'we could not stop the recurring payment at PayPal — nothing was changed, please try again or contact support'),
            502,
          );
        }
      }
    }

    const ok = await d.repo.cancel(a.user.id);
    if (!ok) {
      /*
         ★ PayPal 은 멈췄는데 우리 기록만 실패한 상태다. 청구는 더 이상 되지 않으므로
           고객이 손해를 보지는 않는다. 대조 작업이 PayPal=CANCELLED 를 보고 정리한다.
           그래도 사람이 알아야 하므로 크게 남긴다.
      */
      console.error(`[subscription] ★ PayPal 은 정지됐으나 기록 갱신 실패 user=${a.user.id} (대조 작업이 정리한다)`);
      return c.json(err('CANCEL_FAILED', 'could not cancel — nothing was changed'), 500);
    }

    return c.json({
      ok: true,
      /** 이 시각까지는 그대로 쓸 수 있다. 화면이 반드시 표시해야 한다. */
      activeUntil: read.row.currentPeriodEnd || null,
      /*
         ★ 우리가 결제 대행사 쪽까지 멈췄다. 고객이 따로 할 일이 **없다.**
           예전에는 이 값이 true 여서 "결제사에서도 멈추세요" 를 띄웠다.
      */
      providerStopped,
      providerStopRequired: false,
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
