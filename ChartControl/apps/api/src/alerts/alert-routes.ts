/*
 * 가격 알림 — 사용자용 라우터.
 *
 * 세션 인증·CSRF 를 다른 사용자 라우터와 같은 방식으로 처리한다(support-routes 와 동일).
 * 소유 확인은 저장소가 한다(cancel 은 user_id 조건 포함) — 라우트에서만 하면
 * 다른 경로가 생길 때 빠뜨린다.
 */

import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';

import { AuthService, type PublicUser } from '@quantumtrade/auth';

import { PgPriceAlertRepo, MAX_ACTIVE_ALERTS_PER_USER, type AlertDirection } from '../db/price-alert-repo';

const CSRF_COOKIE = 'qt_csrf';

export interface AlertRouterDeps {
  service: AuthService;
  /** Postgres 배포에만 있다. 없으면 supported:false 로 사실을 알린다(빈 배열로 속이지 않는다). */
  repo?: PgPriceAlertRepo;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  verifyCsrf: (token: string | undefined, cookie: string | undefined, secret: string, key: string) => boolean;
  originAllowed: (origin: string | undefined, referer: string | undefined, allowed: string[]) => boolean;
}

const err = (code: string, message: string) => ({ error: { code, message } });
const MAX_SYMBOL = 30;

export function createAlertRouter(d: AlertRouterDeps): Hono {
  const app = new Hono();

  const authed = async (c: Context): Promise<{ user: PublicUser; csrfSecret: string } | null> => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };

  const csrfOk = (c: Context, secret: string) =>
    d.originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    d.verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF_COOKIE), secret, d.csrfKey);

  /** 내 알림 목록. */
  app.get('/me/alerts', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.repo) return c.json({ alerts: [], supported: false });
    try {
      const alerts = await d.repo.listForUser(a.user.id);
      return c.json({ alerts, supported: true });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  /** 새 알림. */
  app.post('/me/alerts', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json({ ...err('NOT_CONFIGURED', 'alerts require the PostgreSQL backend'), supported: false });

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    const direction = String(body.direction ?? '') as AlertDirection;
    const targetPrice = Number(body.targetPrice);
    const notifyEmail = body.notifyEmail !== false; // 기본 true

    if (!symbol || symbol.length > MAX_SYMBOL) return c.json(err('BAD_REQUEST', 'symbol required'), 400);
    if (direction !== 'above' && direction !== 'below') return c.json(err('BAD_REQUEST', 'direction must be above|below'), 400);
    if (!Number.isFinite(targetPrice) || targetPrice <= 0) return c.json(err('BAD_REQUEST', 'targetPrice must be > 0'), 400);

    try {
      /* 상한: 한 사용자가 무한히 만들어 감시 루프를 무겁게 하지 않게. */
      const active = await d.repo.countActive(a.user.id);
      if (active >= MAX_ACTIVE_ALERTS_PER_USER) {
        return c.json(err('LIMIT_REACHED', `max ${MAX_ACTIVE_ALERTS_PER_USER} active alerts`), 409);
      }
      const alert = await d.repo.create({ userId: a.user.id, symbol, direction, targetPrice, notifyEmail });
      return c.json({ alert }, 201);
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  /** 알림 취소. */
  app.delete('/me/alerts/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', 'alerts unavailable'), 503);
    try {
      const ok = await d.repo.cancel(a.user.id, c.req.param('id'));
      return ok ? c.json({ ok: true }) : c.json(err('NOT_FOUND', 'alert not found'), 404);
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  return app;
}
