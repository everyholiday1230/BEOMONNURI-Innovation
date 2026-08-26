import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import type { PgSavedItemRepo, SavedItemKind, SavedItemScope } from './db/saved-item-repo';
import type { PgPointsRepo } from './db/points-repo';

const CSRF = 'qt_csrf';
const err = (code: string, message: string) => ({ error: { code, message } });

/*
   저장 비용(차등가격):
     · symbol — 그 종목 전용 저장(저렴)
     · global — 모든 종목에서 재사용(비쌈)
   연장 1회 비용은 EXTEND_COST_POINTS. 제도가 켜져 있을 때만 부과한다.
*/
export const SAVE_COST_BY_SCOPE: Record<SavedItemScope, number> = { symbol: 100, global: 300 };
export const EXTEND_COST_POINTS = 50;
const saveCostOf = (scope: SavedItemScope) => SAVE_COST_BY_SCOPE[scope] ?? SAVE_COST_BY_SCOPE.symbol;
const VALID_KINDS = new Set<SavedItemKind>(['signal', 'indicator', 'drawing']);

export interface SavedRouterDeps {
  service: AuthService;
  repo?: PgSavedItemRepo;
  points?: PgPointsRepo;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  verifyCsrf: typeof verifyCsrf;
  originAllowed: typeof originAllowed;
}

export function createSavedRouter(d: SavedRouterDeps): Hono {
  const app = new Hono();
  const authed = async (c: Context) => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };
  const csrfOk = (c: Context, secret: string) =>
    d.originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    d.verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF), secret, d.csrfKey);

  // ---- 저장 항목 목록 (?kind=signal|indicator|drawing) ----
  app.get('/me/saved', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.repo) return c.json({ supported: false, items: [], saveCost: SAVE_COST_BY_SCOPE, extendCost: EXTEND_COST_POINTS });
    const kindQ = c.req.query('kind');
    const kind = kindQ && VALID_KINDS.has(kindQ as SavedItemKind) ? (kindQ as SavedItemKind) : undefined;
    const items = await d.repo.listForUser(a.user.id, kind);
    return c.json({ supported: true, items, saveCost: SAVE_COST_BY_SCOPE, extendCost: EXTEND_COST_POINTS });
  });

  // ---- 저장 (포인트 차감) ----
  app.post('/me/saved', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', 'saving requires the PostgreSQL backend'), 503);
    const body = (await c.req.json().catch(() => ({}))) as { kind?: string; scope?: string; name?: string; symbol?: string; timeframe?: string; payload?: unknown };
    if (!body.kind || !VALID_KINDS.has(body.kind as SavedItemKind)) return c.json(err('BAD_REQUEST', 'invalid kind'), 400);
    if (!body.name || !String(body.name).trim()) return c.json(err('BAD_REQUEST', 'name required'), 400);
    if (body.payload === undefined || body.payload === null) return c.json(err('BAD_REQUEST', 'payload required'), 400);
    const scope: SavedItemScope = body.scope === 'global' ? 'global' : 'symbol';
    const cost = saveCostOf(scope);

    // 포인트 제도가 켜져 있으면 저장에 포인트를 쓴다(범위별 차등가격). 잔액이 모자라면 저장하지 않는다.
    let meteringOn = false;
    if (d.points) {
      try { meteringOn = Boolean((await d.points.getSettings()).enabled); } catch { meteringOn = false; }
      if (meteringOn) {
        const balance = await d.points.balanceOf(a.user.id);
        if (balance < cost) return c.json(err('INSUFFICIENT_POINTS', `need ${cost} points to save`), 402);
      }
    }

    const item = await d.repo.create({
      userId: a.user.id,
      kind: body.kind as SavedItemKind,
      scope,
      name: String(body.name),
      symbol: body.symbol ?? null,
      timeframe: body.timeframe ?? null,
      payload: body.payload,
    });

    let charged = 0;
    let balance: number | undefined;
    if (meteringOn && d.points) {
      try {
        const res = await d.points.spendMetered({ userId: a.user.id, amount: cost, refType: 'saved_item', refId: item.id, memo: `save ${item.kind}/${scope}` });
        if (res) { charged = res.deducted; balance = res.balanceAfter; }
      } catch { /* 차감 실패해도 저장은 유지(비치명) */ }
    }
    return c.json({ ok: true, item, charged, balance }, 201);
  });

  // ---- 만료 연장 (포인트 차감) ----
  app.post('/me/saved/:id/extend', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', ''), 503);
    const id = c.req.param('id');

    let meteringOn = false;
    if (d.points) {
      try { meteringOn = Boolean((await d.points.getSettings()).enabled); } catch { meteringOn = false; }
      if (meteringOn) {
        const balance = await d.points.balanceOf(a.user.id);
        if (balance < EXTEND_COST_POINTS) return c.json(err('INSUFFICIENT_POINTS', `need ${EXTEND_COST_POINTS} points to extend`), 402);
      }
    }

    const item = await d.repo.extend(a.user.id, id);
    if (!item) return c.json(err('NOT_FOUND', ''), 404);

    let charged = 0;
    let balance: number | undefined;
    if (meteringOn && d.points) {
      try {
        // ref_id 를 만료시각과 묶어 연장마다 고유하게(멱등 위반 없이) 차감한다.
        const res = await d.points.spendMetered({ userId: a.user.id, amount: EXTEND_COST_POINTS, refType: 'saved_item_extend', refId: `${id}:${item.expiresAt}`, memo: 'extend saved item' });
        if (res) { charged = res.deducted; balance = res.balanceAfter; }
      } catch { /* 차감 실패해도 연장은 유지 */ }
    }
    return c.json({ ok: true, item, charged, balance });
  });

  // ---- 삭제 ----
  app.delete('/me/saved/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', ''), 503);
    const ok = await d.repo.remove(a.user.id, c.req.param('id'));
    return ok ? c.json({ ok: true }) : c.json(err('NOT_FOUND', ''), 404);
  });

  return app;
}
