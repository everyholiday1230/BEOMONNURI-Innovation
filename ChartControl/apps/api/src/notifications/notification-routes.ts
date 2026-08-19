import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { AuthService, type IAuditRepository, type PublicUser } from '@quantumtrade/auth';
import {
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_TYPES,
  type INotificationRepo,
} from '../db/notification-repo';
import { buildProvenance, type TradingPosture } from '../portfolio/provenance';

/**
 * B6 — notifications (NTF-01 / NTF-02).
 *
 * The read mutations are idempotent by design, so the client can retry or double-click without needing a
 * separate idempotency key: marking an already-read notification read is a 200 that changes nothing and
 * does NOT overwrite the original `readAt`.
 *
 * There is no real-time channel in this deployment, so the contract is explicit polling. The response
 * carries `pollIntervalMs` rather than leaving each client to invent its own interval.
 */

const CSRF_COOKIE = 'qt_csrf';
const corr = () => Math.random().toString(36).slice(2, 10);
const err = (code: string, message: string) => ({ error: { code, message, correlationId: corr() } });

const ListQuerySchema = z
  .object({
    unread: z.enum(['true', 'false']).optional(),
    type: z.enum(NOTIFICATION_TYPES).optional(),
    severity: z.enum(NOTIFICATION_SEVERITIES).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export interface NotificationRouterDeps {
  service: AuthService;
  audit: IAuditRepository;
  repo: INotificationRepo;
  /*
     공지 저장소 (선택).

     ★★ 공지 팝업이 여기 붙는 이유: 알림과 공지는 이용자에게 같은 성격이고
       (읽음 처리·인증 필요), 두 라우터로 나누면 읽음 규칙이 갈린다.

     ★ 없으면 팝업 라우트가 `supported:false` 를 준다 — 빈 목록을 주면 화면이
       "띄울 공지가 없다" 로 읽고, 공지 기능이 없는 배포와 구분되지 않는다.
  */
  notices?: import('../db/notice-repo').PgNoticeRepo;
  posture: TradingPosture;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  pollIntervalMs?: number;
  now?: () => number;
  verifyCsrf: (token: string | undefined, cookie: string | undefined, secret: string, key: string) => boolean;
  originAllowed: (origin: string | undefined, referer: string | undefined, allowed: string[]) => boolean;
}

export function createNotificationRouter(d: NotificationRouterDeps): Hono {
  const app = new Hono();
  const now = d.now ?? Date.now;
  const pollIntervalMs = d.pollIntervalMs ?? 20_000;

  const authed = async (c: Context): Promise<{ user: PublicUser; csrfSecret: string } | null> => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };

  const csrfOk = (c: Context, secret: string) =>
    d.originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    d.verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF_COOKIE), secret, d.csrfKey);

  const noStore = (c: Context) => {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  };

  /** NTF-01 — list. */
  app.get('/notifications', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    noStore(c);
    const parsed = ListQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) {
      return c.json(
        {
          ...err('BAD_REQUEST', 'invalid query'),
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
        },
        400,
      );
    }
    const q = parsed.data;
    const out = await d.repo.list(a.user.id, {
      unreadOnly: q.unread === 'true',
      type: q.type,
      severity: q.severity,
      limit: q.limit,
      offset: q.offset,
    });
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    return c.json({
      items: out.items,
      unreadCount: out.unreadCount,
      page: { limit, offset, total: out.total, hasMore: offset + out.items.length < out.total },
      // No push channel exists here, so the refresh contract is stated rather than left to each client.
      delivery: { channel: 'POLL', pollIntervalMs },
      ...buildProvenance({ posture: d.posture, asOf: out.asOf, now: now(), freshnessMs: null }),
    });
  });

  /** NTF-02 — mark one read. Idempotent. */
  /**
   * GET /notices/popups — 아직 읽지 않은 팝업 공지.
   *
   * ★★ 읽음을 서버가 판정한다. 로컬 저장이면 기기를 바꿀 때마다 같은 팝업이
   *   다시 뜨고, 그러면 이용자는 내용을 보지 않고 닫는 습관이 든다.
   *
   * ★ 언어를 쿼리로 받는다. 공지는 언어별로 따로 작성되므로(locale 칸),
   *   화면 언어와 다른 공지를 띄우면 읽을 수 없는 글이 나온다.
   */
  app.get('/notices/popups', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    noStore(c);
    if (!d.notices) return c.json({ notices: [], supported: false });
    try {
      const locale = c.req.query('locale') || undefined;
      const rows = await d.notices.listUnreadPopups(a.user.id, locale, 3);
      return c.json({
        supported: true,
        notices: rows.map((n) => ({
          id: n.id,
          title: n.title,
          body: n.body,
          category: n.category,
          severity: n.severity,
          publishedAt: n.publishedAt ?? n.publishAt,
        })),
        asOf: now(),
      });
    } catch (e) {
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }
  });

  /**
   * POST /notices/:id/read — 공지를 읽음으로 표시한다.
   *
   * ★ 실패를 성공으로 위장하지 않는다. 화면이 팝업을 닫았는데 서버에 기록되지
   *   않으면 다음 로그인에 또 뜬다 — 이용자는 우리 화면이 고장났다고 여긴다.
   */
  app.post('/notices/:id/read', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', 'csrf validation failed'), 403);
    noStore(c);
    if (!d.notices) return c.json(err('NOTICES_UNAVAILABLE', 'notices are not configured'), 503);
    const ok = await d.notices.markRead(a.user.id, c.req.param('id'));
    // 없는 공지는 404 다. 200 을 주면 화면이 닫고 다음에 또 뜬다.
    if (!ok) return c.json(err('NOT_FOUND', 'notice not found'), 404);
    return c.json({ ok: true });
  });

  app.post('/notifications/:id/read', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', 'csrf validation failed'), 403);
    noStore(c);
    const r = await d.repo.markRead(a.user.id, c.req.param('id'), now());
    // Another user's notification is a 404: a 403 would confirm the id exists.
    if (!r.found) return c.json(err('NOT_FOUND', 'notification not found'), 404);
    if (r.changed) {
      await d.audit.record({
        id: corr(),
        actorUserId: a.user.id,
        action: 'notification.read',
        target: c.req.param('id'),
        ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        at: now(),
        meta: { result: 'success' },
      });
    }
    const out = await d.repo.list(a.user.id, { limit: 1 });
    // `changed: false` reports the replay honestly instead of pretending the call did work.
    return c.json({ ok: true, changed: r.changed, unreadCount: out.unreadCount });
  });

  /** NTF-02 — mark all read. Idempotent; reports how many rows it actually changed. */
  app.post('/notifications/read-all', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', 'csrf validation failed'), 403);
    noStore(c);
    const r = await d.repo.markAllRead(a.user.id, now());
    if (r.changed > 0) {
      await d.audit.record({
        id: corr(),
        actorUserId: a.user.id,
        action: 'notification.read_all',
        target: a.user.id,
        ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
        at: now(),
        meta: { result: 'success', changed: r.changed },
      });
    }
    return c.json({ ok: true, changed: r.changed, unreadCount: 0 });
  });

  return app;
}
