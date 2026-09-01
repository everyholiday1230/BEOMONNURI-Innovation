import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  verifyCsrf,
  csrfTokenFor,
  can,
  AuthService,
  LoginRateLimiter,
  MemoryUserRepository,
  MemorySessionRepository,
  MemoryAuditRepository,
  MemoryTokenRepository,
  MailSink,
} from '../index';

function svc(opts?: { limiter?: LoginRateLimiter }) {
  const users = new MemoryUserRepository();
  const sessions = new MemorySessionRepository();
  const audit = new MemoryAuditRepository();
  const service = new AuthService(users, sessions, audit, opts);
  return { users, sessions, audit, service };
}

describe('password hashing (scrypt)', () => {
  it('hashes and verifies; wrong password fails; never stores plaintext', () => {
    const h = hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(h).not.toContain('correct horse battery');
    expect(verifyPassword('correct horse battery', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });
  it('rejects malformed stored hashes without throwing', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false);
  });
});

describe('csrf signed double-submit (HMAC, session-bound)', () => {
  it('passes only when header==cookie==HMAC(secret,key)', () => {
    const key = 'server-key';
    const token = csrfTokenFor('sess-secret', key);
    expect(verifyCsrf(token, token, 'sess-secret', key)).toBe(true);
    expect(verifyCsrf(token, 'x', 'sess-secret', key)).toBe(false);
    expect(verifyCsrf(token, token, 'other-secret', key)).toBe(false); // not session-bound
    expect(verifyCsrf(token, token, 'sess-secret', 'wrong-key')).toBe(false); // signature
    expect(verifyCsrf(undefined, token, 'sess-secret', key)).toBe(false);
  });
});

describe('rbac', () => {
  it('user has account perms, not admin; admin has all', () => {
    expect(can('user', 'account:read')).toBe(true);
    expect(can('user', 'admin:users:write')).toBe(false);
    expect(can('admin', 'admin:users:write')).toBe(true);
  });
});

