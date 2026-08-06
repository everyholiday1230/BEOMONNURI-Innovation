import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { DEFAULT_LOCKOUT, isLocked, recordFailure, resetLockout, type RecoveryCodeRecord } from '@quantumtrade/mfa';
import { openDb } from '../db/sqlite';
import { createPool, migrateDown, migrateUp } from '../db/pg';
import { PgMfaRepo, SqliteMfaRepo, type IMfaRepo } from '../db/mfa-repo';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { PgLockoutStore, SqliteLockoutStore, type LockoutStore } from '../db/lockout-repo';

/**
 * BATCH_1 — ONE contract suite for the MFA credential/challenge store and the account-lockout store,
 * executed against BOTH backends. SQLite always runs; PostgreSQL runs when `PG_TEST_URL` points at an
 * EPHEMERAL container (never RDS, never a shared local instance).
 *
 * The assertions are the properties a production cutover must not silently lose: enrollment/activation
 * lifecycle, single-use challenges, ownership isolation (IDOR), foreign keys, primary-key upsert instead
 * of duplication, transaction atomicity, concurrent-writer convergence, optimistic version monotonicity,
 * and survival across a "restart" (a fresh repository instance over the same store).
 *
 * A deliberate secret-handling assertion is included: what lands in the columns is the ciphertext/hashes
 * the caller passed, and never a plaintext seed or recovery code.
 */

const PG_URL = process.env.PG_TEST_URL;

/** Stand-ins for real AES-GCM output / hashed recovery records — opaque to the repository by design. */
const CIPHERTEXT = 'v1:gcm:9f8e7d6c5b4a39281706:ZmFrZS1jaXBoZXJ0ZXh0';
const PENDING_CIPHERTEXT = 'v1:gcm:0011223344556677:cGVuZGluZy1jaXBoZXI';
const recoveryRecords = (): RecoveryCodeRecord[] => [
  { hash: 'a'.repeat(64), usedAt: null },
  { hash: 'b'.repeat(64), usedAt: null },
];

interface Harness {
  mfa: IMfaRepo;
  lockouts: LockoutStore;
  mkUser: () => Promise<string>;
  /** True users.mfa_enabled flag, read straight from the store (not via the repo). */
  userMfaFlag: (userId: string) => Promise<boolean>;
  /** Count credential rows for a user — proves upsert rather than duplicate insert. */
  credentialRowCount: (userId: string) => Promise<number>;
  /** Raw column values, to assert nothing plaintext was persisted. */
  rawCredential: (userId: string) => Promise<{ secret: string | null; recovery: string | null }>;
  /** Force the `users` update inside activate() to fail, so atomicity can be observed. */
  breakUsersUpdate: (userId: string) => Promise<void>;
  unbreakUsersUpdate: () => Promise<void>;
  /** A fresh repo pair over the SAME store — the "restart" case. */
  reopen: () => Promise<{ mfa: IMfaRepo; lockouts: LockoutStore }>;
  /** Optimistic-concurrency version of the lockout row (0 when absent). */
  lockoutVersion: (userId: string) => Promise<number>;
  cleanup?: () => Promise<void>;
}

