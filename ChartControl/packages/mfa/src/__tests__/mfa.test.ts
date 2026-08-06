import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  base32Encode, base32Decode,
  generateTotpSecret, otpauthUri, totpAt, verifyTotp, counterForTime, DEFAULT_TOTP,
  generateRecoveryCodes, redeemRecoveryCode, remainingRecoveryCodes, hashRecoveryCode,
  AesGcmSecretCipher,
  recordFailure, isLocked, resetLockout, retryAfterMs, DEFAULT_LOCKOUT,
  evaluateStepUp, mfaRequiredForRole, isStepUpAction, canDisableMfa,
} from '../index';

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (let i = 0; i < 50; i++) {
      const b = randomBytes(1 + (i % 20));
      expect(Buffer.from(base32Decode(base32Encode(b)))).toEqual(Buffer.from(b));
    }
  });
  it('rejects invalid characters', () => {
    expect(() => base32Decode('018!')).toThrow();
  });
});

describe('TOTP (RFC 6238)', () => {
  const t0 = 1_700_000_000_000; // fixed ms

  it('generates a base32 secret and a valid otpauth URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const uri = otpauthUri(secret, 'admin@qt.local');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=QuantumTrade+AI');
  });

  it('verifies the current code and rejects a wrong one', () => {
    const secret = generateTotpSecret();
    const code = totpAt(secret, t0);
    expect(verifyTotp(secret, code, t0).ok).toBe(true);
    expect(verifyTotp(secret, '000000', t0).ok).toBe(false);
  });

  it('accepts within the skew window and rejects outside it', () => {
    const secret = generateTotpSecret();
    const prev = totpAt(secret, t0 - DEFAULT_TOTP.periodSec * 1000); // -1 step
    const far = totpAt(secret, t0 - 3 * DEFAULT_TOTP.periodSec * 1000); // -3 steps
    expect(verifyTotp(secret, prev, t0).ok).toBe(true);
    expect(verifyTotp(secret, far, t0).ok).toBe(false);
  });

  it('prevents replay via lastUsedCounter', () => {
    const secret = generateTotpSecret();
    const code = totpAt(secret, t0);
    const first = verifyTotp(secret, code, t0);
    expect(first.ok).toBe(true);
    const replay = verifyTotp(secret, code, t0, { lastUsedCounter: first.counter });
    expect(replay.ok).toBe(false);
    expect(replay.reason).toMatch(/replay/);
  });

  it('rejects malformed tokens', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, 'abcdef', t0).reason).toMatch(/malformed/);
    expect(verifyTotp(secret, '12345', t0).reason).toMatch(/malformed/);
  });

  it('counterForTime advances every period', () => {
    expect(counterForTime(t0 + 30_000) - counterForTime(t0)).toBe(1);
  });
});

describe('recovery codes', () => {
  it('generates one-time codes stored only as hashes', () => {
    const { codes, records } = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(records).toHaveLength(10);
    // stored records are hashes, not the plaintext codes
    for (const c of codes) expect(records.some((r) => r.hash === c)).toBe(false);
    expect(records[0]!.hash).toBe(hashRecoveryCode(codes[0]!));
  });

  it('redeems a code once and rejects reuse', () => {
    const { codes, records } = generateRecoveryCodes(5);
    expect(remainingRecoveryCodes(records)).toBe(5);
    const idx = redeemRecoveryCode(records, codes[2]!, 1000);
    expect(idx).toBe(2);
    expect(remainingRecoveryCodes(records)).toBe(4);
    expect(redeemRecoveryCode(records, codes[2]!, 2000)).toBe(-1); // reuse rejected
  });

  it('is case/format insensitive and rejects unknown codes', () => {
    const { codes, records } = generateRecoveryCodes(3);
    const messy = codes[0]!.toLowerCase().replace('-', ' ');
    expect(redeemRecoveryCode(records, messy, 1)).toBe(0);
    expect(redeemRecoveryCode(records, 'ZZZZZ-ZZZZZ', 2)).toBe(-1);
  });
});

