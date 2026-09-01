import { randomUUID } from 'node:crypto';
import { hashPassword, verifyPassword } from './password';
import { newSessionId, newCsrfSecret, computeExpiry, isExpired, DEFAULT_TIMING, type SessionTiming } from './session';
import { generateToken, hashToken } from './tokens';
import { RegisterInputSchema, LoginInputSchema } from './schemas';
import type { MailProvider } from './mail';
import {
  toPublicUser,
  type IAuditRepository,
  type ISessionRepository,
  type ITokenRepository,
  type IUserRepository,
  type PublicUser,
  type Session,
  type TokenRecord,
  type User,
} from './repositories';

export interface RequestCtx {
  ip?: string;
  userAgent?: string;
  traceId?: string;
  /*
     화면 언어. 인증·재설정 메일을 어느 언어로 쓸지 정하는 데 쓴다.

     ★ 사용자 계정에는 언어를 저장하지 않는다. 요청을 보낸 화면이 자기 언어를
       알려주는 것이 가장 정확하다(설정에서 언어를 바꾸면 즉시 반영된다).
       없으면 메일은 영어로 나간다.
  */
  locale?: string;
}

export type RegisterResult =
  | { ok: true; user: PublicUser }
  | { ok: false; code: 'VALIDATION' | 'EMAIL_TAKEN'; error: string };

export type LoginResult =
  | { ok: true; user: PublicUser; sessionId: string; csrfSecret: string; expiresAt: number }
  | { ok: false; code: 'INVALID_CREDENTIALS' | 'RATE_LIMITED' | 'DISABLED' | 'EMAIL_NOT_VERIFIED'; error: string; retryAfterMs?: number };

export interface DeviceSession {
  id: string;
  ip?: string;
  userAgent?: string;
  createdAt: number;
  expiresAt: number;
  current: boolean;
}

/** Simple in-memory login rate limiter per (ip+email). Redis-backed in the scaling gate. */
export class LoginRateLimiter {
  private hits = new Map<string, { count: number; first: number }>();
  constructor(private readonly max = 5, private readonly windowMs = 15 * 60 * 1000) {}
  private key(ip: string | undefined, email: string) {
    return `${ip ?? '?'}|${email}`;
  }
  check(ip: string | undefined, email: string, now = Date.now()): { allowed: boolean; retryAfterMs?: number } {
    const e = this.hits.get(this.key(ip, email));
    if (!e || now - e.first > this.windowMs) return { allowed: true };
    if (e.count >= this.max) return { allowed: false, retryAfterMs: this.windowMs - (now - e.first) };
    return { allowed: true };
  }
  fail(ip: string | undefined, email: string, now = Date.now()) {
    const k = this.key(ip, email);
    const e = this.hits.get(k);
    if (!e || now - e.first > this.windowMs) this.hits.set(k, { count: 1, first: now });
    else e.count += 1;
  }
  reset(ip: string | undefined, email: string) {
    this.hits.delete(this.key(ip, email));
  }
}

export interface AuthServiceOptions {
  timing?: SessionTiming;
  limiter?: LoginRateLimiter;
  now?: () => number;
  emailTokens?: ITokenRepository;
  resetTokens?: ITokenRepository;
  mail?: MailProvider;
  verificationTtlMs?: number;
  resetTtlMs?: number;
  /*
     로그인에 이메일 인증을 요구할지.

     ★ true 면 이메일을 인증하지 않은 계정은 로그인이 거부되고(EMAIL_NOT_VERIFIED),
       인증 메일을 자동으로 다시 보낸다. 비밀번호 재설정이 이메일로 가는 서비스라
       유효한 이메일을 보장하기 위해 프로덕션 기본값은 true 로 둔다.
     ★ SUPER_ADMIN·ADMIN 은 예외로 둔다 — 메일 문제로 운영자가 관리자 화면에서
       잠기는 것을 막기 위해서다(운영자 계정은 수동으로 만들고 신뢰된다).
  */
  requireEmailVerification?: boolean;
}

const MIN_PASSWORD = 10;
const PW_OK = (pw: string) => typeof pw === 'string' && pw.length >= MIN_PASSWORD;

/**
 * AuthService — register/login/logout, hashed server sessions (raw token only in the cookie),
 * email-verification + password-reset lifecycles (hashed, single-use, expiring tokens), password
 * change, account disable, and session management (device list, revoke one/others). Generic
 * responses avoid user enumeration; audit meta is caller-sanitized (never passwords/tokens).
 */
