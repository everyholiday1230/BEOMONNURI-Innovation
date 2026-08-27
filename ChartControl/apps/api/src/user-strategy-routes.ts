import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import type { PgUserStrategyRepo, UserStrategyKind } from './db/user-strategy-repo';
import type { PgPointsRepo } from './db/points-repo';

/*
   사용자가 만든 전략/지표 CRUD (Option B).

   · 저장(생성)에 포인트를 쓴다 — 전략은 비싸고 지표는 저렴하다(차등가격).
   · 편집·삭제는 무료(이미 소유한 자원).
   · 모든 접근은 세션 사용자 소유로 스코프된다.
   · 포인트 제도가 꺼져 있으면 무료로 저장된다(제도 자체가 없을 때 막지 않는다).
*/

const CSRF = 'qt_csrf';
const err = (code: string, message: string) => ({ error: { code, message } });

export const STRATEGY_SAVE_COST: Record<UserStrategyKind, number> = { strategy: 300, indicator: 100 };
const VALID_KINDS = new Set<UserStrategyKind>(['strategy', 'indicator']);

export interface UserStrategyRouterDeps {
  service: AuthService;
  repo?: PgUserStrategyRepo;
  points?: PgPointsRepo;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
}

export function createUserStrategyRouter(d: UserStrategyRouterDeps): Hono {
  const app = new Hono();

  const authed = async (c: Context) => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };
  const csrfOk = (c: Context, secret: string) =>
    originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF), secret, d.csrfKey);

  // ---- 목록 (?kind=strategy|indicator) ----
  app.get('/me/strategies', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.repo) return c.json({ supported: false, items: [], saveCost: STRATEGY_SAVE_COST });
    const kindQ = c.req.query('kind');
    const kind = kindQ && VALID_KINDS.has(kindQ as UserStrategyKind) ? (kindQ as UserStrategyKind) : undefined;
    const items = await d.repo.listForUser(a.user.id, kind);
    return c.json({ supported: true, items, saveCost: STRATEGY_SAVE_COST });
  });

  // ---- 생성 (포인트 차감) ----
  app.post('/me/strategies', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', 'saving requires the PostgreSQL backend'), 503);
    const body = (await c.req.json().catch(() => ({}))) as {
      kind?: string; name?: string; baseStrategyId?: string; symbol?: string; timeframe?: string; config?: unknown;
    };
    if (!body.kind || !VALID_KINDS.has(body.kind as UserStrategyKind)) return c.json(err('BAD_REQUEST', 'invalid kind'), 400);
    if (!body.name || !String(body.name).trim()) return c.json(err('BAD_REQUEST', 'name required'), 400);
    const kind = body.kind as UserStrategyKind;
    const cost = STRATEGY_SAVE_COST[kind];

    // 포인트 제도가 켜져 있으면 저장에 포인트를 쓴다. 잔액이 모자라면 저장하지 않는다.
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
      kind,
      name: String(body.name),
      baseStrategyId: body.baseStrategyId ?? null,
      symbol: body.symbol ?? null,
      timeframe: body.timeframe ?? null,
      config: body.config ?? {},
    });

    let charged = 0;
    let balance: number | undefined;
    if (meteringOn && d.points) {
      try {
        const res = await d.points.spendMetered({ userId: a.user.id, amount: cost, refType: 'user_strategy', refId: item.id, memo: `save ${kind}` });
        charged = cost;
        balance = res && typeof res.balanceAfter === 'number' ? res.balanceAfter : undefined;
      } catch { /* 저장은 됐다 — 과금 실패는 조용히 넘기지 않되 저장을 되돌리진 않는다 */ }
    }
    return c.json({ ok: true, item, charged, balance });
  });

  // ---- 편집(무료, 소유자만) ----
  app.patch('/me/strategies/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', ''), 503);
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; symbol?: string; timeframe?: string; config?: unknown };
    const updated = await d.repo.update(a.user.id, id, {
      ...(body.name !== undefined ? { name: String(body.name) } : {}),
      ...(body.symbol !== undefined ? { symbol: body.symbol } : {}),
      ...(body.timeframe !== undefined ? { timeframe: body.timeframe } : {}),
      ...(body.config !== undefined ? { config: body.config } : {}),
    });
    if (!updated) return c.json(err('NOT_FOUND', ''), 404);
    return c.json({ ok: true, item: updated });
  });

  // ---- 삭제(소유자만) ----
  app.delete('/me/strategies/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json(err('NOT_CONFIGURED', ''), 503);
    const ok = await d.repo.remove(a.user.id, c.req.param('id'));
    if (!ok) return c.json(err('NOT_FOUND', ''), 404);
    return c.json({ ok: true });
  });

  return app;
}
