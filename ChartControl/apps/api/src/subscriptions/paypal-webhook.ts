import { Hono } from 'hono';

/**
 * PayPal 웹훅 수신 — **분쟁(chargeback)을 보이게 만드는 것이 주 목적이다.**
 *
 * 왜 필요한가 (TODO-2026-09-10 §3-3)
 * ----------------------------------
 * 구독 상태는 15분 폴링(`subscription-reconcile.ts`)이 처리한다. 폴링은 유실되지 않고
 * PayPal 쪽 설정도 필요 없어서 **의도적으로 고른 방식**이다. 그 선택은 유지한다.
 *
 * 그런데 폴링으로 **절대 알 수 없는 것**이 있다: 고객이 PayPal 에 이의를 제기하면
 * (dispute/chargeback) 구독 상태는 그대로 ACTIVE 다. 우리 화면에는 아무 변화가 없고
 * PayPal 대시보드에만 나타난다. 즉 **돈이 빠져나가는데 우리는 모른다.**
 *
 * ★★★ 보안 — 이 엔드포인트는 **인증이 없는 공개 경로**다
 * ------------------------------------------------------
 * 아무나 우리 주소로 "분쟁이 열렸다"·"구독이 취소됐다" 를 보낼 수 있다.
 * 그래서 **PayPal 서명 검증이 유일한 관문**이고, 다음을 지킨다:
 *
 *   · `webhookId` 가 없으면 **503 으로 거부한다.** 검증할 수 없는데 처리하면
 *     무검증 통과가 된다. 설정이 빠졌을 때 조용히 열리는 것이 최악이다.
 *   · 검증 실패·검증 불가(네트워크 오류 포함)는 **401/503 으로 거부한다.**
 *     "검증할 수 없었다" 를 "검증됐다" 로 바꾸지 않는다.
 *   · CSRF 검증을 걸지 않는다 — PayPal 은 우리 토큰을 갖고 있지 않다. 대신 서명이
 *     그 역할을 한다. (그래서 이 라우터는 구독 라우터와 **분리**돼 있다.)
 *
 * ★★ 돈 계산을 여기서 다시 하지 않는다
 * ------------------------------------
 * 웹훅 본문은 **트리거로만** 쓴다. 구독 상태를 바꿔야 하면 기존 reconcile 경로가
 * PayPal 에 **다시 물어봐서**(getSubscription) 판단한다. 웹훅 payload 를 믿고 기간을
 * 연장하면, 위조된 요청 하나로 무료 구독이 열린다. 그리고 같은 판단을 두 곳에 두면
 * 언젠가 서로 다른 답을 낸다.
 *
 * ★ 멱등성은 `claimWebhookEvent` 가 DB 유니크 제약으로 보장한다. PayPal 은 같은
 *   이벤트를 여러 번 보낸다(재시도).
 */

export interface PaypalWebhookVerifier {
  verifyWebhookSignature(input: {
    webhookId: string;
    rawBody: string;
    transmissionId: string;
    transmissionTime: string;
    transmissionSig: string;
    certUrl: string;
    authAlgo: string;
  }): Promise<{ ok: boolean; status: string }>;
}

export interface PaypalWebhookRepo {
  /** 처음 받은 이벤트면 true. 이미 받은 것이면 false. */
  claimWebhookEvent(input: {
    eventId: string; provider: string; eventType: string; resourceId?: string | null;
  }): Promise<boolean>;
  markWebhookHandled(eventId: string, note: string): Promise<void>;
}

