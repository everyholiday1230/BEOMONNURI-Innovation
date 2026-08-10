import type { Pool } from 'pg';

import {
  ORDER_SORT_COLUMNS,
  POSITION_SORT_COLUMNS,
  TRADE_SORT_COLUMNS,
  resolvePage,
  type OrderQuery,
  type PositionQuery,
  type TradeQuery,
} from '../portfolio/query';
import type { BalanceRow, OrderRow, Page, PositionRow, TradeRow } from './portfolio-repo';

/**
 * 거래 읽기 모델 — **PostgreSQL** 판.
 *
 * 왜 이 파일이 생겼나
 * -----------------
 * `PortfolioRepo` 는 SQLite 전용이다. 모의 주문 기록은 PostgreSQL 에 쓰도록 고쳤는데
 * 조회는 여전히 SQLite 를 보고 있었다. 그 결과 `/api/positions` 가 DB 에 포지션이
 * 1건 있는데도 `items: []` 를 돌려줬고, 화면은 빈 응답을 받자 목업으로 폴백했다.
 *
 * ★ 쓰기와 읽기가 다른 저장소를 가리키면 "저장은 됐는데 안 보인다" 가 된다. 이건
 *   화면만 보고는 절대 알 수 없다 — 목업이 그 자리를 채우기 때문이다.
 *
 * 지켜야 하는 두 가지 (SQLite 판과 동일)
 * -----------------------------------
 *  1. **모든 WHERE 에 `user_id` 가 있고**, 그 값은 세션에서 온다. 요청에서 받지
 *     않으므로 남의 주문을 읽는 경로가 존재하지 않는다.
 *  2. **소수 컬럼을 숫자로 바꾸지 않는다.** 수량을 JS number 로 통과시키면 조용히
 *     반올림된다(0.1 + 0.2). 반올림된 수량은 표시 문제가 아니라 결함이다.
 *     PostgreSQL 의 `numeric` 은 pg 드라이버가 문자열로 주므로 그대로 넘긴다.
 *
 * ★ 시각 컬럼이 `timestamptz` 다. 화면은 epoch ms 를 기대하므로 SQL 에서 변환한다
 *   (`EXTRACT(EPOCH ...) * 1000`). JS 에서 Date 로 바꾸면 널 처리와 시간대에서
 *   실수가 생긴다.
 */

/** 정렬 키(카멜) → 실제 컬럼(스네이크). 클라이언트 문자열을 SQL 에 넣지 않는다. */
const COLUMN_OF: Record<string, string> = {
  updatedAt: 'updated_at',
  createdAt: 'created_at',
  at: 'at',
  symbol: 'symbol',
  size: 'size',
  quantity: 'quantity',
  price: 'price',
  status: 'status',
  side: 'side',
};

/**
 * 정렬 컬럼을 화이트리스트로 확정한다.
 *
 * `resolvePage` 가 이미 허용 목록을 검사하지만, 그 결과를 SQL 에 그대로 이어붙이기
 * 전에 한 번 더 매핑한다 — 두 겹으로 막지 않으면 목록에 새 키를 추가할 때
 * 주입 경로가 열릴 수 있다.
 */
const safeColumn = (key: string, fallback: string): string => COLUMN_OF[key] ?? fallback;

const ms = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const msOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function mapOrder(r: Record<string, unknown>): OrderRow {
  return {
    id: str(r.internal_order_id),
    clientOrderId: str(r.client_order_id),
    exchangeOrderId: strOrNull(r.exchange_order_id),
    symbol: str(r.symbol),
    side: str(r.side),
    type: str(r.type),
    // 소수는 문자열로 통과. 이 파일에 Number() 를 쓰는 곳은 시각뿐이다.
    price: strOrNull(r.price),
    quantity: str(r.quantity),
    filledQuantity: str(r.filled_quantity),
    status: str(r.status),
    mode: str(r.mode),
    createdAt: ms(r.created_ms),
    updatedAt: ms(r.updated_ms),
  };
}

function mapTrade(r: Record<string, unknown>): TradeRow {
  return {
    id: str(r.id),
    orderId: str(r.internal_order_id),
    execId: strOrNull(r.exec_id),
    symbol: str(r.symbol),
    side: str(r.side),
    price: str(r.price),
    quantity: str(r.quantity),
    fee: strOrNull(r.fee),
    liquidity: strOrNull(r.liquidity),
    at: ms(r.at_ms),
  };
}

