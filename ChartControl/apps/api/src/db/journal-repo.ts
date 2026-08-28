import { D } from '@quantumtrade/domain';
import type { DB } from './sqlite';

/**
 * G7 — trade journal read/write model over `trade_journal` (migration 0010).
 *
 * Same two invariants as `portfolio-repo.ts`:
 *
 *  1. `user_id = ?` is in every WHERE clause and comes from the session, never from the request. No
 *     method here can read or mutate another user's rows.
 *  2. Money columns are TEXT decimal strings and are returned untouched. Aggregates are computed with
 *     decimal.js, so a daily PnL total never reports `0.30000000000000004`.
 */

export type Decimal = string;

export const JOURNAL_MOODS = ['confident', 'neutral', 'anxious', 'fomo', 'disciplined'] as const;
export type JournalMood = (typeof JOURNAL_MOODS)[number];

/** How the row came to exist. A derived row must never be presented as a user-confirmed one. */
export const JOURNAL_SOURCES = ['manual', 'derived'] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 24;
export const MAX_NOTE_LENGTH = 2000;

export interface JournalRow {
  id: string;
  symbol: string;
  side: string;
  entryPrice: Decimal;
  exitPrice: Decimal;
  size: Decimal;
  realizedPnl: Decimal;
  fees: Decimal | null;
  roiPct: Decimal | null;
  openedAt: number;
  closedAt: number;
  mood: string | null;
  tags: string[];
  note: string | null;
  source: string;
  openOrderId: string | null;
  closeOrderId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface JournalQuery {
  symbol?: string;
  side?: 'long' | 'short';
  mood?: string;
  /** Inclusive epoch-ms bounds on `closed_at`. */
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export interface JournalPage {
  items: JournalRow[];
  total: number;
  /** Newest `closed_at` in the whole matching set, or null when empty. */
  asOf: number | null;
}

export interface CreateJournalInput {
  symbol: string;
  side: 'long' | 'short';
  entryPrice: Decimal;
  exitPrice: Decimal;
  size: Decimal;
  fees?: Decimal | null;
  openedAt: number;
  closedAt: number;
  mood?: string | null;
  tags?: string[];
  note?: string | null;
  openOrderId?: string | null;
  closeOrderId?: string | null;
}

export interface AnnotateJournalInput {
  mood?: string | null;
  tags?: string[];
  note?: string | null;
}

export interface DailyPnlBucket {
  /** `YYYY-MM-DD` in UTC. */
  date: string;
  realizedPnl: Decimal;
  fees: Decimal;
  tradeCount: number;
  winCount: number;
  lossCount: number;
}

export interface DailyPnlSummary {
  buckets: DailyPnlBucket[];
  totalRealizedPnl: Decimal;
  totalFees: Decimal;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  /** Win rate as a percentage string, or null when there are no trades (0% would claim all losses). */
  winRatePct: Decimal | null;
  from: string | null;
  to: string | null;
}

export interface IJournalRepo {
  list(userId: string, q: JournalQuery): Promise<JournalPage>;
  get(userId: string, id: string): Promise<JournalRow | null>;
  create(userId: string, input: CreateJournalInput, now: number): Promise<JournalRow>;
  annotate(userId: string, id: string, input: AnnotateJournalInput, now: number): Promise<JournalRow | null>;
  remove(userId: string, id: string): Promise<boolean>;
  dailyPnl(userId: string, q: { from?: number; to?: number }): Promise<DailyPnlSummary>;
}

/**
 * Realized PnL for a round trip, as a decimal string.
 *
 * long:  (exit - entry) * size
 * short: (entry - exit) * size
 *
 * Fees are NOT subtracted here. Gross and net are different figures and a journal that silently reports
 * one as the other cannot be reconciled against an exchange statement; `fees` is stored alongside so a
 * caller can compute net explicitly.
 */
export function computeRealizedPnl(
  side: 'long' | 'short',
  entryPrice: Decimal,
  exitPrice: Decimal,
  size: Decimal,
): Decimal {
  const diff = side === 'long' ? D(exitPrice).minus(D(entryPrice)) : D(entryPrice).minus(D(exitPrice));
  return diff.mul(D(size)).toString();
}

/**
 * Return on the position as a percentage string, or `null` when there is no cost basis.
 *
 * Cost basis is `entryPrice * size`. A zero basis has no meaningful return, and dividing would yield
 * Infinity — which would render as a spectacular fake number.
 *
 * Rounded to 4 decimal places. The raw quotient is a repeating decimal (10/670*100 runs to 40+ digits),
 * and a percentage displayed to 2dp gains nothing from the rest while bloating every row and response.
 */
export function computeRoiPct(
  side: 'long' | 'short',
  entryPrice: Decimal,
  exitPrice: Decimal,
  size: Decimal,
): Decimal | null {
  const basis = D(entryPrice).mul(D(size));
  if (basis.isZero()) return null;
  const pnl = D(computeRealizedPnl(side, entryPrice, exitPrice, size));
  return pnl.div(basis).mul(100).toDecimalPlaces(4).toString();
}

/** `YYYY-MM-DD` in UTC. Local time would put a trade in different buckets for different viewers. */
export function utcDateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

function parseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '') return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    // A malformed tags blob must not make the whole entry unreadable.
    return [];
  }
}

