import { describe, it, expect } from 'vitest';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { Hono } from 'hono';
import { AuthService, MailSink } from '@quantumtrade/auth';
import { totpAt, AesGcmSecretCipher } from '@quantumtrade/mfa';
import { openDb } from '../db/sqlite';
import { SqliteUserRepository, SqliteSessionRepository, SqliteAuditRepository, SqliteTokenRepository } from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { createAuthRouter } from '../auth-routes';
import { SqliteMfaRepo } from '../db/mfa-repo';
import { createMfaRouter, mfaChallengeHash } from '../mfa/mfa-routes';
import { randomUUID } from 'node:crypto';

const ORIGIN = 'http://localhost:5173';
const MFA_COOKIE = 'qt_mfa';

function build() {
  const db = openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    mail: new MailSink(),
  });
  const mfaRepo = new SqliteMfaRepo(db);
  const cipher = new AesGcmSecretCipher(Buffer.alloc(32, 9));
  const gate = {
    isEnabled: (uid: string) => mfaRepo.isEnabled(uid),
    startChallenge: async (uid: string) => { const raw = randomUUID() + randomUUID(); await mfaRepo.createChallenge(mfaChallengeHash(raw), uid, 300_000); return raw; },
    cookie: MFA_COOKIE, ttlMs: 300_000,
  };
  const app = new Hono();
  app.route('/api', createAuthRouter({ service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN], mfa: gate }));
  app.route('/api', createMfaRouter({ service, repo: mfaRepo, cipher, csrfKey: 'k', corsOrigins: [ORIGIN], cookieName: 'qt_session', challengeCookie: MFA_COOKIE, secureCookies: false, activeSuperAdminIds: () => [] }));
  return { app, db, mfaRepo };
}

function jarFrom(res: Response, jar: Record<string, string> = {}) {
  for (const sc of res.headers.getSetCookie?.() ?? []) { const [p] = sc.split(';'); const i = p!.indexOf('='); const k = p!.slice(0, i); const v = p!.slice(i + 1); if (v === '') delete jar[k]; else jar[k] = v; }
  return jar;
}
const cj = (j: Record<string, string>) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
type App = ReturnType<typeof build>['app'];
async function rq(app: App, method: string, path: string, o: { jar?: Record<string, string>; csrf?: boolean; body?: unknown } = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN };
  if (o.jar) h['cookie'] = cj(o.jar);
  if (o.csrf && o.jar?.['qt_csrf']) h['x-csrf-token'] = o.jar['qt_csrf'];
  const init: RequestInit = { method, headers: h };
  if (method !== 'GET') init.body = JSON.stringify(o.body ?? {});
  return app.request(path, init);
}

async function registerLogin(app: App, email: string, password = 'password1234') {
  await rq(app, 'POST', '/api/auth/register', { body: { email, password } });
  const res = await rq(app, 'POST', '/api/auth/login', { body: { email, password } });
  const jar = jarFrom(res);
  return { jar, body: await res.json() as any };
}

/** Enroll MFA for a logged-in jar; returns the TOTP secret + recovery codes. */
async function enroll(app: App, jar: Record<string, string>, password = 'password1234') {
  const setup = await rq(app, 'POST', '/api/auth/mfa/totp/setup', { jar, csrf: true, body: { password } });
  const { secret } = await setup.json() as any;
  const code = totpAt(secret, Date.now());
  const verify = await rq(app, 'POST', '/api/auth/mfa/totp/verify-enrollment', { jar, csrf: true, body: { code } });
  const { recoveryCodes } = await verify.json() as any;
  return { secret, recoveryCodes, verifyStatus: verify.status };
}

