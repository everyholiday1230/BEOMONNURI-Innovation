import { randomBytes } from 'node:crypto';

/** Opaque 256-bit session id (the cookie value). */
export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/** Per-session CSRF secret (double-submit token value). */
export function newCsrfSecret(): string {
  return randomBytes(24).toString('base64url');
}

export interface SessionTiming {
  /** sliding idle TTL */
  idleMs: number;
  /** absolute cap from creation */
  absoluteMs: number;
}

export const DEFAULT_TIMING: SessionTiming = {
  idleMs: 12 * 60 * 60 * 1000, // 12h
  absoluteMs: 7 * 24 * 60 * 60 * 1000, // 7d
};

/** Compute the next expiry: min(now + idle, createdAt + absolute). */
export function computeExpiry(createdAt: number, now: number, timing: SessionTiming): number {
  return Math.min(now + timing.idleMs, createdAt + timing.absoluteMs);
}

export function isExpired(expiresAt: number, now = Date.now()): boolean {
  return now >= expiresAt;
}