function mapRow(r: Record<string, unknown>): JournalRow {
  return {
    id: String(r['id']),
    symbol: String(r['symbol']),
    side: String(r['side']),
    entryPrice: String(r['entry_price']),
    exitPrice: String(r['exit_price']),
    size: String(r['size']),
    realizedPnl: String(r['realized_pnl']),
    fees: r['fees'] === null || r['fees'] === undefined ? null : String(r['fees']),
    roiPct: r['roi_pct'] === null || r['roi_pct'] === undefined ? null : String(r['roi_pct']),
    openedAt: Number(r['opened_at']),
    closedAt: Number(r['closed_at']),
    mood: r['mood'] === null || r['mood'] === undefined ? null : String(r['mood']),
    tags: parseTags(r['tags']),
    note: r['note'] === null || r['note'] === undefined ? null : String(r['note']),
    source: String(r['source'] ?? 'manual'),
    openOrderId: r['open_order_id'] === null || r['open_order_id'] === undefined ? null : String(r['open_order_id']),
    closeOrderId:
      r['close_order_id'] === null || r['close_order_id'] === undefined ? null : String(r['close_order_id']),
    createdAt: Number(r['created_at']),
    updatedAt: Number(r['updated_at']),
  };
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

export class SqliteJournalRepo implements IJournalRepo {
  constructor(private readonly db: DB) {}

  /** Shared WHERE construction. Every filter is parameterized; no value is interpolated. */
  private where(userId: string, q: JournalQuery): { sql: string; params: unknown[] } {
    const clauses = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (q.symbol) {
      clauses.push('symbol = ?');
      params.push(q.symbol);
    }
    if (q.side) {
      clauses.push('side = ?');
      params.push(q.side);
    }
    if (q.mood) {
      clauses.push('mood = ?');
      params.push(q.mood);
    }
    if (q.from !== undefined) {
      clauses.push('closed_at >= ?');
      params.push(q.from);
    }
    if (q.to !== undefined) {
      clauses.push('closed_at <= ?');
      params.push(q.to);
    }
    return { sql: clauses.join(' AND '), params };
  }

  async list(userId: string, q: JournalQuery): Promise<JournalPage> {
    const { sql, params } = this.where(userId, q);
    const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(q.offset ?? 0, 0);

    const total = Number(
      (this.db.prepare(`SELECT COUNT(*) AS n FROM trade_journal WHERE ${sql}`).get(...params) as {
        n: number;
      }).n,
    );
    const rows = this.db
      .prepare(
        `SELECT * FROM trade_journal WHERE ${sql} ORDER BY closed_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Record<string, unknown>[];

    // asOf is the newest match in the whole set, not just this page: it describes the data, not the view.
    const newest = this.db
      .prepare(`SELECT MAX(closed_at) AS m FROM trade_journal WHERE ${sql}`)
      .get(...params) as { m: number | null };

    return {
      items: rows.map(mapRow),
      total,
      asOf: newest.m === null || newest.m === undefined ? null : Number(newest.m),
    };
  }

  async get(userId: string, id: string): Promise<JournalRow | null> {
    const r = this.db
      .prepare('SELECT * FROM trade_journal WHERE user_id = ? AND id = ?')
      .get(userId, id) as Record<string, unknown> | undefined;
    return r ? mapRow(r) : null;
  }

  async create(userId: string, input: CreateJournalInput, now: number): Promise<JournalRow> {
    const id = crypto.randomUUID();
    const realized = computeRealizedPnl(input.side, input.entryPrice, input.exitPrice, input.size);
    const roi = computeRoiPct(input.side, input.entryPrice, input.exitPrice, input.size);

    this.db
      .prepare(
        `INSERT INTO trade_journal
         (id,user_id,symbol,side,entry_price,exit_price,size,realized_pnl,fees,roi_pct,
          opened_at,closed_at,mood,tags,note,source,open_order_id,close_order_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        userId,
        input.symbol,
        input.side,
        input.entryPrice,
        input.exitPrice,
        input.size,
        realized,
        input.fees ?? null,
        roi,
        input.openedAt,
        input.closedAt,
        input.mood ?? null,
        JSON.stringify(input.tags ?? []),
        input.note ?? null,
        // Written by a user through the API, so 'manual'. A future matching job writes 'derived'.
        'manual',
        input.openOrderId ?? null,
        input.closeOrderId ?? null,
        now,
        now,
      );

    const created = await this.get(userId, id);
    if (!created) throw new Error('journal insert did not produce a readable row');
    return created;
  }

  /**
   * Update annotations only.
   *
   * Prices, size and realized PnL are deliberately NOT updatable: an entry whose PnL can be edited after
   * the fact is not a record of anything. A wrong entry is deleted and re-created.
   */
  async annotate(userId: string, id: string, input: AnnotateJournalInput, now: number): Promise<JournalRow | null> {
    const existing = await this.get(userId, id);
    if (!existing) return null;

    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.mood !== undefined) {
      sets.push('mood = ?');
      params.push(input.mood);
    }
    if (input.tags !== undefined) {
      sets.push('tags = ?');
      params.push(JSON.stringify(input.tags));
    }
    if (input.note !== undefined) {
      sets.push('note = ?');
      params.push(input.note);
    }
    if (sets.length === 0) return existing; // nothing to change; not an error

    sets.push('updated_at = ?');
    params.push(now, userId, id);
    this.db
      .prepare(`UPDATE trade_journal SET ${sets.join(', ')} WHERE user_id = ? AND id = ?`)
      .run(...params);
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const info = this.db
      .prepare('DELETE FROM trade_journal WHERE user_id = ? AND id = ?')
      .run(userId, id);
    return Number(info.changes ?? 0) > 0;
  }

  /**
   * Realized PnL bucketed by UTC day.
   *
   * Aggregated in application code with decimal.js rather than by SQL `SUM()`, because the columns are
   * TEXT: SQLite would coerce them to floats and reintroduce exactly the drift the string storage exists
   * to prevent.
   */
  async dailyPnl(userId: string, q: { from?: number; to?: number }): Promise<DailyPnlSummary> {
    const clauses = ['user_id = ?'];
    const params: unknown[] = [userId];
    if (q.from !== undefined) {
      clauses.push('closed_at >= ?');
      params.push(q.from);
    }
    if (q.to !== undefined) {
      clauses.push('closed_at <= ?');
      params.push(q.to);
    }

    const rows = this.db
      .prepare(
        `SELECT closed_at, realized_pnl, fees FROM trade_journal WHERE ${clauses.join(' AND ')} ORDER BY closed_at ASC`,
      )
      .all(...params) as { closed_at: number; realized_pnl: string; fees: string | null }[];

    const byDate = new Map<string, { pnl: ReturnType<typeof D>; fees: ReturnType<typeof D>; n: number; w: number; l: number }>();
    let totalPnl = D(0);
    let totalFees = D(0);
    let wins = 0;
    let losses = 0;

    for (const r of rows) {
      const key = utcDateKey(Number(r.closed_at));
      const pnl = D(r.realized_pnl);
      const fee = r.fees === null ? D(0) : D(r.fees);
      const bucket = byDate.get(key) ?? { pnl: D(0), fees: D(0), n: 0, w: 0, l: 0 };
      bucket.pnl = bucket.pnl.plus(pnl);
      bucket.fees = bucket.fees.plus(fee);
      bucket.n += 1;
      // Break-even (exactly 0) counts as neither a win nor a loss; win rate must not absorb it.
      if (pnl.gt(0)) {
        bucket.w += 1;
        wins += 1;
      } else if (pnl.lt(0)) {
        bucket.l += 1;
        losses += 1;
      }
      byDate.set(key, bucket);
      totalPnl = totalPnl.plus(pnl);
      totalFees = totalFees.plus(fee);
    }

    const buckets: DailyPnlBucket[] = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, b]) => ({
        date,
        realizedPnl: b.pnl.toString(),
        fees: b.fees.toString(),
        tradeCount: b.n,
        winCount: b.w,
        lossCount: b.l,
      }));

    const decided = wins + losses;
    return {
      buckets,
      totalRealizedPnl: totalPnl.toString(),
      totalFees: totalFees.toString(),
      tradeCount: rows.length,
      winCount: wins,
      lossCount: losses,
      // null when nothing is decided: 0% would claim every trade lost.
      winRatePct: decided === 0 ? null : D(wins).div(D(decided)).mul(100).toString(),
      from: buckets[0]?.date ?? null,
      to: buckets[buckets.length - 1]?.date ?? null,
    };
  }
}