describe('MFA API (Phase 6 §5)', () => {
  it('[1] status is disabled initially', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'a@ex.com');
    const s = await (await rq(app, 'GET', '/api/account/mfa/status', { jar })).json() as any;
    expect(s.enabled).toBe(false);
  });

  it('[2] setup requires correct password re-auth', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'b@ex.com');
    expect((await rq(app, 'POST', '/api/auth/mfa/totp/setup', { jar, csrf: true, body: { password: 'wrong' } })).status).toBe(403);
  });

  it('[3] setup returns an otpauth URI + secret and marks pending', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'c@ex.com');
    const r = await rq(app, 'POST', '/api/auth/mfa/totp/setup', { jar, csrf: true, body: { password: 'password1234' } });
    const j = await r.json() as any;
    expect(j.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    expect(j.secret).toMatch(/^[A-Z2-7]+$/);
    expect((await (await rq(app, 'GET', '/api/account/mfa/status', { jar })).json() as any).pendingSetup).toBe(true);
  });

  it('[4] verify-enrollment rejects a wrong code', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'd@ex.com');
    await rq(app, 'POST', '/api/auth/mfa/totp/setup', { jar, csrf: true, body: { password: 'password1234' } });
    expect((await rq(app, 'POST', '/api/auth/mfa/totp/verify-enrollment', { jar, csrf: true, body: { code: '000000' } })).status).toBe(400);
  });

  it('[5] verify-enrollment activates MFA and returns recovery codes ONCE', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'e@ex.com');
    const { recoveryCodes, verifyStatus } = await enroll(app, jar);
    expect(verifyStatus).toBe(200);
    expect(recoveryCodes).toHaveLength(10);
  });

  it('[6] secret is stored ENCRYPTED and recovery codes as HASHES (no plaintext at rest)', async () => {
    const { app, db } = build();
    const { jar } = await registerLogin(app, 'f@ex.com');
    const { secret, recoveryCodes } = await enroll(app, jar);
    const row = db.prepare('SELECT secret_encrypted, recovery_codes_json FROM mfa_credentials').get() as any;
    expect(row.secret_encrypted).toContain('v1.'); // AES-GCM token
    expect(row.secret_encrypted).not.toContain(secret);
    expect(row.recovery_codes_json).not.toContain(recoveryCodes[0]); // only hashes stored
  });

  it('[7] login with MFA enabled returns a pending challenge (no session)', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'g@ex.com');
    await enroll(app, jar);
    const res = await rq(app, 'POST', '/api/auth/login', { body: { email: 'g@ex.com', password: 'password1234' } });
    const body = await res.json() as any;
    expect(body.mfaRequired).toBe(true);
    const newJar = jarFrom(res);
    expect(newJar['qt_session']).toBeUndefined(); // NO full session yet
    expect(newJar[MFA_COOKIE]).toBeTruthy(); // pending challenge cookie
  });

  it('[8] wrong TOTP challenge is rejected', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'h@ex.com');
    await enroll(app, jar);
    const login = await rq(app, 'POST', '/api/auth/login', { body: { email: 'h@ex.com', password: 'password1234' } });
    const pend = jarFrom(login);
    expect((await rq(app, 'POST', '/api/auth/mfa/challenge', { jar: pend, body: { code: '000000' } })).status).toBe(401);
  });

  it('[9] correct TOTP challenge issues a rotated session', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'i@ex.com');
    const { secret } = await enroll(app, jar);
    const login = await rq(app, 'POST', '/api/auth/login', { body: { email: 'i@ex.com', password: 'password1234' } });
    const pend = jarFrom(login);
    const res = await rq(app, 'POST', '/api/auth/mfa/challenge', { jar: pend, body: { code: totpAt(secret, Date.now()) } });
    expect(res.status).toBe(200);
    const finalJar = jarFrom(res, { ...pend });
    expect(finalJar['qt_session']).toBeTruthy(); // session issued
    // authenticated: /auth/me works
    expect((await rq(app, 'GET', '/api/auth/me', { jar: finalJar })).status).toBe(200);
  });

  it('[10] TOTP replay (same code twice) is rejected', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'j@ex.com');
    const { secret } = await enroll(app, jar);
    const code = totpAt(secret, Date.now());
    const l1 = jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email: 'j@ex.com', password: 'password1234' } }));
    expect((await rq(app, 'POST', '/api/auth/mfa/challenge', { jar: l1, body: { code } })).status).toBe(200);
    const l2 = jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email: 'j@ex.com', password: 'password1234' } }));
    expect((await rq(app, 'POST', '/api/auth/mfa/challenge', { jar: l2, body: { code } })).status).toBe(401); // replay/rotated code
  });

  it('[11] recovery-code login works and [12] the code is single-use', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'k@ex.com');
    const { recoveryCodes } = await enroll(app, jar);
    const l1 = jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email: 'k@ex.com', password: 'password1234' } }));
    const r1 = await rq(app, 'POST', '/api/auth/mfa/recovery', { jar: l1, body: { code: recoveryCodes[0] } });
    expect(r1.status).toBe(200);
    expect(jarFrom(r1, { ...l1 })['qt_session']).toBeTruthy();
    const l2 = jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email: 'k@ex.com', password: 'password1234' } }));
    expect((await rq(app, 'POST', '/api/auth/mfa/recovery', { jar: l2, body: { code: recoveryCodes[0] } })).status).toBe(401); // reused
  });

  it('[13] disable requires password + code and [14] then login needs no MFA', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'l@ex.com');
    const { secret } = await enroll(app, jar);
    // wrong code rejected
    expect((await rq(app, 'POST', '/api/account/mfa/disable', { jar, csrf: true, body: { password: 'password1234', code: '000000' } })).status).toBe(400);
    const ok = await rq(app, 'POST', '/api/account/mfa/disable', { jar, csrf: true, body: { password: 'password1234', code: totpAt(secret, Date.now()) } });
    expect(ok.status).toBe(200);
    const login = await rq(app, 'POST', '/api/auth/login', { body: { email: 'l@ex.com', password: 'password1234' } });
    expect((await login.json() as any).mfaRequired).toBeUndefined(); // full session again
    expect(jarFrom(login)['qt_session']).toBeTruthy();
  });

  it('[15] regenerate recovery codes requires a valid TOTP', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'm@ex.com');
    const { secret, recoveryCodes } = await enroll(app, jar);
    expect((await rq(app, 'POST', '/api/account/mfa/regenerate-recovery', { jar, csrf: true, body: { code: '000000' } })).status).toBe(400);
    const r = await rq(app, 'POST', '/api/account/mfa/regenerate-recovery', { jar, csrf: true, body: { code: totpAt(secret, Date.now()) } });
    const fresh = (await r.json() as any).recoveryCodes;
    expect(fresh).toHaveLength(10);
    expect(fresh[0]).not.toBe(recoveryCodes[0]);
  });

  it('[16] brute-force lockout after repeated failed challenges (429)', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'n@ex.com');
    await enroll(app, jar);
    const pend = jarFrom(await rq(app, 'POST', '/api/auth/login', { body: { email: 'n@ex.com', password: 'password1234' } }));
    let locked = false;
    for (let i = 0; i < 7; i++) { if ((await rq(app, 'POST', '/api/auth/mfa/challenge', { jar: pend, body: { code: '000000' } })).status === 429) { locked = true; break; } }
    expect(locked).toBe(true);
  });

  it('[17] CSRF is required for MFA mutations', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'o@ex.com');
    expect((await rq(app, 'POST', '/api/auth/mfa/totp/setup', { jar, csrf: false, body: { password: 'password1234' } })).status).toBe(403);
  });

  it('[18] step-up requires a valid TOTP for an authenticated session', async () => {
    const { app } = build();
    const { jar } = await registerLogin(app, 'p@ex.com');
    const { secret } = await enroll(app, jar);
    expect((await rq(app, 'POST', '/api/auth/mfa/step-up', { jar, csrf: true, body: { code: '000000' } })).status).toBe(401);
    const ok = await rq(app, 'POST', '/api/auth/mfa/step-up', { jar, csrf: true, body: { code: totpAt(secret, Date.now()) } });
    expect(ok.status).toBe(200);
    expect((await ok.json() as any).level).toBe('stepup');
  });
});
