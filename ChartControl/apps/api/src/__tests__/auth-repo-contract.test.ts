import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  IAuditRepository,
  ISessionRepository,
  ITokenRepository,
  IUserRepository,
  User,
} from '@quantumtrade/auth';
import { openDb } from '../db/sqlite';
import { createPool, migrateDown, migrateUp } from '../db/pg';
import { SqliteAuditRepository, SqliteSessionRepository, SqliteTokenRepository, SqliteUserRepository } from '../db/repos';
import { PgAuditRepository, PgSessionRepository, PgTokenRepository, PgUserRepository } from '../db/pg-repos';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';

/**
 * BATCH_1 — one contract suite for the AUTH repositories (users, sessions, auth audit, single-use
 * verification/reset tokens) against SQLite and PostgreSQL.
 *
 * `PgUserRepository` / `PgSessionRepository` / `PgAuditRepository` existed but were never wired or
 * contract-tested against the SQLite behaviour; `PgTokenRepository` is new in this batch. This suite is
 * what makes the factory's production branch trustworthy rather than merely present.
 */

const PG_URL = process.env.PG_TEST_URL;

interface Harness {
  users: IUserRepository;
  sessions: ISessionRepository;
  audit: IAuditRepository;
  emailTokens: ITokenRepository;
  resetTokens: ITokenRepository;
  /** Fresh instances over the same store — the "restart" case. */
  reopen: () => Promise<Pick<Harness, 'users' | 'sessions' | 'emailTokens'>>;
  cleanup?: () => Promise<void>;
}

const mkUser = (over: Partial<User> = {}): User => {
  const t = Date.now();
  const id = randomUUID();
  return {
    id,
    email: `${id}@example.com`,
    passwordHash: 'argon2id$fake$hash',
    role: 'user',
    status: 'active',
    mfaEnabled: false,
    emailVerified: false,
    createdAt: t,
    updatedAt: t,
    ...over,
  };
};

