import type {
  AuditEntry,
  IAuditRepository,
  ISessionRepository,
  ITokenRepository,
  IUserRepository,
  Session,
  TokenRecord,
  User,
} from '@quantumtrade/auth';
import type { Role } from '@quantumtrade/auth';
import type { DB } from './sqlite';

interface UserRow {
  id: string; email: string; password_hash: string; role: string; status: string;
  mfa_enabled: number; email_verified: number; created_at: number; updated_at: number;
  country?: string | null;
  country_source?: string | null;
}
const rowToUser = (r: UserRow): User => ({
  id: r.id, email: r.email, passwordHash: r.password_hash, role: r.role as Role,
  status: r.status as User['status'], mfaEnabled: !!r.mfa_enabled, emailVerified: !!r.email_verified,
  createdAt: r.created_at, updatedAt: r.updated_at,
  // ★ 없으면 null 로 남긴다. 기본값을 채우면 없는 사실을 만든다.
  country: r.country ?? null, countrySource: (r.country_source ?? null) as User['countrySource'],
});

export class SqliteUserRepository implements IUserRepository {
  constructor(private readonly db: DB) {}
  async create(u: User): Promise<void> {
    this.db
      .prepare('INSERT INTO users (id,email,password_hash,role,status,mfa_enabled,email_verified,created_at,updated_at,country,country_source) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      /*
         ★★ country·country_source 를 함께 넣는다. 이 두 칸이 없어서 가입 화면이
           물어본 국가가 저장되지 않았다.
         ★ 없으면 null 이다 — 기본값을 채우면 없는 사실을 만든다.
      */
      .run(u.id, u.email, u.passwordHash, u.role, u.status, u.mfaEnabled ? 1 : 0, u.emailVerified ? 1 : 0, u.createdAt, u.updatedAt,
        u.country ?? null, u.countrySource ?? null);
  }
  async findByEmail(email: string): Promise<User | null> {
    const r = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
    return r ? rowToUser(r) : null;
  }
  async findById(id: string): Promise<User | null> {
    const r = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return r ? rowToUser(r) : null;
  }
  async setRole(id: string, role: Role): Promise<void> {
    this.db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, Date.now(), id);
  }
  async setStatus(id: string, status: User['status']): Promise<void> {
    this.db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
  }
  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, Date.now(), id);
  }
  async setEmailVerified(id: string, verified: boolean): Promise<void> {
    this.db.prepare('UPDATE users SET email_verified = ?, updated_at = ? WHERE id = ?').run(verified ? 1 : 0, Date.now(), id);
  }
}

interface SessionRow {
  id: string; user_id: string; csrf_secret: string; created_at: number; expires_at: number;
  ip: string | null; user_agent: string | null;
}
const rowToSession = (r: SessionRow): Session => ({
  id: r.id, userId: r.user_id, csrfSecret: r.csrf_secret, createdAt: r.created_at, expiresAt: r.expires_at,
  ip: r.ip ?? undefined, userAgent: r.user_agent ?? undefined,
});
export class SqliteSessionRepository implements ISessionRepository {
  constructor(private readonly db: DB) {}
  async create(s: Session): Promise<void> {
    this.db
      .prepare('INSERT INTO sessions (id,user_id,csrf_secret,created_at,expires_at,ip,user_agent) VALUES (?,?,?,?,?,?,?)')
      .run(s.id, s.userId, s.csrfSecret, s.createdAt, s.expiresAt, s.ip ?? null, s.userAgent ?? null);
  }
  async findById(id: string): Promise<Session | null> {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    return r ? rowToSession(r) : null;
  }
  async listByUser(userId: string): Promise<Session[]> {
    return (this.db.prepare('SELECT * FROM sessions WHERE user_id = ?').all(userId) as SessionRow[]).map(rowToSession);
  }
  async updateExpiry(id: string, expiresAt: number): Promise<void> {
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expiresAt, id);
  }
  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }
  async deleteByUser(userId: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
  async deleteOthers(userId: string, keepId: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepId);
  }
}

interface AuditRow {
  id: string; actor_user_id: string | null; action: string; target: string | null;
  ip: string | null; at: number; meta: string | null;
}
export class SqliteAuditRepository implements IAuditRepository {
  constructor(private readonly db: DB) {}
  async record(e: AuditEntry): Promise<void> {
    this.db
      .prepare('INSERT INTO audit_logs (id,actor_user_id,action,target,ip,at,meta) VALUES (?,?,?,?,?,?,?)')
      .run(e.id, e.actorUserId ?? null, e.action, e.target ?? null, e.ip ?? null, e.at, e.meta ? JSON.stringify(e.meta) : null);
  }
  async list(limit = 100): Promise<AuditEntry[]> {
    const rows = this.db.prepare('SELECT * FROM audit_logs ORDER BY at DESC LIMIT ?').all(limit) as AuditRow[];
    return rows.map((r) => ({
      id: r.id, actorUserId: r.actor_user_id, action: r.action, target: r.target, ip: r.ip, at: r.at,
      meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
    }));
  }
}

interface TokenRow {
  id: string; user_id: string; token_hash: string; expires_at: number; used_at: number | null; created_at: number;
}
/** Single-use hashed token repo bound to a table (email_verification_tokens | password_reset_tokens). */
export class SqliteTokenRepository implements ITokenRepository {
  constructor(private readonly db: DB, private readonly table: 'email_verification_tokens' | 'password_reset_tokens') {}
  async create(rec: TokenRecord): Promise<void> {
    this.db
      .prepare(`INSERT INTO ${this.table} (id,user_id,token_hash,expires_at,used_at,created_at) VALUES (?,?,?,?,?,?)`)
      .run(rec.id, rec.userId, rec.tokenHash, rec.expiresAt, rec.usedAt, rec.createdAt);
  }
  async findByHash(tokenHash: string): Promise<TokenRecord | null> {
    const r = this.db.prepare(`SELECT * FROM ${this.table} WHERE token_hash = ?`).get(tokenHash) as TokenRow | undefined;
    return r ? { id: r.id, userId: r.user_id, tokenHash: r.token_hash, expiresAt: r.expires_at, usedAt: r.used_at, createdAt: r.created_at } : null;
  }
  async markUsed(id: string, at: number): Promise<void> {
    this.db.prepare(`UPDATE ${this.table} SET used_at = ? WHERE id = ?`).run(at, id);
  }
  async deleteForUser(userId: string): Promise<void> {
    this.db.prepare(`DELETE FROM ${this.table} WHERE user_id = ?`).run(userId);
  }
}
