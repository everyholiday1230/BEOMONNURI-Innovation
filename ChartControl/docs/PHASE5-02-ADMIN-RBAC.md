# PHASE 5 — Admin RBAC

Layered on the Phase 2 6-role model WITHOUT modifying the seeded `permissions` table (Phase 2's 12
permissions are unchanged). Admin permissions live in a separate namespace (`packages/admin-domain`).

## Permissions (20)
admin.dashboard.read, admin.user.read, admin.user.status.write, admin.role.read, admin.role.write,
admin.audit.read, admin.audit.export, admin.exchange.read, admin.order.read, admin.position.read,
admin.ai.read, admin.ai.policy.write, admin.incident.read, admin.incident.write,
admin.feature_flag.read, admin.feature_flag.write, admin.kill_switch.read, admin.kill_switch.write,
admin.release_gate.read, admin.release_gate.write.

## Role → permissions
- **USER / PRO_USER**: none (cannot access the dashboard — 403 on any admin route).
- **SUPPORT**: read-only + admin.user.status.write.
- **ANALYST**: read-only + admin.audit.export.
- **ADMIN**: read-only + status/role/incident/feature_flag/kill_switch/release_gate/ai.policy writes +
  audit.export. Cannot grant ADMIN/SUPER_ADMIN, cannot modify ADMIN/SUPER_ADMIN accounts, cannot WAIVE gates.
- **SUPER_ADMIN**: all admin permissions; only role that may create/modify SUPER_ADMIN and WAIVE gates.

## Invariants (server-enforced, unit-tested)
- **Default deny**: unknown role or permission → denied.
- **No self role change** (`canAssignRole`).
- **No privilege escalation**: actor cannot grant a role ≥ their own; ADMIN cannot grant/modify
  ADMIN/SUPER_ADMIN; only SUPER_ADMIN creates/modifies SUPER_ADMIN.
- **Last SUPER_ADMIN guard**: cannot disable or demote the last active SUPER_ADMIN
  (`canDisableAdmin` / `wouldRemoveLastSuperAdmin`).
- **Disabled-admin session revoke**: disabling a user revokes their sessions immediately; a disabled
  user's session no longer validates (401).
- **Step-up**: high-risk actions (kill switch) require a re-auth flag; MFA is `Not Implemented /
  Release Gate` (accurately labeled, never shown as enabled).
- Every admin action is written to append-only `admin_actions` with before/after + correlation id + reason.
