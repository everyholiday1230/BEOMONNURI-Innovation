export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'account:read',
  'account:write',
  'layout:persist',
  'admin:users:read',
  'admin:users:write',
  'admin:audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Code-defined RBAC (docs/PHASE2-04-rbac-matrix.md). market:read / sim:trade / ai:analyze stay
 * PUBLIC in Phase 1/2 and are intentionally NOT gated here. Roles never self-granted via the API.
 */
const MATRIX: Record<Role, ReadonlySet<Permission>> = {
  user: new Set<Permission>(['account:read', 'account:write', 'layout:persist']),
  admin: new Set<Permission>([
    'account:read',
    'account:write',
    'layout:persist',
    'admin:users:read',
    'admin:users:write',
    'admin:audit:read',
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role]?.has(permission) ?? false;
}

export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}
