import { randomBytes, createHash } from 'node:crypto';

/** SHA-256 hash (hex) of a token/session secret — what we persist (never the raw value). */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Generate a single-use token: return the raw (emailed to the user) and its hash (stored). */
export function generateToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashToken(raw) };
}
