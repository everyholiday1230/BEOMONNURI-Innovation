import { normalizeRole, type RoleName } from '@quantumtrade/auth';

/**
 * Admin RBAC invariants (docs PHASE5-02 / §3). Server-enforced. These are pure functions so they can
 * be unit-tested exhaustively and reused by the API guard.
 */
const RANK: Record<RoleName, number> = { USER: 0, PRO_USER: 1, SUPPORT: 2, ANALYST: 2, ADMIN: 3, SUPER_ADMIN: 4 };

export interface RoleChangeRequest {
  actorRole: string;
  actorUserId: string;
  targetUserId: string;
  targetCurrentRole: string;
  newRole: string;
}

export interface Decision {
  allowed: boolean;
  reason?: string;
}

/**
 * Can the actor assign `newRole` to the target?
 * - No self role change.
 * - Only ADMIN/SUPER_ADMIN may change roles at all (SUPPORT/ANALYST cannot escalate anyone).
 * - No privilege escalation: actor cannot grant a role >= their own rank (SUPPORT can't grant ADMIN;
 *   ADMIN can't grant/modify/create SUPER_ADMIN).
 * - ADMIN cannot modify an existing SUPER_ADMIN.
 * - Only SUPER_ADMIN may create or modify SUPER_ADMIN.
 */
export function canAssignRole(req: RoleChangeRequest): Decision {
  const actor = normalizeRole(req.actorRole);
  const target = normalizeRole(req.targetCurrentRole);
  const next = normalizeRole(req.newRole);
  if (!actor || !next) return { allowed: false, reason: 'unknown role' };
  if (target === null) return { allowed: false, reason: 'unknown target role' };
  if (req.actorUserId === req.targetUserId) return { allowed: false, reason: 'cannot change your own role' };
  if (actor !== 'ADMIN' && actor !== 'SUPER_ADMIN') return { allowed: false, reason: 'insufficient role to change roles' };
  // No escalation to a rank >= actor's own (strictly below for ADMIN; SUPER_ADMIN may grant up to SUPER_ADMIN).
  if (actor === 'ADMIN') {
    if (RANK[next] >= RANK.ADMIN && next !== 'ANALYST' && next !== 'SUPPORT') {
      // ADMIN may assign USER/PRO_USER/SUPPORT/ANALYST, never ADMIN or SUPER_ADMIN.
      return { allowed: false, reason: 'ADMIN cannot grant ADMIN/SUPER_ADMIN (privilege escalation)' };
    }
    if (target === 'SUPER_ADMIN' || target === 'ADMIN') return { allowed: false, reason: 'ADMIN cannot modify ADMIN/SUPER_ADMIN accounts' };
  }
  // SUPER_ADMIN may assign any role (incl. SUPER_ADMIN).
  return { allowed: true };
}

/** Prevent disabling / demoting the LAST active SUPER_ADMIN. */
export function canDisableAdmin(target: { role: string; userId: string }, activeSuperAdminIds: string[]): Decision {
  const r = normalizeRole(target.role);
  if (r === 'SUPER_ADMIN') {
    const remaining = activeSuperAdminIds.filter((id) => id !== target.userId);
    if (remaining.length === 0) return { allowed: false, reason: 'cannot disable the last active SUPER_ADMIN' };
  }
  return { allowed: true };
}

/** Same guard for demoting a SUPER_ADMIN via a role change. */
export function wouldRemoveLastSuperAdmin(req: RoleChangeRequest, activeSuperAdminIds: string[]): boolean {
  if (normalizeRole(req.targetCurrentRole) !== 'SUPER_ADMIN') return false;
  if (normalizeRole(req.newRole) === 'SUPER_ADMIN') return false;
  return activeSuperAdminIds.filter((id) => id !== req.targetUserId).length === 0;
}

/** A disabled admin's sessions must be revoked immediately (helper flag for the API). */
export function requiresSessionRevoke(action: 'disable' | 'demote' | 'enable'): boolean {
  return action === 'disable' || action === 'demote';
}
