import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { openDb } from '../db/sqlite';
import { ResourceRepo } from '../db/resource-repo';
import { createPool, migrateUp, migrateDown } from '../db/pg';
import { SqliteFavoritesRepo, PgFavoritesRepo, type IFavoritesRepo, MAX_FAVORITES } from '../db/favorites-repo';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';

/**
 * R5 — the repository CONTRACT is backend-agnostic. This one suite runs the same behavioural assertions
 * against BOTH the SQLite (dev) and PostgreSQL (prod) implementation — proof that a production cutover to
 * PostgreSQL preserves behaviour. SQLite always runs; PostgreSQL runs when PG_TEST_URL is set (ephemeral
 * container). Never touches RDS.
 */

const PG_URL = process.env.PG_TEST_URL;

function contract(
  name: string,
  setup: () => Promise<{ repo: IFavoritesRepo; mkUser: () => Promise<string>; cleanup?: () => Promise<void> }>,
) {
  describe(`IFavoritesRepo contract — ${name}`, () => {
    let repo: IFavoritesRepo;
    let mkUser: () => Promise<string>;
    let cleanup: (() => Promise<void>) | undefined;
    beforeAll(async () => {
      const s = await setup();
      repo = s.repo;
      mkUser = s.mkUser;
      cleanup = s.cleanup;
    });
    afterAll(async () => {
      if (cleanup) await cleanup();
    });

    it('starts empty at version 0', async () => {
      const u = await mkUser();
      expect(await repo.list(u)).toEqual({ symbols: [], version: 0, updatedAt: null });
    });

    it('persists order, de-duplicates and normalizes case; version increments', async () => {
      const u = await mkUser();
      const r = await repo.replace(u, ['btcusdt', 'ETHUSDT', 'btcusdt ', ' ethusdt']);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
      expect(r.version).toBe(1);
      const list = await repo.list(u);
      expect(list.symbols).toEqual(['BTCUSDT', 'ETHUSDT']);
      expect(list.version).toBe(1);
    });

    it('optimistic version: a stale If-Match is a conflict, not a clobber', async () => {
      const u = await mkUser();
      await repo.replace(u, ['BTCUSDT']);
      const stale = await repo.replace(u, ['ETHUSDT'], 0);
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.reason).toBe('conflict');
      expect(stale.currentVersion).toBe(1);
      expect((await repo.list(u)).symbols).toEqual(['BTCUSDT']);
      const ok = await repo.replace(u, ['ETHUSDT'], 1);
      expect(ok.ok).toBe(true);
    });

    it('ownership isolation: one user never sees or overwrites another set', async () => {
      const a = await mkUser();
      const b = await mkUser();
      await repo.replace(a, ['BTCUSDT']);
      await repo.replace(b, ['XRPUSDT', 'SOLUSDT']);
      expect((await repo.list(a)).symbols).toEqual(['BTCUSDT']);
      expect((await repo.list(b)).symbols).toEqual(['XRPUSDT', 'SOLUSDT']);
    });

    it('enforces the max-favourites cap', async () => {
      const u = await mkUser();
      const tooMany = Array.from({ length: MAX_FAVORITES + 1 }, (_, i) => `SYM${i}`);
      const r = await repo.replace(u, tooMany);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.reason).toBe('tooMany');
    });
  });
}

contract('SQLite', async () => {
  const db = openDb(':memory:');
  const resource = new ResourceRepo(db);
  let seq = 0;
  const mkUser = async () => {
    const id = `u-${++seq}-${randomUUID().slice(0, 8)}`;
    db.prepare("INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,'active',1,1)").run(
      id,
      `${id}@ex.com`,
      'x',
      'USER',
    );
    return id;
  };
  return { repo: new SqliteFavoritesRepo(resource), mkUser };
});

if (PG_URL) {
  contract('PostgreSQL', async () => {
    // Dedicated database: this suite migrates down/up, so it must not share a schema with another suite.
    const pool: Pool = createPool(await createIsolatedTestDatabase(PG_URL, 'favorites_contract'));
    await migrateDown(pool).catch(() => {});
    await migrateUp(pool);
    const mkUser = async () => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES ($1,$2,'x','USER','active',now(),now())",
        [id, `${id}@ex.com`],
      );
      return id;
    };
    return { repo: new PgFavoritesRepo(pool), mkUser, cleanup: async () => { await pool.end(); } };
  });
}
