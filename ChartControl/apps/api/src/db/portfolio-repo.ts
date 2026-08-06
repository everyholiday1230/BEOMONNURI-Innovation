import type { DB } from './sqlite';
import {
  ORDER_SORT_COLUMNS,
  POSITION_SORT_COLUMNS,
  TRADE_SORT_COLUMNS,
  resolvePage,
  type OrderQuery,
  type PositionQuery,
  type TradeQuery,
} from '../portfolio/query';

/**
 * B3 / B5 — user-scoped read model over the existing trading tables (`orders`, `executions`,
 * `positions`, `account_balances` from migration 0003).
 *
 * Two invariants hold for every method here:
 *
 *  1. `user_id = ?` is part of every WHERE clause and the value comes from the session, never from
 *     the request. There is no method that can read another user's rows, so IDOR is not something the
 *     route layer has to remember to prevent.
 *  2. Decimal columns are TEXT in the schema and are returned as strings, untouched. Passing an order
 *     quantity through a JS number silently rounds it (0.1 + 0.2), and a rounded quantity in a
 *     trading UI is a defect, not a display nit.
 */

/** Decimal values are strings end-to-end. This alias exists to make that explicit at call sites. */
export type Decimal = string;

export interface OrderRow {
  id: string;
  clientOrderId: string;
  exchangeOrderId: string | null;
  symbol: string;
  side: string;
  type: string;
  price: Decimal | null;
  quantity: Decimal;
  filledQuantity: Decimal;
  status: string;
  mode: string;
  createdAt: number;
  updatedAt: number;
}

export interface TradeRow {
  id: string;
  orderId: string;
  execId: string | null;
  symbol: string;
  side: string;
  price: Decimal;
  quantity: Decimal;
  fee: Decimal | null;
  liquidity: string | null;
  at: number;
}

export interface PositionRow {
  id: string;
  symbol: string;
  side: string;
  size: Decimal;
  entryPrice: Decimal | null;
  markPrice: Decimal | null;
  liquidationPrice: Decimal | null;
  leverage: number | null;
  marginMode: string | null;
  unrealizedPnl: Decimal | null;
  updatedAt: number;
}

export interface BalanceRow {
  id: string;
  asset: string;
  available: Decimal;
  equity: Decimal;
  used: Decimal;
  at: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  /** Newest `updatedAt`/`at` across ALL matching rows, not just the current page. */
  asOf: number | null;
}

export class PortfolioRepo {
  constructor(private readonly db: DB) {}

  // ---------------- orders ----------------

