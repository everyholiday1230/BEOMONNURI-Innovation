import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { AuthService, verifyCsrf, originAllowed } from '@quantumtrade/auth';
import type { PgUserStrategyRepo, UserStrategyKind } from './db/user-strategy-repo';
import type { PgPointsRepo } from './db/points-repo';
import type { PgSubscriptionRepo } from './subscriptions/subscription-repo';
import { checkPlanFeature, gateErrorBody } from './subscriptions/plan-gate';
import { FEATURE_SAVES } from './subscriptions/plans';
import { signalSaveIsFree, type CampaignConfig } from './campaign/campaign-window';

/*
   사용자가 만든 전략/지표 CRUD (Option B).

   · 저장(생성)에 포인트를 쓴다 — 전략은 비싸고 지표는 저렴하다(차등가격).
   · 편집·삭제는 무료(이미 소유한 자원).
   · 모든 접근은 세션 사용자 소유로 스코프된다.
   · 포인트 제도가 꺼져 있으면 무료로 저장된다(제도 자체가 없을 때 막지 않는다).
*/

const CSRF = 'qt_csrf';
const err = (code: string, message: string) => ({ error: { code, message } });

/*
   저장 비용(포인트). 편집·삭제는 무료 — 이미 소유한 자원이다.

   ★ 'signal' 은 지표와 같은 100 으로 둔다. 조건식 하나이고 전략(300)처럼 백테스트
     대상이 아니다. 값을 다르게 매기려면 근거가 있어야 하는데, 지금은 없다.
*/
export const STRATEGY_SAVE_COST: Record<UserStrategyKind, number> = { strategy: 300, indicator: 100, signal: 100 };
const VALID_KINDS = new Set<UserStrategyKind>(['strategy', 'indicator', 'signal']);

export interface UserStrategyRouterDeps {
  service: AuthService;
  /** 구독 저장소. 전략·지표 저장은 유료 플랜 기능이다. */
  subscriptions?: PgSubscriptionRepo;
  repo?: PgUserStrategyRepo;
  points?: PgPointsRepo;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  /*
     KuCoin 공동 캠페인 설정(선택). 없으면 캠페인 혜택이 적용되지 않는다 —
     기본이 꺼짐이어야 신청서 없이 포인트가 나가지 않는다.
     상세: CAMPAIGN-KUCOIN-2026-10.md
  */
  campaign?: CampaignConfig;
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
    /*
       ★★ 전략·지표 저장도 유료 플랜 기능이다. 포인트를 차감하기 전에 막는다 —
         차감 후 막으면 포인트는 나가고 저장은 안 된다.
    */
    {
      const gate = await checkPlanFeature(d.subscriptions, a.user.id, FEATURE_SAVES);
      if (!gate.allowed) return c.json(gateErrorBody(gate), gate.reason === 'PLAN_REQUIRED' ? 402 : 503);
    }
    let cost = STRATEGY_SAVE_COST[kind];

    /*
       ★★★ **캠페인 약속: 신호 규칙 저장 처음 5회 무료.**

         KuCoin 신청서에 "the first five are free for campaign participants" 를
         적어 제출했다. 그러므로 이것은 선택이 아니라 이행이다.

       ★★ 이미 저장한 개수를 **DB 에서 센다.** 세션이나 화면 값으로 세면 새로 접속할
         때마다 다시 5회가 되어 무한 무료가 된다.

       ★ 지표·전략은 대상이 아니다(신청서가 "signal rules" 라고 썼다). 캠페인 창
         판정과 종류 판정은 campaign-window.ts 한 곳에 있다 — 두 곳에서 날짜를
         비교하면 한쪽만 고쳐진다.
    */
    let freeBecauseCampaign = false;
    if (d.campaign && kind === 'signal') {
      try {
        const mine = await d.repo.listForUser(a.user.id, 'signal');
        freeBecauseCampaign = signalSaveIsFree(d.campaign, kind, mine.length);
      } catch {
        /*
           ★ 개수를 못 세면 **무료로 주지 않는다.** 무료로 주면 셀 수 없는 상태에서
             무한히 나간다. 유료로 두면 고객이 문의하고 운영자가 확인할 수 있다.
        */
        freeBecauseCampaign = false;
      }
    }
    if (freeBecauseCampaign) cost = 0;

    // 포인트 제도가 켜져 있으면 저장에 포인트를 쓴다. 잔액이 모자라면 저장하지 않는다.
    let meteringOn = false;
    if (d.points) {
      try { meteringOn = Boolean((await d.points.getSettings()).enabled); } catch { meteringOn = false; }
      if (meteringOn) {
        /* ★ 무료면 잔액을 보지 않는다 — 잔액 0 인 신규 고객도 약속받은 5회를 쓴다. */
        if (cost > 0) {
          const balance = await d.points.balanceOf(a.user.id);
          if (balance < cost) return c.json(err('INSUFFICIENT_POINTS', `need ${cost} points to save`), 402);
        }
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
    /* ★ cost 0 이면 차감을 부르지 않는다 — 0 원장 항목은 금지돼 있다(delta <> 0). */
    if (meteringOn && d.points && cost > 0) {
      try {
        const res = await d.points.spendMetered({ userId: a.user.id, amount: cost, refType: 'user_strategy', refId: item.id, memo: `save ${kind}` });
        charged = cost;
        balance = res && typeof res.balanceAfter === 'number' ? res.balanceAfter : undefined;
      } catch { /* 저장은 됐다 — 과금 실패는 조용히 넘기지 않되 저장을 되돌리진 않는다 */ }
    }
    /*
       ★★ 무료로 처리됐다는 사실을 응답에 밝힌다. 화면이 "0 포인트 차감" 을 보여줄
         수 있어야 고객이 혜택을 받았는지 안다 — 조용히 0 을 차감하면 혜택이
         적용됐는지 알 수 없다.
    */
    return c.json({ ok: true, item, charged, balance, freeByCampaign: freeBecauseCampaign });
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
