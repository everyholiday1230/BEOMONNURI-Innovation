import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { base32Encode } from './base32';

/**
 * Recovery (backup) codes. Plaintext codes are shown ONCE at generation; only SHA-256 hashes are
 * stored. Each code is single-use (marked used on redemption). Constant-time comparison.
 */
export interface RecoveryCodeRecord {
  hash: string; // sha256 hex of the normalized code
  usedAt: number | null;
}

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeCode(code)).digest('hex');
}

/** Generate N human-typable codes (base32, grouped) and their stored hash records. */
export function generateRecoveryCodes(count = 10, bytesPerCode = 8): { codes: string[]; records: RecoveryCodeRecord[] } {
  const codes: string[] = [];
  const records: RecoveryCodeRecord[] = [];
  for (let i = 0; i < count; i++) {
    const raw = base32Encode(randomBytes(bytesPerCode)).slice(0, 10);
    const pretty = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    codes.push(pretty);
    records.push({ hash: hashRecoveryCode(pretty), usedAt: null });
  }
  return { codes, records };
}

/**
 * Redeem a code against the stored records. Returns the matched index (and mutates usedAt) or -1.
 * Rejects already-used codes. Constant-time hash comparison.
 */
export function redeemRecoveryCode(records: RecoveryCodeRecord[], submitted: string, nowMs: number): number {
  const target = Buffer.from(hashRecoveryCode(submitted), 'hex');
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]!;
    const stored = Buffer.from(rec.hash, 'hex');
    if (stored.length === target.length && timingSafeEqual(stored, target)) {
      if (rec.usedAt !== null) return -1; // already used
      rec.usedAt = nowMs;
      return i;
    }
  }
  return -1;
}

export function remainingRecoveryCodes(records: RecoveryCodeRecord[]): number {
  return records.filter((r) => r.usedAt === null).length;
}