/** pg Pool 의 최소 형태(쿼리만 쓴다). */
interface PgPoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

/*
   ★★ PostgreSQL 트레이드 저널 저장소.

     저널이 SqliteJournalRepo 로 SQLite 에 기록되고 있었다. 그런데 사용자는
     Postgres 에만 존재하므로 SQLite 의 trade_journal → users 외래키가 깨져
     **모든 저널 저장이 500(FOREIGN KEY constraint failed)** 으로 실패했고,
     조회는 빈 SQLite 를 읽어 항상 비어 보였다(= 저널 기능 전체가 프로덕션에서
     동작하지 않음). Postgres 배포에서는 이 저장소로 같은 테이블에 기록/조회한다.

   ★ 금액 컬럼은 TEXT 십진 문자열로 저장하고 그대로 돌려준다. 집계는 decimal.js
     (D)로 계산해 부동소수 오차를 만들지 않는다 — SqliteJournalRepo 와 동일한 규칙.
*/
export class PgJournalRepo implements IJournalRepo {
  constructor(private readonly pool: PgPoolLike) {}

  /** 파라미터화된 WHERE. 모든 값은 $n 바인딩이며 문자열 보간하지 않는다. */
  private where(userId: string, q: JournalQuery): { sql: string; params: unknown[] } {
    const clauses = ['user_id = $1'];
    const params: unknown[] = [userId];
    const add = (col: string, val: unknown) => { params.push(val); clauses.push(`${col} = $${params.length}`); };
    if (q.symbol) add('symbol', q.symbol);
    if (q.side) add('side', q.side);
    if (q.mood) add('mood', q.mood);
    if (q.from !== undefined) { params.push(q.from); clauses.push(`closed_at >= $${params.length}`); }
    if (q.to !== undefined) { params.push(q.to); clauses.push(`closed_at <= $${params.length}`); }
    return { sql: clauses.join(' AND '), params };
  }

