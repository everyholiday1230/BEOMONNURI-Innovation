import type { LockoutState } from '@quantumtrade/mfa';
import type { Pool } from 'pg';
import type { DB } from './sqlite';

/**
 * Brute-force lockout STORE (Phase 7 / Prompt 5 — B7, ADM-API-13; BATCH_1 PostgreSQL cutover).
 *
 * The lockout ALGORITHM stays in `@quantumtrade/mfa` (`recordFailure` / `isLocked` / `resetLockout`);
 * this is only where the state lives. It was a process-local `Map` in `mfa/mfa-routes.ts`, which meant:
 *
 *  - the state vanished on restart, so a locked attacker was unlocked by a deploy;
 *  - no other process (or the admin console) could see or clear it;
 *  - "how many accounts are locked?" was unanswerable, and an admin unlock endpoint would have had
 *    nothing real to clear.
 *
 * Persisting it is what makes ADM-API-13 an actual operation rather than a button that reports success.
 *
 * The interface is still the two `Map` methods the routes already called — but now ASYNC, because the
 * production store is PostgreSQL over a network socket and better-sqlite3's synchronous shape cannot be
 * carried across it. Every route call site is awaited; a dropped promise here would mean a failure that
 * is never counted, i.e. a lockout that never engages.
 *
 * This is DELIBERATELY not the same thing as the Redis request-rate limiter on the login/MFA routes:
 * this is the PERSISTENT, per-account penalty (survives restarts, admin-clearable, strongly consistent
 * in PostgreSQL); the limiter is a short-window request budget. Neither substitutes for the other.
 */
export interface LockoutStore {
  get(userId: string): Promise<LockoutState | undefined>;
  set(userId: string, state: LockoutState): Promise<void>;
}

/** Previous behaviour, kept as the default so a caller that wires nothing keeps working (dev/test only). */
export class MemoryLockoutStore implements LockoutStore {
  private readonly m = new Map<string, LockoutState>();
  async get(userId: string): Promise<LockoutState | undefined> { return this.m.get(userId); }
  async set(userId: string, state: LockoutState): Promise<void> { this.m.set(userId, state); }
}

/** Shared rule: a fully-zero state means "cleared", which is stored as the ABSENCE of a row. */
const isCleared = (state: LockoutState): boolean => state.fails === 0 && state.lockedUntilMs === 0;

/** SQLite-backed lockout state (`account_lockouts`, migration 0009) — dev/test. */
export class SqliteLockoutStore implements LockoutStore {
  constructor(private readonly db: DB, private readonly now: () => number = Date.now) {}

  async get(userId: string): Promise<LockoutState | undefined> {
    const r = this.db
      .prepare('SELECT fails, first_fail_at, locked_until FROM account_lockouts WHERE user_id=?')
      .get(userId) as { fails: number; first_fail_at: number; locked_until: number } | undefined;
    if (!r) return undefined;
    return { fails: r.fails, firstFailMs: r.first_fail_at, lockedUntilMs: r.locked_until };
  }

  /**
   * A fully-zero state is `resetLockout()` — a successful verification. That is stored as the ABSENCE of
   * a row rather than a row of zeros, so `account_lockouts` only ever holds accounts with something to
   * report and the admin summary counts cannot be inflated by cleared history.
   *
   * An admin-cleared row is kept (with `cleared_at`/`cleared_by`) by `SqliteAdminRepo.clearLockout`,
   * which is a different operation: that row is evidence of the clearing, not live lockout state.
   */
  async set(userId: string, state: LockoutState): Promise<void> {
    if (isCleared(state)) {
      this.db.prepare('DELETE FROM account_lockouts WHERE user_id=?').run(userId);
      return;
    }
    const t = this.now();
    this.db
      .prepare(
        `INSERT INTO account_lockouts (user_id, fails, first_fail_at, locked_until, source, version, updated_at)
         VALUES (?,?,?,?,'mfa',0,?)
         ON CONFLICT(user_id) DO UPDATE SET
           fails=excluded.fails,
           first_fail_at=excluded.first_fail_at,
           locked_until=excluded.locked_until,
           version=account_lockouts.version+1,
           updated_at=excluded.updated_at,
           cleared_at=NULL,
           cleared_by=NULL`,
      )
      .run(userId, state.fails, state.firstFailMs, state.lockedUntilMs, t);
  }
}

/**
 * Production implementation — real PostgreSQL over the 0009 `account_lockouts` table.
 *
 * Same semantics as the SQLite store (cleared == no row, `version` monotonically increments per write,
 * an admin clearing is a different operation that keeps its own evidence row), with two properties that
 * only matter once more than one instance is serving login traffic:
 *
 *  - the upsert is a SINGLE atomic statement scoped by the `user_id` primary key, so two instances
 *    recording a failed attempt for the same account cannot both insert, and neither can lose the other's
 *    row (`ON CONFLICT` updates rather than raising);
 *  - `version` is incremented BY THE DATABASE (`account_lockouts.version + 1`), never by a read-then-write
 *    in the application, so the counter cannot be rolled back by a concurrent writer that read a stale
 *    value. The returned version is what the admin console reads for optimistic concurrency.
 *
 * `fails` itself is written from the algorithm's computed state (read-modify-write through the routes),
 * which is the pre-existing Phase 6 behaviour and is bounded by the same threshold; the atomic upsert
 * guarantees the LOCK decision converges rather than being lost.
 */
export class PgLockoutStore implements LockoutStore {
  constructor(private readonly pool: Pool, private readonly now: () => number = Date.now) {}

  async get(userId: string): Promise<LockoutState | undefined> {
    const r = await this.pool.query(
      'SELECT fails, first_fail_at, locked_until FROM account_lockouts WHERE user_id=$1',
      [userId],
    );
    const row = r.rows[0];
    if (!row) return undefined;
    return { fails: Number(row.fails), firstFailMs: Number(row.first_fail_at), lockedUntilMs: Number(row.locked_until) };
  }

  async set(userId: string, state: LockoutState): Promise<void> {
    if (isCleared(state)) {
      await this.pool.query('DELETE FROM account_lockouts WHERE user_id=$1', [userId]);
      return;
    }
    await this.pool.query(
      `INSERT INTO account_lockouts (user_id, fails, first_fail_at, locked_until, source, version, updated_at)
       VALUES ($1,$2,$3,$4,'mfa',0,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         fails=EXCLUDED.fails,
         first_fail_at=EXCLUDED.first_fail_at,
         locked_until=EXCLUDED.locked_until,
         version=account_lockouts.version+1,
         updated_at=EXCLUDED.updated_at,
         cleared_at=NULL,
         cleared_by=NULL`,
      [userId, state.fails, state.firstFailMs, state.lockedUntilMs, this.now()],
    );
  }

  /** Current optimistic-concurrency version (0 when there is no row). Used by the contract test and by
   *  admin tooling that must not clobber a lockout it did not read. */
  async version(userId: string): Promise<number> {
    const r = await this.pool.query('SELECT version FROM account_lockouts WHERE user_id=$1', [userId]);
    return r.rows[0] ? Number(r.rows[0].version) : 0;
  }
}