function mapPosition(r: Record<string, unknown>): PositionRow {
  return {
    id: str(r.id),
    symbol: str(r.symbol),
    side: str(r.side),
    size: str(r.size),
    entryPrice: strOrNull(r.entry_price),
    /*
       표시가·청산가·미실현손익은 실시간 시세가 있어야 채워진다.

       NULL 을 0 으로 바꾸지 않는다 — 화면이 "손익 0" 을 보여주면 사용자는
       본전이라고 읽는다. 모르는 것과 0 은 다르다.
    */
    markPrice: strOrNull(r.mark_price),
    liquidationPrice: strOrNull(r.liquidation_price),
    leverage: r.leverage === null || r.leverage === undefined ? null : Number(r.leverage),
    marginMode: strOrNull(r.margin_mode),
    unrealizedPnl: strOrNull(r.unrealized_pnl),
    updatedAt: ms(r.updated_ms),
  };
}

function mapBalance(r: Record<string, unknown>): BalanceRow {
  return {
    id: str(r.id),
    asset: str(r.asset),
    available: str(r.available),
    equity: str(r.equity),
    used: str(r.used),
    at: ms(r.at_ms),
  };
}

export class PgPortfolioRepo {
  constructor(private readonly pool: Pool) {}

  // ---------------- 주문 ----------------

  /**
   * 지정한 생애주기 상태의 주문.
   *
   * `states` 는 항상 서버 상수다(`resolveStatusFilter` 참고) — 요청에서 오지 않으므로
   * 생성되는 플레이스홀더 목록을 클라이언트가 흔들 수 없다.
   */
  async listOrders(userId: string, states: readonly string[], q: OrderQuery): Promise<Page<OrderRow>> {
    if (states.length === 0) return { items: [], total: 0, asOf: null };

    const page = resolvePage(q, ORDER_SORT_COLUMNS, 'updatedAt');
    const args: unknown[] = [userId];
    const where: string[] = ['user_id = $1'];

    where.push(`status = ANY($${args.length + 1})`);
    args.push([...states]);

    if (q.symbol) { args.push(q.symbol); where.push(`symbol = $${args.length}`); }
    if (q.side) { args.push(q.side); where.push(`side = $${args.length}`); }
    if (q.from !== undefined) {
      args.push(q.from);
      where.push(`created_at >= to_timestamp($${args.length}::double precision / 1000)`);
    }
    if (q.to !== undefined) {
      args.push(q.to);
      where.push(`created_at <= to_timestamp($${args.length}::double precision / 1000)`);
    }

    const clause = where.join(' AND ');
    const col = safeColumn(page.column, 'updated_at');

    const agg = await this.pool.query(
      `SELECT COUNT(*)::int AS n,
              (EXTRACT(EPOCH FROM MAX(updated_at)) * 1000)::bigint AS newest
         FROM orders WHERE ${clause}`,
      args,
    );

    const rows = await this.pool.query(
      `SELECT internal_order_id, client_order_id, exchange_order_id, symbol, side, type,
              price, quantity, filled_quantity, status, mode,
              (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_ms,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS updated_ms
         FROM orders WHERE ${clause}
        ORDER BY ${col} ${page.dir === 'DESC' ? 'DESC' : 'ASC'}, internal_order_id ASC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, page.limit, page.offset],
    );

    const a = agg.rows[0] as { n: number; newest: string | null };
    return {
      items: rows.rows.map((r) => mapOrder(r as Record<string, unknown>)),
      total: Number(a.n),
      asOf: msOrNull(a.newest),
    };
  }

  // ---------------- 체결 ----------------

  async listTrades(userId: string, q: TradeQuery): Promise<Page<TradeRow>> {
    const page = resolvePage(q, TRADE_SORT_COLUMNS, 'at');
    const args: unknown[] = [userId];
    const where: string[] = ['e.user_id = $1'];

    if (q.symbol) { args.push(q.symbol); where.push(`o.symbol = $${args.length}`); }
    if (q.from !== undefined) {
      args.push(q.from);
      where.push(`e.at >= to_timestamp($${args.length}::double precision / 1000)`);
    }
    if (q.to !== undefined) {
      args.push(q.to);
      where.push(`e.at <= to_timestamp($${args.length}::double precision / 1000)`);
    }

    const clause = where.join(' AND ');
    // 정렬 컬럼이 executions 쪽인지 orders 쪽인지 구분해 접두어를 붙인다.
    const raw = safeColumn(page.column, 'at');
    const col = raw === 'symbol' || raw === 'side' ? `o.${raw}` : `e.${raw}`;

    const agg = await this.pool.query(
      `SELECT COUNT(*)::int AS n, (EXTRACT(EPOCH FROM MAX(e.at)) * 1000)::bigint AS newest
         FROM executions e JOIN orders o ON o.internal_order_id = e.internal_order_id
        WHERE ${clause}`,
      args,
    );

    const rows = await this.pool.query(
      `SELECT e.id, e.internal_order_id, e.exec_id, o.symbol, o.side,
              e.price, e.quantity, e.fee, e.liquidity,
              (EXTRACT(EPOCH FROM e.at) * 1000)::bigint AS at_ms
         FROM executions e JOIN orders o ON o.internal_order_id = e.internal_order_id
        WHERE ${clause}
        ORDER BY ${col} ${page.dir === 'DESC' ? 'DESC' : 'ASC'}, e.id ASC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, page.limit, page.offset],
    );