  async list(userId: string, q: JournalQuery): Promise<JournalPage> {
    const { sql, params } = this.where(userId, q);
    const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(q.offset ?? 0, 0);

    const totalR = await this.pool.query(`SELECT COUNT(*) AS n FROM trade_journal WHERE ${sql}`, params);
    const total = Number((totalR.rows[0] as { n: string } | undefined)?.n ?? 0);

    const rowsR = await this.pool.query(
      `SELECT * FROM trade_journal WHERE ${sql} ORDER BY closed_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    const newestR = await this.pool.query(`SELECT MAX(closed_at) AS m FROM trade_journal WHERE ${sql}`, params);
    const m = (newestR.rows[0] as { m: string | null } | undefined)?.m;
    return {
      items: rowsR.rows.map(mapRow),
      total,
      asOf: m === null || m === undefined ? null : Number(m),
    };
  }

  async get(userId: string, id: string): Promise<JournalRow | null> {
    const r = await this.pool.query('SELECT * FROM trade_journal WHERE user_id = $1 AND id = $2', [userId, id]);
    const row = r.rows[0];
    return row ? mapRow(row) : null;
  }

  async create(userId: string, input: CreateJournalInput, now: number): Promise<JournalRow> {
    const id = crypto.randomUUID();
    const realized = computeRealizedPnl(input.side, input.entryPrice, input.exitPrice, input.size);
    const roi = computeRoiPct(input.side, input.entryPrice, input.exitPrice, input.size);
    await this.pool.query(
      `INSERT INTO trade_journal
         (id,user_id,symbol,side,entry_price,exit_price,size,realized_pnl,fees,roi_pct,
          opened_at,closed_at,mood,tags,note,source,open_order_id,close_order_id,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'manual',$16,$17,$18,$18)`,
      [
        id, userId, input.symbol, input.side, input.entryPrice, input.exitPrice, input.size,
        realized, input.fees ?? null, roi, input.openedAt, input.closedAt,
        input.mood ?? null, JSON.stringify(input.tags ?? []), input.note ?? null,
        input.openOrderId ?? null, input.closeOrderId ?? null, now,
      ],
    );
    const created = await this.get(userId, id);
    if (!created) throw new Error('journal insert did not produce a readable row');
    return created;
  }

  async annotate(userId: string, id: string, input: AnnotateJournalInput, now: number): Promise<JournalRow | null> {
    const existing = await this.get(userId, id);
    if (!existing) return null;
    const sets: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    if (input.mood !== undefined) add('mood', input.mood);
    if (input.tags !== undefined) add('tags', JSON.stringify(input.tags));
    if (input.note !== undefined) add('note', input.note);
    if (sets.length === 0) return existing;
    params.push(now); sets.push(`updated_at = $${params.length}`);
    params.push(userId); const uIdx = params.length;
    params.push(id); const iIdx = params.length;
    await this.pool.query(`UPDATE trade_journal SET ${sets.join(', ')} WHERE user_id = $${uIdx} AND id = $${iIdx}`, params);
    return this.get(userId, id);
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const r = await this.pool.query('DELETE FROM trade_journal WHERE user_id = $1 AND id = $2', [userId, id]);
    return (r.rowCount ?? 0) > 0;
  }

  async dailyPnl(userId: string, q: { from?: number; to?: number }): Promise<DailyPnlSummary> {
    const clauses = ['user_id = $1'];
    const params: unknown[] = [userId];
    if (q.from !== undefined) { params.push(q.from); clauses.push(`closed_at >= $${params.length}`); }
    if (q.to !== undefined) { params.push(q.to); clauses.push(`closed_at <= $${params.length}`); }
    const r = await this.pool.query(
      `SELECT closed_at, realized_pnl, fees FROM trade_journal WHERE ${clauses.join(' AND ')} ORDER BY closed_at ASC`,
      params,
    );
    const rows = r.rows as { closed_at: string | number; realized_pnl: string; fees: string | null }[];

    const byDate = new Map<string, { pnl: ReturnType<typeof D>; fees: ReturnType<typeof D>; n: number; w: number; l: number }>();
    let totalPnl = D(0);
    let totalFees = D(0);
    let wins = 0;
    let losses = 0;
    for (const row of rows) {
      const key = utcDateKey(Number(row.closed_at));
      const pnl = D(row.realized_pnl);
      const fee = row.fees === null ? D(0) : D(row.fees);
      const bucket = byDate.get(key) ?? { pnl: D(0), fees: D(0), n: 0, w: 0, l: 0 };
      bucket.pnl = bucket.pnl.plus(pnl);
      bucket.fees = bucket.fees.plus(fee);
      bucket.n += 1;
      if (pnl.gt(0)) { bucket.w += 1; wins += 1; }
      else if (pnl.lt(0)) { bucket.l += 1; losses += 1; }
      byDate.set(key, bucket);
      totalPnl = totalPnl.plus(pnl);
      totalFees = totalFees.plus(fee);
    }
    const buckets: DailyPnlBucket[] = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, b]) => ({
        date,
        realizedPnl: b.pnl.toString(),
        fees: b.fees.toString(),
        tradeCount: b.n,
        winCount: b.w,
        lossCount: b.l,
      }));
    const decided = wins + losses;
    return {
      buckets,
      totalRealizedPnl: totalPnl.toString(),
      totalFees: totalFees.toString(),
      tradeCount: rows.length,
      winCount: wins,
      lossCount: losses,
      winRatePct: decided === 0 ? null : D(wins).div(D(decided)).mul(100).toString(),
      from: buckets[0]?.date ?? null,
      to: buckets[buckets.length - 1]?.date ?? null,
    };
  }
}