describe('AuthService', () => {
  it('registers, logs in, validates session, logs out', async () => {
    const { service } = svc();
    const reg = await service.register({ email: 'A@Ex.com', password: 'longenough123' });
    expect(reg.ok).toBe(true);
    if (reg.ok) expect(reg.user.email).toBe('a@ex.com'); // lowercased, no passwordHash
    expect((reg as { user?: { passwordHash?: string } }).user?.passwordHash).toBeUndefined();

    const login = await service.login({ email: 'a@ex.com', password: 'longenough123' }, { ip: '1.1.1.1' });
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    const v = await service.validateSession(login.sessionId);
    expect(v?.user.email).toBe('a@ex.com');

    await service.logout(login.sessionId);
    expect(await service.validateSession(login.sessionId)).toBeNull();
  });

  it('rejects duplicate email', async () => {
    const { service } = svc();
    await service.register({ email: 'dup@ex.com', password: 'longenough123' });
    const again = await service.register({ email: 'dup@ex.com', password: 'longenough123' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('EMAIL_TAKEN');
  });

  it('returns generic INVALID_CREDENTIALS for wrong password and unknown email', async () => {
    const { service } = svc();
    await service.register({ email: 'u@ex.com', password: 'longenough123' });
    const wrong = await service.login({ email: 'u@ex.com', password: 'nope' });
    const unknown = await service.login({ email: 'ghost@ex.com', password: 'whatever123' });
    expect(wrong.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe('INVALID_CREDENTIALS');
    if (!unknown.ok) expect(unknown.code).toBe('INVALID_CREDENTIALS');
  });

  it('rate-limits after repeated failures', async () => {
    const { service } = svc({ limiter: new LoginRateLimiter(3, 60_000) });
    await service.register({ email: 'rl@ex.com', password: 'longenough123' });
    for (let i = 0; i < 3; i++) await service.login({ email: 'rl@ex.com', password: 'bad' }, { ip: '9.9.9.9' });
    const blocked = await service.login({ email: 'rl@ex.com', password: 'longenough123' }, { ip: '9.9.9.9' });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe('RATE_LIMITED');
  });

  it('expired session is invalid', async () => {
    let t = 1_000_000;
    const users = new MemoryUserRepository();
    const sessions = new MemorySessionRepository();
    const audit = new MemoryAuditRepository();
    const service = new AuthService(users, sessions, audit, {
      timing: { idleMs: 1000, absoluteMs: 10_000 },
      now: () => t,
    });
    await service.register({ email: 't@ex.com', password: 'longenough123' });
    const login = await service.login({ email: 't@ex.com', password: 'longenough123' });
    if (!login.ok) throw new Error('login failed');
    t += 2000; // past idle TTL
    expect(await service.validateSession(login.sessionId)).toBeNull();
  });

  it('records audit events (no password in meta)', async () => {
    const { service, audit } = svc();
    await service.register({ email: 'aud@ex.com', password: 'longenough123' });
    await service.login({ email: 'aud@ex.com', password: 'longenough123' });
    const entries = await audit.list();
    expect(entries.some((e) => e.action === 'auth.register')).toBe(true);
    expect(entries.some((e) => e.action === 'auth.login' && (e.meta as { result?: string })?.result === 'success')).toBe(true);
    expect(JSON.stringify(entries)).not.toContain('longenough123');
  });
});


describe('이메일 인증 필수 (requireEmailVerification)', () => {
  function svcVerify() {
    const users = new MemoryUserRepository();
    const sessions = new MemorySessionRepository();
    const audit = new MemoryAuditRepository();
    const emailTokens = new MemoryTokenRepository();
    const mail = new MailSink();
    const service = new AuthService(users, sessions, audit, {
      emailTokens, mail, requireEmailVerification: true,
    });
    return { users, service, mail };
  }

  it('★ 인증 안 한 계정은 로그인이 EMAIL_NOT_VERIFIED 로 막히고, 인증 메일을 다시 보낸다', async () => {
    const { service, mail } = svcVerify();
    await service.register({ email: 'u@ex.com', password: 'longenough123' });
    mail.clear();
    const r = await service.login({ email: 'u@ex.com', password: 'longenough123' });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('EMAIL_NOT_VERIFIED');
    // 막을 때 인증 메일을 재발송한다
    expect(mail.sent.some((m) => m.meta?.kind === 'verify')).toBe(true);
  });

  it('이메일을 인증하면 로그인된다', async () => {
    const { users, service } = svcVerify();
    const reg = await service.register({ email: 'v@ex.com', password: 'longenough123' });
    const uid = reg.ok ? reg.user.id : '';
    await users.setEmailVerified(uid, true);
    const r = await service.login({ email: 'v@ex.com', password: 'longenough123' });
    expect(r.ok).toBe(true);
  });

  it('★ 관리자(SUPER_ADMIN)는 미인증이어도 로그인된다 (메일 장애로 운영자가 잠기지 않게)', async () => {
    const { users, service } = svcVerify();
    const reg = await service.register({ email: 'admin@ex.com', password: 'longenough123' });
    const uid = reg.ok ? reg.user.id : '';
    await users.setRole(uid, 'SUPER_ADMIN' as never);
    const r = await service.login({ email: 'admin@ex.com', password: 'longenough123' });
    expect(r.ok).toBe(true);
  });

  it('요구가 꺼져 있으면(기본) 미인증도 로그인된다', async () => {
    const users = new MemoryUserRepository();
    const service = new AuthService(users, new MemorySessionRepository(), new MemoryAuditRepository(), {});
    await service.register({ email: 'off@ex.com', password: 'longenough123' });
    const r = await service.login({ email: 'off@ex.com', password: 'longenough123' });
    expect(r.ok).toBe(true);
  });
});

/* ============================================================
   외부 신원 제공자 로그인 (구글)
   ------------------------------------------------------------
   ★★ 이 경로가 비밀번호 경로의 보호를 우회하면 안 된다. 특히:
     · 정지된 계정이 구글로는 들어와지는 것
     · 비밀번호 없는 계정에 비밀번호로 로그인되는 것
     · 같은 이메일로 계정이 두 개 생기는 것
   ============================================================ */
describe('loginWithVerifiedEmail (federated)', () => {
  it('[1] 처음 오는 이메일이면 계정을 만들고 세션을 준다', async () => {
    const { service, users } = svc();
    const r = await service.loginWithVerifiedEmail('New.User@Gmail.com', 'google');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessionId).toBeTruthy();
    expect(r.csrfSecret).toBeTruthy();
    // 이메일은 소문자로 정규화된다 — 대소문자로 계정이 갈리면 안 된다.
    expect(r.user.email).toBe('new.user@gmail.com');
    expect(await users.findByEmail('new.user@gmail.com')).toBeTruthy();
  });

  it('[2] 제공자가 확인한 주소이므로 이메일 인증됨으로 만든다', async () => {
    const { service, users } = svc();
    await service.loginWithVerifiedEmail('v@gmail.com', 'google');
    const u = await users.findByEmail('v@gmail.com');
    expect(u!.emailVerified).toBe(true);
  });

  it('[3] ★★ 두 번 로그인해도 계정은 하나다 (중복 가입 없음)', async () => {
    const { service, users } = svc();
    const a = await service.loginWithVerifiedEmail('same@gmail.com', 'google');
    const b = await service.loginWithVerifiedEmail('same@gmail.com', 'google');
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.user.id).toBe(a.user.id);
    // 세션은 매번 새로 발급된다(세션 ID 회전).
    expect(b.sessionId).not.toBe(a.sessionId);
    expect(await users.findByEmail('same@gmail.com')).toBeTruthy();
  });

  it('[4] ★★ 비밀번호로 만든 기존 계정에 붙는다 (계정을 새로 만들지 않는다)', async () => {
    const { service } = svc();
    const reg = await service.register({ email: 'both@gmail.com', password: 'longenough123' });
    expect(reg.ok).toBe(true);
    const r = await service.loginWithVerifiedEmail('both@gmail.com', 'google');
    expect(r.ok).toBe(true);
    if (!r.ok || !reg.ok) return;
    expect(r.user.id).toBe(reg.user.id);
  });

  it('[5] ★★ 구글로 만든 계정은 비밀번호 로그인이 불가능하다', async () => {
    const { service, users } = svc();
    await service.loginWithVerifiedEmail('nopw@gmail.com', 'google');
    const u = await users.findByEmail('nopw@gmail.com');
    // 저장된 값이 scrypt 형식이 아니므로 어떤 비밀번호도 검증에 통과할 수 없다.
    expect(u!.passwordHash.startsWith('scrypt$')).toBe(false);
    const attempt = await service.login({ email: 'nopw@gmail.com', password: 'anything-at-all' });
    expect(attempt.ok).toBe(false);
  });

  it('[6] ★★ 정지된 계정은 구글로도 들어올 수 없다', async () => {
    const { service, users } = svc();
    const first = await service.loginWithVerifiedEmail('banned@gmail.com', 'google');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const u = await users.findByEmail('banned@gmail.com');
    await users.setStatus(u!.id, 'disabled');
    const again = await service.loginWithVerifiedEmail('banned@gmail.com', 'google');
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('DISABLED');
  });

  it('[7] 이메일 형식이 아니면 거부한다', async () => {
    const { service } = svc();
    expect((await service.loginWithVerifiedEmail('', 'google')).ok).toBe(false);
    expect((await service.loginWithVerifiedEmail('not-an-email', 'google')).ok).toBe(false);
  });
});
