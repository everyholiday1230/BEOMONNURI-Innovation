import type { Pool } from 'pg';
import type {
  AuditEntry,
  IAuditRepository,
  ISessionRepository,
  ITokenRepository,
  IUserRepository,
  Role,
  Session,
  TokenRecord,
  User,
} from '@quantumtrade/auth';

const ms = (col: string, alias: string) => `(EXTRACT(EPOCH FROM ${col}) * 1000)::bigint AS ${alias}`;

/** Postgres User repository — parity with the SQLite adapter (same @quantumtrade/auth interface). */
export class PgUserRepository implements IUserRepository {
  constructor(private readonly pool: Pool) {}
  async create(u: User): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id,email,password_hash,role,status,mfa_enabled,email_verified,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8/1000.0), to_timestamp($9/1000.0))`,
      [u.id, u.email, u.passwordHash, u.role, u.status, u.mfaEnabled, u.emailVerified, u.createdAt, u.updatedAt],
    );
  }
  private async one(where: string, val: string): Promise<User | null> {
    const r = await this.pool.query(
      `SELECT id,email,password_hash,role,status,mfa_enabled,email_verified, ${ms('created_at', 'c')}, ${ms('updated_at', 'u')} FROM users WHERE ${where} = $1`,
      [val],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id, email: row.email, passwordHash: row.password_hash, role: row.role as Role,
      status: row.status as User['status'], mfaEnabled: !!row.mfa_enabled, emailVerified: !!row.email_verified,
      createdAt: Number(row.c), updatedAt: Number(row.u),
    };
  }
  findByEmail(email: string): Promise<User | null> {
    return this.one('email', email.toLowerCase());
  }
  findById(id: string): Promise<User | null> {
    return this.one('id', id);
  }
  async setRole(id: string, role: Role): Promise<void> {
    await this.pool.query('UPDATE users SET role=$1, updated_at=now() WHERE id=$2', [role, id]);
  }
  async setStatus(id: string, status: User['status']): Promise<void> {
    await this.pool.query('UPDATE users SET status=$1, updated_at=now() WHERE id=$2', [status, id]);
  }
  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.pool.query('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [passwordHash, id]);
  }
  async setEmailVerified(id: string, verified: boolean): Promise<void> {
    await this.pool.query('UPDATE users SET email_verified=$1, updated_at=now() WHERE id=$2', [verified, id]);
  }
}

export class PgSessionRepository implements ISessionRepository {
  constructor(private readonly pool: Pool) {}
  async create(s: Session): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (id,user_id,csrf_secret,created_at,expires_at,ip,user_agent)
       VALUES ($1,$2,$3, to_timestamp($4/1000.0), to_timestamp($5/1000.0), $6, $7)`,
      [s.id, s.userId, s.csrfSecret, s.createdAt, s.expiresAt, s.ip ?? null, s.userAgent ?? null],
    );
  }
  async findById(id: string): Promise<Session | null> {
    const r = await this.pool.query(
      `SELECT id,user_id,csrf_secret, ${ms('created_at', 'c')}, ${ms('expires_at', 'e')}, ip, user_agent FROM sessions WHERE id=$1`,
      [id],
    );
    const row = r.rows[0];
    return row
      ? { id: row.id, userId: row.user_id, csrfSecret: row.csrf_secret, createdAt: Number(row.c), expiresAt: Number(row.e), ip: row.ip ?? undefined, userAgent: row.user_agent ?? undefined }
      : null;
  }
  async updateExpiry(id: string, expiresAt: number): Promise<void> {
    await this.pool.query('UPDATE sessions SET expires_at=to_timestamp($1/1000.0) WHERE id=$2', [expiresAt, id]);
  }
  async listByUser(userId: string): Promise<Session[]> {
    const r = await this.pool.query(
      `SELECT id,user_id,csrf_secret, ${ms('created_at', 'c')}, ${ms('expires_at', 'e')}, ip, user_agent FROM sessions WHERE user_id=$1`,
      [userId],
    );
    return r.rows.map((row) => ({ id: row.id, userId: row.user_id, csrfSecret: row.csrf_secret, createdAt: Number(row.c), expiresAt: Number(row.e), ip: row.ip ?? undefined, userAgent: row.user_agent ?? undefined }));
  }
  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE id=$1', [id]);
  }
  async deleteByUser(userId: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
  }
  async deleteOthers(userId: string, keepId: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id=$1 AND id<>$2', [userId, keepId]);
  }
}

/**
 * BATCH_1 — PostgreSQL single-use hashed token repo (email verification / password reset).
 *
 * The table is chosen from a CLOSED UNION at construction time, never from a caller-supplied string, so
 * the one interpolated identifier cannot become an injection point (every value is parameterized). Only
 * the token HASH is stored — the raw token exists solely in the e-mail link — and `markUsed` is what makes
 * a token single-use, so `findByHash` returning a row is not by itself authorisation.
 */
export class PgTokenRepository implements ITokenRepository {
  private readonly table: 'email_verification_tokens' | 'password_reset_tokens';
  constructor(
    private readonly pool: Pool,
    table: 'email_verification_tokens' | 'password_reset_tokens',
  ) {
    // Re-validated rather than trusted: the value is the only part of these statements that is not a
    // bound parameter, so it must be provably one of two literals.
    if (table !== 'email_verification_tokens' && table !== 'password_reset_tokens') {
      throw new Error('PgTokenRepository: unsupported token table');
    }
    this.table = table;
  }
  async create(rec: TokenRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.table} (id,user_id,token_hash,expires_at,used_at,created_at)
       VALUES ($1,$2,$3, to_timestamp($4/1000.0), CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5::bigint/1000.0) END, to_timestamp($6/1000.0))`,
      [rec.id, rec.userId, rec.tokenHash, rec.expiresAt, rec.usedAt, rec.createdAt],
    );
  }
  async findByHash(tokenHash: string): Promise<TokenRecord | null> {
    const r = await this.pool.query(
      `SELECT id,user_id,token_hash, ${ms('expires_at', 'e')}, ${ms('used_at', 'us')}, ${ms('created_at', 'c')}
         FROM ${this.table} WHERE token_hash=$1`,
      [tokenHash],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: row.id, userId: row.user_id, tokenHash: row.token_hash, expiresAt: Number(row.e),
      usedAt: row.us === null ? null : Number(row.us), createdAt: Number(row.c),
    };
  }
  async markUsed(id: string, at: number): Promise<void> {
    await this.pool.query(`UPDATE ${this.table} SET used_at=to_timestamp($1/1000.0) WHERE id=$2`, [at, id]);
  }
  async deleteForUser(userId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE user_id=$1`, [userId]);
  }
}

export class PgAuditRepository implements IAuditRepository {
  constructor(private readonly pool: Pool) {}
  async record(e: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (id,actor_user_id,action,target,ip,at,meta) VALUES ($1,$2,$3,$4,$5, to_timestamp($6/1000.0), $7)`,
      [e.id, e.actorUserId, e.action, e.target ?? null, e.ip ?? null, e.at, e.meta ? JSON.stringify(e.meta) : null],
    );
  }
  async list(limit = 100): Promise<AuditEntry[]> {
    const r = await this.pool.query(`SELECT id,actor_user_id,action,target,ip, ${ms('at', 'a')}, meta FROM audit_logs ORDER BY at DESC LIMIT $1`, [limit]);
    return r.rows.map((row) => ({
      id: row.id, actorUserId: row.actor_user_id, action: row.action, target: row.target, ip: row.ip, at: Number(row.a),
      meta: row.meta ?? null,
    }));
  }
}
