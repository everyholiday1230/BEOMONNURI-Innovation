# PHASE 2 — RBAC Matrix (implemented)

Permission-based policy (`packages/auth/src/policy.ts`), server-enforced via `hasPermission(role,
permission)` in the BFF (`apps/api/src/auth-routes.ts`). Frontend hiding is NOT a control — the
server is authoritative. Legacy stored roles map: `user→USER`, `admin→ADMIN` (`normalizeRole`).

## Roles (6)
USER · PRO_USER · SUPPORT · ANALYST · ADMIN · SUPER_ADMIN

## Permissions (12) → role matrix
| Permission | USER | PRO_USER | SUPPORT | ANALYST | ADMIN | SUPER_ADMIN |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| account.read.self | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| account.update.self | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| layout.read.self | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| layout.write.self | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| signal.read.self | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| signal.write.self | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| order-draft.read.self | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| order-draft.write.self | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| support.user.read | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ |
| audit.read | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| role.manage | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| system.admin | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

`self` permissions are additionally scoped by **ownership**: every `/me/*` and `/account/*` read
and write is filtered by the authenticated `userId`; cross-user access returns 404 (see the
horizontal-privilege-escalation test in `PHASE2-07-security-test-report.md`).

## Enforcement points
- `authed(c)` → valid session (hashed lookup) or 401.
- `requirePerm(user, permission)` → `hasPermission` or 403.
- `csrfGuard` on all unsafe methods (Origin/Referer allowlist + HMAC signed session-bound token).
- Roles are never self-granted; role changes require `role.manage` (admin+).
