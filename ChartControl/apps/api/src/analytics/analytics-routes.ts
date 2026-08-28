import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import { AuthService, hasPermission, type PublicUser } from '@quantumtrade/auth';
import {
  JOURNAL_MOODS,
  MAX_NOTE_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  type IJournalRepo,
} from '../db/journal-repo';
import { buildProvenance, type TradingPosture } from '../portfolio/provenance';

/**
 * G7 — trade journal and realized-PnL analytics.
 *
 * Endpoints:
 *   GET    /analytics/journal            list closed round trips (filters + paging)
 *   POST   /analytics/journal            record a closed round trip
 *   PATCH  /analytics/journal/:id        edit ANNOTATIONS only (mood / tags / note)
 *   DELETE /analytics/journal/:id        remove an entry
 *   GET    /analytics/daily-pnl          realized PnL bucketed by UTC day
 *
 * Two deliberate constraints:
 *
 *  - **PnL is computed server-side, never accepted from the client.** The request supplies entry/exit
 *    prices and size; `realized_pnl` and `roi_pct` are derived with decimal.js. A client-supplied PnL
 *    would make the journal unauditable.
 *  - **Prices and size are immutable after creation.** PATCH touches annotations only. An entry whose
 *    PnL can be edited afterwards is not a record of anything; a wrong entry is deleted and re-created.
 *
 * Automatic derivation from fills is not implemented: nothing in `executions` says whether a fill opened
 * or closed a position. Migration 0010 adds `orders.reduce_only` so that becomes possible for new orders.
 * Until then every entry is `source: 'manual'`, and the list response says so.
 */

const CSRF_COOKIE = 'qt_csrf';
const corr = () => Math.random().toString(36).slice(2, 10);
const err = (code: string, message: string) => ({ error: { code, message, correlationId: corr() } });

/** Decimal string, optionally signed. Same shape the rest of the money layer uses. */
const DecimalString = z.string().regex(/^-?\d+(\.\d+)?$/u, 'must be a decimal string');
const PositiveDecimal = DecimalString.refine((s) => Number(s) > 0, 'must be greater than 0');

const SymbolFilter = z
  .string()
  .trim()
  .regex(/^[A-Z0-9]{2,20}$/iu)
  .transform((s) => s.toUpperCase());

const TagList = z
  .array(z.string().trim().min(1).max(MAX_TAG_LENGTH))
  .max(MAX_TAGS)
  // De-duplicated at the boundary so the stored blob cannot contain the same tag twice.
  .transform((tags) => [...new Set(tags)]);

