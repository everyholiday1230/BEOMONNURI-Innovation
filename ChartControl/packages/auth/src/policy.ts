/**
 * Permission-based RBAC policy (docs PHASE2-04). 6 roles, 12 permissions. Server-enforced via
 * `hasPermission`. This is the authoritative policy; the older `rbac.ts` (user/admin) remains for
 * backward compatibility and maps into this policy via ROLE_ALIASES.
 */
export const ROLE_NAMES = ['USER', 'PRO_USER', 'SUPPORT', 'ANALYST', 'ADMIN', 'SUPER_ADMIN'] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const PERMISSIONS_V2 = [
  'account.read.self',
  'account.update.self',
  'layout.read.self',
  'layout.write.self',
  'signal.read.self',
  'signal.write.self',
  'order-draft.read.self',
  'order-draft.write.self',
  'support.user.read',
  'audit.read',
  'role.manage',
  'system.admin',
] as const;
export type PermissionV2 = (typeof PERMISSIONS_V2)[number];

const SELF: PermissionV2[] = [
  'account.read.self', 'account.update.self',
  'layout.read.self', 'layout.write.self',
  'signal.read.self', 'signal.write.self',
  'order-draft.read.self', 'order-draft.write.self',
];

export const ROLE_PERMISSIONS: Record<RoleName, ReadonlySet<PermissionV2>> = {
  USER: new Set(SELF),
  PRO_USER: new Set(SELF),
  SUPPORT: new Set<PermissionV2>([...SELF, 'support.user.read']),
  ANALYST: new Set<PermissionV2>([...SELF, 'audit.read']),
  ADMIN: new Set<PermissionV2>([...SELF, 'support.user.read', 'audit.read', 'role.manage']),
  SUPER_ADMIN: new Set<PermissionV2>([...PERMISSIONS_V2]),
};

/** Map legacy stored roles ('user'/'admin') onto the v2 role names. */
const ROLE_ALIASES: Record<string, RoleName> = {
  user: 'USER',
  admin: 'ADMIN',
};

export function normalizeRole(role: string): RoleName | null {
  if ((ROLE_NAMES as readonly string[]).includes(role)) return role as RoleName;
  return ROLE_ALIASES[role] ?? null;
}

export function hasPermission(role: string, permission: PermissionV2): boolean {
  const r = normalizeRole(role);
  return r ? (ROLE_PERMISSIONS[r].has(permission) ?? false) : false;
}

export function permissionsFor(role: string): PermissionV2[] {
  const r = normalizeRole(role);
  return r ? [...ROLE_PERMISSIONS[r]] : [];
}
