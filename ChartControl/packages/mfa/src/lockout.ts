/**
 * Brute-force lockout for MFA verification (per-actor). Fixed attempts within a window; on exceed,
 * lock for a cooldown. Pure/injectable clock so it is deterministically unit-tested and can be backed
 * by Redis for multinode (see @quantumtrade/cluster) without changing the algorithm.
 */
export interface LockoutState {
  fails: number;
  firstFailMs: number;
  lockedUntilMs: number;
}

export interface LockoutConfig {
  maxFails: number; // default 5
  windowMs: number; // default 15 min
  lockMs: number; // default 15 min
}

export const DEFAULT_LOCKOUT: LockoutConfig = { maxFails: 5, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };

export function isLocked(s: LockoutState | undefined, nowMs: number): boolean {
  return !!s && s.lockedUntilMs > nowMs;
}

/** Record a failure; returns the new state (locked when threshold exceeded). */
export function recordFailure(s: LockoutState | undefined, nowMs: number, cfg: LockoutConfig = DEFAULT_LOCKOUT): LockoutState {
  if (!s || nowMs - s.firstFailMs > cfg.windowMs || s.lockedUntilMs !== 0 && s.lockedUntilMs <= nowMs) {
    s = { fails: 0, firstFailMs: nowMs, lockedUntilMs: 0 };
  }
  const fails = s.fails + 1;
  const lockedUntilMs = fails >= cfg.maxFails ? nowMs + cfg.lockMs : 0;
  return { fails, firstFailMs: s.firstFailMs, lockedUntilMs };
}

/** Clear on success. */
export function resetLockout(): LockoutState {
  return { fails: 0, firstFailMs: 0, lockedUntilMs: 0 };
}

export function retryAfterMs(s: LockoutState | undefined, nowMs: number): number {
  return s && s.lockedUntilMs > nowMs ? s.lockedUntilMs - nowMs : 0;
}