export const JournalQuerySchema = z
  .object({
    symbol: SymbolFilter.optional(),
    side: z.enum(['long', 'short']).optional(),
    mood: z.enum(JOURNAL_MOODS).optional(),
    /** Epoch MILLISECONDS on `closedAt`, matching every other timestamp in this API. */
    from: z.coerce.number().int().nonnegative().optional(),
    to: z.coerce.number().int().nonnegative().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

export const JournalCreateSchema = z
  .object({
    symbol: SymbolFilter,
    side: z.enum(['long', 'short']),
    entryPrice: PositiveDecimal,
    exitPrice: PositiveDecimal,
    size: PositiveDecimal,
    /** Optional, and signed: a rebate is a negative fee. */
    fees: DecimalString.optional(),
    openedAt: z.number().int().nonnegative(),
    closedAt: z.number().int().nonnegative(),
    mood: z.enum(JOURNAL_MOODS).optional(),
    tags: TagList.optional(),
    note: z.string().max(MAX_NOTE_LENGTH).optional(),
    openOrderId: z.string().max(64).optional(),
    closeOrderId: z.string().max(64).optional(),
  })
  .strict()
  .refine((b) => b.openedAt <= b.closedAt, {
    message: 'openedAt must not be after closedAt',
    path: ['openedAt'],
  });

export const JournalAnnotateSchema = z
  .object({
    // `null` clears the field; omitting it leaves the field alone. Those are different intents.
    mood: z.enum(JOURNAL_MOODS).nullable().optional(),
    tags: TagList.optional(),
    note: z.string().max(MAX_NOTE_LENGTH).nullable().optional(),
  })
  .strict();

export const DailyPnlQuerySchema = z
  .object({
    from: z.coerce.number().int().nonnegative().optional(),
    to: z.coerce.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((q) => q.from === undefined || q.to === undefined || q.from <= q.to, {
    message: 'from must not be after to',
    path: ['from'],
  });

export interface AnalyticsRouterDeps {
  service: AuthService;
  repo: IJournalRepo;
  posture: TradingPosture;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  now?: () => number;
  verifyCsrf: (token: string | undefined, cookie: string | undefined, secret: string, key: string) => boolean;
  originAllowed: (origin: string | undefined, referer: string | undefined, allowed: string[]) => boolean;
}

export function createAnalyticsRouter(d: AnalyticsRouterDeps): Hono {
  const app = new Hono();
  const now = d.now ?? Date.now;

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

  const badBody = (c: Context, issues: { path: string; code: string }[]) =>
    // Field path + rule code only; the rejected input is never echoed back.
    c.json({ ...err('BAD_REQUEST', 'invalid body'), issues }, 400);

  const readJson = async (c: Context): Promise<{ ok: true; body: unknown } | { ok: false }> => {
    try {
      return { ok: true, body: await c.req.json() };
    } catch {
      return { ok: false };
    }
  };

  /** The journal is per-user data; the same self-scoped permission the portfolio reads use. */
  const canRead = (u: PublicUser) => hasPermission(u.role, 'account.read.self');
  const canWrite = (u: PublicUser) => hasPermission(u.role, 'account.update.self');

  // ---------------------------------------------------------------- list

  app.get('/analytics/journal', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!canRead(a.user)) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);

    const parsed = JournalQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) {
      return badBody(
        c,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
      );
    }
    const q = parsed.data;
    const out = await d.repo.list(a.user.id, q);
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;

    return c.json({
      items: out.items,
      page: { limit, offset, total: out.total, hasMore: offset + out.items.length < out.total },
      // Stated so a client never has to guess whether entries are automatic.
      derivation: {
        automatic: false,
        reason:
          'fills do not record whether they opened or closed a position; orders.reduce_only was added in migration 0010 to make future derivation possible',
      },
      ...buildProvenance({ posture: d.posture, asOf: out.asOf, now: now(), freshnessMs: null }),
    });
  });

  // ---------------------------------------------------------------- create

  app.post('/analytics/journal', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', 'csrf validation failed'), 403);
    if (!canWrite(a.user)) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);

    const raw = await readJson(c);
    if (!raw.ok) return badBody(c, [{ path: '', code: 'invalid_json' }]);
    const parsed = JournalCreateSchema.safeParse(raw.body);
    if (!parsed.success) {
      return badBody(
        c,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
      );
    }

    // PnL and ROI are computed in the repository from the supplied prices — never taken from the client.
    const row = await d.repo.create(a.user.id, parsed.data, now());
    return c.json(row, 201);
  });

  // ---------------------------------------------------------------- annotate

  app.patch('/analytics/journal/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', 'csrf validation failed'), 403);
    if (!canWrite(a.user)) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);

    const raw = await readJson(c);
    if (!raw.ok) return badBody(c, [{ path: '', code: 'invalid_json' }]);
    const parsed = JournalAnnotateSchema.safeParse(raw.body);
    if (!parsed.success) {
      return badBody(
        c,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
      );
    }

    const updated = await d.repo.annotate(a.user.id, c.req.param('id'), parsed.data, now());
    // Another user's entry is a 404: a 403 would confirm the id exists.
    if (!updated) return c.json(err('NOT_FOUND', 'journal entry not found'), 404);
    return c.json(updated);
  });

  // ---------------------------------------------------------------- delete

  app.delete('/analytics/journal/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(err('CSRF_FAILED', 'csrf validation failed'), 403);
    if (!canWrite(a.user)) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);

    return (await d.repo.remove(a.user.id, c.req.param('id')))
      ? c.json({ ok: true })
      : c.json(err('NOT_FOUND', 'journal entry not found'), 404);
  });

  // ---------------------------------------------------------------- daily PnL

  app.get('/analytics/daily-pnl', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(err('UNAUTHENTICATED', 'not logged in'), 401);
    if (!canRead(a.user)) return c.json(err('FORBIDDEN', 'permission'), 403);
    noStore(c);

    const parsed = DailyPnlQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) {
      return badBody(
        c,
        parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
      );
    }

    const out = await d.repo.dailyPnl(a.user.id, parsed.data);
    return c.json({
      ...out,
      // Buckets are UTC days. Local-day bucketing would put the same trade on different dates for
      // different viewers, which makes two people reading the same account disagree.
      timezone: 'UTC',
      ...buildProvenance({ posture: d.posture, asOf: null, now: now(), freshnessMs: null }),
    });
  });

  return app;
}
