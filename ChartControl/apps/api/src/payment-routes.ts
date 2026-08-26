import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import type { PgPointOrderRepo } from './db/point-order-repo';
import type { PgPointsRepo } from './db/points-repo';
import { type PaymentProviders, POINT_PACKAGES, findPackage } from './payments/providers';

const CSRF = 'qt_csrf';
const err = (code: string, message: string) => ({ error: { code, message } });

export interface PaymentRouterDeps {
  service: AuthService;
  orders?: PgPointOrderRepo;
  points?: PgPointsRepo;
  providers: PaymentProviders;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  verifyCsrf: typeof verifyCsrf;
  originAllowed: typeof originAllowed;
  /** 결제 후 돌아올 기준 주소(PayPal return/cancel). */
  publicBaseUrl?: string;
}

export function createPaymentRouter(d: PaymentRouterDeps): Hono {
  const app = new Hono();

  const authed = async (c: Context) => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };
  const csrfOk = (c: Context, secret: string) =>
    d.originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    d.verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF), secret, d.csrfKey);

  const paypalOn = Boolean(d.orders && d.points && d.providers.paypal);
  const usdtOn = Boolean(d.orders && d.points && d.providers.crypto);
  const tossOn = Boolean(d.orders && d.points && d.providers.toss);

  // ---- 사용 가능한 결제 수단 + 포인트 패키지 ----
  app.get('/me/topup/packages', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    return c.json({
      supported: { paypal: paypalOn, usdt: usdtOn, toss: tossOn },
      packages: POINT_PACKAGES,
      // 결제 수단이 하나도 없으면 화면이 "결제 준비 중" 을 정직히 표시한다.
      enabled: paypalOn || usdtOn || tossOn,
    });
  });

  // ---- PayPal: 주문 생성 → 승인 URL 반환 ----
  app.post('/me/topup/paypal/create', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!paypalOn) return c.json(err('NOT_CONFIGURED', 'PayPal is not enabled'), 503);
    const body = (await c.req.json().catch(() => ({}))) as { packageId?: string };
    const pkg = body.packageId ? findPackage(body.packageId) : undefined;
    if (!pkg) return c.json(err('BAD_REQUEST', 'unknown package'), 400);

    const order = await d.orders!.create({
      userId: a.user.id, provider: 'paypal', packageId: pkg.id, points: pkg.points, amount: pkg.amount, currency: 'USD',
    });
    const baseUrl = d.publicBaseUrl || '';
    try {
      const pp = await d.providers.paypal!.createOrder({
        orderId: order.id, amount: pkg.amount, currency: 'USD',
        returnUrl: `${baseUrl}/#/wallet?topup=paypal&order=${order.id}`,
        cancelUrl: `${baseUrl}/#/wallet?topup=cancel`,
      });
      await d.orders!.attachRef(order.id, pp.providerRef);
      return c.json({ orderId: order.id, approveUrl: pp.approveUrl, provider: 'paypal' });
    } catch (e) {
      await d.orders!.markFailed(order.id);
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  // ---- PayPal: 캡처(결제 확정) → 포인트 적립 ----
  app.post('/me/topup/paypal/capture', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!paypalOn) return c.json(err('NOT_CONFIGURED', 'PayPal is not enabled'), 503);
    const body = (await c.req.json().catch(() => ({}))) as { orderId?: string };
    const order = body.orderId ? await d.orders!.getOwned(a.user.id, body.orderId) : null;
    if (!order || !order.providerRef) return c.json(err('NOT_FOUND', 'order not found'), 404);
    if (order.status === 'paid') {
      const balance = await d.points!.balanceOf(a.user.id);
      return c.json({ credited: false, alreadyPaid: true, balance });
    }
    try {
      const cap = await d.providers.paypal!.capture(order.providerRef);
      // 서버가 PayPal 로부터 직접 확인한 결과 + 금액/주문 대조.
      if (!cap.ok || cap.customId !== order.id || (cap.amount && cap.amount !== order.amount)) {
        await d.orders!.markFailed(order.id);
        return c.json(err('PAYMENT_NOT_COMPLETED', `status=${cap.status}`), 402);
      }
      const res = await d.orders!.markPaid(order.id);
      const balance = await d.points!.balanceOf(a.user.id);
      return c.json({ credited: Boolean(res?.credited), points: order.points, balance });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  // ---- Toss(한국결제): 클라이언트 키 반환 (위젯 초기화용) ----
  app.get('/me/topup/toss/config', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!tossOn) return c.json({ supported: false });
    return c.json({ supported: true, clientKey: d.providers.toss!.clientKey });
  });

  // ---- Toss: 주문 생성 → 위젯에 넘길 정보 반환(원화) ----
  app.post('/me/topup/toss/create', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!tossOn) return c.json(err('NOT_CONFIGURED', 'Toss is not enabled'), 503);
    const body = (await c.req.json().catch(() => ({}))) as { packageId?: string };
    const pkg = body.packageId ? findPackage(body.packageId) : undefined;
    if (!pkg) return c.json(err('BAD_REQUEST', 'unknown package'), 400);
    const order = await d.orders!.create({
      userId: a.user.id, provider: 'toss', packageId: pkg.id, points: pkg.points, amount: String(pkg.krw), currency: 'KRW',
    });
    return c.json({ orderId: order.id, amount: pkg.krw, orderName: `${pkg.points.toLocaleString()} points`, clientKey: d.providers.toss!.clientKey, provider: 'toss' });
  });

  // ---- Toss: 결제 확정 → 서버가 직접 confirm → 포인트 적립 ----
  app.post('/me/topup/toss/confirm', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!tossOn) return c.json(err('NOT_CONFIGURED', 'Toss is not enabled'), 503);
    const body = (await c.req.json().catch(() => ({}))) as { paymentKey?: string; orderId?: string; amount?: number };
    if (!body.paymentKey || !body.orderId || !body.amount) return c.json(err('BAD_REQUEST', 'paymentKey, orderId, amount required'), 400);
    const order = await d.orders!.getOwned(a.user.id, body.orderId);
    if (!order) return c.json(err('NOT_FOUND', 'order not found'), 404);
    if (order.status === 'paid') {
      const balance = await d.points!.balanceOf(a.user.id);
      return c.json({ credited: false, alreadyPaid: true, balance });
    }
    // 클라이언트가 보낸 금액이 서버 주문 금액(원화)과 일치해야 한다(위변조 방지).
    if (Number(body.amount) !== Number(order.amount)) return c.json(err('AMOUNT_MISMATCH', ''), 400);
    try {
      const conf = await d.providers.toss!.confirm({ paymentKey: body.paymentKey, orderId: body.orderId, amount: Number(body.amount) });
      if (!conf.ok) {
        await d.orders!.markFailed(order.id);
        return c.json(err('PAYMENT_NOT_COMPLETED', `status=${conf.status ?? conf.message ?? ''}`), 402);
      }
      await d.orders!.attachRef(order.id, body.paymentKey);
      const res = await d.orders!.markPaid(order.id);
      const balance = await d.points!.balanceOf(a.user.id);
      return c.json({ credited: Boolean(res?.credited), points: order.points, balance });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  // ---- USDT: 인보이스 생성(수신 주소/금액 반환) ----
  app.post('/me/topup/usdt/create', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!usdtOn) return c.json(err('NOT_CONFIGURED', 'USDT payment is not enabled'), 503);
    const body = (await c.req.json().catch(() => ({}))) as { packageId?: string };
    const pkg = body.packageId ? findPackage(body.packageId) : undefined;
    if (!pkg) return c.json(err('BAD_REQUEST', 'unknown package'), 400);
    const order = await d.orders!.create({
      userId: a.user.id, provider: 'usdt', packageId: pkg.id, points: pkg.points, amount: pkg.amount, currency: 'USDT',
    });
    const inv = d.providers.crypto!.createInvoice({ orderId: order.id, amount: pkg.amount });
    await d.orders!.attachRef(order.id, inv.providerRef);
    // 적립은 결제 확인 웹훅(/webhooks/crypto)에서 이뤄진다. 여기선 결제 안내만 반환.
    return c.json({ orderId: order.id, provider: 'usdt', address: inv.address, network: inv.network, amount: inv.amount, currency: 'USDT' });
  });

  // ---- 크립토 결제 확정 웹훅 (HMAC 검증; 쿠키/CSRF 없음) ----
  app.post('/webhooks/crypto', async (c) => {
    if (!usdtOn) return c.json(err('NOT_CONFIGURED', 'crypto payments not enabled'), 503);
    // HMAC 검증을 위해 원문 바디가 필요하다.
    const raw = await c.req.text();
    const sig = c.req.header('x-webhook-signature') || c.req.header('x-signature');
    if (!d.providers.crypto!.verifyWebhook(raw, sig)) return c.json(err('BAD_SIGNATURE', ''), 401);
    let payload: { orderId?: string; providerRef?: string; status?: string } = {};
    try { payload = JSON.parse(raw); } catch { return c.json(err('BAD_REQUEST', 'invalid json'), 400); }
    const ref = payload.orderId || payload.providerRef;
    if (!ref) return c.json(err('BAD_REQUEST', 'orderId required'), 400);
    if (payload.status && payload.status !== 'confirmed' && payload.status !== 'paid') {
      return c.json({ ok: true, ignored: `status=${payload.status}` });
    }
    const order = await d.orders!.findByRef('usdt', ref);
    if (!order) return c.json(err('NOT_FOUND', 'order not found'), 404);
    const res = await d.orders!.markPaid(order.id);
    return c.json({ ok: true, credited: Boolean(res?.credited) });
  });

  return app;
}
