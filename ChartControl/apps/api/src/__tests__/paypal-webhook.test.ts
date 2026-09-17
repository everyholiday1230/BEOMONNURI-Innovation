import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPaypalWebhookRouter, type PaypalWebhookDeps } from '../subscriptions/paypal-webhook';

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/**
 * PayPal 웹훅 — **인증 없는 공개 엔드포인트**의 안전 규칙.
 *
 * 왜 이 시험이 중요한가
 * ---------------------
 * 이 경로는 아무나 부를 수 있다. 서명 검증이 유일한 관문이므로, 검증을 우회하는 회귀는
 * 곧 "아무나 분쟁·구독취소 사건을 만들어 넣을 수 있다" 가 된다. 그래서 다음을
 * **거부하는지**를 본다: 설정 없음 · 서명 실패 · 검증 불가.
 *
 * 그리고 폴링(15분)과 역할이 겹치지 않아야 한다. 웹훅의 존재 이유는 **분쟁**이다 —
 * 폴링으로는 볼 수 없는 유일한 사건.
 */

const EVENT = (over: Record<string, unknown> = {}) => JSON.stringify({
  id: 'WH-TEST-1',
  event_type: 'CUSTOMER.DISPUTE.CREATED',
  resource: { id: 'PP-D-1' },
  ...over,
});

const HEADERS = {
  'paypal-transmission-id': 'tid',
  'paypal-transmission-time': '2026-09-17T00:00:00Z',
  'paypal-transmission-sig': 'sig',
  'paypal-cert-url': 'https://api.paypal.com/cert',
  'paypal-auth-algo': 'SHA256withRSA',
  'content-type': 'application/json',
};

const mount = (d: PaypalWebhookDeps) => {
  const app = new Hono();
  app.route('/api', createPaypalWebhookRouter(d));
  return app;
};

const post = (app: Hono, body: string, headers: Record<string, string> = HEADERS) =>
  app.request('/api/payments/paypal/webhook', { method: 'POST', body, headers });

/** 항상 통과하는 검증기(정상 경로 시험용). */
const okVerifier = { verifyWebhookSignature: async () => ({ ok: true, status: 'SUCCESS' }) };

