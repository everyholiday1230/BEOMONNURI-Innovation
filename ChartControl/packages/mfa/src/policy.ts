/**
 * MFA / step-up policy (Phase 6 §2). Pure decisions reused by the API guard. Roles that can access the
 * admin dashboard MUST have MFA; high-risk admin actions require a recent step-up re-authentication.
 * The LAST active SUPER_ADMIN cannot bypass the MFA-enforcement policy.
 */
export type SessionMfaLevel = 'none' | 'mfa' | 'stepup';

/** High-risk admin actions requiring fresh step-up (Phase 6 §2). */
export const STEP_UP_ACTIONS = [
  'kill_switch.update',
  'user.role.change',
  'release_gate.update',
  'mfa.disable',
  'feature_flag.update',
] as const;
export type StepUpAction = (typeof STEP_UP_ACTIONS)[number];

const ADMIN_ROLES = new Set(['SUPPORT', 'ANALYST', 'ADMIN', 'SUPER_ADMIN']);

/** Admin roles must enroll MFA. */
export function mfaRequiredForRole(role: string): boolean {
  return ADMIN_ROLES.has(role.toUpperCase());
}

export function isStepUpAction(action: string): action is StepUpAction {
  return (STEP_UP_ACTIONS as readonly string[]).includes(action);
}

export interface StepUpContext {
  action: string;
  sessionLevel: SessionMfaLevel;
  mfaAuthenticatedAtMs: number | null; // last successful MFA/step-up on this session
  nowMs: number;
  maxAgeMs?: number; // step-up freshness window (default 5 min)
}

export interface StepUpDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Decide whether a high-risk action may proceed. Requires a `stepup`-level session that was
 * re-authenticated within `maxAgeMs`. Non-step-up actions pass through (RBAC handled elsewhere).
 */
export function evaluateStepUp(ctx: StepUpContext): StepUpDecision {
  if (!isStepUpAction(ctx.action)) return { allowed: true };
  const maxAge = ctx.maxAgeMs ?? 5 * 60_000;
  if (ctx.sessionLevel !== 'stepup') return { allowed: false, reason: 'STEP_UP_REQUIRED' };
  if (ctx.mfaAuthenticatedAtMs === null) return { allowed: false, reason: 'STEP_UP_REQUIRED' };
  if (ctx.nowMs - ctx.mfaAuthenticatedAtMs > maxAge) return { allowed: false, reason: 'STEP_UP_STALE' };
  return { allowed: true };
}

/**
 * Whether disabling MFA is permitted. The last active SUPER_ADMIN may not drop below the enforced
 * policy (prevents locking the org out of enforced admin MFA).
 */
export function canDisableMfa(target: { role: string; userId: string }, activeSuperAdminIdsWithMfa: string[]): StepUpDecision {
  if (target.role.toUpperCase() === 'SUPER_ADMIN') {
    const remaining = activeSuperAdminIdsWithMfa.filter((id) => id !== target.userId);
    if (remaining.length === 0) return { allowed: false, reason: 'cannot disable MFA for the last SUPER_ADMIN' };
  }
  return { allowed: true };
}
