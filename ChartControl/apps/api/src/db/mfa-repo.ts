import type { Pool } from 'pg';
import type { DB } from './sqlite';
import type { RecoveryCodeRecord } from '@quantumtrade/mfa';

export interface MfaCredential {
  userId: string;
  enabled: boolean;
  secretEncrypted: string | null;
  pendingSecretEncrypted: string | null;
  pendingExpiresAt: number | null;
  recoveryCodes: RecoveryCodeRecord[];
  lastUsedCounter: number | null;
}

/**
 * BATCH_1 / BL-10 — MFA persistence contract (Phase 6 §5), backend-abstracted.
 *
 * The methods are exactly the ones the MFA router already called on `SqliteMfaRepo`; the only change is
 * that they are ASYNC, which is what makes a PostgreSQL implementation possible at all (better-sqlite3 is
 * synchronous, `pg` is not). Both implementations satisfy ONE contract suite
 * (`mfa-lockout-contract.test.ts`), which is the proof that the production cutover preserves behaviour.
 *
 * Secret handling is part of the contract, not an implementation detail: `secretEncrypted` /
 * `pendingSecretEncrypted` are AES-256-GCM CIPHERTEXT produced by the caller's `SecretCipher`, and
 * `recoveryCodes` carry HASHES only. Neither backend ever sees, derives or logs a plaintext TOTP seed or
 * recovery code, so "encrypted at rest" holds for PostgreSQL exactly as it did for SQLite.
 */
export interface IMfaRepo {
  get(userId: string): Promise<MfaCredential | null>;
  isEnabled(userId: string): Promise<boolean>;
  startEnrollment(userId: string, encryptedSecret: string, expiresAt: number): Promise<void>;
  activate(userId: string, encryptedSecret: string, recovery: RecoveryCodeRecord[]): Promise<void>;
  disable(userId: string): Promise<void>;
  setLastCounter(userId: string, counter: number): Promise<void>;
  setRecovery(userId: string, recovery: RecoveryCodeRecord[]): Promise<void>;
  createChallenge(tokenHash: string, userId: string, ttlMs: number): Promise<void>;
  consumeChallenge(tokenHash: string): Promise<string | null>;
  peekChallenge(tokenHash: string): Promise<string | null>;
}

interface CredentialRow {
  user_id: string;
  enabled: number;
  secret_encrypted: string | null;
  pending_secret_encrypted: string | null;
  pending_expires_at: number | null;
  recovery_codes_json: string | null;
  last_used_counter: number | null;
}

const rowToCredential = (r: CredentialRow): MfaCredential => ({
  userId: r.user_id,
  enabled: Number(r.enabled) === 1,
  secretEncrypted: r.secret_encrypted,
  pendingSecretEncrypted: r.pending_secret_encrypted,
  pendingExpiresAt: r.pending_expires_at === null ? null : Number(r.pending_expires_at),
  recoveryCodes: r.recovery_codes_json ? (JSON.parse(r.recovery_codes_json) as RecoveryCodeRecord[]) : [],
  lastUsedCounter: r.last_used_counter === null ? null : Number(r.last_used_counter),
});

/**
 * Development / test implementation (`mfa_credentials` / `mfa_challenges`, SQLite migration 0006).
 *
 * The bodies are the previous synchronous statements; only the signatures became `async` (the same
 * "async interface over sync better-sqlite3" wrapper the auth repos have always used). Production must
 * NOT use this — the startup guard refuses SQLite in production.
 */
export class SqliteMfaRepo implements IMfaRepo {
  constructor(private readonly db: DB, private readonly now: () => number = Date.now) {}

  async get(userId: string): Promise<MfaCredential | null> {
    const r = this.db.prepare('SELECT * FROM mfa_credentials WHERE user_id=?').get(userId) as CredentialRow | undefined;
    return r ? rowToCredential(r) : null;
  }

  async isEnabled(userId: string): Promise<boolean> {
    const r = this.db.prepare('SELECT enabled FROM mfa_credentials WHERE user_id=?').get(userId) as { enabled: number } | undefined;
    return r?.enabled === 1;
  }

