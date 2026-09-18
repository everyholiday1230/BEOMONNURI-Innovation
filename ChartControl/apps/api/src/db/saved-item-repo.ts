import { randomUUID } from 'node:crypto';

/*
   사용자 저장 항목 저장소 (PostgreSQL). 신호·지표·드로잉을 저장/조회/삭제한다.
   모든 접근은 user_id 로 스코프되어 다른 사용자의 항목에 접근할 수 없다.
*/

export type SavedItemKind = 'signal' | 'indicator' | 'drawing';
export type SavedItemScope = 'symbol' | 'global';

/** 저장 유효기간(일) 및 연장 단위. */
/*
   ★★★ 보관기간 **100일** (운영 결정 2026-09-18: "전부 100일이요").

     예전에는 30일이었다. 규칙은 만료가 아예 없었다 — 저장 종류에 따라 사라지는
     것과 안 사라지는 것이 섞여 있었고, 고객은 어느 쪽에 저장했는지 기억해야 했다.
     **하나로 통일한다.**

   ★ 연장 기간도 같은 값을 쓴다 — 저장은 100일, 연장은 30일 같은 식으로 다르면
     고객이 계산을 못 한다.
*/
export const SAVED_TTL_DAYS = 100;

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
       WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING *`,
      [id, userId, String(days)],
    );
    return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null;
  }

  async listForUser(userId: string, kind?: SavedItemKind, limit = 100): Promise<SavedItemRow[]> {
    const lim = Math.min(300, Math.max(1, limit));
    /*
       ★★★ **만료된 항목을 목록에서 뺀다.**

         예전에는 걸러내지 않았다. 그래서 화면은 "30일 뒤 만료" 라고 알리는데
         **실제로는 아무 일도 일어나지 않았다** — 고객에게 사실이 아닌 것을
         말한 셈이다. 약속한 대로 동작해야 한다.

       ★ 지우지는 않는다(`DELETE` 가 아니다). 만료는 **안 보이게 하는 것**이고,
         연장하면 다시 보인다. 지워 버리면 되돌릴 방법이 없다.
       ★ `expires_at IS NULL` 은 보여준다 — 만료 개념이 없던 시절의 항목이다.
         모른다고 감추면 고객이 저장한 것이 사라진 것으로 보인다.
    */
    const alive = "(deleted_at IS NULL AND (expires_at IS NULL OR expires_at > now()))";
    const { rows } = kind
      ? await this.pool.query(`SELECT * FROM saved_items WHERE user_id=$1 AND kind=$2 AND ${alive} ORDER BY created_at DESC LIMIT $3`, [userId, kind, lim])
      : await this.pool.query(`SELECT * FROM saved_items WHERE user_id=$1 AND ${alive} ORDER BY created_at DESC LIMIT $2`, [userId, lim]);
    return (rows as Record<string, unknown>[]).map(mapRow);
  }

  /*
     ★★★ **삭제된 항목은 없는 것으로 다룬다.**

       soft delete 를 넣으면서 이 함수를 빼먹었다. 그래서 고객이 지운 항목을
       `getOwned` 가 계속 돌려줬다 — 연장·수정이 되고, 목록에는 없는데 조작은 되는
       상태가 된다. 시험이 잡았다(`deletes only own items`).
     ★ 서버에는 남아 있지만 **고객 경로에서는 없는 것**이다. 학습용 보관과 고객에게
       보이는 것은 다른 이야기다.
  */
  async getOwned(userId: string, id: string): Promise<SavedItemRow | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM saved_items WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL',
      [id, userId],
    );
    return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null;
  }

  /*
     삭제 — **지우지 않고 표시만 한다**(운영 결정 2026-09-18). 위 `user-strategy-repo`
     와 같은 이유다: 학습을 위해 서버에는 남긴다.
     ★ 거래소 API 키에는 이 방식을 쓰지 않는다.
  */
  async remove(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'UPDATE saved_items SET deleted_at = now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL',
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  async countForUser(userId: string): Promise<number> {
    const { rows } = await this.pool.query('SELECT COUNT(*)::int AS n FROM saved_items WHERE user_id=$1 AND deleted_at IS NULL', [userId]);
    return Number((rows[0] as { n: number })?.n ?? 0);
  }
}
