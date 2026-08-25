import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createHmac, randomUUID } from 'node:crypto';
import { createPool, migrateUp } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { PgPointsRepo } from '../db/points-repo';
import { PgPointOrderRepo } from '../db/point-order-repo';
import { CryptoInvoiceProvider, resolvePaymentProviders, findPackage, POINT_PACKAGES } from '../payments/providers';

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