describe('secret cipher (encryption at rest)', () => {
  it('encrypts/decrypts and produces opaque tokens', () => {
    const cipher = new AesGcmSecretCipher(randomBytes(32));
    const secret = generateTotpSecret();
    const token = cipher.encrypt(secret);
    expect(token.startsWith('v1.')).toBe(true);
    expect(token).not.toContain(secret);
    expect(cipher.decrypt(token)).toBe(secret);
  });
  it('rejects a bad key length', () => {
    expect(() => new AesGcmSecretCipher(randomBytes(16))).toThrow();
  });
  it('fails authentication on tampered ciphertext', () => {
    const cipher = new AesGcmSecretCipher(randomBytes(32));
    const token = cipher.encrypt('secret');
    const parts = token.split('.');
    parts[2] = Buffer.from('tampered').toString('base64');
    expect(() => cipher.decrypt(parts.join('.'))).toThrow();
  });
});

describe('brute-force lockout', () => {
  it('locks after maxFails within the window', () => {
    let s = undefined as ReturnType<typeof recordFailure> | undefined;
    let now = 0;
    for (let i = 0; i < DEFAULT_LOCKOUT.maxFails; i++) { s = recordFailure(s, now); now += 1000; }
    expect(isLocked(s, now)).toBe(true);
    expect(retryAfterMs(s, now)).toBeGreaterThan(0);
  });
  it('unlocks after the cooldown and resets on success', () => {
    let s = undefined as ReturnType<typeof recordFailure> | undefined;
    for (let i = 0; i < DEFAULT_LOCKOUT.maxFails; i++) s = recordFailure(s, 0);
    expect(isLocked(s, DEFAULT_LOCKOUT.lockMs + 1)).toBe(false);
    expect(isLocked(resetLockout(), 0)).toBe(false);
  });
});

describe('step-up + policy', () => {
  it('requires MFA for admin roles only', () => {
    expect(mfaRequiredForRole('ADMIN')).toBe(true);
    expect(mfaRequiredForRole('SUPER_ADMIN')).toBe(true);
    expect(mfaRequiredForRole('USER')).toBe(false);
  });
  it('flags high-risk actions', () => {
    expect(isStepUpAction('kill_switch.update')).toBe(true);
    expect(isStepUpAction('release_gate.update')).toBe(true);
    expect(isStepUpAction('user.read')).toBe(false);
  });
  it('requires a fresh step-up session for high-risk actions', () => {
    const now = 1_000_000;
    expect(evaluateStepUp({ action: 'kill_switch.update', sessionLevel: 'mfa', mfaAuthenticatedAtMs: now, nowMs: now }).reason).toBe('STEP_UP_REQUIRED');
    expect(evaluateStepUp({ action: 'kill_switch.update', sessionLevel: 'stepup', mfaAuthenticatedAtMs: now - 10 * 60_000, nowMs: now }).reason).toBe('STEP_UP_STALE');
    expect(evaluateStepUp({ action: 'kill_switch.update', sessionLevel: 'stepup', mfaAuthenticatedAtMs: now - 60_000, nowMs: now }).allowed).toBe(true);
    expect(evaluateStepUp({ action: 'user.read', sessionLevel: 'none', mfaAuthenticatedAtMs: null, nowMs: now }).allowed).toBe(true);
  });
  it('blocks disabling MFA for the last SUPER_ADMIN', () => {
    expect(canDisableMfa({ role: 'SUPER_ADMIN', userId: 'a' }, ['a']).allowed).toBe(false);
    expect(canDisableMfa({ role: 'SUPER_ADMIN', userId: 'a' }, ['a', 'b']).allowed).toBe(true);
    expect(canDisableMfa({ role: 'ADMIN', userId: 'a' }, ['a']).allowed).toBe(true);
  });
});