function contract(name: string, setup: () => Promise<Harness>) {
  describe(`BATCH_1 identity store contract — ${name}`, () => {
    let h: Harness;
    beforeAll(async () => { h = await setup(); });
    afterAll(async () => { if (h?.cleanup) await h.cleanup(); });

    // ---------------- MFA credential lifecycle ----------------
    it('absent credential reads as null / not enabled', async () => {
      const u = await h.mkUser();
      expect(await h.mfa.get(u)).toBeNull();
      expect(await h.mfa.isEnabled(u)).toBe(false);
    });

    it('enrollment stores a PENDING ciphertext and does not enable MFA', async () => {
      const u = await h.mkUser();
      const expires = Date.now() + 600_000;
      await h.mfa.startEnrollment(u, PENDING_CIPHERTEXT, expires);
      const cred = await h.mfa.get(u);
      expect(cred).not.toBeNull();
      expect(cred!.enabled).toBe(false);
      expect(cred!.pendingSecretEncrypted).toBe(PENDING_CIPHERTEXT);
      expect(cred!.pendingExpiresAt).toBe(expires);
      expect(cred!.secretEncrypted).toBeNull();
      // The pending state must NOT make the account behave as MFA-protected yet.
      expect(await h.mfa.isEnabled(u)).toBe(false);
      expect(await h.userMfaFlag(u)).toBe(false);
    });

    it('re-enrollment UPSERTS the pending secret (primary key, never a second row)', async () => {
      const u = await h.mkUser();
      await h.mfa.startEnrollment(u, PENDING_CIPHERTEXT, Date.now() + 1000);
      await h.mfa.startEnrollment(u, `${PENDING_CIPHERTEXT}-2`, Date.now() + 2000);
      expect(await h.credentialRowCount(u)).toBe(1);
      expect((await h.mfa.get(u))!.pendingSecretEncrypted).toBe(`${PENDING_CIPHERTEXT}-2`);
    });

    it('activation clears the pending secret, sets users.mfa_enabled, and stores recovery HASHES only', async () => {
      const u = await h.mkUser();
      await h.mfa.startEnrollment(u, PENDING_CIPHERTEXT, Date.now() + 600_000);
      await h.mfa.activate(u, CIPHERTEXT, recoveryRecords());
      const cred = await h.mfa.get(u);
      expect(cred!.enabled).toBe(true);
      expect(cred!.secretEncrypted).toBe(CIPHERTEXT);
      expect(cred!.pendingSecretEncrypted).toBeNull();
      expect(cred!.pendingExpiresAt).toBeNull();
      expect(cred!.recoveryCodes).toHaveLength(2);
      expect(cred!.lastUsedCounter).toBeNull();
      expect(await h.mfa.isEnabled(u)).toBe(true);
      // Both halves of activation committed together.
      expect(await h.userMfaFlag(u)).toBe(true);
    });

    it('persists only ciphertext / hash material — no plaintext seed or recovery code', async () => {
      const u = await h.mkUser();
      await h.mfa.startEnrollment(u, PENDING_CIPHERTEXT, Date.now() + 600_000);
      await h.mfa.activate(u, CIPHERTEXT, recoveryRecords());
      const raw = await h.rawCredential(u);
      // Exactly the caller's ciphertext: the repository neither decrypts nor re-encodes it.
      expect(raw.secret).toBe(CIPHERTEXT);
      // Recovery column holds hash records, and carries no `code`/`plaintext` field at all.
      expect(raw.recovery).toContain('hash');
      expect(raw.recovery).not.toMatch(/"code"|plaintext/i);
      for (const rec of (JSON.parse(raw.recovery!) as RecoveryCodeRecord[])) {
        expect(Object.keys(rec).sort()).toEqual(['hash', 'usedAt']);
        expect(rec.hash).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('replay counter and recovery-code consumption persist', async () => {
      const u = await h.mkUser();
      await h.mfa.startEnrollment(u, PENDING_CIPHERTEXT, Date.now() + 600_000);
      await h.mfa.activate(u, CIPHERTEXT, recoveryRecords());
      await h.mfa.setLastCounter(u, 58_123_456);
      expect((await h.mfa.get(u))!.lastUsedCounter).toBe(58_123_456);
      const used = recoveryRecords();
      used[0]!.usedAt = 1_700_000_000_000;
      await h.mfa.setRecovery(u, used);
      expect((await h.mfa.get(u))!.recoveryCodes[0]!.usedAt).toBe(1_700_000_000_000);
    });

    it('disable wipes secret + recovery material and clears users.mfa_enabled', async () => {
      const u = await h.mkUser();
      await h.mfa.startEnrollment(u, PENDING_CIPHERTEXT, Date.now() + 600_000);
      await h.mfa.activate(u, CIPHERTEXT, recoveryRecords());
      await h.mfa.disable(u);
      const cred = await h.mfa.get(u);
      expect(cred!.enabled).toBe(false);
      expect(cred!.secretEncrypted).toBeNull();
      expect(cred!.recoveryCodes).toEqual([]);
      expect(cred!.lastUsedCounter).toBeNull();
      expect(await h.userMfaFlag(u)).toBe(false);
    });

    it('[atomicity] a failing users update rolls the credential change back entirely', async () => {
      const u = await h.mkUser();
      await h.mfa.startEnrollment(u, PENDING_CIPHERTEXT, Date.now() + 600_000);
      await h.breakUsersUpdate(u);
      try {
        await expect(h.mfa.activate(u, CIPHERTEXT, recoveryRecords())).rejects.toThrow();
      } finally {
        await h.unbreakUsersUpdate();
      }
      // Neither half applied: no "enabled credential with an unflagged user" and no orphan secret.
      const cred = await h.mfa.get(u);
      expect(cred!.enabled).toBe(false);
      expect(cred!.secretEncrypted).toBeNull();
      expect(await h.userMfaFlag(u)).toBe(false);
    });

    // ---------------- ownership / IDOR ----------------
    it('[ownership] one user cannot read or mutate another credential', async () => {
      const a = await h.mkUser();
      const b = await h.mkUser();
      await h.mfa.startEnrollment(a, PENDING_CIPHERTEXT, Date.now() + 600_000);
      await h.mfa.activate(a, CIPHERTEXT, recoveryRecords());
      // B has nothing, even though A is fully enrolled.
      expect(await h.mfa.get(b)).toBeNull();
      expect(await h.mfa.isEnabled(b)).toBe(false);
      // Writes scoped to B never touch A's row.
      await h.mfa.setLastCounter(b, 999);
      await h.mfa.setRecovery(b, []);
      await h.mfa.disable(b);
      const aCred = await h.mfa.get(a);
      expect(aCred!.enabled).toBe(true);
      expect(aCred!.secretEncrypted).toBe(CIPHERTEXT);
      expect(aCred!.lastUsedCounter).toBeNull();
      expect(await h.userMfaFlag(a)).toBe(true);
    });

    // ---------------- challenges ----------------
    it('challenge peek is non-destructive, consume is SINGLE-USE', async () => {
      const u = await h.mkUser();
      const token = randomUUID();
      await h.mfa.createChallenge(token, u, 60_000);
      expect(await h.mfa.peekChallenge(token)).toBe(u);
      expect(await h.mfa.peekChallenge(token)).toBe(u);
      expect(await h.mfa.consumeChallenge(token)).toBe(u);
      expect(await h.mfa.consumeChallenge(token)).toBeNull();
      expect(await h.mfa.peekChallenge(token)).toBeNull();
    });

    it('an EXPIRED challenge is never honoured, and is consumed away rather than left replayable', async () => {
      const u = await h.mkUser();
      const token = randomUUID();
      await h.mfa.createChallenge(token, u, -1_000); // already expired
      expect(await h.mfa.peekChallenge(token)).toBeNull();
      expect(await h.mfa.consumeChallenge(token)).toBeNull();
      expect(await h.mfa.peekChallenge(token)).toBeNull();
    });

    it('[ownership] a challenge resolves ONLY to its own user', async () => {
      const a = await h.mkUser();
      const b = await h.mkUser();
      const ta = randomUUID();
      const tb = randomUUID();
      await h.mfa.createChallenge(ta, a, 60_000);
      await h.mfa.createChallenge(tb, b, 60_000);
      expect(await h.mfa.peekChallenge(ta)).toBe(a);
      expect(await h.mfa.peekChallenge(tb)).toBe(b);
      expect(await h.mfa.consumeChallenge(ta)).toBe(a);
      // Consuming A's challenge leaves B's untouched.
      expect(await h.mfa.peekChallenge(tb)).toBe(b);
    });

    it('[FK] a credential or challenge for a non-existent user is rejected by the database', async () => {
      const ghost = randomUUID();
      await expect(h.mfa.startEnrollment(ghost, PENDING_CIPHERTEXT, Date.now() + 1000)).rejects.toThrow();
      await expect(h.mfa.createChallenge(randomUUID(), ghost, 60_000)).rejects.toThrow();
    });

    // ---------------- lockout store ----------------
    it('lockout: cleared state is the ABSENCE of a row, and the algorithm drives to locked', async () => {
      const u = await h.mkUser();
      expect(await h.lockouts.get(u)).toBeUndefined();
      const now = Date.now();
      for (let i = 0; i < DEFAULT_LOCKOUT.maxFails; i += 1) {
        await h.lockouts.set(u, recordFailure(await h.lockouts.get(u), now, DEFAULT_LOCKOUT));
      }
      const locked = await h.lockouts.get(u);
      expect(locked!.fails).toBe(DEFAULT_LOCKOUT.maxFails);
      expect(isLocked(locked, now)).toBe(true);
      await h.lockouts.set(u, resetLockout());
      expect(await h.lockouts.get(u)).toBeUndefined();
    });

    it('[ownership] lockout state is per-account', async () => {
      const a = await h.mkUser();
      const b = await h.mkUser();
      const now = Date.now();
      await h.lockouts.set(a, recordFailure(undefined, now, DEFAULT_LOCKOUT));
      expect((await h.lockouts.get(a))!.fails).toBe(1);
      expect(await h.lockouts.get(b)).toBeUndefined();
    });

    it('[optimistic version] every write increments the version monotonically (DB-side)', async () => {
      const u = await h.mkUser();
      const now = Date.now();
      await h.lockouts.set(u, { fails: 1, firstFailMs: now, lockedUntilMs: 0 });
      const v1 = await h.lockoutVersion(u);
      await h.lockouts.set(u, { fails: 2, firstFailMs: now, lockedUntilMs: 0 });
      const v2 = await h.lockoutVersion(u);
      await h.lockouts.set(u, { fails: 3, firstFailMs: now, lockedUntilMs: 0 });
      const v3 = await h.lockoutVersion(u);
      expect(v2).toBeGreaterThan(v1);
      expect(v3).toBeGreaterThan(v2);
    });

    it('[concurrent] parallel writers converge on one row instead of raising or duplicating', async () => {
      const u = await h.mkUser();
      const now = Date.now();
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          h.lockouts.set(u, { fails: i + 1, firstFailMs: now, lockedUntilMs: now + 60_000 }),
        ),
      );
      // No writer lost to a unique-violation: the upsert is the conflict resolution.
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      const state = await h.lockouts.get(u);
      expect(state).toBeDefined();
      expect(isLocked(state, now)).toBe(true);
      // Version advanced at least once per successful write beyond the insert.
      expect(await h.lockoutVersion(u)).toBeGreaterThan(0);
    });

    it('[FK] a lockout row for a non-existent user is rejected', async () => {
      await expect(
        h.lockouts.set(randomUUID(), { fails: 1, firstFailMs: Date.now(), lockedUntilMs: 0 }),
      ).rejects.toThrow();
    });

    it('[restart persistence] a fresh repository instance sees the committed MFA + lockout state', async () => {
      const u = await h.mkUser();
      const token = randomUUID();
      await h.mfa.startEnrollment(u, PENDING_CIPHERTEXT, Date.now() + 600_000);
      await h.mfa.activate(u, CIPHERTEXT, recoveryRecords());
      await h.mfa.createChallenge(token, u, 60_000);
      const now = Date.now();
      await h.lockouts.set(u, { fails: 3, firstFailMs: now, lockedUntilMs: now + 60_000 });

      const fresh = await h.reopen();
      expect(await fresh.mfa.isEnabled(u)).toBe(true);
      expect((await fresh.mfa.get(u))!.secretEncrypted).toBe(CIPHERTEXT);
      expect(await fresh.mfa.peekChallenge(token)).toBe(u);
      expect(isLocked(await fresh.lockouts.get(u), now)).toBe(true);
    });
  });
}

// ---------------------------------------------------------------- SQLite (always)
contract('SQLite', async () => {
  const db = openDb(':memory:');
  const mkUser = async () => {
    const id = randomUUID();
    db.prepare("INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,'USER','active',1,1)")
      .run(id, `${id}@ex.com`, 'x');
    return id;
  };
  return {
    mfa: new SqliteMfaRepo(db),
    lockouts: new SqliteLockoutStore(db),
    mkUser,
    userMfaFlag: async (userId) =>
      ((db.prepare('SELECT mfa_enabled FROM users WHERE id=?').get(userId) as { mfa_enabled: number }).mfa_enabled) === 1,
    credentialRowCount: async (userId) =>
      (db.prepare('SELECT COUNT(*) AS n FROM mfa_credentials WHERE user_id=?').get(userId) as { n: number }).n,
    rawCredential: async (userId) => {
      const r = db.prepare('SELECT secret_encrypted, recovery_codes_json FROM mfa_credentials WHERE user_id=?').get(userId) as
        | { secret_encrypted: string | null; recovery_codes_json: string | null }
        | undefined;
      return { secret: r?.secret_encrypted ?? null, recovery: r?.recovery_codes_json ?? null };
    },
    // Test-only trigger: makes the second statement of activate() fail so the rollback is observable.
    breakUsersUpdate: async (userId) => {
      db.exec(
        `CREATE TRIGGER qt_break_users_update BEFORE UPDATE ON users WHEN NEW.id='${userId}'
         BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
      );
    },
    unbreakUsersUpdate: async () => { db.exec('DROP TRIGGER IF EXISTS qt_break_users_update'); },
    reopen: async () => ({ mfa: new SqliteMfaRepo(db), lockouts: new SqliteLockoutStore(db) }),
    lockoutVersion: async (userId) =>
      ((db.prepare('SELECT version FROM account_lockouts WHERE user_id=?').get(userId) as { version: number } | undefined)?.version ?? 0),
  };
});

// ---------------------------------------------------------------- PostgreSQL (ephemeral container)
if (PG_URL) {
  contract('PostgreSQL', async () => {
    // Dedicated database: this suite migrates down/up, so it must not share a schema with another suite.
    const pool: Pool = createPool(await createIsolatedTestDatabase(PG_URL, 'mfa_lockout_contract'));
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
    return {
      mfa: new PgMfaRepo(pool),
      lockouts: new PgLockoutStore(pool),
      mkUser,
      userMfaFlag: async (userId) => (await pool.query('SELECT mfa_enabled FROM users WHERE id=$1', [userId])).rows[0].mfa_enabled === true,
      credentialRowCount: async (userId) =>
        Number((await pool.query('SELECT COUNT(*)::int AS n FROM mfa_credentials WHERE user_id=$1', [userId])).rows[0].n),
      rawCredential: async (userId) => {
        const r = await pool.query('SELECT secret_encrypted, recovery_codes_json FROM mfa_credentials WHERE user_id=$1', [userId]);
        return { secret: r.rows[0]?.secret_encrypted ?? null, recovery: r.rows[0]?.recovery_codes_json ?? null };
      },
      breakUsersUpdate: async (userId) => {
        await pool.query(
          `CREATE OR REPLACE FUNCTION qt_break_users_update() RETURNS trigger AS $$
             BEGIN IF NEW.id = '${userId}'::uuid THEN RAISE EXCEPTION 'injected failure'; END IF; RETURN NEW; END;
           $$ LANGUAGE plpgsql`,
        );
        await pool.query('CREATE TRIGGER qt_break_users_update BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION qt_break_users_update()');
      },
      unbreakUsersUpdate: async () => {
        await pool.query('DROP TRIGGER IF EXISTS qt_break_users_update ON users');
        await pool.query('DROP FUNCTION IF EXISTS qt_break_users_update()');
      },
      reopen: async () => ({ mfa: new PgMfaRepo(pool), lockouts: new PgLockoutStore(pool) }),
      lockoutVersion: async (userId) => new PgLockoutStore(pool).version(userId),
      cleanup: async () => { await pool.end(); },
    };
  });
}