export interface PaypalWebhookDeps {
  /** PayPal 대시보드에서 웹훅을 만들 때 생기는 id. **없으면 엔드포인트가 거부한다.** */
  webhookId?: string;
  /** 서명 검증기(PayPalProvider). 없으면 거부한다. */
  verifier?: PaypalWebhookVerifier;
  repo?: PaypalWebhookRepo;
  /**
   * 운영자가 **실제로 보는 곳**에 남긴다.
   *
   * ★ `payment_webhook_events` 에만 적으면 아무도 보지 않는다. 분쟁은 기한이 있는
   *   일이므로(증빙 제출 기한) 관리자 화면에 뜨는 인시던트로 올린다.
   */
  raiseIncident?(input: {
    title: string; description: string; severity: string; service: string;
  }): Promise<void>;
  /**
   * 구독 상태를 다시 맞춘다. **PayPal 에 다시 물어보는 경로여야 한다.**
   * 없으면 기록만 하고 넘어간다(폴링이 15분 안에 처리한다).
   */
  resyncSubscription?(providerRef: string): Promise<void>;
}

/** 분쟁·환불처럼 **돈이 되돌아가는** 사건. 운영자가 즉시 알아야 한다. */
const MONEY_BACK_EVENTS = [
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
  'PAYMENT.CAPTURE.REVERSED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.DENIED',
];

/** 구독 생애주기 — 상태를 다시 맞춘다(폴링과 같은 일을 더 빨리). */
const SUBSCRIPTION_EVENT_PREFIX = 'BILLING.SUBSCRIPTION.';

