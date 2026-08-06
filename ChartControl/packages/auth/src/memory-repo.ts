import type {
  AuditEntry,
  IAuditRepository,
  ISessionRepository,
  ITokenRepository,
  IUserRepository,
  Session,
  TokenRecord,
  User,
} from './repositories';
import type { Role } from './rbac';

export class MemoryUserRepository implements IUserRepository {
  private byId = new Map<string, User>();
  private byEmail = new Map<string, string>();
  async create(user: User): Promise<void> {
    this.byId.set(user.id, { ...user });
    this.byEmail.set(user.email.toLowerCase(), user.id);
  }
  async findByEmail(email: string): Promise<User | null> {
    const id = this.byEmail.get(email.toLowerCase());
    return id ? (this.byId.get(id) ?? null) : null;
  }
  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }
  async setRole(id: string, role: Role): Promise<void> {
    const u = this.byId.get(id);
    if (u) this.byId.set(id, { ...u, role, updatedAt: Date.now() });
  }
  async setStatus(id: string, status: User['status']): Promise<void> {
    const u = this.byId.get(id);
    if (u) this.byId.set(id, { ...u, status, updatedAt: Date.now() });
  }
  async setPasswordHash(id: string, passwordHash: string): Promise<void> {
    const u = this.byId.get(id);
    if (u) this.byId.set(id, { ...u, passwordHash, updatedAt: Date.now() });
  }
  async setEmailVerified(id: string, verified: boolean): Promise<void> {
    const u = this.byId.get(id);
    if (u) this.byId.set(id, { ...u, emailVerified: verified, updatedAt: Date.now() });
  }
}

export class MemorySessionRepository implements ISessionRepository {
  private byId = new Map<string, Session>();
  async create(session: Session): Promise<void> {
    this.byId.set(session.id, { ...session });
  }
  async findById(id: string): Promise<Session | null> {
    return this.byId.get(id) ?? null;
  }
  async listByUser(userId: string): Promise<Session[]> {
    return [...this.byId.values()].filter((s) => s.userId === userId);
  }
  async updateExpiry(id: string, expiresAt: number): Promise<void> {
    const s = this.byId.get(id);
    if (s) this.byId.set(id, { ...s, expiresAt });
  }
  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }
  async deleteByUser(userId: string): Promise<void> {
    for (const [id, s] of this.byId) if (s.userId === userId) this.byId.delete(id);
  }
  async deleteOthers(userId: string, keepId: string): Promise<void> {
    for (const [id, s] of this.byId) if (s.userId === userId && id !== keepId) this.byId.delete(id);
  }
}

export class MemoryTokenRepository implements ITokenRepository {
  private byId = new Map<string, TokenRecord>();
  private byHash = new Map<string, string>();
  async create(rec: TokenRecord): Promise<void> {
    this.byId.set(rec.id, { ...rec });
    this.byHash.set(rec.tokenHash, rec.id);
  }
  async findByHash(tokenHash: string): Promise<TokenRecord | null> {
    const id = this.byHash.get(tokenHash);
    return id ? (this.byId.get(id) ?? null) : null;
  }
  async markUsed(id: string, at: number): Promise<void> {
    const r = this.byId.get(id);
    if (r) this.byId.set(id, { ...r, usedAt: at });
  }
  async deleteForUser(userId: string): Promise<void> {
    for (const [id, r] of this.byId) if (r.userId === userId) {
      this.byHash.delete(r.tokenHash);
      this.byId.delete(id);
    }
  }
}

export class MemoryAuditRepository implements IAuditRepository {
  private entries: AuditEntry[] = [];
  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
  async list(limit = 100): Promise<AuditEntry[]> {
    return this.entries.slice(-limit).reverse();
  }
}