export class AuthService {
  private readonly timing: SessionTiming;
  private readonly limiter: LoginRateLimiter;
  private readonly now: () => number;
  private readonly emailTokens?: ITokenRepository;
  private readonly resetTokens?: ITokenRepository;
  private readonly mail?: MailProvider;
  private readonly verificationTtlMs: number;
  private readonly resetTtlMs: number;
  private readonly requireEmailVerification: boolean;

  constructor(
    private readonly users: IUserRepository,
    private readonly sessions: ISessionRepository,
    private readonly audit: IAuditRepository,
    opts: AuthServiceOptions = {},
  ) {
    this.timing = opts.timing ?? DEFAULT_TIMING;
    this.limiter = opts.limiter ?? new LoginRateLimiter();
    this.now = opts.now ?? Date.now;
    this.emailTokens = opts.emailTokens;
    this.resetTokens = opts.resetTokens;
    this.mail = opts.mail;
    this.verificationTtlMs = opts.verificationTtlMs ?? 24 * 60 * 60 * 1000;
    this.resetTtlMs = opts.resetTtlMs ?? 60 * 60 * 1000;
    this.requireEmailVerification = opts.requireEmailVerification ?? false;
  }

  private async log(action: string, actorUserId: string | null, ctx: RequestCtx, result: string, meta?: Record<string, unknown>) {
    await this.audit.record({
      id: randomUUID(),
      actorUserId,
      action,
      target: (meta?.target as string) ?? null,
      ip: ctx.ip ?? null,
      at: this.now(),
      // meta MUST be pre-sanitized by callers (never passwords/tokens/secrets).
      meta: { result, traceId: ctx.traceId ?? null, ...(meta ?? {}) },
    });
  }

