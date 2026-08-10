/**
 * 포인트 — 사용자용 라우터.
 *
 * 이 라우터가 하지 않는 것
 * ---------------------
 * · **현금 출금·환전이 없다.** 포인트를 현금으로 바꿔주면 자금 이동업이고
 *   우리는 그 자격이 없다. 사이트 안에서만 쓰인다. 그 사실을 응답에 담아
 *   화면이 표시하게 한다.
 *
 * · **현금 구매를 여기서 처리하지 않는다.** 결제 대행사가 연결되지 않았다.
 *   구매 경로를 만들어두면 사용자가 돈을 보내고 포인트를 못 받는다.
 *   settings.purchaseEnabled 가 켜져 있어도 결제 라우트가 없으면 화면이
 *   구매 버튼을 보여주지 않는다.
 */

import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';

import { AuthService, type PublicUser } from '@quantumtrade/auth';

import type { PgPointsRepo } from '../db/points-repo';

const CSRF_COOKIE = 'qt_csrf';

export interface PointsRouterDeps {
  service: AuthService;
  /** Postgres 배포에만 있다. 없으면 제도를 사용할 수 없다고 알린다. */
  repo?: PgPointsRepo;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  verifyCsrf: (token: string | undefined, cookie: string | undefined, secret: string, key: string) => boolean;
  originAllowed: (origin: string | undefined, referer: string | undefined, allowed: string[]) => boolean;
}

const err = (code: string, message: string) => ({ error: { code, message } });

export function createPointsRouter(d: PointsRouterDeps): Hono {
  const app = new Hono();

  const authed = async (c: Context): Promise<{ user: PublicUser; csrfSecret: string } | null> => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };

  const csrfOk = (c: Context, secret: string) =>
    d.originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    d.verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF_COOKIE), secret, d.csrfKey);

  /** 내 포인트 — 잔액·내역·상품·이용권. */
  app.get('/points/me', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.repo) return c.json({ supported: false, enabled: false });

    try {
      const settings = await d.repo.getSettings();
      if (!settings.enabled) {
        // 제도가 꺼져 있으면 잔액도 상품도 보여주지 않는다.
        return c.json({ supported: true, enabled: false, settings: { enabled: false, unitName: settings.unitName } });
      }

      const [balance, history, catalog, entitlements, redemptions] = await Promise.all([
        d.repo.balanceOf(a.user.id),
        d.repo.history(a.user.id, 100),
        d.repo.listCatalog(false),
        d.repo.entitlementsOf(a.user.id),
        d.repo.listRedemptions(a.user.id, 50),
      ]);

      return c.json({
        supported: true,
        enabled: true,
        settings: {
          enabled: true,
          unitName: settings.unitName,
          /*
             구매 가능 여부.

             ★ 조건 두 개를 모두 만족해야 true 다: 설정이 켜져 있고, 결제
               경로가 실제로 있어야 한다. 지금은 결제 대행사가 없으므로
               항상 false 다. 설정만 보고 true 를 주면 화면이 구매 버튼을
               띄우고 사용자가 돈을 보낼 방법을 찾는다.
          */
          purchaseAvailable: false,
          purchaseEnabledInSettings: settings.purchaseEnabled,
          expiryDays: settings.expiryDays,
        },
        balance,
        entitlements,
        catalog,
        history,
        redemptions,
        /*
           ★ 화면이 반드시 표시해야 하는 사실.

           포인트는 현금이 아니고, 출금할 수 없다. 이 문구가 없으면 사용자가
           적립된 포인트를 인출하려 하고, 안 된다는 것을 나중에 알게 된다.
        */
        disclosures: {
          cashConvertible: false,
          withdrawable: false,
          usableOnlyInApp: true,
        },
      });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  /**
   * 상품 사용.
   *
   * 잔액 부족을 402(Payment Required)로 답한다 — 400(잘못된 요청)이 아니다.
   * 요청은 올바르고, 잔액이 모자란 것이다. 화면이 두 경우를 다르게 안내해야 한다.
   */
  app.post('/points/redeem', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', 'points are unavailable on this deployment'), 200);

    const settings = await d.repo.getSettings();
    if (!settings.enabled) return c.json(err('NOT_ENABLED', 'the points programme is not running'), 409);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const itemId = String(body.itemId ?? '').trim();
    if (!itemId) return c.json(err('BAD_REQUEST', 'itemId is required'), 400);

    try {
      const out = await d.repo.redeem(a.user.id, itemId);
      const balance = await d.repo.balanceOf(a.user.id);
      return c.json({ redemption: out.redemption, entry: out.entry, balance }, 201);
    } catch (e) {
      const m = (e as Error).message;
      if (m === 'INSUFFICIENT_POINTS') {
        // 402: 요청은 올바르고 잔액이 부족하다.
        return c.json(err('INSUFFICIENT_POINTS', 'not enough points'), 402);
      }
      if (m === 'ITEM_NOT_FOUND') return c.json(err('NOT_FOUND', 'item not found'), 404);
      if (m === 'ITEM_DISABLED') return c.json(err('ITEM_DISABLED', 'item is not available'), 409);
      return c.json(err('UPSTREAM_ERROR', m), 502);
    }
  });

  /**
   * 이용권 1회 소비.
   *
   * AI 분석처럼 실행마다 비용이 드는 기능이 호출한다.
   *
   * ★ 남은 이용권이 없으면 `consumed:false` 를 200 으로 돌려준다.
   *   402 로 하지 않는 이유: 호출자가 "이용권이 없다" 와 "요청이 잘못됐다" 를
   *   구분해야 하고, 없는 것은 정상 상황이다(사용자가 다 썼을 뿐).
   *   화면은 consumed 를 보고 기능 실행 여부를 결정한다.
   */
  app.post('/points/consume', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json({ consumed: false, reason: 'not_configured' });

    const settings = await d.repo.getSettings();
    /*
       제도가 꺼져 있으면 소비하지 않고 통과시킨다.

       consumed:true 를 주는 이유: 제도를 끄면 기능이 무료가 되는 것이
       의도다. false 를 주면 제도를 끈 순간 AI 분석이 전부 막힌다.
    */
    if (!settings.enabled) return c.json({ consumed: true, reason: 'programme_off' });

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const itemId = String(body.itemId ?? '').trim();
    if (!itemId) return c.json(err('BAD_REQUEST', 'itemId is required'), 400);

    try {
      const consumed = await d.repo.consume(a.user.id, itemId);
      const entitlements = await d.repo.entitlementsOf(a.user.id);
      return c.json({ consumed, remaining: entitlements[itemId] ?? 0 });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  return app;
}
