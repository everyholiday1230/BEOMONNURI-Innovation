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
