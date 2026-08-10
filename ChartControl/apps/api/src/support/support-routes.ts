/**
 * 고객 지원 티켓 — 사용자용 라우터.
 *
 * 왜 별 라우터인가
 * --------------
 * 세션 인증과 CSRF 검증을 다른 사용자 라우터와 같은 방식으로 해야 한다.
 * index.ts 안에 인라인으로 두면 그 헬퍼를 다시 만들게 되고, 두 구현이
 * 조금씩 달라져 한쪽에만 CSRF 가 빠지는 식으로 어긋난다.
 *
 * 소유 확인의 위치
 * --------------
 * "내 티켓인가" 는 저장소가 판단한다(getForCustomer). 라우트에서만 확인하면
 * 다른 호출 경로가 생길 때 빠뜨리고, 남의 문의 내용이 노출된다.
 *
 * 없는 티켓과 남의 티켓을 같은 404 로 답한다. 다르게 답하면 ID 를 넣어보며
 * 다른 사람의 티켓이 존재하는지 알아낼 수 있다(존재 여부 유출).
 */

import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';

import { AuthService, type PublicUser } from '@quantumtrade/auth';

import type { PgSupportRepo } from '../db/support-repo';

const CSRF_COOKIE = 'qt_csrf';

export interface SupportRouterDeps {
  service: AuthService;
  /**
   * 티켓 저장소. Postgres 배포에만 있다.
   *
   * 없을 때 빈 배열을 주지 않는 이유: "문의가 없다" 로 읽히고, 티켓 생성이
   * 조용히 성공한 것처럼 보인다. `supported: false` 로 사실을 알린다.
   */
  repo?: PgSupportRepo;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  verifyCsrf: (token: string | undefined, cookie: string | undefined, secret: string, key: string) => boolean;
  originAllowed: (origin: string | undefined, referer: string | undefined, allowed: string[]) => boolean;
}

const err = (code: string, message: string) => ({ error: { code, message } });

/** 문자열 길이 상한. 본문이 무한히 길면 목록 조회가 느려지고 저장이 부담된다. */
const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;

export function createSupportRouter(d: SupportRouterDeps): Hono {
  const app = new Hono();

  const authed = async (c: Context): Promise<{ user: PublicUser; csrfSecret: string } | null> => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };

  const csrfOk = (c: Context, secret: string) =>
    d.originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    d.verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF_COOKIE), secret, d.csrfKey);

  /** 내 티켓 목록. */
  app.get('/support/tickets', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.repo) return c.json({ tickets: [], supported: false });

    try {
      const limit = Number(c.req.query('limit') ?? 50);
      const tickets = await d.repo.listForUser(a.user.id, Number.isFinite(limit) ? limit : 50);
      return c.json({ tickets, supported: true });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  /** 티켓 상세 + 대화. 내부 메모는 저장소가 제외한다. */
  app.get('/support/tickets/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!d.repo) return c.json({ ...err('NOT_CONFIGURED', 'support is unavailable'), supported: false });

    try {
      const found = await d.repo.getForCustomer(c.req.param('id'), a.user.id);
      if (!found) return c.json(err('NOT_FOUND', 'ticket not found'), 404);
      return c.json({ ...found, supported: true });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  /** 새 문의. */
  app.post('/support/tickets', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json({ ...err('NOT_CONFIGURED', 'support is unavailable'), supported: false });

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const subject = String(body.subject ?? '').trim();
    const text = String(body.body ?? '').trim();

    // 제목이나 본문이 없으면 운영자가 무슨 문의인지 알 수 없다.
    if (!subject) return c.json(err('BAD_REQUEST', 'subject is required'), 400);
    if (subject.length > MAX_SUBJECT) return c.json(err('BAD_REQUEST', `subject too long (max ${MAX_SUBJECT})`), 400);
    if (!text) return c.json(err('BAD_REQUEST', 'body is required'), 400);
    if (text.length > MAX_BODY) return c.json(err('BAD_REQUEST', `body too long (max ${MAX_BODY})`), 400);

    try {
      const ticket = await d.repo.create({
        userId: a.user.id,
        userEmail: a.user.email,
        subject,
        body: text,
        ...(typeof body.category === 'string' && body.category ? { category: body.category } : {}),
      });
      return c.json({ ticket }, 201);
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  /** 내 티켓에 답글. */
  app.post('/support/tickets/:id/reply', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', ''), 403);
    if (!d.repo) return c.json({ ...err('NOT_CONFIGURED', 'support is unavailable'), supported: false });

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = String(body.body ?? '').trim();
    if (!text) return c.json(err('BAD_REQUEST', 'body is required'), 400);
    if (text.length > MAX_BODY) return c.json(err('BAD_REQUEST', `body too long (max ${MAX_BODY})`), 400);

    try {
      // 소유 확인. 남의 티켓에 글을 남길 수 없다.
      const owned = await d.repo.getForCustomer(c.req.param('id'), a.user.id);
      if (!owned) return c.json(err('NOT_FOUND', 'ticket not found'), 404);

      const message = await d.repo.addMessage({
        ticketId: c.req.param('id'),
        authorUserId: a.user.id,
        authorSide: 'customer',
        body: text,
        /*
           고객은 내부 메모를 만들 수 없다. 요청 값을 보지 않는다 —
           받으면 실수나 조작으로 true 가 들어와 자기 글이 스스로에게
           안 보이게 되고, 답을 기다리다 문의가 사라진 것으로 느낀다.
        */
        internal: false,
      });
      return c.json({ message }, 201);
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  return app;
}
