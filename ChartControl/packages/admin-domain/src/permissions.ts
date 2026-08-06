import { normalizeRole, type RoleName } from '@quantumtrade/auth';

/**
 * Admin RBAC (docs PHASE5-02). SEPARATE admin permission namespace layered on the Phase 2 6-role
 * model — does NOT modify the Phase 2 PERMISSIONS_V2 set (so the seeded permissions table is
 * unchanged). USER and PRO_USER have ZERO admin permissions (cannot access the dashboard).
 * DEFAULT DENY: an unknown role or unknown permission is always denied.
 */
export const ADMIN_PERMISSIONS = [
  'admin.dashboard.read',
  'admin.user.read',
  'admin.user.status.write',
  'admin.role.read',
  'admin.role.write',
  'admin.audit.read',
  'admin.audit.export',
  'admin.exchange.read',
  // Control of the LOCAL MOCK market gateway (resync / reconnect). Separate from `admin.exchange.read`
  // because it is a MUTATION: a read permission must never be sufficient to change operational state,
  // even when the thing being changed is a mock. SUPPORT and ANALYST are read-only roles and do not
  // hold it.
  'admin.gateway.write',
  'admin.order.read',
  'admin.position.read',
  'admin.ai.read',
  'admin.ai.policy.write',
  'admin.incident.read',
  'admin.incident.write',
  'admin.feature_flag.read',
  'admin.feature_flag.write',
  'admin.kill_switch.read',
  'admin.kill_switch.write',
  'admin.release_gate.read',
  'admin.release_gate.write',
  /**
   * Read the operator's BitMart API Broker rebate statement (our own revenue).
   *
   * Not part of READ_ONLY. The other read permissions expose operational state; this one exposes
   * company revenue, and the read-only support/analyst roles have no operational need for it. Kept
   * separate from `admin.exchange.read` for the same reason: seeing that an exchange connection is
   * healthy must not imply seeing what the business earns.
   */
  'admin.broker.rebate.read',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Roles that may access the admin dashboard at all. */
export const ADMIN_ROLES: readonly RoleName[] = ['SUPPORT', 'ANALYST', 'ADMIN', 'SUPER_ADMIN'];

const READ_ONLY: AdminPermission[] = ['admin.dashboard.read', 'admin.user.read', 'admin.role.read', 'admin.exchange.read', 'admin.order.read', 'admin.position.read', 'admin.ai.read', 'admin.incident.read', 'admin.feature_flag.read', 'admin.kill_switch.read', 'admin.release_gate.read'];

/**
 * Role → admin permissions. USER/PRO_USER intentionally absent (no admin access).
 *
 * **Permission equivalence does not imply authority equivalence.** ADMIN and SUPER_ADMIN share the
 * same base permission set, while privileged authority is separated through server-derived,
 * non-client-overridable capabilities. The two privileged operations documented in
 * docs/PHASE5-02-ADMIN-RBAC.md — creating/modifying a SUPER_ADMIN, and WAIVING a release gate — are
 * enforced by the invariant layer (`canAssignRole`, `evaluateReleaseGateUpdate`), NOT by a permission
 * flag, and are surfaced to clients as capabilities on `GET /admin/me`. A client can therefore never
 * widen its own authority by asserting a role string.
 *
 * `admin.audit.export` always ships with `admin.audit.read`: `GET /admin/audit` is guarded by
 * `read` while `GET /admin/audit/export` is guarded by `export`, so a role holding only `export`
 * could download the whole log but got a 403 listing it in the UI. SUPPORT deliberately holds
 * neither — audit access is not widened here, only made self-consistent.
 */
export const ADMIN_ROLE_PERMISSIONS: Record<RoleName, ReadonlySet<AdminPermission>> = {
  USER: new Set<AdminPermission>(),
  PRO_USER: new Set<AdminPermission>(),
  SUPPORT: new Set<AdminPermission>([...READ_ONLY, 'admin.user.status.write']),
  ANALYST: new Set<AdminPermission>([...READ_ONLY, 'admin.audit.read', 'admin.audit.export']),
  ADMIN: new Set<AdminPermission>([...READ_ONLY, 'admin.user.status.write', 'admin.audit.read', 'admin.audit.export', 'admin.role.write', 'admin.incident.write', 'admin.feature_flag.write', 'admin.kill_switch.write', 'admin.release_gate.write', 'admin.ai.policy.write', 'admin.gateway.write', 'admin.broker.rebate.read']),
  SUPER_ADMIN: new Set<AdminPermission>([...ADMIN_PERMISSIONS]),
};

/** Default-deny admin permission check. Unknown role/permission ⇒ false. */
export function hasAdminPermission(role: string, permission: AdminPermission): boolean {
  const r = normalizeRole(role);
  if (!r) return false;
  const set = ADMIN_ROLE_PERMISSIONS[r];
  return set ? set.has(permission) : false;
}

/** Whether a role may access the admin dashboard at all (any admin permission). */
export function isAdminRole(role: string): boolean {
  const r = normalizeRole(role);
  return !!r && (ADMIN_ROLES as readonly string[]).includes(r);
}
