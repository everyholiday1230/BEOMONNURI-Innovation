import { randomUUID } from 'node:crypto';

/*
   사용자 저장 항목 저장소 (PostgreSQL). 신호·지표·드로잉을 저장/조회/삭제한다.
   모든 접근은 user_id 로 스코프되어 다른 사용자의 항목에 접근할 수 없다.
*/

export type SavedItemKind = 'signal' | 'indicator' | 'drawing';
export type SavedItemScope = 'symbol' | 'global';

/** 저장 유효기간(일) 및 연장 단위. */
export const SAVED_TTL_DAYS = 30;

export interface SavedItemRow {
  id: string;
  userId: string;
  kind: SavedItemKind;
  scope: SavedItemScope;
  name: string;
  symbol: string | null;
  timeframe: string | null;
  payload: unknown;
  createdAt: number;
  expiresAt: number | null;
}

export interface CreateSavedItemInput {
  userId: string;
  kind: SavedItemKind;
  scope?: SavedItemScope;
  name: string;
  symbol?: string | null;
  timeframe?: string | null;
  payload: unknown;
}

function mapRow(x: Record<string, unknown>): SavedItemRow {
  return {
    id: String(x.id),
    userId: String(x.user_id),
    kind: String(x.kind) as SavedItemKind,
    scope: (x.scope ? String(x.scope) : 'symbol') as SavedItemScope,
    name: String(x.name),
    symbol: x.symbol == null ? null : String(x.symbol),
    timeframe: x.timeframe == null ? null : String(x.timeframe),
    payload: x.payload,
    createdAt: x.created_at instanceof Date ? x.created_at.getTime() : Number(x.created_at),
    expiresAt: x.expires_at == null ? null : (x.expires_at instanceof Date ? x.expires_at.getTime() : Number(x.expires_at)),
  };
}

export class PgSavedItemRepo {
  constructor(private readonly pool: import('pg').Pool) {}

  async create(input: CreateSavedItemInput): Promise<SavedItemRow> {
    const id = randomUUID();
    const scope: SavedItemScope = input.scope === 'global' ? 'global' : 'symbol';
    const { rows } = await this.pool.query(
      `INSERT INTO saved_items (id, user_id, kind, scope, name, symbol, timeframe, payload, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now() + ($9 || ' days')::interval) RETURNING *`,
      [id, input.userId, input.kind, scope, input.name.slice(0, 120), input.symbol ?? null, input.timeframe ?? null, JSON.stringify(input.payload ?? {}), String(SAVED_TTL_DAYS)],
    );
    return mapRow(rows[0] as Record<string, unknown>);
  }

  /** 만료 연장. 이미 만료됐어도 now() 기준으로 days 만큼 연장한다. 소유자만. */
  async extend(userId: string, id: string, days = SAVED_TTL_DAYS): Promise<SavedItemRow | null> {
    const { rows } = await this.pool.query(
      `UPDATE saved_items
         SET expires_at = GREATEST(now(), COALESCE(expires_at, now())) + ($3 || ' days')::interval
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId, String(days)],
    );
    return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null;
  }

  async listForUser(userId: string, kind?: SavedItemKind, limit = 100): Promise<SavedItemRow[]> {
    const lim = Math.min(300, Math.max(1, limit));
    const { rows } = kind
      ? await this.pool.query('SELECT * FROM saved_items WHERE user_id=$1 AND kind=$2 ORDER BY created_at DESC LIMIT $3', [userId, kind, lim])
      : await this.pool.query('SELECT * FROM saved_items WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2', [userId, lim]);
    return (rows as Record<string, unknown>[]).map(mapRow);
  }

  async getOwned(userId: string, id: string): Promise<SavedItemRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM saved_items WHERE id=$1 AND user_id=$2', [id, userId]);
    return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query('DELETE FROM saved_items WHERE id=$1 AND user_id=$2', [id, userId]);
    return (rowCount ?? 0) > 0;
  }

  async countForUser(userId: string): Promise<number> {
    const { rows } = await this.pool.query('SELECT COUNT(*)::int AS n FROM saved_items WHERE user_id=$1', [userId]);
    return Number((rows[0] as { n: number })?.n ?? 0);
  }
}
