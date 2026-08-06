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