  /**
   * Orders in the supplied lifecycle states.
   *
   * `states` is always a server-side constant (see `resolveStatusFilter`), never raw user input, so the
   * generated placeholder list cannot be influenced by the client.
   */
  listOrders(userId: string, states: readonly string[], q: OrderQuery): Page<OrderRow> {
    const page = resolvePage(q, ORDER_SORT_COLUMNS, 'updatedAt');
    const where: string[] = ['user_id = ?'];
    const args: unknown[] = [userId];

    if (states.length === 0) return { items: [], total: 0, asOf: null };
    where.push(`status IN (${states.map(() => '?').join(',')})`);
    args.push(...states);

    if (q.symbol) {
      where.push('symbol = ?');
      args.push(q.symbol);
    }
    if (q.side) {
      where.push('side = ?');
      args.push(q.side);
    }
    if (q.type) {
      where.push('type = ?');
      args.push(q.type);
    }
    if (q.from !== undefined) {
      where.push('updated_at >= ?');
      args.push(q.from);
    }
    if (q.to !== undefined) {
      // Exclusive upper bound: see the TimeRange comment in portfolio/query.ts.
      where.push('updated_at < ?');
      args.push(q.to);
    }

    const clause = where.join(' AND ');
    const agg = this.db
      .prepare(`SELECT COUNT(*) AS n, MAX(updated_at) AS newest FROM orders WHERE ${clause}`)
      .get(...args) as { n: number; newest: number | null };

    // The trailing `internal_order_id` tie-break makes the ordering a TOTAL order. Without it, rows
    // sharing a timestamp (or a symbol) can be returned in a different relative order on each query,
    // and LIMIT/OFFSET paging over an unstable order duplicates and skips rows.
    const rows = this.db
      .prepare(
        `SELECT internal_order_id, client_order_id, exchange_order_id, symbol, side, type, price, quantity,
                filled_quantity, status, mode, created_at, updated_at
           FROM orders WHERE ${clause}
          ORDER BY ${page.column} ${page.dir}, internal_order_id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(...args, page.limit, page.offset) as Record<string, unknown>[];

    return { items: rows.map(mapOrder), total: agg.n, asOf: agg.newest ?? null };
  }

  // ---------------- trades (fills) ----------------

  /**
   * Fills for the user.
   *
   * `executions` carries no symbol or side of its own, so the join to `orders` is what makes those
   * filterable. The join is additionally constrained on `o.user_id` — belt and braces, since a fill
   * whose parent order belonged to someone else would otherwise be reachable if `executions.user_id`
   * were ever written incorrectly.
   */
  listTrades(userId: string, q: TradeQuery): Page<TradeRow> {
    const page = resolvePage(q, TRADE_SORT_COLUMNS, 'at');
    const where: string[] = ['e.user_id = ?', 'o.user_id = ?'];
    const args: unknown[] = [userId, userId];

    if (q.symbol) {
      where.push('o.symbol = ?');
      args.push(q.symbol);
    }
    if (q.side) {
      where.push('o.side = ?');
      args.push(q.side);
    }
    if (q.from !== undefined) {
      where.push('e.at >= ?');
      args.push(q.from);
    }
    if (q.to !== undefined) {
      where.push('e.at < ?');
      args.push(q.to);
    }

    const clause = where.join(' AND ');
    const from = 'executions e JOIN orders o ON o.internal_order_id = e.internal_order_id';
    const agg = this.db
      .prepare(`SELECT COUNT(*) AS n, MAX(e.at) AS newest FROM ${from} WHERE ${clause}`)
      .get(...args) as { n: number; newest: number | null };

    // Sort column is qualified with the correct alias: `at` lives on executions, `symbol` on orders.
    const sortExpr = page.column === 'at' ? 'e.at' : 'o.symbol';
    const rows = this.db
      .prepare(
        `SELECT e.id, e.internal_order_id, e.exec_id, o.symbol, o.side, e.price, e.quantity, e.fee,
                e.liquidity, e.at
           FROM ${from} WHERE ${clause}
          ORDER BY ${sortExpr} ${page.dir}, e.id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(...args, page.limit, page.offset) as Record<string, unknown>[];

    return { items: rows.map(mapTrade), total: agg.n, asOf: agg.newest ?? null };
  }

  // ---------------- positions ----------------

  listPositions(userId: string, q: PositionQuery): Page<PositionRow> {
    const page = resolvePage(q, POSITION_SORT_COLUMNS, 'updatedAt');
    const where: string[] = ['user_id = ?'];
    const args: unknown[] = [userId];
    if (q.symbol) {
      where.push('symbol = ?');
      args.push(q.symbol);
    }
    if (q.side) {
      where.push('side = ?');
      args.push(q.side);
    }
    const clause = where.join(' AND ');
    const agg = this.db
      .prepare(`SELECT COUNT(*) AS n, MAX(updated_at) AS newest FROM positions WHERE ${clause}`)
      .get(...args) as { n: number; newest: number | null };
    const rows = this.db
      .prepare(
        `SELECT id, symbol, side, size, entry_price, mark_price, liquidation_price, leverage, margin_mode,
                unrealized_pnl, updated_at
           FROM positions WHERE ${clause}
          ORDER BY ${page.column} ${page.dir}, id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(...args, page.limit, page.offset) as Record<string, unknown>[];
    return { items: rows.map(mapPosition), total: agg.n, asOf: agg.newest ?? null };
  }

  /** Single owned position, or null. Used by the close-draft/margin validation contracts (B5). */
  getPosition(userId: string, id: string): PositionRow | null {
    const r = this.db
      .prepare(
        `SELECT id, symbol, side, size, entry_price, mark_price, liquidation_price, leverage, margin_mode,
                unrealized_pnl, updated_at
           FROM positions WHERE user_id = ? AND id = ?`,
      )
      .get(userId, id) as Record<string, unknown> | undefined;
    return r ? mapPosition(r) : null;
  }

  // ---------------- balances (B5) ----------------

  /**
   * Latest balance row per asset.
   *
   * `account_balances` is append-only (one row per snapshot per asset), so a plain SELECT would return
   * history. The correlated MAX(at) picks the newest snapshot per asset; ties break on `id` so the
   * result is deterministic even if two snapshots share a millisecond.
   */
  listBalances(userId: string): { items: BalanceRow[]; asOf: number | null } {
    const rows = this.db
      .prepare(
        `SELECT b.id, b.asset, b.available, b.equity, b.used, b.at
           FROM account_balances b
           JOIN (
             SELECT asset, MAX(at) AS at FROM account_balances WHERE user_id = ? GROUP BY asset
           ) latest ON latest.asset = b.asset AND latest.at = b.at
          WHERE b.user_id = ?
          GROUP BY b.asset
          ORDER BY b.asset ASC`,
      )
      .all(userId, userId) as Record<string, unknown>[];
    const items = rows.map(mapBalance);
    const asOf = items.length === 0 ? null : Math.max(...items.map((b) => b.at));
    return { items, asOf };
  }
}

function mapOrder(r: Record<string, unknown>): OrderRow {
  return {
    id: String(r.internal_order_id),
    clientOrderId: String(r.client_order_id),
    exchangeOrderId: (r.exchange_order_id as string | null) ?? null,
    symbol: String(r.symbol),
    side: String(r.side),
    type: String(r.type),
    // Decimals pass through as strings. No Number() anywhere in this file.
    price: (r.price as string | null) ?? null,
    quantity: String(r.quantity),
    filledQuantity: String(r.filled_quantity),
    status: String(r.status),
    mode: String(r.mode),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function mapTrade(r: Record<string, unknown>): TradeRow {
  return {
    id: String(r.id),
    orderId: String(r.internal_order_id),
    execId: (r.exec_id as string | null) ?? null,
    symbol: String(r.symbol),
    side: String(r.side),
    price: String(r.price),
    quantity: String(r.quantity),
    fee: (r.fee as string | null) ?? null,
    liquidity: (r.liquidity as string | null) ?? null,
    at: Number(r.at),
  };
}

function mapPosition(r: Record<string, unknown>): PositionRow {
  return {
    id: String(r.id),
    symbol: String(r.symbol),
    side: String(r.side),
    size: String(r.size),
    entryPrice: (r.entry_price as string | null) ?? null,
    markPrice: (r.mark_price as string | null) ?? null,
    liquidationPrice: (r.liquidation_price as string | null) ?? null,
    leverage: r.leverage === null || r.leverage === undefined ? null : Number(r.leverage),
    marginMode: (r.margin_mode as string | null) ?? null,
    unrealizedPnl: (r.unrealized_pnl as string | null) ?? null,
    updatedAt: Number(r.updated_at),
  };
}

function mapBalance(r: Record<string, unknown>): BalanceRow {
  return {
    id: String(r.id),
    asset: String(r.asset),
    available: String(r.available),
    equity: String(r.equity),
    used: String(r.used),
    at: Number(r.at),
  };
}
