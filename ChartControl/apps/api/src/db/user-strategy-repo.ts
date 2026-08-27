/*
   사용자가 만든 전략/지표 저장소 (PostgreSQL, Option B).
   내장 카탈로그와 별개로 사용자 소유 전략/지표를 CRUD 한다.
   모든 접근은 user_id 로 스코프되어 남의 것에 접근할 수 없다.
*/
import { randomUUID } from 'node:crypto';

export type UserStrategyKind = 'strategy' | 'indicator';

export interface UserStrategyRow {
  id: string;
  userId: string;
  kind: UserStrategyKind;
  name: string;
  baseStrategyId: string | null;
  symbol: string | null;
  timeframe: string | null;
  config: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface CreateUserStrategyInput {
  userId: string;
  kind: UserStrategyKind;
  name: string;
  baseStrategyId?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  config: unknown;
}

export interface UpdateUserStrategyInput {
  name?: string;
  symbol?: string | null;
  timeframe?: string | null;
  config?: unknown;
}

function toMs(x: unknown): number {
  return x instanceof Date ? x.getTime() : Number(x);
}

function mapRow(x: Record<string, unknown>): UserStrategyRow {
  return {
    id: String(x.id),
    userId: String(x.user_id),
    kind: (String(x.kind) === 'indicator' ? 'indicator' : 'strategy') as UserStrategyKind,
    name: String(x.name),
    baseStrategyId: x.base_strategy_id == null ? null : String(x.base_strategy_id),
    symbol: x.symbol == null ? null : String(x.symbol),
    timeframe: x.timeframe == null ? null : String(x.timeframe),
    config: x.config,
    createdAt: toMs(x.created_at),
    updatedAt: toMs(x.updated_at),
  };
}

export class PgUserStrategyRepo {
  constructor(private readonly pool: import('pg').Pool) {}

  async create(input: CreateUserStrategyInput): Promise<UserStrategyRow> {
    const id = randomUUID();
    const kind: UserStrategyKind = input.kind === 'indicator' ? 'indicator' : 'strategy';
    const { rows } = await this.pool.query(
      `INSERT INTO user_strategies (id, user_id, kind, name, base_strategy_id, symbol, timeframe, config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
      [
        id, input.userId, kind, String(input.name).slice(0, 120),
        input.baseStrategyId ?? null, input.symbol ?? null, input.timeframe ?? null,
        JSON.stringify(input.config ?? {}),
      ],
    );
    return mapRow(rows[0] as Record<string, unknown>);
  }

  /** 소유자의 목록. kind 로 좁힐 수 있다. */
  async listForUser(userId: string, kind?: UserStrategyKind): Promise<UserStrategyRow[]> {
    const { rows } = kind
      ? await this.pool.query(
          `SELECT * FROM user_strategies WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC`,
          [userId, kind],
        )
      : await this.pool.query(
          `SELECT * FROM user_strategies WHERE user_id = $1 ORDER BY created_at DESC`,
          [userId],
        );
    return (rows as Record<string, unknown>[]).map(mapRow);
  }

  async get(userId: string, id: string): Promise<UserStrategyRow | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM user_strategies WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return rows.length ? mapRow(rows[0] as Record<string, unknown>) : null;
  }

  /** 편집(소유자만). 넘긴 필드만 갱신한다. */
  async update(userId: string, id: string, patch: UpdateUserStrategyInput): Promise<UserStrategyRow | null> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.name !== undefined) { sets.push(`name = $${++i}`); vals.push(String(patch.name).slice(0, 120)); }
    if (patch.symbol !== undefined) { sets.push(`symbol = $${++i}`); vals.push(patch.symbol); }
    if (patch.timeframe !== undefined) { sets.push(`timeframe = $${++i}`); vals.push(patch.timeframe); }
    if (patch.config !== undefined) { sets.push(`config = $${++i}::jsonb`); vals.push(JSON.stringify(patch.config ?? {})); }
    if (sets.length === 0) return this.get(userId, id);
    sets.push('updated_at = now()');
    const { rows } = await this.pool.query(
      `UPDATE user_strategies SET ${sets.join(', ')} WHERE id = $1 AND user_id = $${i + 1} RETURNING *`,
      [id, ...vals, userId],
    );
    return rows.length ? mapRow(rows[0] as Record<string, unknown>) : null;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM user_strategies WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }
}
