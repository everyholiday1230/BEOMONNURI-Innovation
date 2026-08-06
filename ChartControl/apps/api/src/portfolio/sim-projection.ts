import { randomUUID } from 'node:crypto';
import { D } from '@quantumtrade/domain';
import type { DB } from '../db/sqlite';

/**
 * Projection of a SIMULATED order onto the durable trading tables.
 *
 * Why this exists: the simulation engine kept confirmed orders in a process-global `Map`. That has two
 * consequences the read model cannot live with — the list is shared by every caller (so it can never be
 * user-scoped) and it disappears on restart (so "persistence" would be a claim with nothing behind it).
 *
 * What this is NOT: an order submission path. Nothing here contacts an exchange. Every row is written
 * with `mode = 'MOCK'`, which is what `/api/orders/*` reports as `source: MOCK`, so a simulated fill can
 * never be mistaken for a real one at any layer.
 *
 * Projection only happens for an AUTHENTICATED caller, because a row in these tables must belong to a
 * user. Anonymous simulation keeps its previous in-memory behaviour.
 */

export interface SimulatedOrderInput {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: string;
  orderType: string;
  price?: string;
  quantity: string;
  filledQuantity?: string;
  leverage?: number;
  marginMode?: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  events?: { fromState: string | null; toState: string; actor: string; at: number }[];
}

export class SimOrderProjection {
  constructor(private readonly db: DB) {}

  /**
   * Write the order, its fills and the resulting position in ONE transaction.
   *
   * A partial projection would be worse than none: an order row with no fill, or a fill with no
   * position, is a read model that contradicts itself.
   */
  project(userId: string, o: SimulatedOrderInput): { ok: boolean; orderId: string } {
    const tx = this.db.transaction(() => {
      const internalId = o.id;
      // The (user_id, client_order_id) UNIQUE constraint is what makes a duplicate confirm a no-op at
      // the DATA layer rather than relying on the caller checking first.
      const existing = this.db
        .prepare('SELECT internal_order_id FROM orders WHERE user_id=? AND client_order_id=?')
        .get(userId, o.clientOrderId) as { internal_order_id: string } | undefined;
      if (existing) return { ok: false, orderId: existing.internal_order_id };

      this.db
        .prepare(
          `INSERT INTO orders (internal_order_id,user_id,client_order_id,symbol,side,type,price,quantity,
                               filled_quantity,status,mode,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,'MOCK',?,?)`,
        )
        .run(
          internalId,
          userId,
          o.clientOrderId,
          o.symbol,
          o.side,
          o.orderType,
          o.price ?? null,
          o.quantity,
          o.filledQuantity ?? '0',
          o.status,
          o.createdAt,
          o.updatedAt,
        );

      // Lifecycle transitions are recorded as order events so the history tab can show provenance of
      // the state, not just its current value.
      for (const [i, e] of (o.events ?? []).entries()) {
        this.db
          .prepare(
            'INSERT INTO order_events (id,internal_order_id,user_id,from_state,to_state,actor,seq,at,meta) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .run(randomUUID(), internalId, userId, e.fromState, e.toState, e.actor, i, e.at, null);
      }

      // A fill row is written only for a transition that actually filled. An order that was accepted but
      // never filled must produce NO trade row — inventing one would make the trade history a fiction.
      const fills = (o.events ?? []).filter((e) => e.toState === 'FILLED' || e.toState === 'PARTIALLY_FILLED');
      for (const [i, e] of fills.entries()) {
        this.db
          .prepare(
            'INSERT INTO executions (id,internal_order_id,user_id,exec_id,price,quantity,fee,liquidity,at) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .run(
            randomUUID(),
            internalId,
            userId,
            `${internalId}-${i}`,
            o.price ?? '0',
            o.filledQuantity ?? o.quantity,
            null, // fee is unknown for a simulated fill; null says so rather than guessing 0
            'taker',
            e.at,
          );
      }

      if (o.status === 'FILLED' || o.status === 'PARTIALLY_FILLED') {
        this.upsertPosition(userId, o);
      }
      return { ok: true, orderId: internalId };
    });
    return tx();
  }

  /**
   * Accumulate the fill into the (user, symbol, side) position.
   *
   * Size and entry price are combined with decimal arithmetic: a volume-weighted average entry computed
   * in floating point drifts on every fill, and the drift is visible in the PnL column.
   */
  private upsertPosition(userId: string, o: SimulatedOrderInput): void {
    const qty = D(o.filledQuantity ?? o.quantity);
    if (qty.isZero()) return;
    const px = o.price === undefined ? null : D(o.price);
    const existing = this.db
      .prepare('SELECT id, size, entry_price FROM positions WHERE user_id=? AND symbol=? AND side=?')
      .get(userId, o.symbol, o.side) as { id: string; size: string; entry_price: string | null } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO positions (id,user_id,symbol,side,size,entry_price,mark_price,liquidation_price,
                                  leverage,margin_mode,unrealized_pnl,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          randomUUID(),
          userId,
          o.symbol,
          o.side,
          qty.toString(),
          px === null ? null : px.toString(),
          // Mark price and unrealized PnL come from a live feed this deployment does not have. NULL is
          // the honest value; the read model reports them as unavailable rather than as zero.
          null,
          null,
          o.leverage ?? null,
          o.marginMode ?? null,
          null,
          o.updatedAt,
        );
      return;
    }

    const prevSize = D(existing.size);
    const newSize = prevSize.plus(qty);
    let entry: string | null = existing.entry_price;
    if (px !== null && !newSize.isZero()) {
      const prevEntry = existing.entry_price === null ? px : D(existing.entry_price);
      entry = prevEntry.mul(prevSize).plus(px.mul(qty)).div(newSize).toString();
    }
    this.db
      .prepare('UPDATE positions SET size=?, entry_price=?, leverage=COALESCE(?,leverage), margin_mode=COALESCE(?,margin_mode), updated_at=? WHERE id=?')
      .run(newSize.toString(), entry, o.leverage ?? null, o.marginMode ?? null, o.updatedAt, existing.id);
  }
}
