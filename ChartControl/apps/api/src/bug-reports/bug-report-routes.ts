/*
   오류 제보(버그 리포트) — 고객 라우터.

   고객이 오류를 제보하고 자기 제보 이력을 본다. 운영자가 확인하면 포인트가 지급되며
   그 처리는 admin 라우터가 담당한다. 제보는 각 고객별(user_id)로 저장된다.
*/
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';

import { AuthService, type PublicUser } from '@quantumtrade/auth';
import { PgBugReportRepo } from '../db/bug-report-repo';

const CSRF_COOKIE = 'qt_csrf';
const err = (code: string, message: string) => ({ error: { code, message } });

export interface BugReportRouterDeps {
  service: AuthService;
  repo?: PgBugReportRepo;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  verifyCsrf: (token: string | undefined, cookie: string | undefined, secret: string, key: string) => boolean;
  originAllowed: (origin: string | undefined, referer: string | undefined, allowed: string[]) => boolean;
}

export function createBugReportRouter(d: BugReportRouterDeps): Hono {
  const app = new Hono();

  const authed = async (c: Context): Promise<{ user: PublicUser; csrfSecret: string } | null> => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };
  const csrfOk = (c: Context, secret: string) =>
    d.originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    d.verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF_COOKIE), secret, d.csrfKey);

  /** 내 오류 제보 이력. */
  app.get('/me/bug-reports', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.repo) return c.json({ reports: [], supported: false });
    try {
      const reports = await d.repo.listByUser(a.user.id, 50);
      return c.json({ reports, supported: true });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  /** 오류 제보 접수. */
  app.post('/me/bug-reports', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json({ ...err('NOT_CONFIGURED', 'bug reports require the PostgreSQL backend'), supported: false });
    const body = (await c.req.json().catch(() => ({}))) as { title?: string; body?: string; area?: string };
    const title = String(body.title ?? '').trim();
    const text = String(body.body ?? '').trim();
    if (title.length < 4 || title.length > 200) return c.json(err('BAD_REQUEST', 'title must be 4-200 chars'), 400);
    if (text.length < 10 || text.length > 4000) return c.json(err('BAD_REQUEST', 'body must be 10-4000 chars'), 400);
    try {
      const report = await d.repo.create(a.user.id, { title, body: text, area: body.area ?? null });
      return c.json({ report }, 201);
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  return app;
}