  async startEnrollment(userId: string, encryptedSecret: string, expiresAt: number): Promise<void> {
    this.db.prepare(
      `INSERT INTO mfa_credentials (user_id, enabled, pending_secret_encrypted, pending_expires_at, updated_at)
       VALUES (?, 0, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET pending_secret_encrypted=excluded.pending_secret_encrypted,
         pending_expires_at=excluded.pending_expires_at, updated_at=excluded.updated_at`,
    ).run(userId, encryptedSecret, expiresAt, this.now());
  }

  async activate(userId: string, encryptedSecret: string, recovery: RecoveryCodeRecord[]): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE mfa_credentials SET enabled=1, secret_encrypted=?, pending_secret_encrypted=NULL,
           pending_expires_at=NULL, recovery_codes_json=?, last_used_counter=NULL, updated_at=? WHERE user_id=?`,
      ).run(encryptedSecret, JSON.stringify(recovery), this.now(), userId);
      this.db.prepare('UPDATE users SET mfa_enabled=1, updated_at=? WHERE id=?').run(this.now(), userId);
    });
    tx();
  }

  async disable(userId: string): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE mfa_credentials SET enabled=0, secret_encrypted=NULL, pending_secret_encrypted=NULL,
           recovery_codes_json=NULL, last_used_counter=NULL, updated_at=? WHERE user_id=?`,
      ).run(this.now(), userId);
      this.db.prepare('UPDATE users SET mfa_enabled=0, updated_at=? WHERE id=?').run(this.now(), userId);
    });
    tx();
  }

  async setLastCounter(userId: string, counter: number): Promise<void> {
    this.db.prepare('UPDATE mfa_credentials SET last_used_counter=?, updated_at=? WHERE user_id=?').run(counter, this.now(), userId);
  }

  async setRecovery(userId: string, recovery: RecoveryCodeRecord[]): Promise<void> {
    this.db.prepare('UPDATE mfa_credentials SET recovery_codes_json=?, updated_at=? WHERE user_id=?').run(JSON.stringify(recovery), this.now(), userId);
  }

  // ---- short-lived login challenge (pending state) ----
  async createChallenge(tokenHash: string, userId: string, ttlMs: number): Promise<void> {
    const t = this.now();
    this.db.prepare('INSERT OR REPLACE INTO mfa_challenges (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
      .run(tokenHash, userId, t, t + ttlMs);
  }

  async consumeChallenge(tokenHash: string): Promise<string | null> {
    const r = this.db.prepare('SELECT user_id, expires_at FROM mfa_challenges WHERE token_hash=?').get(tokenHash) as { user_id: string; expires_at: number } | undefined;
    if (!r) return null;
    this.db.prepare('DELETE FROM mfa_challenges WHERE token_hash=?').run(tokenHash);
    if (r.expires_at < this.now()) return null;
    return r.user_id;
  }

  async peekChallenge(tokenHash: string): Promise<string | null> {
    const r = this.db.prepare('SELECT user_id, expires_at FROM mfa_challenges WHERE token_hash=?').get(tokenHash) as { user_id: string; expires_at: number } | undefined;
    return r && r.expires_at >= this.now() ? r.user_id : null;
  }
}

/**
 * Production implementation — real PostgreSQL over the 0006 `mfa_credentials` / `mfa_challenges` tables.
 *
 * Every statement is parameterized (no string-built SQL) and scoped by `user_id`, so the credential row a
 * request can read or mutate is the one belonging to the session's own user — an id from a request body
 * can never widen the scope. `activate`/`disable` run their credential update and the `users.mfa_enabled`
 * flag in ONE transaction, so the two can never disagree (a half-applied enable would either lock a user
 * out of their own account or advertise MFA that is not enforced).
 *
 * `secret_encrypted` / `pending_secret_encrypted` receive the caller's AES-GCM ciphertext verbatim and
 * `recovery_codes_json` receives hash records only; this class performs no encryption, decryption or
 * logging of either, which is what keeps the plaintext seed out of the database and out of the logs.
 */
export class PgMfaRepo implements IMfaRepo {
  constructor(private readonly pool: Pool, private readonly now: () => number = Date.now) {}

  async get(userId: string): Promise<MfaCredential | null> {
    const r = await this.pool.query(
      `SELECT user_id, enabled, secret_encrypted, pending_secret_encrypted, pending_expires_at,
              recovery_codes_json, last_used_counter
         FROM mfa_credentials WHERE user_id=$1`,
      [userId],
    );
    return r.rows[0] ? rowToCredential(r.rows[0] as CredentialRow) : null;
  }

