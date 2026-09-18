/*
   사용자가 만든 전략/지표 저장소 (PostgreSQL, Option B).
   내장 카탈로그와 별개로 사용자 소유 전략/지표를 CRUD 한다.
   모든 접근은 user_id 로 스코프되어 남의 것에 접근할 수 없다.
*/
import { randomUUID } from 'node:crypto';
/*
   ★ 보관기간은 **한 곳에서** 정한다. 두 저장소가 각자 상수를 들면 한쪽만 바뀌어
     "전부 100일" 이 깨진다 — 실제로 30일/무기한으로 갈려 있었다.
*/
import { SAVED_TTL_DAYS } from './saved-item-repo.js';

/*
   사용자가 만들어 저장하는 것의 종류.

   ★ 'signal' 은 2026-09-18 에 추가했다 — 운영 결정: **매매 신호는 고객이 만든다.**
     고객이 조건식을 쓰고(config.rule), 서비스는 그 조건이 성립한 봉을 차트에
     표시한다. 규칙은 고객 것이고 주문은 발생하지 않는다.
   ★ DB CHECK 제약(0051)도 같은 세 값이어야 한다 — 한쪽만 늘리면 INSERT 가 거부된다.
*/
export type UserStrategyKind = 'strategy' | 'indicator' | 'signal';

/**
 * 알 수 없는 값은 'strategy' 로 떨어뜨린다(기존 동작).
 *
 * ★★ 두 곳(읽기·쓰기)이 각자 삼항 연산자로 판정하고 있었다. 종류를 하나 늘릴 때
 *   한쪽만 고치면 **저장은 되는데 읽을 때 다른 종류로 보인다.** 한 함수로 모은다.
 */
export function normalizeKind(v: unknown): UserStrategyKind {
  const s = String(v);
  return s === 'indicator' || s === 'signal' ? s : 'strategy';
}

export interface UserStrategyRow {
  id: string;
  userId: string;
  kind: UserStrategyKind;
  name: string;
  baseStrategyId: string | null;
  symbol: string | null;
  timeframe: string | null;
  config: unknown;
  /** 만료 시각(ms). null = 만료 개념이 없던 시절의 항목. */
  expiresAt: number | null;
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
    kind: normalizeKind(x.kind),
    name: String(x.name),
    baseStrategyId: x.base_strategy_id == null ? null : String(x.base_strategy_id),
    symbol: x.symbol == null ? null : String(x.symbol),
    timeframe: x.timeframe == null ? null : String(x.timeframe),
    config: x.config,
    /* ★ 화면이 남은 기간을 보여줄 수 있어야 한다 — 안 주면 "언제 사라지나" 를 알 수 없다. */
    expiresAt: x.expires_at == null ? null : (x.expires_at instanceof Date ? x.expires_at.getTime() : Number(x.expires_at)),
    createdAt: toMs(x.created_at),
    updatedAt: toMs(x.updated_at),
  };
}

export class PgUserStrategyRepo {
  constructor(private readonly pool: import('pg').Pool) {}

  async create(input: CreateUserStrategyInput): Promise<UserStrategyRow> {
    const id = randomUUID();
    const kind: UserStrategyKind = normalizeKind(input.kind);
    const { rows } = await this.pool.query(
      /*
         ★★★ 보관기간 **100일** — 저장된 항목과 같은 값이다(운영 결정 2026-09-18).
           예전에는 규칙에 만료가 없었다. 종류에 따라 사라지는 것과 안 사라지는 것이
           섞여 있으면 고객이 결과를 예측할 수 없다.
      */
      `INSERT INTO user_strategies (id, user_id, kind, name, base_strategy_id, symbol, timeframe, config, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, now() + ($9 || ' days')::interval) RETURNING *`,
      [
        id, input.userId, kind, String(input.name).slice(0, 120),
        input.baseStrategyId ?? null, input.symbol ?? null, input.timeframe ?? null,
        JSON.stringify(input.config ?? {}), String(SAVED_TTL_DAYS),
      ],
    );
    return mapRow(rows[0] as Record<string, unknown>);
  }

  /** 소유자의 목록. kind 로 좁힐 수 있다. */
  /*
     보관기간을 연장한다.

     ★ `GREATEST(now(), ...)` 로 **이미 만료된 것도 지금부터** 다시 센다. 지난 만료
       시각에 더하면 연장했는데도 여전히 만료 상태로 남는다.
     ★ 소유자 확인을 쿼리에 넣는다(`user_id=$2`) — 남의 항목을 연장할 수 없어야 한다.
  */
  async extend(userId: string, id: string, days = SAVED_TTL_DAYS): Promise<UserStrategyRow | null> {
    const { rows } = await this.pool.query(
      `UPDATE user_strategies
          SET expires_at = GREATEST(now(), COALESCE(expires_at, now())) + ($3 || ' days')::interval
        WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId, String(days)],
    );
    return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null;
  }

  async listForUser(userId: string, kind?: UserStrategyKind): Promise<UserStrategyRow[]> {
    /*
       ★ 만료된 것은 목록에서 뺀다. 지우지는 않는다 — 연장하면 다시 보인다.
       ★ `expires_at IS NULL` 은 보여준다(만료 개념이 없던 시절의 항목).
    */
    const alive = '(expires_at IS NULL OR expires_at > now())';
    const { rows } = kind
      ? await this.pool.query(
          `SELECT * FROM user_strategies WHERE user_id = $1 AND kind = $2 AND ${alive} ORDER BY created_at DESC`,
          [userId, kind],
        )
      : await this.pool.query(
          `SELECT * FROM user_strategies WHERE user_id = $1 AND ${alive} ORDER BY created_at DESC`,
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
