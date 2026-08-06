import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { openDb } from '../db/sqlite';
import { ResourceRepo } from '../db/resource-repo';
import { createPool, migrateUp, migrateDown } from '../db/pg';
import { SqlitePreferencesRepo, PgPreferencesRepo, type IPreferencesRepo } from '../db/preferences-repo';
import {
  SqliteNotificationRepo,
  PgNotificationRepo,
  type INotificationRepo,
} from '../db/notification-repo';
import { SqliteOrderDraftRepo, PgOrderDraftRepo, type IOrderDraftRepo } from '../db/order-draft-repo';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';

/**
 * BATCH_2 / BL-10 — the user/trading repository CONTRACTS are backend-agnostic. Each suite runs the SAME
 * behavioural assertions against BOTH the SQLite (dev) and PostgreSQL (prod) implementation, proving a
 * production cutover preserves behaviour: partial-patch + optimistic version (preferences), ownership +
 * idempotent read-state + unread count (notifications), idempotency-key replay + user isolation + the
 * always-false `executable` invariant (order drafts). SQLite always runs; PostgreSQL runs when
 * PG_TEST_URL is set (ephemeral container). Never touches RDS.
 */

const PG_URL = process.env.PG_TEST_URL;

type Ctx<R> = { repo: R; mkUser: () => Promise<string>; cleanup?: () => Promise<void> };

function sqliteHarness() {
  const db = openDb(':memory:');
  let seq = 0;
  const mkUser = async () => {
    const id = `u-${++seq}-${randomUUID().slice(0, 8)}`;
    db.prepare(
      "INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,'active',1,1)",
    ).run(id, `${id}@ex.com`, 'x', 'USER');
    return id;
  };
  return { db, mkUser };
}

async function pgHarness(suite: string): Promise<{ pool: Pool; mkUser: () => Promise<string> }> {
  const pool = createPool(await createIsolatedTestDatabase(PG_URL!, suite));
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
  return { pool, mkUser };
}

/* ─────────────────────────── Preferences ─────────────────────────── */
function preferencesContract(name: string, setup: () => Promise<Ctx<IPreferencesRepo>>) {
  describe(`IPreferencesRepo contract — ${name}`, () => {
    let repo: IPreferencesRepo;
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
      expect(await repo.get(u)).toBeNull();
    });

    it('a partial patch does not erase other keys; version increments', async () => {
      const u = await mkUser();
      const r1 = await repo.upsert(u, { theme: 'dark', locale: 'ko' });
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;
      expect(r1.version).toBe(1);
      // Patch only theme — locale must survive.
      const r2 = await repo.upsert(u, { theme: 'light' });
      expect(r2.ok).toBe(true);
      const got = await repo.get(u);
      expect(got?.theme).toBe('light');
      expect(got?.locale).toBe('ko');
      expect(got?.version).toBe(2);
    });

    it('optimistic version: a stale If-Match is a conflict, not a clobber', async () => {
      const u = await mkUser();
      await repo.upsert(u, { theme: 'dark' });
      const stale = await repo.upsert(u, { theme: 'light' }, 0);
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.reason).toBe('conflict');
      expect(stale.currentVersion).toBe(1);
      expect((await repo.get(u))?.theme).toBe('dark');
      const ok = await repo.upsert(u, { theme: 'light' }, 1);
      expect(ok.ok).toBe(true);
    });

    it('ownership isolation: one user never sees another set', async () => {
      const a = await mkUser();
      const b = await mkUser();
      await repo.upsert(a, { theme: 'dark' });
      await repo.upsert(b, { theme: 'light' });
      expect((await repo.get(a))?.theme).toBe('dark');
      expect((await repo.get(b))?.theme).toBe('light');
    });
  });
}

/* ─────────────────────────── Notifications ─────────────────────────── */
function notificationContract(name: string, setup: () => Promise<Ctx<INotificationRepo>>) {
  describe(`INotificationRepo contract — ${name}`, () => {
    let repo: INotificationRepo;
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

    it('persists per user with an accurate unread count', async () => {
      const u = await mkUser();
      await repo.create({ userId: u, type: 'system', severity: 'info', message: 'a' });
      await repo.create({ userId: u, type: 'risk_alert', severity: 'critical', message: 'b' });
      const page = await repo.list(u);
      expect(page.total).toBe(2);
      expect(page.unreadCount).toBe(2);
      expect(page.items.map((i) => i.message).sort()).toEqual(['a', 'b']);
    });

    it('mark-read is idempotent and preserves the first readAt', async () => {
      const u = await mkUser();
      const n = await repo.create({ userId: u, type: 'system', severity: 'info', message: 'x' });
      const first = await repo.markRead(u, n.id, 1000);
      expect(first).toEqual({ found: true, changed: true });
      const again = await repo.markRead(u, n.id, 2000);
      expect(again).toEqual({ found: true, changed: false });
      const page = await repo.list(u);
      expect(page.unreadCount).toBe(0);
      expect(page.items[0]!.readAt).toBe(1000);
    });

    it('ownership: another user cannot read or mark my notification', async () => {
      const a = await mkUser();
      const b = await mkUser();
      const n = await repo.create({ userId: a, type: 'system', severity: 'info', message: 'a-only' });
      expect(await repo.markRead(b, n.id, 1)).toEqual({ found: false, changed: false });
      expect((await repo.list(b)).total).toBe(0);
    });

    it('rejects an unsupported type or severity at the data layer', async () => {
      const u = await mkUser();
      await expect(
        repo.create({ userId: u, type: 'nope' as 'system', severity: 'info', message: 'x' }),
      ).rejects.toThrow();
    });
  });
}

