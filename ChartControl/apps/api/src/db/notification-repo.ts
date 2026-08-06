import { randomUUID } from 'node:crypto';
import type { DB } from './sqlite';

/**
 * B6 — user notification store (NTF-01 / NTF-02).
 *
 * The `notifications` table already existed (0002) and gained severity / read_at / correlation_id in
 * 0007; what was missing was any way to reach it. Nothing is duplicated here.
 *
 * Two rules hold throughout: `user_id` comes from the session and appears in every WHERE clause, and the
 * message body is stored and returned as TEXT. It is never interpolated into markup anywhere — the UI
 * renders it as a text node — so a notification cannot become an injection vector.
 */

/**
 * Allow-listed notification kinds.
 *
 * A free-text `type` reaches the UI's icon/severity mapping and any future routing logic. Constraining it
 * server-side means a caller cannot introduce a kind the client has no rendering path for.
 */
export const NOTIFICATION_TYPES = [
  'order_filled',
  'order_rejected',
  'risk_alert',
  'price_alert',
  'account_security',
  'system',
  'ai_advisory',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const MAX_MESSAGE_LENGTH = 500;

export interface NotificationRow {
  id: string;
  type: string;
  severity: string;
  message: string;
  read: boolean;
  readAt: number | null;
  correlationId: string | null;
  createdAt: number;
}

export interface NotificationPage {
  items: NotificationRow[];
  total: number;
  unreadCount: number;
  asOf: number | null;
}

export class NotificationRepo {
  constructor(private readonly db: DB) {}

  /**
   * List a user's notifications.
   *
   * `unreadCount` is computed over ALL of the user's rows, not the current page: a badge that only counted
   * the visible page would under-report, and a badge that under-reports unread security alerts is a real
   * problem rather than a cosmetic one.
   */
  list(
    userId: string,
    q: { unreadOnly?: boolean; type?: string; severity?: string; limit?: number; offset?: number } = {},
  ): NotificationPage {
    const where: string[] = ['user_id = ?'];
    const args: unknown[] = [userId];
    if (q.unreadOnly) where.push('read = 0');
    if (q.type) {
      where.push('type = ?');
      args.push(q.type);
    }
    if (q.severity) {
      where.push('severity = ?');
      args.push(q.severity);
    }
    const clause = where.join(' AND ');
    const agg = this.db
      .prepare(`SELECT COUNT(*) AS n, MAX(created_at) AS newest FROM notifications WHERE ${clause}`)
      .get(...args) as { n: number; newest: number | null };
    const unread = this.db
      .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0')
      .get(userId) as { n: number };

    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    const rows = this.db
      .prepare(
        // `id` tie-break: several notifications can share a millisecond, and paging over a non-total
        // order repeats and skips rows.
        `SELECT id, type, severity, message, read, read_at, correlation_id, created_at
           FROM notifications WHERE ${clause}
          ORDER BY created_at DESC, id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as Record<string, unknown>[];

    return { items: rows.map(map), total: agg.n, unreadCount: unread.n, asOf: agg.newest ?? null };
  }

  /**
   * Mark one notification read.
   *
   * Idempotent: the UPDATE is conditional on `read = 0`, and a row that is already read returns
   * `changed: false` with `found: true`. A second click is therefore a 200, not a 404 or a spurious
   * timestamp overwrite — `read_at` must record when it was FIRST read.
   */
  markRead(userId: string, id: string, at: number): { found: boolean; changed: boolean } {
    const exists = this.db
      .prepare('SELECT read FROM notifications WHERE user_id = ? AND id = ?')
      .get(userId, id) as { read: number } | undefined;
    // Ownership is in the query, so another user's notification is simply not found.
    if (!exists) return { found: false, changed: false };
    if (exists.read) return { found: true, changed: false };
    const info = this.db
      .prepare('UPDATE notifications SET read = 1, read_at = ? WHERE user_id = ? AND id = ? AND read = 0')
      .run(at, userId, id);
    return { found: true, changed: info.changes > 0 };
  }

  /** Mark every unread notification read in one statement, so the set cannot change mid-operation. */
  markAllRead(userId: string, at: number): { changed: number } {
    const info = this.db
      .prepare('UPDATE notifications SET read = 1, read_at = ? WHERE user_id = ? AND read = 0')
      .run(at, userId);
    return { changed: info.changes };
  }

  /**
   * Insert a notification for a user.
   *
   * Type and severity are validated against the allow-lists here as well as in the route: this is the
   * last point before the row exists, and a bad value that reached the table would then be served to the
   * UI forever.
   */
  create(input: {
    userId: string;
    type: NotificationType;
    severity: NotificationSeverity;
    message: string;
    correlationId?: string | null;
    at?: number;
  }): NotificationRow {
    if (!NOTIFICATION_TYPES.includes(input.type)) throw new Error(`unsupported notification type`);
    if (!NOTIFICATION_SEVERITIES.includes(input.severity)) throw new Error(`unsupported notification severity`);
    const id = randomUUID();
    const at = input.at ?? Date.now();
    this.db
      .prepare(
        'INSERT INTO notifications (id,user_id,type,message,read,created_at,severity,read_at,correlation_id) VALUES (?,?,?,?,0,?,?,NULL,?)',
      )
      // Truncated rather than rejected: a long message is a caller formatting problem, and dropping the
      // notification entirely would lose the signal it carried.
      .run(id, input.userId, input.type, input.message.slice(0, MAX_MESSAGE_LENGTH), at, input.severity, input.correlationId ?? null);
    return this.db
      .prepare('SELECT id, type, severity, message, read, read_at, correlation_id, created_at FROM notifications WHERE id = ?')
      .get(id) as unknown as NotificationRow;
  }
}

function map(r: Record<string, unknown>): NotificationRow {
  return {
    id: String(r.id),
    type: String(r.type),
    severity: String(r.severity ?? 'info'),
    message: String(r.message),
    read: Boolean(r.read),
    readAt: r.read_at === null || r.read_at === undefined ? null : Number(r.read_at),
    correlationId: (r.correlation_id as string | null) ?? null,
    createdAt: Number(r.created_at),
  };
}

/**
 * BATCH_2 / BL-10 — async notification repository contract.
 *
 * The sync `NotificationRepo` above is the better-sqlite3 engine; this interface is what the routes and
 * the server-side projection depend on, with a SQLite adapter (dev/test) and a PostgreSQL implementation
 * (production) selected by the server. Every method carries `user_id` from the session, so another user's
 * notification id is simply not found (a 404, never a 403 that would confirm the id exists).
 */
export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  severity: NotificationSeverity;
  message: string;
  correlationId?: string | null;
  at?: number;
}

export interface INotificationRepo {
  list(
    userId: string,
    q?: { unreadOnly?: boolean; type?: string; severity?: string; limit?: number; offset?: number },
  ): Promise<NotificationPage>;
  markRead(userId: string, id: string, at: number): Promise<{ found: boolean; changed: boolean }>;
  markAllRead(userId: string, at: number): Promise<{ changed: number }>;
  create(input: CreateNotificationInput): Promise<NotificationRow>;
}

/** Development / test — async-over-sync wrapper around the better-sqlite3 NotificationRepo. */
export class SqliteNotificationRepo implements INotificationRepo {
  private readonly inner: NotificationRepo;
  constructor(db: DB) {
    this.inner = new NotificationRepo(db);
  }
  async list(
    userId: string,
    q: { unreadOnly?: boolean; type?: string; severity?: string; limit?: number; offset?: number } = {},
  ): Promise<NotificationPage> {
    return this.inner.list(userId, q);
  }
  async markRead(userId: string, id: string, at: number): Promise<{ found: boolean; changed: boolean }> {
    return this.inner.markRead(userId, id, at);
  }
  async markAllRead(userId: string, at: number): Promise<{ changed: number }> {
    return this.inner.markAllRead(userId, at);
  }
  async create(input: CreateNotificationInput): Promise<NotificationRow> {
    return this.inner.create(input);
  }
}

/**
 * Production — real PostgreSQL over the 0002 `notifications` table (severity/read_at/correlation_id from
 * 0007). `read` is a BOOLEAN and `created_at` is TIMESTAMPTZ; both are normalized to the app's contract
 * (boolean read, epoch-millis createdAt). Parameterized throughout; ownership is `user_id = $1` on every
 * statement; the message is stored and returned as TEXT (never interpolated into markup).
 */
export class PgNotificationRepo implements INotificationRepo {
  constructor(private readonly pool: import('pg').Pool) {}

  async list(
    userId: string,
    q: { unreadOnly?: boolean; type?: string; severity?: string; limit?: number; offset?: number } = {},
  ): Promise<NotificationPage> {
    const where: string[] = ['user_id = $1'];
    const args: unknown[] = [userId];
    if (q.unreadOnly) where.push('read = false');
    if (q.type) {
      args.push(q.type);
      where.push(`type = $${args.length}`);
    }
    if (q.severity) {
      args.push(q.severity);
      where.push(`severity = $${args.length}`);
    }
    const clause = where.join(' AND ');
    const agg = await this.pool.query(
      `SELECT COUNT(*)::int AS n, (EXTRACT(EPOCH FROM MAX(created_at)) * 1000)::bigint AS newest
         FROM notifications WHERE ${clause}`,
      args,
    );
    const unread = await this.pool.query(
      'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read = false',
      [userId],
    );
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;
    const rows = await this.pool.query(
      `SELECT id, type, severity, message, read, read_at, correlation_id,
              (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_at
         FROM notifications WHERE ${clause}
        ORDER BY created_at DESC, id ASC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, limit, offset],
    );
    return {
      items: rows.rows.map(map),
      total: Number(agg.rows[0].n),
      unreadCount: Number(unread.rows[0].n),
      asOf: agg.rows[0].newest === null ? null : Number(agg.rows[0].newest),
    };
  }

  async markRead(userId: string, id: string, at: number): Promise<{ found: boolean; changed: boolean }> {
    const exists = await this.pool.query('SELECT read FROM notifications WHERE user_id = $1 AND id = $2', [userId, id]);
    if (!exists.rows[0]) return { found: false, changed: false };
    if (exists.rows[0].read) return { found: true, changed: false };
    const upd = await this.pool.query(
      'UPDATE notifications SET read = true, read_at = $1 WHERE user_id = $2 AND id = $3 AND read = false',
      [at, userId, id],
    );
    return { found: true, changed: (upd.rowCount ?? 0) > 0 };
  }

  async markAllRead(userId: string, at: number): Promise<{ changed: number }> {
    const upd = await this.pool.query(
      'UPDATE notifications SET read = true, read_at = $1 WHERE user_id = $2 AND read = false',
      [at, userId],
    );
    return { changed: upd.rowCount ?? 0 };
  }

  async create(input: CreateNotificationInput): Promise<NotificationRow> {
    if (!NOTIFICATION_TYPES.includes(input.type)) throw new Error('unsupported notification type');
    if (!NOTIFICATION_SEVERITIES.includes(input.severity)) throw new Error('unsupported notification severity');
    const id = randomUUID();
    const at = input.at ?? Date.now();
    const r = await this.pool.query(
      `INSERT INTO notifications (id, user_id, type, message, read, created_at, severity, read_at, correlation_id)
       VALUES ($1,$2,$3,$4,false, to_timestamp($5 / 1000.0), $6, NULL, $7)
       RETURNING id, type, severity, message, read, read_at, correlation_id,
                 (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_at`,
      [id, input.userId, input.type, input.message.slice(0, MAX_MESSAGE_LENGTH), at, input.severity, input.correlationId ?? null],
    );
    return map(r.rows[0]);
  }
}
