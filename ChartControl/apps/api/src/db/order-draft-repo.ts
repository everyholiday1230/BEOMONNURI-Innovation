import { randomUUID } from 'node:crypto';
import type { DB } from './sqlite';

/**
 * B4 — order draft store.
 *
 * Separate from `ResourceRepo.createOrderDraft` (the Phase-2 free-form draft) because this one records a
 * VALIDATED intent together with the verdict the server reached, keyed by idempotency key. The older
 * method is left alone: its callers and its `/me/order-drafts` route still work unchanged.
 *
 * Nothing here can submit an order. The `executable` column is written as 0 on every insert and there is
 * no method that updates it.
 */

export interface DraftRow {
  id: string;
  userId: string;
  symbol: string;
  side: string;
  version: number;
  source: string;
  executable: boolean;
  valid: boolean | null;
  allowed: boolean | null;
  idempotencyKey: string | null;
  data: unknown;
  createdAt: number;
  updatedAt: number | null;
}

export class OrderDraftRepo {
  constructor(private readonly db: DB) {}

  /**
   * Create a draft, or return the existing one for the same (user, idempotency key).
   *
   * The replay path returns the STORED row rather than re-running validation. A retry that produced a
   * different verdict than the original call would defeat the purpose of the idempotency key.
   */
  create(input: {
    userId: string;
    symbol: string;
    side: string;
    idempotencyKey: string;
    valid: boolean;
    allowed: boolean;
    data: unknown;
  }): { row: DraftRow; replayed: boolean } {
    const existing = this.getByIdempotencyKey(input.userId, input.idempotencyKey);
    if (existing) return { row: existing, replayed: true };

    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO order_drafts (id,user_id,symbol,side,data,created_at,updated_at,version,source,
                                   executable,valid,allowed,idempotency_key)
         VALUES (?,?,?,?,?,?,?,1,'MOCK',0,?,?,?)`,
      )
      .run(
        id,
        input.userId,
        input.symbol,
        input.side,
        JSON.stringify(input.data),
        now,
        now,
        input.valid ? 1 : 0,
        input.allowed ? 1 : 0,
        input.idempotencyKey,
      );
    return { row: this.getOwned(input.userId, id)!, replayed: false };
  }

  getByIdempotencyKey(userId: string, key: string): DraftRow | null {
    const r = this.db
      .prepare('SELECT * FROM order_drafts WHERE user_id=? AND idempotency_key=?')
      .get(userId, key) as Record<string, unknown> | undefined;
    return r ? map(r) : null;
  }

  /** Ownership is part of the query, so a draft belonging to someone else is simply not found. */
  getOwned(userId: string, id: string): DraftRow | null {
    const r = this.db.prepare('SELECT * FROM order_drafts WHERE user_id=? AND id=?').get(userId, id) as
      | Record<string, unknown>
      | undefined;
    return r ? map(r) : null;
  }

  listOwned(userId: string, limit = 50, offset = 0): { items: DraftRow[]; total: number } {
    const total = (
      this.db.prepare('SELECT COUNT(*) AS n FROM order_drafts WHERE user_id=?').get(userId) as { n: number }
    ).n;
    const rows = this.db
      // `id` tie-break keeps paging stable when several drafts share a millisecond.
      .prepare('SELECT * FROM order_drafts WHERE user_id=? ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?')
      .all(userId, limit, offset) as Record<string, unknown>[];
    return { items: rows.map(map), total };
  }

  /** Orders created by this user today, used by the daily-order-count risk gate. */
  countOrdersSince(userId: string, since: number): number {
    return (
      this.db
        .prepare('SELECT COUNT(*) AS n FROM orders WHERE user_id=? AND created_at >= ?')
        .get(userId, since) as { n: number }
    ).n;
  }
}

function map(r: Record<string, unknown>): DraftRow {
  let data: unknown = null;
  try {
    data = r.data ? JSON.parse(String(r.data)) : null;
  } catch {
    // A row whose payload cannot be parsed is reported with `data: null` rather than throwing: the draft
    // list must not be taken down by one bad row.
    data = null;
  }
  return {
    id: String(r.id),
    userId: String(r.user_id),
    symbol: String(r.symbol),
    side: String(r.side),
    version: Number(r.version ?? 1),
    source: String(r.source ?? 'MOCK'),
    executable: Boolean(r.executable),
    valid: r.valid === null || r.valid === undefined ? null : Boolean(r.valid),
    allowed: r.allowed === null || r.allowed === undefined ? null : Boolean(r.allowed),
    idempotencyKey: (r.idempotency_key as string | null) ?? null,
    data,
    createdAt: Number(r.created_at),
    updatedAt: r.updated_at === null || r.updated_at === undefined ? null : Number(r.updated_at),
  };
}

export interface CreateDraftInput {
  userId: string;
  symbol: string;
  side: string;
  idempotencyKey: string;
  valid: boolean;
  allowed: boolean;
  data: unknown;
}

/**
 * BATCH_2 / BL-10 — async order-draft repository contract.
 *
 * The sync `OrderDraftRepo` above is the better-sqlite3 engine; this interface is what the order route
 * depends on, with a SQLite adapter (dev/test) and a PostgreSQL implementation (production). Nothing here
 * can submit an order: `executable` is written 0 on every insert and no method updates it. Idempotency is
 * enforced at the DATA layer (unique index on (user_id, idempotency_key)), so a retried draft request is
 * a no-op that returns the STORED verdict rather than re-running validation.
 */
export interface IOrderDraftRepo {
  create(input: CreateDraftInput): Promise<{ row: DraftRow; replayed: boolean }>;
  getByIdempotencyKey(userId: string, key: string): Promise<DraftRow | null>;
  getOwned(userId: string, id: string): Promise<DraftRow | null>;
  listOwned(userId: string, limit?: number, offset?: number): Promise<{ items: DraftRow[]; total: number }>;
  countOrdersSince(userId: string, since: number): Promise<number>;
}

/** Development / test — async-over-sync wrapper around the better-sqlite3 OrderDraftRepo. */
export class SqliteOrderDraftRepo implements IOrderDraftRepo {
  private readonly inner: OrderDraftRepo;
  constructor(db: DB) {
    this.inner = new OrderDraftRepo(db);
  }
  async create(input: CreateDraftInput): Promise<{ row: DraftRow; replayed: boolean }> {
    return this.inner.create(input);
  }
  async getByIdempotencyKey(userId: string, key: string): Promise<DraftRow | null> {
    return this.inner.getByIdempotencyKey(userId, key);
  }
  async getOwned(userId: string, id: string): Promise<DraftRow | null> {
    return this.inner.getOwned(userId, id);
  }
  async listOwned(userId: string, limit = 50, offset = 0): Promise<{ items: DraftRow[]; total: number }> {
    return this.inner.listOwned(userId, limit, offset);
  }
  async countOrdersSince(userId: string, since: number): Promise<number> {
    return this.inner.countOrdersSince(userId, since);
  }
}

const PG_DRAFT_COLUMNS =
  `id, user_id, symbol, side, version, source, executable, valid, allowed, idempotency_key,
   data::text AS data, updated_at, (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_at`;

/**
 * Production — real PostgreSQL over the 0002 `order_drafts` table (verdict/idempotency columns from
 * 0007/0008). `data` is JSONB, `created_at` is TIMESTAMPTZ (normalized to epoch-millis), `executable`
 * is always 0. The idempotency key has a partial UNIQUE index; a concurrent duplicate that loses the
 * race is caught (23505) and returned as a replay, so two identical requests can never create two drafts.
 */
export class PgOrderDraftRepo implements IOrderDraftRepo {
  constructor(private readonly pool: import('pg').Pool) {}

  async create(input: CreateDraftInput): Promise<{ row: DraftRow; replayed: boolean }> {
    const existing = await this.getByIdempotencyKey(input.userId, input.idempotencyKey);
    if (existing) return { row: existing, replayed: true };
    const id = randomUUID();
    const now = Date.now();
    try {
      await this.pool.query(
        `INSERT INTO order_drafts (id,user_id,symbol,side,data,created_at,updated_at,version,source,
                                   executable,valid,allowed,idempotency_key)
         VALUES ($1,$2,$3,$4,$5::jsonb, to_timestamp($6 / 1000.0), $6, 1, 'MOCK', 0, $7, $8, $9)`,
        [id, input.userId, input.symbol, input.side, JSON.stringify(input.data ?? null), now,
          input.valid ? 1 : 0, input.allowed ? 1 : 0, input.idempotencyKey],
      );
    } catch (e) {
      // Lost the idempotency race: another request with the same (user, key) inserted first. Return the
      // stored row as a replay rather than surfacing the unique-violation.
      if ((e as { code?: string }).code === '23505') {
        const row = await this.getByIdempotencyKey(input.userId, input.idempotencyKey);
        if (row) return { row, replayed: true };
      }
      throw e;
    }
    return { row: (await this.getOwned(input.userId, id))!, replayed: false };
  }

  async getByIdempotencyKey(userId: string, key: string): Promise<DraftRow | null> {
    const r = await this.pool.query(
      `SELECT ${PG_DRAFT_COLUMNS} FROM order_drafts WHERE user_id=$1 AND idempotency_key=$2`,
      [userId, key],
    );
    return r.rows[0] ? map(r.rows[0]) : null;
  }

  async getOwned(userId: string, id: string): Promise<DraftRow | null> {
    const r = await this.pool.query(
      `SELECT ${PG_DRAFT_COLUMNS} FROM order_drafts WHERE user_id=$1 AND id=$2`,
      [userId, id],
    );
    return r.rows[0] ? map(r.rows[0]) : null;
  }

  async listOwned(userId: string, limit = 50, offset = 0): Promise<{ items: DraftRow[]; total: number }> {
    const total = await this.pool.query('SELECT COUNT(*)::int AS n FROM order_drafts WHERE user_id=$1', [userId]);
    const rows = await this.pool.query(
      `SELECT ${PG_DRAFT_COLUMNS} FROM order_drafts WHERE user_id=$1 ORDER BY created_at DESC, id ASC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    return { items: rows.rows.map(map), total: Number(total.rows[0].n) };
  }

  /**
   * 기간 내 **실제로 거래소에 전송된** 주문 수.
   *
   * ═══ ★★★ 왜 `orders` 가 아니라 `trade_decisions` 인가 ═══
   *
   *   전에는 `FROM orders` 를 셌다. 그런데 프로덕션 실측(2026-09-14):
   *
   *     orders          0건        ← 실주문 경로가 여기에 쓰지 않는다
   *     order_drafts    0건
   *     trade_decisions 32건 (ACCEPTED 12건)  ← 실주문은 여기에 남는다
   *
   *   `INSERT INTO orders` 를 하는 곳은 **모의 주문 투영(sim-projection)뿐**이다.
   *   즉 일일 주문 한도 게이트는 항상 `0` 을 보고 `0 < 한도` 로 통과했다 —
   *   **한도를 걸어도 절대 걸리지 않는 상태**였다.
   *
   * ★★ 이 저장소가 이미 한 번 고친 실패다. 예전 주석: "이전에는 항상 SQLite 를
   *   세어, Postgres 배포에서는 빈 테이블 → 카운트 0 → 일일 주문 한도 게이트가
   *   절대 걸리지 않았다." 상수를 실제 조회로 바꾸긴 했지만 **조회 대상이 실주문이
   *   들어가지 않는 표**였다. 어제 AI 포지션 도구도 같은 구조였다(모의 주문용 표를 읽음).
   *
   * ★ `ACCEPTED` 만 센다. `BLOCKED` 는 우리 게이트가 막은 것이라 거래소에 가지
   *   않았고, `REJECTED` 는 거래소가 거절했다. 둘 다 "낸 주문" 이 아니다.
   * ★ `execution_mode='live'` 만 센다. 모의 실행을 한도에 넣으면 실거래 여력이
   *   모의 연습으로 줄어든다.
   */
  async countOrdersSince(userId: string, since: number): Promise<number> {
    const r = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM trade_decisions
        WHERE user_id = $1
          AND submit_status = 'ACCEPTED'
          AND execution_mode = 'live'
          AND decided_at >= to_timestamp($2 / 1000.0)`,
      [userId, since],
    );
    return Number(r.rows[0].n);
  }
}
