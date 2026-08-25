import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createPool, migrateUp } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { PgSavedItemRepo } from '../db/saved-item-repo';

const PG_URL = process.env.PG_TEST_URL;
const d = PG_URL ? describe : describe.skip;

d('PgSavedItemRepo', () => {
  let pool: Pool;
  let repo: PgSavedItemRepo;

  const makeUser = async (): Promise<string> => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at)
       VALUES ($1, $2, 'x', 'user', 'active', now(), now())`,
      [id, `saved_${id.slice(0, 8)}@saved-test.local`],
    );
    return id;
  };

  beforeAll(async () => {
    pool = createPool(await createIsolatedTestDatabase(PG_URL!, 'saved_items'));
    await migrateUp(pool);
    repo = new PgSavedItemRepo(pool);
  });
  afterAll(async () => { if (pool) await pool.end(); });

  it('saves, lists (filtered by kind), and preserves the JSON payload', async () => {
    const userId = await makeUser();
    const sig = await repo.create({ userId, kind: 'signal', name: 'My BTC long', symbol: 'BTCUSDT', timeframe: '15m', payload: { direction: 'long', entry: '65000', tp: ['68000'] } });
    await repo.create({ userId, kind: 'indicator', name: 'RSI+MA', payload: { indicators: ['RSI', 'MA'], params: { rsi: 14 } } });

    const all = await repo.listForUser(userId);
    expect(all).toHaveLength(2);
    const signals = await repo.listForUser(userId, 'signal');
    expect(signals).toHaveLength(1);
    expect((signals[0]!.payload as { direction: string }).direction).toBe('long');
    expect(signals[0]!.symbol).toBe('BTCUSDT');
    expect(sig.id).toBeTruthy();
  });

  it('isolates by user and deletes only own items', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const itemA = await repo.create({ userId: a, kind: 'drawing', name: 'trend', payload: { points: [] } });

    // b cannot see or delete a's item
    expect(await repo.getOwned(b, itemA.id)).toBeNull();
    expect(await repo.remove(b, itemA.id)).toBe(false);
    // a can
    expect(await repo.getOwned(a, itemA.id)).not.toBeNull();
    expect(await repo.remove(a, itemA.id)).toBe(true);
    expect(await repo.getOwned(a, itemA.id)).toBeNull();
  });
});
