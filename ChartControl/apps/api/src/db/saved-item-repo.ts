import { randomUUID } from 'node:crypto';

/*
   사용자 저장 항목 저장소 (PostgreSQL). 신호·지표·드로잉을 저장/조회/삭제한다.
   모든 접근은 user_id 로 스코프되어 다른 사용자의 항목에 접근할 수 없다.
*/

export type SavedItemKind = 'signal' | 'indicator' | 'drawing';

export interface SavedItemRow {
  id: string;
  userId: string;
  kind: SavedItemKind;
  name: string;
  symbol: string | null;
  timeframe: string | null;
  payload: unknown;
  createdAt: number;
}

export interface CreateSavedItemInput {
  userId: string;
  kind: SavedItemKind;
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
    name: String(x.name),
    symbol: x.symbol == null ? null : String(x.symbol),
    timeframe: x.timeframe == null ? null : String(x.timeframe),
    payload: x.payload,
    createdAt: x.created_at instanceof Date ? x.created_at.getTime() : Number(x.created_at),
  };
}

export class PgSavedItemRepo {
  constructor(private readonly pool: import('pg').Pool) {}

  async create(input: CreateSavedItemInput): Promise<SavedItemRow> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO saved_items (id, user_id, kind, name, symbol, timeframe, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
      [id, input.userId, input.kind, input.name.slice(0, 120), input.symbol ?? null, input.timeframe ?? null, JSON.stringify(input.payload ?? {})],
    );
    return mapRow(rows[0] as Record<string, unknown>);
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