  async isEnabled(userId: string): Promise<boolean> {
    const r = await this.pool.query('SELECT enabled FROM mfa_credentials WHERE user_id=$1', [userId]);
    return r.rows[0] ? Number(r.rows[0].enabled) === 1 : false;
  }

  async startEnrollment(userId: string, encryptedSecret: string, expiresAt: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO mfa_credentials (user_id, enabled, pending_secret_encrypted, pending_expires_at, updated_at)
       VALUES ($1, 0, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET pending_secret_encrypted=EXCLUDED.pending_secret_encrypted,
         pending_expires_at=EXCLUDED.pending_expires_at, updated_at=EXCLUDED.updated_at`,
      [userId, encryptedSecret, expiresAt, this.now()],
    );
  }

  /** Credential activation + the `users.mfa_enabled` flag, atomically (see class note). */
  async activate(userId: string, encryptedSecret: string, recovery: RecoveryCodeRecord[]): Promise<void> {
    await this.tx(async (client) => {
      await client.query(
        `UPDATE mfa_credentials SET enabled=1, secret_encrypted=$1, pending_secret_encrypted=NULL,
           pending_expires_at=NULL, recovery_codes_json=$2, last_used_counter=NULL, updated_at=$3
         WHERE user_id=$4`,
        [encryptedSecret, JSON.stringify(recovery), this.now(), userId],
      );
      await client.query('UPDATE users SET mfa_enabled=TRUE, updated_at=now() WHERE id=$1', [userId]);
    });
  }

  async disable(userId: string): Promise<void> {
    await this.tx(async (client) => {
      await client.query(
        `UPDATE mfa_credentials SET enabled=0, secret_encrypted=NULL, pending_secret_encrypted=NULL,
           recovery_codes_json=NULL, last_used_counter=NULL, updated_at=$1 WHERE user_id=$2`,
        [this.now(), userId],
      );
      await client.query('UPDATE users SET mfa_enabled=FALSE, updated_at=now() WHERE id=$1', [userId]);
    });
  }

  async setLastCounter(userId: string, counter: number): Promise<void> {
    await this.pool.query('UPDATE mfa_credentials SET last_used_counter=$1, updated_at=$2 WHERE user_id=$3', [counter, this.now(), userId]);
  }

  async setRecovery(userId: string, recovery: RecoveryCodeRecord[]): Promise<void> {
    await this.pool.query('UPDATE mfa_credentials SET recovery_codes_json=$1, updated_at=$2 WHERE user_id=$3', [JSON.stringify(recovery), this.now(), userId]);
  }

  async createChallenge(tokenHash: string, userId: string, ttlMs: number): Promise<void> {
    const t = this.now();
    await this.pool.query(
      `INSERT INTO mfa_challenges (token_hash, user_id, created_at, expires_at) VALUES ($1,$2,$3,$4)
       ON CONFLICT (token_hash) DO UPDATE SET user_id=EXCLUDED.user_id, created_at=EXCLUDED.created_at,
         expires_at=EXCLUDED.expires_at`,
      [tokenHash, userId, t, t + ttlMs],
    );
  }

  /**
   * Single-use by construction: the row is deleted in the SAME statement that reads it, so two concurrent
   * requests presenting one challenge token cannot both be told which user it belongs to. An EXPIRED row
   * is still consumed (deleted) and then reported as `null`, matching the SQLite behaviour — a stale token
   * must not remain replayable.
   */
  async consumeChallenge(tokenHash: string): Promise<string | null> {
    const r = await this.pool.query(
      'DELETE FROM mfa_challenges WHERE token_hash=$1 RETURNING user_id, expires_at',
      [tokenHash],
    );
    const row = r.rows[0];
    if (!row) return null;
    return Number(row.expires_at) < this.now() ? null : (row.user_id as string);
  }

  async peekChallenge(tokenHash: string): Promise<string | null> {
    const r = await this.pool.query('SELECT user_id, expires_at FROM mfa_challenges WHERE token_hash=$1', [tokenHash]);
    const row = r.rows[0];
    return row && Number(row.expires_at) >= this.now() ? (row.user_id as string) : null;
  }

  private async tx<T>(fn: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
}
