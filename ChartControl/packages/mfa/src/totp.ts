import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { base32Decode, base32Encode } from './base32';

/**
 * RFC 6238 TOTP / RFC 4226 HOTP (SHA-1, 6 digits, 30s period) — the algorithm supported by Google
 * Authenticator / Authy / 1Password. Secrets are raw bytes; callers persist them ENCRYPTED
 * (see `SecretCipher`) and never re-display them after activation.
 */
export interface TotpConfig {
  digits: number; // default 6
  periodSec: number; // default 30
  skewSteps: number; // accepted +/- steps (default 1 → ±30s), capped to bound drift
  algorithm: 'sha1'; // authenticator-standard
}

export const DEFAULT_TOTP: TotpConfig = { digits: 6, periodSec: 30, skewSteps: 1, algorithm: 'sha1' };

/** Generate a new random TOTP secret (160-bit) as base32. */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** otpauth:// URI for QR provisioning (issuer + account label). Secret shown ONCE at setup. */
export function otpauthUri(secretBase32: string, account: string, issuer = 'QuantumTrade AI'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function hotp(secret: Uint8Array, counter: number, cfg: TotpConfig): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter (safe for JS integer range).
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac(cfg.algorithm, Buffer.from(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (bin % 10 ** cfg.digits).toString().padStart(cfg.digits, '0');
}

export function counterForTime(nowMs: number, cfg: TotpConfig = DEFAULT_TOTP): number {
  return Math.floor(nowMs / 1000 / cfg.periodSec);
}

export function totpAt(secretBase32: string, nowMs: number, cfg: TotpConfig = DEFAULT_TOTP): string {
  return hotp(base32Decode(secretBase32), counterForTime(nowMs, cfg), cfg);
}

export interface TotpVerifyResult {
  ok: boolean;
  counter?: number; // the accepted step (for replay tracking)
  reason?: string;
}

/**
 * Verify a submitted code within the skew window using constant-time comparison.
 * `lastUsedCounter` (if provided) prevents replay: a step at or below the last accepted step is rejected.
 */
export function verifyTotp(
  secretBase32: string,
  token: string,
  nowMs: number,
  opts: { lastUsedCounter?: number; cfg?: TotpConfig } = {},
): TotpVerifyResult {
  const cfg = opts.cfg ?? DEFAULT_TOTP;
  const clean = token.replace(/\s/g, '');
  if (!/^\d+$/.test(clean) || clean.length !== cfg.digits) return { ok: false, reason: 'malformed token' };
  const skew = Math.min(Math.max(cfg.skewSteps, 0), 2); // bound drift (≤ ±60s)
  const secret = base32Decode(secretBase32);
  const base = counterForTime(nowMs, cfg);
  for (let d = -skew; d <= skew; d++) {
    const counter = base + d;
    if (counter < 0) continue;
    const expected = hotp(secret, counter, cfg);
    const a = Buffer.from(expected);
    const b = Buffer.from(clean);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      if (opts.lastUsedCounter !== undefined && counter <= opts.lastUsedCounter) {
        return { ok: false, reason: 'replay (code already used)' };
      }
      return { ok: true, counter };
    }
  }
  return { ok: false, reason: 'invalid code' };
}