    const a = agg.rows[0] as { n: number; newest: string | null };
    return {
      items: rows.rows.map((r) => mapTrade(r as Record<string, unknown>)),
      total: Number(a.n),
      asOf: msOrNull(a.newest),
    };
  }

  // ---------------- 포지션 ----------------

  async listPositions(userId: string, q: PositionQuery): Promise<Page<PositionRow>> {
    const page = resolvePage(q, POSITION_SORT_COLUMNS, 'updatedAt');
    const args: unknown[] = [userId];
    const where: string[] = ['user_id = $1'];
    if (q.symbol) { args.push(q.symbol); where.push(`symbol = $${args.length}`); }
    if (q.side) { args.push(q.side); where.push(`side = $${args.length}`); }

    const clause = where.join(' AND ');
    const col = safeColumn(page.column, 'updated_at');

    const agg = await this.pool.query(
      `SELECT COUNT(*)::int AS n, (EXTRACT(EPOCH FROM MAX(updated_at)) * 1000)::bigint AS newest
         FROM positions WHERE ${clause}`,
      args,
    );

    const rows = await this.pool.query(
      `SELECT id, symbol, side, size, entry_price, mark_price, liquidation_price, leverage,
              margin_mode, unrealized_pnl,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS updated_ms
         FROM positions WHERE ${clause}
        ORDER BY ${col} ${page.dir === 'DESC' ? 'DESC' : 'ASC'}, id ASC
        LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, page.limit, page.offset],
    );

    const a = agg.rows[0] as { n: number; newest: string | null };
    return {
      items: rows.rows.map((r) => mapPosition(r as Record<string, unknown>)),
      total: Number(a.n),
      asOf: msOrNull(a.newest),
    };
  }

  /** 내가 가진 포지션 하나, 없으면 null. 청산 초안·마진 검증이 쓴다. */
  async getPosition(userId: string, id: string): Promise<PositionRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, symbol, side, size, entry_price, mark_price, liquidation_price, leverage,
              margin_mode, unrealized_pnl,
              (EXTRACT(EPOCH FROM updated_at) * 1000)::bigint AS updated_ms
         FROM positions WHERE user_id = $1 AND id = $2`,
      [userId, id],
    );
    return rows[0] ? mapPosition(rows[0] as Record<string, unknown>) : null;
  }

  // ---------------- 잔고 ----------------

  async listBalances(userId: string): Promise<{ items: BalanceRow[]; asOf: number | null }> {
    const { rows } = await this.pool.query(
      `SELECT id, asset, available, equity, used,
              (EXTRACT(EPOCH FROM at) * 1000)::bigint AS at_ms
         FROM account_balances WHERE user_id = $1 ORDER BY asset ASC`,
      [userId],
    );
    const items = rows.map((r) => mapBalance(r as Record<string, unknown>));
    /*
       가장 최근 시각.

       ★ 빈 목록이면 null 이다 — 0 을 주면 화면이 1970년을 "마지막 갱신" 으로 표시한다.
    */
    const asOf = items.length ? Math.max(...items.map((x) => x.at)) : null;
    return { items, asOf };
  }
}