  async register(input: unknown, ctx: RequestCtx = {}): Promise<RegisterResult> {
    const parsed = RegisterInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'VALIDATION', error: 'invalid email or password (min 10 chars)' };
    if (await this.users.findByEmail(parsed.data.email)) {
      await this.log('auth.register', null, ctx, 'failure', { email: parsed.data.email });
      return { ok: false, code: 'EMAIL_TAKEN', error: 'email already registered' };
    }
    const t = this.now();
    const user: User = {
      id: randomUUID(),
      email: parsed.data.email,
      passwordHash: hashPassword(parsed.data.password),
      role: 'user',
      status: 'active',
      mfaEnabled: false,
      emailVerified: false,
      createdAt: t,
      updatedAt: t,
    };
    await this.users.create(user);
    await this.log('auth.register', user.id, ctx, 'success', { email: user.email });
    return { ok: true, user: toPublicUser(user) };
  }

  /**
   * 외부 신원 제공자(구글 등)로 로그인·가입.
   *
   * ★★ 왜 서비스 안에 두는가
   *
   *   세션 발급·회전·감사기록·비활성 계정 차단이 login() 한 곳에만 있다. OAuth
   *   라우트가 세션을 직접 만들면 그 규칙이 두 곳으로 갈리고, 언젠가 한쪽만
   *   고쳐진다(예: 정지된 계정이 구글 로그인으로는 들어와진다).
   *
   * ★★ 이메일은 **제공자가 소유를 확인한 것만** 넘겨야 한다.
   *
   *   호출자가 `email_verified` 를 확인한 뒤 부른다. 확인되지 않은 주소를 넘기면
   *   남의 이메일로 계정을 가로챌 수 있다(같은 주소의 기존 계정에 붙는다).
   *
   * ★ 비밀번호 없는 계정을 만든다. password_hash 는 NOT NULL 이므로 **검증에
   *   절대 통과할 수 없는 무작위 값**을 넣는다. 그래서 이 계정은 비밀번호
   *   로그인이 불가능하고, 쓰려면 비밀번호 재설정을 거쳐야 한다.
   *
   * ★ 이미 있는 이메일이면 그 계정으로 로그인시킨다(계정을 새로 만들지 않는다).
   *   같은 사람이 비밀번호로 가입했다가 구글로 들어오는 경우가 정상 경로다.
   */
  async loginWithVerifiedEmail(
    rawEmail: string,
    provider: string,
    ctx: RequestCtx = {},
  ): Promise<LoginResult> {
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return { ok: false, code: 'INVALID_CREDENTIALS', error: 'invalid credentials' };
    }

    let user = await this.users.findByEmail(email);
    if (!user) {
      const t0 = this.now();
      const fresh: User = {
        id: randomUUID(),
        email,
        // 절대 검증에 통과하지 않는 값. 비밀번호 로그인 경로를 막는다.
        passwordHash: `federated:${provider}:${randomUUID()}${randomUUID()}`,
        role: 'user',
        status: 'active',
        mfaEnabled: false,
        // 제공자가 소유를 확인했다. 다시 확인시키지 않는다.
        emailVerified: true,
        createdAt: t0,
        updatedAt: t0,
      };
      await this.users.create(fresh);
      await this.log('auth.register', fresh.id, ctx, 'success', { email, provider });
      user = fresh;
    }

    /*
       ★ 정지·삭제된 계정은 여기서도 막는다. 비밀번호 경로에만 검사가 있으면
         정지된 이용자가 구글로 우회해 들어온다.
    */
    if (user.status !== 'active') {
      await this.log('auth.login', user.id, ctx, 'disabled', { email, provider });
      return { ok: false, code: 'DISABLED', error: 'account is not active' };
    }

    const t = this.now();
    // 세션 ID 회전 — 비밀번호 로그인과 동일하게 매번 새 토큰, 해시만 저장한다.
    const rawToken = newSessionId();
    const session: Session = {
      id: hashToken(rawToken),
      userId: user.id,
      csrfSecret: newCsrfSecret(),
      createdAt: t,
      expiresAt: computeExpiry(t, t, this.timing),
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 200),
    };
    await this.sessions.create(session);
    await this.log('auth.login', user.id, ctx, 'success', { email, provider });
    return {
      ok: true,
      user: toPublicUser(user),
      sessionId: rawToken,
      csrfSecret: session.csrfSecret,
      expiresAt: session.expiresAt,
    };
  }

  async login(input: unknown, ctx: RequestCtx = {}): Promise<LoginResult> {    const parsed = LoginInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'INVALID_CREDENTIALS', error: 'invalid credentials' };
    const { email, password } = parsed.data;

    const rl = this.limiter.check(ctx.ip, email, this.now());
    if (!rl.allowed) {
      await this.log('auth.login', null, ctx, 'ratelimited', { email });
      return { ok: false, code: 'RATE_LIMITED', error: 'too many attempts', retryAfterMs: rl.retryAfterMs };
    }

    const user = await this.users.findByEmail(email);
    const ok = user ? verifyPassword(password, user.passwordHash) : verifyPassword(password, DUMMY_HASH);
    if (!user || !ok) {
      this.limiter.fail(ctx.ip, email, this.now());
      await this.log('auth.login', user?.id ?? null, ctx, 'failure', { email });
      return { ok: false, code: 'INVALID_CREDENTIALS', error: 'invalid credentials' };
    }
    if (user.status === 'disabled') {
      await this.log('auth.login', user.id, ctx, 'disabled', { email });
      return { ok: false, code: 'DISABLED', error: 'account disabled' };
    }

    /*
       이메일 인증 요구.

       ★★ 인증하지 않은 계정은 로그인을 막는다. 비밀번호를 잊으면 재설정 링크가
         이메일로 가는데, 인증되지 않은(=존재를 확인 못 한) 주소로는 계정을 되찾을
         수 없다. 그래서 최초 진입 전에 이메일 소유를 확인한다.
       ★ 관리자(SUPER_ADMIN·ADMIN)는 예외다 — 메일 장애로 운영자가 관리자 화면에서
         잠기면 서비스 대응이 마비된다. 운영자 계정은 수동 생성·신뢰된다.
       ★ 막을 때 인증 메일을 다시 보낸다(있으면). 사용자가 바로 행동할 수 있게.
    */
    /* role 은 타입상 'user'|'admin' 이지만 런타임엔 'SUPER_ADMIN'·'ADMIN' 등이 저장된다
       (두 RBAC 체계가 섞여 있다). 문자열로 정규화해 비교한다. */
    const roleStr = String(user.role).toUpperCase();
    const isOperator = roleStr === 'SUPER_ADMIN' || roleStr === 'ADMIN';
    if (this.requireEmailVerification && !user.emailVerified && !isOperator) {
      await this.log('auth.login', user.id, ctx, 'email_unverified', { email });
      // 인증 메일 재발송 (실패는 로그인 거부 응답을 바꾸지 않는다)
      try { await this.requestEmailVerification(user.id, ctx); } catch { /* 재발송 실패는 무시 */ }
      return { ok: false, code: 'EMAIL_NOT_VERIFIED', error: 'email not verified' };
    }

    this.limiter.reset(ctx.ip, email);
    const t = this.now();
    // Session ID ROTATION: a fresh random token per login; only its HASH is stored.
    const rawToken = newSessionId();
    const session: Session = {
      id: hashToken(rawToken),
      userId: user.id,
      csrfSecret: newCsrfSecret(),
      createdAt: t,
      expiresAt: computeExpiry(t, t, this.timing),
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 200),
    };
    await this.sessions.create(session);
    await this.log('auth.login', user.id, ctx, 'success', { email });
    return { ok: true, user: toPublicUser(user), sessionId: rawToken, csrfSecret: session.csrfSecret, expiresAt: session.expiresAt };
  }

  /**
   * Mint a fresh session for an already-authenticated user (e.g. after a successful MFA challenge or
   * recovery-code login). Session-ID ROTATION: a new random token; only its hash is stored. Used by the
   * MFA login flow so the pre-MFA "pending" state never yields a full session.
   */
  async createSessionForUser(userId: string, ctx: RequestCtx = {}): Promise<{ ok: true; user: PublicUser; sessionId: string; csrfSecret: string; expiresAt: number } | { ok: false; code: 'NOT_FOUND' | 'DISABLED'; error: string }> {
    const user = await this.users.findById(userId);
    if (!user) return { ok: false, code: 'NOT_FOUND', error: 'user not found' };
    if (user.status === 'disabled') return { ok: false, code: 'DISABLED', error: 'account disabled' };
    const t = this.now();
    const rawToken = newSessionId();
    const session: Session = {
      id: hashToken(rawToken),
      userId: user.id,
      csrfSecret: newCsrfSecret(),
      createdAt: t,
      expiresAt: computeExpiry(t, t, this.timing),
      ip: ctx.ip,
      userAgent: ctx.userAgent?.slice(0, 200),
    };
    await this.sessions.create(session);
    await this.log('auth.mfa.session', user.id, ctx, 'success');
    return { ok: true, user: toPublicUser(user), sessionId: rawToken, csrfSecret: session.csrfSecret, expiresAt: session.expiresAt };
  }

  /** Verify a user's password for step-up re-authentication (no session side effects). */
  async checkPassword(userId: string, password: string): Promise<boolean> {
    const u = await this.users.findById(userId);
    return u ? verifyPassword(password, u.passwordHash) : false;
  }

  async logout(rawToken: string | undefined, ctx: RequestCtx = {}): Promise<void> {
    if (!rawToken) return;
    const id = hashToken(rawToken);
    const s = await this.sessions.findById(id);
    await this.sessions.delete(id);
    if (s) await this.log('auth.logout', s.userId, ctx, 'success');
  }

  /** Validate a raw session token (hashes it); slides idle expiry. */
  async validateSession(rawToken: string | undefined): Promise<{ user: PublicUser; session: Session } | null> {
    if (!rawToken) return null;
    const id = hashToken(rawToken);
    const session = await this.sessions.findById(id);
    if (!session) return null;
    const t = this.now();
    if (isExpired(session.expiresAt, t)) {
      await this.sessions.delete(session.id);
      return null;
    }
    const user = await this.users.findById(session.userId);
    if (!user || user.status === 'disabled') {
      await this.sessions.delete(session.id);
      return null;
    }
    const nextExp = computeExpiry(session.createdAt, t, this.timing);
    if (nextExp !== session.expiresAt) {
      await this.sessions.updateExpiry(session.id, nextExp);
      session.expiresAt = nextExp;
    }
    return { user: toPublicUser(user), session };
  }

  // ---- session management ----
  async listSessions(userId: string, currentRawToken?: string): Promise<DeviceSession[]> {
    const currentId = currentRawToken ? hashToken(currentRawToken) : undefined;
    const list = await this.sessions.listByUser(userId);
    return list.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, expiresAt: s.expiresAt, current: s.id === currentId }));
  }
  async revokeSession(userId: string, sessionId: string, ctx: RequestCtx = {}): Promise<boolean> {
    const s = await this.sessions.findById(sessionId);
    if (!s || s.userId !== userId) return false; // ownership enforced (no cross-user revoke)
    await this.sessions.delete(sessionId);
    await this.log('auth.session.revoke', userId, ctx, 'success', { target: sessionId });
    return true;
  }
  async revokeOtherSessions(userId: string, currentRawToken: string, ctx: RequestCtx = {}): Promise<void> {
    await this.sessions.deleteOthers(userId, hashToken(currentRawToken));
    await this.log('auth.session.revoke_others', userId, ctx, 'success');
  }

  // ---- password change ----
  async changePassword(userId: string, oldPassword: string, newPassword: string, ctx: RequestCtx = {}): Promise<{ ok: boolean; error?: string }> {
    const user = await this.users.findById(userId);
    if (!user || !verifyPassword(oldPassword, user.passwordHash)) {
      await this.log('auth.password.change', userId, ctx, 'failure');
      return { ok: false, error: 'invalid credentials' };
    }
    if (!PW_OK(newPassword)) return { ok: false, error: 'password too short (min 10)' };
    await this.users.setPasswordHash(userId, hashPassword(newPassword));
    await this.sessions.deleteByUser(userId); // policy: invalidate all sessions on password change
    await this.log('auth.password.change', userId, ctx, 'success');
    return { ok: true };
  }

  async disableAccount(userId: string, ctx: RequestCtx = {}): Promise<void> {
    await this.users.setStatus(userId, 'disabled');
    await this.sessions.deleteByUser(userId);
    await this.log('auth.account.disable', userId, ctx, 'success', { target: userId });
  }

  // ---- email verification lifecycle ----
  async requestEmailVerification(userId: string, ctx: RequestCtx = {}): Promise<void> {
    if (!this.emailTokens) return;
    const user = await this.users.findById(userId);
    if (!user) return;
    const { raw, hash } = generateToken();
    const rec: TokenRecord = { id: randomUUID(), userId, tokenHash: hash, expiresAt: this.now() + this.verificationTtlMs, usedAt: null, createdAt: this.now() };
    await this.emailTokens.create(rec);
    await this.mail?.send({ to: user.email, subject: 'Verify your email', text: 'Use the enclosed token to verify your email.', meta: { token: raw, kind: 'verify', ...(ctx.locale ? { locale: ctx.locale } : {}) } });
    await this.log('auth.email.verify_request', userId, ctx, 'success');
  }
  async verifyEmail(rawToken: string, ctx: RequestCtx = {}): Promise<{ ok: boolean }> {
    if (!this.emailTokens) return { ok: false };
    const rec = await this.emailTokens.findByHash(hashToken(rawToken));
    if (!rec || rec.usedAt || rec.expiresAt < this.now()) {
      await this.log('auth.email.verify', rec?.userId ?? null, ctx, 'failure');
      return { ok: false };
    }
    await this.emailTokens.markUsed(rec.id, this.now());
    await this.users.setEmailVerified(rec.userId, true);
    await this.log('auth.email.verify', rec.userId, ctx, 'success');
    return { ok: true };
  }

  // ---- password reset lifecycle (generic responses, no enumeration) ----
  async requestPasswordReset(email: string, ctx: RequestCtx = {}): Promise<void> {
    const user = await this.users.findByEmail(String(email ?? '').toLowerCase());
    if (user && this.resetTokens) {
      const { raw, hash } = generateToken();
      const rec: TokenRecord = { id: randomUUID(), userId: user.id, tokenHash: hash, expiresAt: this.now() + this.resetTtlMs, usedAt: null, createdAt: this.now() };
      await this.resetTokens.create(rec);
      await this.mail?.send({ to: user.email, subject: 'Password reset', text: 'Use the enclosed token to reset your password.', meta: { token: raw, kind: 'reset', ...(ctx.locale ? { locale: ctx.locale } : {}) } });
    }
    // Always log + return generically (no user enumeration).
    await this.log('auth.password.reset_request', user?.id ?? null, ctx, 'accepted', { email: String(email ?? '').toLowerCase() });
  }
  async resetPassword(rawToken: string, newPassword: string, ctx: RequestCtx = {}): Promise<{ ok: boolean; error?: string }> {
    if (!this.resetTokens) return { ok: false, error: 'unavailable' };
    if (!PW_OK(newPassword)) return { ok: false, error: 'password too short (min 10)' };
    const rec = await this.resetTokens.findByHash(hashToken(rawToken));
    if (!rec || rec.usedAt || rec.expiresAt < this.now()) {
      await this.log('auth.password.reset', rec?.userId ?? null, ctx, 'failure');
      return { ok: false, error: 'invalid or expired token' };
    }
    await this.resetTokens.markUsed(rec.id, this.now());
    await this.users.setPasswordHash(rec.userId, hashPassword(newPassword));
    await this.sessions.deleteByUser(rec.userId); // invalidate all sessions after reset
    await this.log('auth.password.reset', rec.userId, ctx, 'success');
    return { ok: true };
  }
}

const DUMMY_HASH = hashPassword('__dummy_password_for_timing__');