function contract(name: string, setup: () => Promise<Harness>) {
  describe(`BATCH_1 auth repository contract — ${name}`, () => {
    let h: Harness;
    beforeAll(async () => { h = await setup(); });
    afterAll(async () => { if (h?.cleanup) await h.cleanup(); });

    // ---------------- users ----------------
    it('creates and reads a user by id and by (case-insensitive) e-mail', async () => {
      const u = mkUser({ email: `Mixed-${randomUUID()}@Example.COM`.toLowerCase() });
      await h.users.create(u);
      expect((await h.users.findById(u.id))!.email).toBe(u.email);
      // Lookup normalizes the address, so a differently-cased login finds the same account.
      expect((await h.users.findByEmail(u.email.toUpperCase()))!.id).toBe(u.id);
      expect(await h.users.findByEmail(`absent-${randomUUID()}@example.com`)).toBeNull();
      expect(await h.users.findById(randomUUID())).toBeNull();
    });

    it('[UNIQUE] a duplicate e-mail is refused by the database, not just by the service', async () => {
      const first = mkUser();
      await h.users.create(first);
      await expect(h.users.create(mkUser({ email: first.email }))).rejects.toThrow();
    });

    it('role / status / password / e-mail-verified mutations persist and stay scoped to one user', async () => {
      const a = mkUser();
      const b = mkUser();
      await h.users.create(a);
      await h.users.create(b);
      await h.users.setRole(a.id, 'admin');
      await h.users.setStatus(a.id, 'disabled');
      await h.users.setPasswordHash(a.id, 'argon2id$rotated');
      await h.users.setEmailVerified(a.id, true);
      const ra = (await h.users.findById(a.id))!;
      expect([ra.role, ra.status, ra.passwordHash, ra.emailVerified]).toEqual(['admin', 'disabled', 'argon2id$rotated', true]);
      // B is untouched: no statement widened beyond its user id.
      const rb = (await h.users.findById(b.id))!;
      expect([rb.role, rb.status, rb.emailVerified]).toEqual(['user', 'active', false]);
    });

    // ---------------- sessions ----------------
    it('session create/find/expiry/list round-trips, and only the owner lists it', async () => {
      const a = mkUser();
      const b = mkUser();
      await h.users.create(a);
      await h.users.create(b);
      const now = Date.now();
      const s = { id: randomUUID(), userId: a.id, csrfSecret: 'secret-a', createdAt: now, expiresAt: now + 3_600_000, ip: '203.0.113.7', userAgent: 'vitest' };
      await h.sessions.create(s);
      const found = (await h.sessions.findById(s.id))!;
      expect(found.userId).toBe(a.id);
      expect(found.csrfSecret).toBe('secret-a');
      expect(found.expiresAt).toBe(s.expiresAt);
      expect(found.ip).toBe('203.0.113.7');
      await h.sessions.updateExpiry(s.id, now + 7_200_000);
      expect((await h.sessions.findById(s.id))!.expiresAt).toBe(now + 7_200_000);
      expect((await h.sessions.listByUser(a.id)).map((x) => x.id)).toEqual([s.id]);
      // [ownership/IDOR] another user's session list never contains it.
      expect(await h.sessions.listByUser(b.id)).toEqual([]);
    });

    it('revocation: delete, deleteOthers (rotation) and deleteByUser are all owner-scoped', async () => {
      const a = mkUser();
      const b = mkUser();
      await h.users.create(a);
      await h.users.create(b);
      const now = Date.now();
      const mk = async (userId: string) => {
        const id = randomUUID();
        await h.sessions.create({ id, userId, csrfSecret: 's', createdAt: now, expiresAt: now + 60_000 });
        return id;
      };
      const [a1, a2, a3] = [await mk(a.id), await mk(a.id), await mk(a.id)];
      const bOnly = await mk(b.id);

      await h.sessions.delete(a1);
      expect(await h.sessions.findById(a1)).toBeNull();

      // Session ROTATION keeps exactly the current session and drops the rest — for THIS user only.
      await h.sessions.deleteOthers(a.id, a2);
      expect((await h.sessions.listByUser(a.id)).map((x) => x.id)).toEqual([a2]);
      expect(await h.sessions.findById(a3)).toBeNull();
      expect(await h.sessions.findById(bOnly)).not.toBeNull();

      await h.sessions.deleteByUser(a.id);
      expect(await h.sessions.listByUser(a.id)).toEqual([]);
      // B's session survives a full revocation of A.
      expect(await h.sessions.findById(bOnly)).not.toBeNull();
    });

    it('[FK] a session for a non-existent user is rejected', async () => {
      const now = Date.now();
      await expect(
        h.sessions.create({ id: randomUUID(), userId: randomUUID(), csrfSecret: 's', createdAt: now, expiresAt: now + 1000 }),
      ).rejects.toThrow();
    });

    // ---------------- tokens ----------------
    it('single-use token: stored by HASH, found by hash, and markUsed records consumption', async () => {
      const u = mkUser();
      await h.users.create(u);
      const t = Date.now();
      const rec = { id: randomUUID(), userId: u.id, tokenHash: 'h'.repeat(64), expiresAt: t + 3_600_000, usedAt: null, createdAt: t };
      await h.emailTokens.create(rec);
      const found = (await h.emailTokens.findByHash(rec.tokenHash))!;
      expect(found.id).toBe(rec.id);
      expect(found.userId).toBe(u.id);
      expect(found.expiresAt).toBe(rec.expiresAt);
      expect(found.usedAt).toBeNull();
      await h.emailTokens.markUsed(rec.id, t + 1000);
      expect((await h.emailTokens.findByHash(rec.tokenHash))!.usedAt).toBe(t + 1000);
      expect(await h.emailTokens.findByHash('z'.repeat(64))).toBeNull();
    });

    it('[UNIQUE] the same token hash cannot be stored twice', async () => {
      const u = mkUser();
      await h.users.create(u);
      const t = Date.now();
      const hash = 'u'.repeat(64);
      await h.emailTokens.create({ id: randomUUID(), userId: u.id, tokenHash: hash, expiresAt: t + 1000, usedAt: null, createdAt: t });
      await expect(
        h.emailTokens.create({ id: randomUUID(), userId: u.id, tokenHash: hash, expiresAt: t + 1000, usedAt: null, createdAt: t }),
      ).rejects.toThrow();
    });

    it('verification and reset tokens are SEPARATE namespaces (a reset token is not a verification token)', async () => {
      const u = mkUser();
      await h.users.create(u);
      const t = Date.now();
      const hash = 'n'.repeat(64);
      await h.resetTokens.create({ id: randomUUID(), userId: u.id, tokenHash: hash, expiresAt: t + 1000, usedAt: null, createdAt: t });
      expect(await h.resetTokens.findByHash(hash)).not.toBeNull();
      // Crucial: presenting it to the other lifecycle must not authenticate anything.
      expect(await h.emailTokens.findByHash(hash)).toBeNull();
    });

    it('deleteForUser clears only that user tokens', async () => {
      const a = mkUser();
      const b = mkUser();
      await h.users.create(a);
      await h.users.create(b);
      const t = Date.now();
      const ha = 'a1'.repeat(32);
      const hb = 'b1'.repeat(32);
      await h.emailTokens.create({ id: randomUUID(), userId: a.id, tokenHash: ha, expiresAt: t + 1000, usedAt: null, createdAt: t });
      await h.emailTokens.create({ id: randomUUID(), userId: b.id, tokenHash: hb, expiresAt: t + 1000, usedAt: null, createdAt: t });
      await h.emailTokens.deleteForUser(a.id);
      expect(await h.emailTokens.findByHash(ha)).toBeNull();
      expect(await h.emailTokens.findByHash(hb)).not.toBeNull();
    });

    it('[FK] a token for a non-existent user is rejected', async () => {
      const t = Date.now();
      await expect(
        h.emailTokens.create({ id: randomUUID(), userId: randomUUID(), tokenHash: 'f'.repeat(64), expiresAt: t + 1000, usedAt: null, createdAt: t }),
      ).rejects.toThrow();
    });

    // ---------------- audit ----------------
    it('audit entries are recorded and listed newest-first with meta preserved', async () => {
      const u = mkUser();
      await h.users.create(u);
      const t = Date.now();
      await h.audit.record({ id: randomUUID(), actorUserId: u.id, action: 'auth.login', target: u.id, ip: '198.51.100.4', at: t - 2000, meta: { result: 'success' } });
      await h.audit.record({ id: randomUUID(), actorUserId: u.id, action: 'auth.logout', target: u.id, ip: '198.51.100.4', at: t, meta: { result: 'success' } });
      const list = await h.audit.list(50);
      expect(list.length).toBeGreaterThanOrEqual(2);
      const mine = list.filter((e) => e.actorUserId === u.id);
      expect(mine[0]!.action).toBe('auth.logout'); // newest first
      expect(mine[0]!.meta).toMatchObject({ result: 'success' });
      expect(list.every((e) => e.at <= list[0]!.at)).toBe(true);
    });

    it('[concurrent] parallel session writes for one user all land', async () => {
      const u = mkUser();
      await h.users.create(u);
      const now = Date.now();
      const ids = Array.from({ length: 8 }, () => randomUUID());
      const results = await Promise.allSettled(
        ids.map((id) => h.sessions.create({ id, userId: u.id, csrfSecret: 's', createdAt: now, expiresAt: now + 60_000 })),
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect((await h.sessions.listByUser(u.id)).length).toBe(ids.length);
    });

    it('[restart persistence] fresh instances see the committed user, session and token', async () => {
      const u = mkUser();
      await h.users.create(u);
      const now = Date.now();
      const sid = randomUUID();
      const hash = 'r'.repeat(64);
      await h.sessions.create({ id: sid, userId: u.id, csrfSecret: 'keep', createdAt: now, expiresAt: now + 60_000 });
      await h.emailTokens.create({ id: randomUUID(), userId: u.id, tokenHash: hash, expiresAt: now + 60_000, usedAt: null, createdAt: now });

      const fresh = await h.reopen();
      expect((await fresh.users.findById(u.id))!.email).toBe(u.email);
      expect((await fresh.sessions.findById(sid))!.csrfSecret).toBe('keep');
      expect(await fresh.emailTokens.findByHash(hash)).not.toBeNull();
    });
  });
}

// ---------------------------------------------------------------- SQLite (always)
contract('SQLite', async () => {
  const db = openDb(':memory:');
  return {
    users: new SqliteUserRepository(db),
    sessions: new SqliteSessionRepository(db),
    audit: new SqliteAuditRepository(db),
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    reopen: async () => ({
      users: new SqliteUserRepository(db),
      sessions: new SqliteSessionRepository(db),
      emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    }),
  };
});

// ---------------------------------------------------------------- PostgreSQL (ephemeral container)
if (PG_URL) {
  contract('PostgreSQL', async () => {
    // Dedicated database: this suite migrates down/up, so it must not share a schema with another suite.
    const pool: Pool = createPool(await createIsolatedTestDatabase(PG_URL, 'auth_repo_contract'));
    await migrateDown(pool).catch(() => {});
    await migrateUp(pool);
    return {
      users: new PgUserRepository(pool),
      sessions: new PgSessionRepository(pool),
      audit: new PgAuditRepository(pool),
      emailTokens: new PgTokenRepository(pool, 'email_verification_tokens'),
      resetTokens: new PgTokenRepository(pool, 'password_reset_tokens'),
      reopen: async () => ({
        users: new PgUserRepository(pool),
        sessions: new PgSessionRepository(pool),
        emailTokens: new PgTokenRepository(pool, 'email_verification_tokens'),
      }),
      cleanup: async () => { await pool.end(); },
    };
  });

  describe('BATCH_1 PgTokenRepository — table selection is a closed set', () => {
    it('refuses a table name that is not one of the two token tables', () => {
      const fake = {} as Pool;
      // The only non-parameterized fragment in these statements; proven to be one of two literals.
      expect(() => new PgTokenRepository(fake, 'users' as unknown as 'email_verification_tokens')).toThrow(/unsupported token table/);
      expect(() => new PgTokenRepository(fake, "x'; DROP TABLE users; --" as unknown as 'password_reset_tokens')).toThrow(/unsupported token table/);
    });
  });
}