/* ─────────────────────────── Order drafts ─────────────────────────── */
function orderDraftContract(name: string, setup: () => Promise<Ctx<IOrderDraftRepo>>) {
  describe(`IOrderDraftRepo contract — ${name}`, () => {
    let repo: IOrderDraftRepo;
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

    it('creates a draft that is NEVER executable and records the verdict', async () => {
      const u = await mkUser();
      const { row, replayed } = await repo.create({
        userId: u,
        symbol: 'BTCUSDT',
        side: 'long',
        idempotencyKey: 'k1',
        valid: true,
        allowed: true,
        data: { intent: { symbol: 'BTCUSDT' } },
      });
      expect(replayed).toBe(false);
      expect(row.executable).toBe(false);
      expect(row.valid).toBe(true);
      expect(row.allowed).toBe(true);
      expect(row.source).toBe('MOCK');
    });

    it('idempotency key: a retry returns the stored row (no second draft)', async () => {
      const u = await mkUser();
      const a = await repo.create({ userId: u, symbol: 'ETHUSDT', side: 'short', idempotencyKey: 'dup', valid: true, allowed: false, data: {} });
      const b = await repo.create({ userId: u, symbol: 'ETHUSDT', side: 'short', idempotencyKey: 'dup', valid: false, allowed: true, data: {} });
      expect(a.replayed).toBe(false);
      expect(b.replayed).toBe(true);
      expect(b.row.id).toBe(a.row.id);
      // The stored verdict wins over the retry's — proof the retry did not re-run validation.
      expect(b.row.valid).toBe(true);
      expect(b.row.allowed).toBe(false);
      const list = await repo.listOwned(u);
      expect(list.total).toBe(1);
    });

    it('ownership: a draft belonging to another user is not found', async () => {
      const a = await mkUser();
      const b = await mkUser();
      const { row } = await repo.create({ userId: a, symbol: 'BTCUSDT', side: 'long', idempotencyKey: 'own', valid: true, allowed: true, data: {} });
      expect(await repo.getOwned(b, row.id)).toBeNull();
      expect((await repo.listOwned(b)).total).toBe(0);
    });

    it('round-trips the JSON data payload', async () => {
      const u = await mkUser();
      const payload = { intent: { symbol: 'BTCUSDT', qty: '0.5' }, nested: { a: [1, 2, 3] } };
      const { row } = await repo.create({ userId: u, symbol: 'BTCUSDT', side: 'long', idempotencyKey: 'json', valid: true, allowed: true, data: payload });
      const got = await repo.getOwned(u, row.id);
      expect(got?.data).toEqual(payload);
    });
  });
}

/* ─────────────────────────── SQLite (always) ─────────────────────────── */
preferencesContract('SQLite', async () => {
  const { db, mkUser } = sqliteHarness();
  return { repo: new SqlitePreferencesRepo(new ResourceRepo(db)), mkUser };
});
notificationContract('SQLite', async () => {
  const { db, mkUser } = sqliteHarness();
  return { repo: new SqliteNotificationRepo(db), mkUser };
});
orderDraftContract('SQLite', async () => {
  const { db, mkUser } = sqliteHarness();
  return { repo: new SqliteOrderDraftRepo(db), mkUser };
});

/* ─────────────────────────── PostgreSQL (PG_TEST_URL) ─────────────────────────── */
if (PG_URL) {
  preferencesContract('PostgreSQL', async () => {
    const { pool, mkUser } = await pgHarness('preferences_contract');
    return { repo: new PgPreferencesRepo(pool), mkUser, cleanup: async () => { await pool.end(); } };
  });
  notificationContract('PostgreSQL', async () => {
    const { pool, mkUser } = await pgHarness('notifications_contract');
    return { repo: new PgNotificationRepo(pool), mkUser, cleanup: async () => { await pool.end(); } };
  });
  orderDraftContract('PostgreSQL', async () => {
    const { pool, mkUser } = await pgHarness('order_drafts_contract');
    return { repo: new PgOrderDraftRepo(pool), mkUser, cleanup: async () => { await pool.end(); } };
  });
}
