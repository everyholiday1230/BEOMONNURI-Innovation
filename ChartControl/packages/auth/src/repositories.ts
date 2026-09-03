import type { Role } from './rbac';

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: 'active' | 'disabled';
  mfaEnabled: boolean;
  emailVerified: boolean;
  createdAt: number;
  updatedAt: number;
  /*
     가입 시 선택한 국가 (ISO 3166-1 alpha-2 또는 'OTHER'). 모르면 null.

     ★ 기존 가입자에게는 이 정보가 없다. 없는 것을 기본값으로 채우면 없는 사실을
       만들어내는 것이 되므로 null 을 유지한다.
  */
  country?: string | null;
  /** 위 값의 근거: 'user'(직접 선택) | 'inferred'(브라우저 추정). 모르면 null. */
  countrySource?: 'user' | 'inferred' | null;
}

/** User without the password hash — safe to return to clients. */
export type PublicUser = Omit<User, 'passwordHash'>;

export function toPublicUser(u: User): PublicUser {
  const { passwordHash: _omit, ...rest } = u;
  void _omit;
  return rest;
}

export interface Session {
  id: string;
  userId: string;
  csrfSecret: string;
  createdAt: number;
  expiresAt: number;
  ip?: string;
  userAgent?: string;
}

export interface AuditEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  target?: string | null;
  ip?: string | null;
  at: number;
  meta?: Record<string, unknown> | null;
}

export interface IUserRepository {
  create(user: User): Promise<void>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  setRole(id: string, role: Role): Promise<void>;
  setStatus(id: string, status: User['status']): Promise<void>;
  setPasswordHash(id: string, passwordHash: string): Promise<void>;
  setEmailVerified(id: string, verified: boolean): Promise<void>;
}

export interface ISessionRepository {
  create(session: Session): Promise<void>;
  findById(id: string): Promise<Session | null>;
  listByUser(userId: string): Promise<Session[]>;
  updateExpiry(id: string, expiresAt: number): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByUser(userId: string): Promise<void>;
  deleteOthers(userId: string, keepId: string): Promise<void>;
}

/** A single-use, hashed, expiring token (email verification / password reset). */
export interface TokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
}

export interface ITokenRepository {
  create(rec: TokenRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<TokenRecord | null>;
  markUsed(id: string, at: number): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
}

export interface IAuditRepository {
  record(entry: AuditEntry): Promise<void>;
  list(limit?: number): Promise<AuditEntry[]>;
}

/** Future exchange-credential vault seam (KMS envelope encryption). Interface only in Phase 2. */
export interface ICredentialVault {
  putEncrypted(userId: string, ciphertext: string): Promise<void>;
  getEncrypted(userId: string): Promise<string | null>;
}
