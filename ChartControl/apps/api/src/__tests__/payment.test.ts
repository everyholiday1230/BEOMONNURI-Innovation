import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createHmac, randomUUID } from 'node:crypto';
import { createPool, migrateUp } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { PgPointsRepo } from '../db/points-repo';
import { PgPointOrderRepo } from '../db/point-order-repo';
import { CryptoInvoiceProvider, resolvePaymentProviders, findPackage, POINT_PACKAGES } from '../payments/providers';
import { capturedPaymentMatches } from '../payment-routes';

// ---- Pure unit tests (no DB) ----
describe('payment providers (pure)', () => {
  it('resolvePaymentProviders is fail-closed: no credentials → no providers', () => {
    const none = resolvePaymentProviders({});
    expect(none.paypal).toBeUndefined();
    expect(none.crypto).toBeUndefined();
  });

  it('builds providers only when credentials are present', () => {
    const p = resolvePaymentProviders({ paypalClientId: 'id', paypalClientSecret: 'sec', cryptoWebhookSecret: 'whsec' });
    expect(p.paypal).toBeTruthy();
    expect(p.crypto).toBeTruthy();
  });

  it('CryptoInvoiceProvider.verifyWebhook accepts a correct HMAC and rejects a wrong one', () => {
    const secret = 'test-webhook-secret';
    const c = new CryptoInvoiceProvider({ webhookSecret: secret });
    const body = JSON.stringify({ orderId: 'o1', status: 'confirmed' });
    const goodSig = createHmac('sha256', secret).update(body).digest('hex');
    expect(c.verifyWebhook(body, goodSig)).toBe(true);
    expect(c.verifyWebhook(body, 'deadbeef')).toBe(false);
    expect(c.verifyWebhook(body, undefined)).toBe(false);
    // tampered body → signature no longer matches
    expect(c.verifyWebhook(JSON.stringify({ orderId: 'o1', status: 'confirmed', amount: 999 }), goodSig)).toBe(false);
  });

  it('has a server-authoritative package catalogue', () => {
    expect(POINT_PACKAGES.length).toBeGreaterThan(0);
    expect(findPackage('pack_10k')?.points).toBe(10_000);
    expect(findPackage('nope')).toBeUndefined();
  });
});

// ---- PG integration: idempotent crediting ----
const PG_URL = process.env.PG_TEST_URL;
const d = PG_URL ? describe : describe.skip;

d('PgPointOrderRepo (idempotent top-up)', () => {
  let pool: Pool;
  let points: PgPointsRepo;
  let orders: PgPointOrderRepo;
  const created: string[] = [];

  const makeUser = async (): Promise<string> => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at)
       VALUES ($1, $2, 'x', 'user', 'active', now(), now())`,
      [id, `pay_${id.slice(0, 8)}@pay-test.local`],
    );
    created.push(id);
    return id;
  };

  beforeAll(async () => {
    pool = createPool(await createIsolatedTestDatabase(PG_URL!, 'point_orders'));
    await migrateUp(pool);
    points = new PgPointsRepo(pool);
    orders = new PgPointOrderRepo(pool, points);
  });
  afterAll(async () => { if (pool) await pool.end(); });
  beforeEach(() => { created.length = 0; });

  it('credits points exactly once even if markPaid runs twice', async () => {
    const userId = await makeUser();
    const before = await points.balanceOf(userId);
    const order = await orders.create({ userId, provider: 'usdt', packageId: 'pack_10k', points: 10_000, amount: '9.99', currency: 'USDT', providerRef: 'inv-1' });

    const r1 = await orders.markPaid(order.id);
    expect(r1?.credited).toBe(true);
    expect(await points.balanceOf(userId)).toBe(before + 10_000);

    // duplicate confirmation (e.g. webhook retry) must NOT double-credit
    const r2 = await orders.markPaid(order.id);
    expect(r2?.credited).toBe(false);
    expect(await points.balanceOf(userId)).toBe(before + 10_000);
  });

  it('finds an order by provider ref (for webhook lookup)', async () => {
    const userId = await makeUser();
    const order = await orders.create({ userId, provider: 'usdt', packageId: 'pack_55k', points: 55_000, amount: '49.99', currency: 'USDT', providerRef: 'inv-2' });
    const found = await orders.findByRef('usdt', 'inv-2');
    expect(found?.id).toBe(order.id);
    expect(found?.points).toBe(55_000);
  });
});

/*
   PayPal 결제 확인 대조 — 고객이 청구당하고 포인트를 못 받는 실패를 막는다.

   ★★ 실제로 있었던 버그: point_orders.amount 는 NUMERIC(24,8) 이라 pg 가
     "9.99000000" 을 돌려주는데 PayPal 은 "9.99" 를 준다. 문자열 `!==` 비교라
     **정상 결제가 항상 불일치**로 처리됐다. 그 시점에는 capture() 가 이미 청구를
     끝냈으므로 돈은 나가고 주문은 실패, 포인트는 미지급이었다.
*/
describe('capturedPaymentMatches — 결제 확인 대조', () => {
  const order = { id: 'ord_1', amount: '9.99000000', currency: 'USD' };

  it('★★ NUMERIC 자리수 차이를 같은 금액으로 본다 (9.99 == 9.99000000)', () => {
    const v = capturedPaymentMatches({ ok: true, customId: 'ord_1', amount: '9.99', currency: 'USD' }, order);
    expect(v.match).toBe(true);
  });

  it('정수 표기도 같은 금액으로 본다 (10 == 10.00000000)', () => {
    const v = capturedPaymentMatches(
      { ok: true, customId: 'ord_1', amount: '10' },
      { id: 'ord_1', amount: '10.00000000', currency: 'USD' },
    );
    expect(v.match).toBe(true);
  });

  it('실제로 다른 금액은 거부한다', () => {
    const v = capturedPaymentMatches({ ok: true, customId: 'ord_1', amount: '1.99', currency: 'USD' }, order);
    expect(v.match).toBe(false);
    expect(v.reason).toMatch(/amount/);
  });

  it('통화가 다르면 거부한다 — 같은 숫자라도 다른 금액이다', () => {
    const v = capturedPaymentMatches({ ok: true, customId: 'ord_1', amount: '9.99', currency: 'EUR' }, order);
    expect(v.match).toBe(false);
    expect(v.reason).toMatch(/currency/);
  });

  it('다른 주문의 결제는 거부한다', () => {
    const v = capturedPaymentMatches({ ok: true, customId: 'ord_OTHER', amount: '9.99' }, order);
    expect(v.match).toBe(false);
    expect(v.reason).toMatch(/custom_id/);
  });

  it('제공자가 미완료라고 하면 거부한다', () => {
    expect(capturedPaymentMatches({ ok: false, customId: 'ord_1', amount: '9.99' }, order).match).toBe(false);
  });

  it('제공자가 생략한 값은 대조하지 않는다 — 없는 값으로 정상 결제를 뒤집지 않는다', () => {
    const v = capturedPaymentMatches({ ok: true, customId: 'ord_1' }, order);
    expect(v.match).toBe(true);
  });

  it('숫자로 못 읽는 금액은 통과시키지 않는다', () => {
    const v = capturedPaymentMatches({ ok: true, customId: 'ord_1', amount: 'abc' }, order);
    expect(v.match).toBe(false);
  });
});