describe('PAYPAL-WEBHOOK — 서명 검증이 유일한 관문이다', () => {
  it('[1] ★★★ webhookId 가 없으면 503 으로 거부한다 (무검증 통과 금지)', async () => {
    /*
       ★ 설정이 빠졌을 때 조용히 열리는 것이 최악이다. 200 을 주면 아무나 사건을
         만들어 넣을 수 있고, 우리는 그것을 "PayPal 이 알려준 것" 으로 취급한다.
       ★ 503 인 이유: PayPal 이 재시도하므로 운영자가 설정을 넣은 뒤 사건이 살아난다.
    */
    const res = await post(mount({ verifier: okVerifier }), EVENT());
    expect(res.status).toBe(503);
    const j = await res.json() as { error?: { code?: string } };
    expect(j.error?.code).toBe('WEBHOOK_NOT_CONFIGURED');
  });

  it('[2] 검증기가 없으면 503 으로 거부한다', async () => {
    const res = await post(mount({ webhookId: 'WH-1' }), EVENT());
    expect(res.status).toBe(503);
  });

  it('[3] ★★ 서명 검증 실패는 401 이고 아무것도 처리하지 않는다', async () => {
    const claimed: string[] = [];
    const res = await post(mount({
      webhookId: 'WH-1',
      verifier: { verifyWebhookSignature: async () => ({ ok: false, status: 'FAILURE' }) },
      repo: {
        claimWebhookEvent: async (i) => { claimed.push(i.eventId); return true; },
        markWebhookHandled: async () => {},
      },
    }), EVENT());
    expect(res.status).toBe(401);
    expect(claimed, '검증 실패인데 이벤트를 기록했다').toEqual([]);
  });

  it('[4] 검증 **불가**(네트워크 실패)는 503 — 재시도로 살릴 수 있다', async () => {
    /*
       ★ "검증할 수 없었다" 를 "검증됐다" 로 바꾸지 않는다. 그리고 위조(401)와 구분한다 —
         401 이면 PayPal 이 포기하고, 503 이면 다시 보낸다.
    */
    const res = await post(mount({
      webhookId: 'WH-1',
      verifier: { verifyWebhookSignature: async () => ({ ok: false, status: 'VERIFY_UNREACHABLE: timeout' }) },
    }), EVENT());
    expect(res.status).toBe(503);
  });

  it('[5] 검증을 통과하면 분쟁을 운영자에게 올린다', async () => {
    const incidents: { title: string; severity: string }[] = [];
    const handled: string[] = [];
    const res = await post(mount({
      webhookId: 'WH-1',
      verifier: okVerifier,
      repo: {
        claimWebhookEvent: async () => true,
        markWebhookHandled: async (id, note) => { handled.push(`${id}:${note}`); },
      },
      raiseIncident: async (i) => { incidents.push({ title: i.title, severity: i.severity }); },
    }), EVENT());
    expect(res.status).toBe(200);
    expect(incidents.length, '분쟁인데 알림을 올리지 않았다').toBe(1);
    expect(incidents[0]!.severity).toBe('high');
    expect(handled[0]).toContain('incident_raised');
  });

  it('[6] ★★ 같은 이벤트를 두 번 받으면 두 번 처리하지 않는다 (200 으로 응답)', async () => {
    /*
       ★ PayPal 은 재시도한다. 멱등하지 않으면 같은 분쟁으로 알림이 반복되고,
         구독 경로라면 기간이 두 번 연장된다.
       ★★ 중복일 때 **200** 을 줘야 한다. 4xx/5xx 를 주면 PayPal 이 영원히 재시도한다.
    */
    let first = true;
    const incidents: unknown[] = [];
    const app = mount({
      webhookId: 'WH-1',
      verifier: okVerifier,
      repo: {
        claimWebhookEvent: async () => { const f = first; first = false; return f; },
        markWebhookHandled: async () => {},
      },
      raiseIncident: async () => { incidents.push(1); },
    });
    const r1 = await post(app, EVENT());
    const r2 = await post(app, EVENT());
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(incidents.length, '중복 이벤트를 두 번 처리했다').toBe(1);
    expect(await r2.json()).toMatchObject({ duplicate: true });
  });

  it('[7] 중복검사에 실패하면 처리하지 않고 500 (재시도 요청)', async () => {
    /*
       ★ 멱등성을 보장할 수 없는데 처리하면 같은 사건을 두 번 다룰 수 있다.
         500 이면 PayPal 이 다시 보낸다.
    */
    const incidents: unknown[] = [];
    const res = await post(mount({
      webhookId: 'WH-1',
      verifier: okVerifier,
      repo: {
        claimWebhookEvent: async () => { throw new Error('db down'); },
        markWebhookHandled: async () => {},
      },
      raiseIncident: async () => { incidents.push(1); },
    }), EVENT());
    expect(res.status).toBe(500);
    expect(incidents, '기록할 수 없는데 처리했다').toEqual([]);
  });

  it('[8] 구독 사건은 **PayPal 에 다시 물어보는** 경로로 넘긴다', async () => {
    /*
       ★★★ 웹훅 payload 를 믿고 기간을 연장하면 위조된 요청 하나로 무료 구독이 열린다.
         그래서 여기서는 상태를 바꾸지 않고 재조회만 트리거한다.
    */
    const resynced: string[] = [];
    const res = await post(mount({
      webhookId: 'WH-1',
      verifier: okVerifier,
      repo: { claimWebhookEvent: async () => true, markWebhookHandled: async () => {} },
      resyncSubscription: async (ref) => { resynced.push(ref); },
    }), EVENT({ event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: 'I-SUB-9' } }));
    expect(res.status).toBe(200);
    expect(resynced).toEqual(['I-SUB-9']);
  });

  it('[9] 모르는 이벤트도 200 으로 받고 무시한다 (재시도 폭주 방지)', async () => {
    const handled: string[] = [];
    const res = await post(mount({
      webhookId: 'WH-1',
      verifier: okVerifier,
      repo: {
        claimWebhookEvent: async () => true,
        markWebhookHandled: async (_id, note) => { handled.push(note); },
      },
    }), EVENT({ event_type: 'SOMETHING.WE.DO.NOT.HANDLE' }));
    expect(res.status).toBe(200);
    expect(handled[0]).toBe('ignored');
  });

  it('[10] id·event_type 이 없는 본문은 400', async () => {
    const res = await post(mount({ webhookId: 'WH-1', verifier: okVerifier }), JSON.stringify({ foo: 1 }));
    expect(res.status).toBe(400);
  });

  it('[11] ★ 서명 검증에 **원문 그대로**를 넘긴다 (재직렬화 금지)', async () => {
    /*
       ★ 파싱했다가 다시 직렬화하면 키 순서·공백이 달라져 서명이 깨진다.
         실제 PayPal 검증에서 바로 실패하므로, 여기서 원문 전달을 고정한다.
    */
    let seen = '';
    const body = '{"id":"WH-X",  "event_type":"CUSTOMER.DISPUTE.CREATED","resource":{"id":"D"}}';
    await post(mount({
      webhookId: 'WH-1',
      verifier: {
        verifyWebhookSignature: async (i) => { seen = i.rawBody; return { ok: true, status: 'SUCCESS' }; },
      },
      repo: { claimWebhookEvent: async () => true, markWebhookHandled: async () => {} },
    }), body);
    expect(seen, '원문이 아니라 다시 만든 문자열을 넘겼다').toBe(body);
  });
});

describe('PAYPAL-WEBHOOK — 배선과 문서', () => {
  it('[12] 구독 라우터와 분리해 마운트한다 (CSRF 와 얽히지 않게)', () => {
    /*
       ★ PayPal 은 우리 CSRF 토큰을 갖고 있지 않다. 같은 라우터에 넣으면 CSRF 검증에
         걸려 모든 웹훅이 거부된다. 서명 검증이 CSRF 의 역할을 대신한다.
    */
    const idx = read('apps/api/src/index.ts');
    expect(idx).toMatch(/createPaypalWebhookRouter\(\{/u);
    /* 설정이 없어도 마운트는 한다 — 404 는 "설정 누락" 과 "기능 없음" 을 구분 못 하게 한다. */
    expect(idx).toMatch(/webhookId: env\.paypalWebhookId/u);
  });

  it('[13] PAYPAL_WEBHOOK_ID 를 env 로 읽는다', () => {
    const envSrc = read('apps/api/src/env.ts');
    expect(envSrc).toMatch(/paypalWebhookId\?: string/u);
    expect(envSrc).toMatch(/env\.PAYPAL_WEBHOOK_ID/u);
  });

  it('[14] 폴링을 대체하지 않는다 — 구독 대조는 그대로 남아 있다', () => {
    /*
       ★ 웹훅이 들어왔다고 폴링을 끄면, 웹훅이 유실될 때 아무도 상태를 맞추지 않는다.
         폴링은 유실되지 않는다는 것이 원래 선택의 이유였다.
    */
    const idx = read('apps/api/src/index.ts');
    expect(idx, '구독 대조 폴링이 사라졌다').toMatch(/startSubscriptionReconciler\(/u);
  });
});
