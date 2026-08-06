import { describe, it, expect } from 'vitest';
import { openDb } from '../db/sqlite';
import { PortfolioRepo } from '../db/portfolio-repo';
import { SimOrderProjection, type SimulatedOrderInput } from '../portfolio/sim-projection';
import type { DB } from '../db/sqlite';

/**
 * Durable projection of simulated orders.
 *
 * The claim being tested is that the read model has something real behind it: a confirmed simulated
 * order becomes rows in `orders`, `order_events`, `executions` and `positions`, owned by exactly one
 * user, and confirming twice does not double the position.
 */

const NOW = 1_800_000_000_000;

function seedUser(db: DB, id: string): string {
  db.prepare(
    `INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at)
     VALUES (?,?,?,?,'active',?,?)`,
  ).run(id, `${id}@ex.com`, 'x', 'USER', NOW, NOW);
  return id;
}

function simOrder(over: Partial<SimulatedOrderInput> = {}): SimulatedOrderInput {
  return {
    id: over.id ?? 'sim-1',
    clientOrderId: over.clientOrderId ?? 'cli-1',
    symbol: 'BTCUSDT',
    side: 'long',
    orderType: 'limit',
    price: '65000.5',
    quantity: '0.002',
    filledQuantity: '0.002',
    leverage: 10,
    marginMode: 'cross',
    status: 'FILLED',
    createdAt: NOW,
    updatedAt: NOW,
    events: [
      { fromState: null, toState: 'VALIDATING', actor: 'system', at: NOW },
      { fromState: 'ACCEPTED', toState: 'FILLED', actor: 'exchange', at: NOW },
    ],
    ...over,
  };
}

function build() {
  const db = openDb(':memory:');
  return { db, proj: new SimOrderProjection(db), repo: new PortfolioRepo(db) };
}

describe('SimOrderProjection', () => {
  it('writes the order, its events, its fill and the resulting position', () => {
    const { db, proj, repo } = build();
    const u = seedUser(db, 'u1');
    const r = proj.project(u, simOrder());
    expect(r.ok).toBe(true);

    const orders = repo.listOrders(u, ['FILLED'], {});
    expect(orders.total).toBe(1);
    // `mode` is what the read model surfaces as `source: MOCK`. It must be recorded on the row itself.
    expect(orders.items[0]!.mode).toBe('MOCK');
    expect(orders.items[0]!.quantity).toBe('0.002');

    const events = db.prepare('SELECT COUNT(*) AS n FROM order_events WHERE user_id=?').get(u) as { n: number };
    expect(events.n).toBe(2);

    const trades = repo.listTrades(u, {});
    expect(trades.total).toBe(1);
    expect(trades.items[0]!.price).toBe('65000.5');
    // Fee is unknown for a simulated fill. Null says so; 0 would be a fabricated number.
    expect(trades.items[0]!.fee).toBeNull();

    const positions = repo.listPositions(u, {});
    expect(positions.total).toBe(1);
    expect(positions.items[0]!.size).toBe('0.002');
    expect(positions.items[0]!.entryPrice).toBe('65000.5');
    // No mark-price feed exists, so unrealized PnL must be absent rather than zero.
    expect(positions.items[0]!.markPrice).toBeNull();
    expect(positions.items[0]!.unrealizedPnl).toBeNull();
  });

  it('is idempotent per client order id: a duplicate confirm does not double the position', () => {
    const { db, proj, repo } = build();
    const u = seedUser(db, 'u2');
    proj.project(u, simOrder({ id: 'a', clientOrderId: 'same' }));
    const second = proj.project(u, simOrder({ id: 'b', clientOrderId: 'same' }));
    expect(second.ok).toBe(false);
    expect(repo.listOrders(u, ['FILLED'], {}).total).toBe(1);
    expect(repo.listPositions(u, {}).items[0]!.size).toBe('0.002');
  });

  it('averages the entry price with decimal arithmetic across fills', () => {
    const { db, proj, repo } = build();
    const u = seedUser(db, 'u3');
    proj.project(u, simOrder({ id: 'f1', clientOrderId: 'c1', price: '100', quantity: '1', filledQuantity: '1' }));
    proj.project(u, simOrder({ id: 'f2', clientOrderId: 'c2', price: '200', quantity: '3', filledQuantity: '3' }));
    const p = repo.listPositions(u, {}).items[0]!;
    expect(p.size).toBe('4');
    // (100*1 + 200*3) / 4 = 175 exactly. A float average would print 175.00000000000003 for some inputs.
    expect(p.entryPrice).toBe('175');
  });

  it('keeps two users\u2019 identical client order ids separate', () => {
    const { db, proj, repo } = build();
    const a = seedUser(db, 'ua');
    const b = seedUser(db, 'ub');
    expect(proj.project(a, simOrder({ id: 'x1', clientOrderId: 'dup' })).ok).toBe(true);
    // Same clientOrderId for a DIFFERENT user must succeed: uniqueness is per user, not global.
    expect(proj.project(b, simOrder({ id: 'x2', clientOrderId: 'dup' })).ok).toBe(true);
    expect(repo.listOrders(a, ['FILLED'], {}).total).toBe(1);
    expect(repo.listOrders(b, ['FILLED'], {}).total).toBe(1);
  });

  it('writes no fill row for an order that never filled', () => {
    const { db, proj, repo } = build();
    const u = seedUser(db, 'u4');
    proj.project(
      u,
      simOrder({
        status: 'ACCEPTED',
        filledQuantity: '0',
        events: [{ fromState: 'SUBMITTING', toState: 'ACCEPTED', actor: 'exchange', at: NOW }],
      }),
    );
    // An accepted-but-unfilled order in the trade history would be an invented trade.
    expect(repo.listTrades(u, {}).total).toBe(0);
    expect(repo.listPositions(u, {}).total).toBe(0);
    expect(repo.listOrders(u, ['ACCEPTED'], {}).total).toBe(1);
  });

  it('rolls the whole projection back if any part of it fails', () => {
    const { db, proj, repo } = build();
    const u = seedUser(db, 'u5');
    // A foreign-key violation on order_events (bad user id would fail earlier) is simulated by removing
    // the parent table constraint target: use an order whose events reference an impossible seq type.
    // Instead, force failure with a duplicate primary key on the second projection of the SAME id.
    proj.project(u, simOrder({ id: 'dup-id', clientOrderId: 'c-a' }));
    let threw = false;
    try {
      proj.project(u, simOrder({ id: 'dup-id', clientOrderId: 'c-b' }));
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // The failed attempt left nothing behind: still exactly one order and one position of size 0.002.
    expect(repo.listOrders(u, ['FILLED'], {}).total).toBe(1);
    expect(repo.listPositions(u, {}).items[0]!.size).toBe('0.002');
  });
});