export function createPaypalWebhookRouter(d: PaypalWebhookDeps): Hono {
  const app = new Hono();

  app.post('/payments/paypal/webhook', async (c) => {
    /*
       ★★ 본문을 **문자열 그대로** 읽는다. 파싱했다가 다시 직렬화하면 바이트가 달라져
         서명 검증이 깨진다(키 순서·공백).
    */
    let rawBody: string;
    try {
      rawBody = await c.req.text();
    } catch (e) {
      console.warn(`[paypal-webhook] 본문을 읽을 수 없다: ${(e as Error).message}`);
      return c.json({ error: { code: 'BAD_BODY', message: 'unreadable body' } }, 400);
    }

    /*
       ★★★ **설정이 없으면 거부한다.** 여기서 통과시키면 위조 요청이 그대로 들어온다.
         503 을 주면 PayPal 이 재시도하므로, 운영자가 설정을 넣은 뒤 사건이 살아난다.
    */
    if (!d.webhookId || !d.verifier) {
      console.error('[paypal-webhook] PAYPAL_WEBHOOK_ID 또는 검증기가 없다 — 요청을 거부한다(무검증 처리 금지)');
      return c.json({ error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'signature verification unavailable' } }, 503);
    }

    const h = (name: string) => c.req.header(name) ?? '';
    const verified = await d.verifier.verifyWebhookSignature({
      webhookId: d.webhookId,
      rawBody,
      transmissionId: h('paypal-transmission-id'),
      transmissionTime: h('paypal-transmission-time'),
      transmissionSig: h('paypal-transmission-sig'),
      certUrl: h('paypal-cert-url'),
      authAlgo: h('paypal-auth-algo'),
    });
    if (!verified.ok) {
      /*
         ★ 검증 실패와 검증 불가를 구분해 응답한다.
           · 실패(위조 가능성) → 401. 재시도해도 같으므로 PayPal 이 포기하는 것이 맞다.
           · 불가(우리 쪽 문제) → 503. 재시도로 살릴 수 있다.
      */
      const unreachable = /UNREACHABLE|TOKEN_FAILED|^http_5/.test(verified.status);
      console.warn(`[paypal-webhook] 서명 검증 실패(${verified.status}) — 처리하지 않는다`);
      return c.json(
        { error: { code: 'BAD_SIGNATURE', message: `verification ${verified.status}` } },
        unreachable ? 503 : 401,
      );
    }

    type PaypalEvent = { id?: string; event_type?: string; resource?: { id?: string } };
    let event: PaypalEvent | null = null;
    try {
      event = JSON.parse(rawBody) as PaypalEvent;
    } catch (e) {
      void e;
      return c.json({ error: { code: 'BAD_JSON', message: 'body is not json' } }, 400);
    }
    const eventId = String(event?.id ?? '');
    const eventType = String(event?.event_type ?? '');
    const resourceId = event?.resource?.id ? String(event.resource.id) : null;
    if (!eventId || !eventType) {
      return c.json({ error: { code: 'BAD_EVENT', message: 'missing id/event_type' } }, 400);
    }

    /*
       ★★ 기록할 수 없으면 **처리하지 않고 500 을 준다.** 멱등성을 보장할 수 없는데
         처리하면 같은 사건을 두 번 다룰 수 있다. 500 이면 PayPal 이 재시도한다.
       ★ repo 가 없는 배포(개발 SQLite 등)에서는 기록 없이 지나간다 — 그때는 알림만
         하고 멱등성은 포기한다(개발 환경이므로 돈이 걸리지 않는다).
    */
    if (d.repo) {
      let fresh: boolean;
      try {
        fresh = await d.repo.claimWebhookEvent({
          eventId, provider: 'paypal', eventType, resourceId,
        });
      } catch (e) {
        console.error(`[paypal-webhook] 중복검사 실패 — 재시도를 요청한다: ${(e as Error).message}`);
        return c.json({ error: { code: 'CLAIM_FAILED', message: 'retry later' } }, 500);
      }
      if (!fresh) {
        /* 이미 처리한 사건. **200 을 준다** — 아니면 PayPal 이 영원히 재시도한다. */
        return c.json({ ok: true, duplicate: true });
      }
    }

    const notes: string[] = [];

    if (MONEY_BACK_EVENTS.includes(eventType)) {
      /*
         ★★★ 분쟁·환불 — 돈이 되돌아간다. 폴링으로는 알 수 없는 **유일한 이유**다.
           금액·사유를 여기서 판단하지 않는다(payload 를 믿지 않는다). 운영자가
           PayPal 대시보드에서 확인하도록 **사건과 참조 id 만** 정확히 전달한다.
      */
      const line = `PayPal ${eventType} — resource=${resourceId ?? 'unknown'}`;
      if (d.raiseIncident) {
        try {
          await d.raiseIncident({
            title: `결제 분쟁/환불: ${eventType}`,
            description: `${line}\nevent_id=${eventId}\n`
              + 'PayPal 대시보드에서 금액·사유·증빙 기한을 확인하십시오. '
              + '이 알림은 웹훅 서명 검증을 통과한 사건입니다.',
            severity: 'high',
            service: 'payments',
          });
          notes.push('incident_raised');
        } catch (e) {
          /* ★ 알림 실패를 조용히 넘기지 않는다 — 그러면 아무도 모른다. */
          console.error(`[paypal-webhook] 인시던트 생성 실패 event=${eventId}: ${(e as Error).message}`);
          notes.push('incident_failed');
        }
      } else {
        console.warn(`[paypal-webhook] 인시던트 창구가 없다 — 로그만 남긴다: ${line}`);
        notes.push('incident_unavailable');
      }
    } else if (eventType.startsWith(SUBSCRIPTION_EVENT_PREFIX)) {
      /*
         ★ 구독 생애주기 — 폴링이 15분 안에 처리하지만, 웹훅이 오면 더 빨리 맞춘다.
           **payload 를 믿지 않는다.** resync 는 PayPal 에 다시 물어보는 경로다.
      */
      if (resourceId && d.resyncSubscription) {
        try {
          await d.resyncSubscription(resourceId);
          notes.push('resynced');
        } catch (e) {
          console.warn(`[paypal-webhook] 구독 재동기화 실패 ${resourceId}: ${(e as Error).message}`);
          notes.push('resync_failed');
        }
      } else {
        notes.push('resync_unavailable');
      }
    } else {
      notes.push('ignored');
    }

    if (d.repo) await d.repo.markWebhookHandled(eventId, notes.join(',') || 'handled');

    /*
       ★ 검증을 통과한 뒤에는 **항상 200** 이다. 우리 처리에 실패했더라도 기록은
         남았고(note), 200 을 주지 않으면 PayPal 이 같은 사건을 계속 보낸다.
    */
    return c.json({ ok: true, eventType, notes });
  });

  return app;
}
