import { describe, it, expect } from 'vitest';
import {
  hasAdminPermission, isAdminRole, ADMIN_PERMISSIONS,
  canAssignRole, canDisableAdmin, wouldRemoveLastSuperAdmin,
  canTransitionIncident, evaluateReleaseGateUpdate, killSwitchDefaultOnError, canTransitionPromptChange,
  redact, csvSafe, escapeHtml, maskAccessKey,
} from '../index';

describe('admin RBAC (default-deny; USER/PRO_USER denied)', () => {
  it('USER and PRO_USER have zero admin access', () => {
    expect(isAdminRole('USER')).toBe(false);
    expect(isAdminRole('PRO_USER')).toBe(false);
    expect(isAdminRole('user')).toBe(false);
    for (const p of ADMIN_PERMISSIONS) { expect(hasAdminPermission('USER', p)).toBe(false); expect(hasAdminPermission('PRO_USER', p)).toBe(false); }
  });
  it('admin roles gated correctly', () => {
    expect(isAdminRole('SUPPORT')).toBe(true);
    expect(hasAdminPermission('SUPPORT', 'admin.dashboard.read')).toBe(true);
    expect(hasAdminPermission('SUPPORT', 'admin.role.write')).toBe(false); // support can't change roles
    expect(hasAdminPermission('ANALYST', 'admin.audit.export')).toBe(true);
    expect(hasAdminPermission('ADMIN', 'admin.kill_switch.write')).toBe(true);
    expect(hasAdminPermission('SUPER_ADMIN', 'admin.release_gate.write')).toBe(true);
    expect(hasAdminPermission('bogus', 'admin.dashboard.read')).toBe(false); // unknown role → deny
  });
  it('audit export always ships with audit read (GET /admin/audit and /export are separately guarded)', () => {
    for (const role of ['SUPPORT', 'ANALYST', 'ADMIN', 'SUPER_ADMIN']) {
      if (hasAdminPermission(role, 'admin.audit.export')) {
        expect(hasAdminPermission(role, 'admin.audit.read'), `${role} can export but not read`).toBe(true);
      }
    }
    // SUPPORT deliberately holds neither — this test must not become a licence to widen it.
    expect(hasAdminPermission('SUPPORT', 'admin.audit.read')).toBe(false);
    expect(hasAdminPermission('SUPPORT', 'admin.audit.export')).toBe(false);
  });
});

describe('RBAC invariants (privilege escalation / self / last super admin)', () => {
  const base = { actorUserId: 'a', targetUserId: 'b', targetCurrentRole: 'USER' };
  it('no self role change', () => {
    expect(canAssignRole({ ...base, actorRole: 'ADMIN', actorUserId: 'x', targetUserId: 'x', newRole: 'ANALYST' }).allowed).toBe(false);
  });
  it('SUPPORT cannot change roles at all', () => {
    expect(canAssignRole({ ...base, actorRole: 'SUPPORT', newRole: 'ANALYST' }).allowed).toBe(false);
  });
  it('ADMIN cannot grant ADMIN or SUPER_ADMIN (escalation)', () => {
    expect(canAssignRole({ ...base, actorRole: 'ADMIN', newRole: 'ADMIN' }).allowed).toBe(false);
    expect(canAssignRole({ ...base, actorRole: 'ADMIN', newRole: 'SUPER_ADMIN' }).allowed).toBe(false);
    expect(canAssignRole({ ...base, actorRole: 'ADMIN', newRole: 'ANALYST' }).allowed).toBe(true);
  });
  it('ADMIN cannot modify an existing SUPER_ADMIN/ADMIN', () => {
    expect(canAssignRole({ ...base, actorRole: 'ADMIN', targetCurrentRole: 'SUPER_ADMIN', newRole: 'USER' }).allowed).toBe(false);
  });
  it('SUPER_ADMIN may grant SUPER_ADMIN', () => {
    expect(canAssignRole({ ...base, actorRole: 'SUPER_ADMIN', newRole: 'SUPER_ADMIN' }).allowed).toBe(true);
  });
  it('cannot disable / demote last active SUPER_ADMIN', () => {
    expect(canDisableAdmin({ role: 'SUPER_ADMIN', userId: 's1' }, ['s1']).allowed).toBe(false);
    expect(canDisableAdmin({ role: 'SUPER_ADMIN', userId: 's1' }, ['s1', 's2']).allowed).toBe(true);
    expect(wouldRemoveLastSuperAdmin({ actorRole: 'SUPER_ADMIN', actorUserId: 'x', targetUserId: 's1', targetCurrentRole: 'SUPER_ADMIN', newRole: 'ADMIN' }, ['s1'])).toBe(true);
  });
});

describe('state machines', () => {
  it('incident transitions', () => {
    expect(canTransitionIncident('OPEN', 'INVESTIGATING')).toBe(true);
    expect(canTransitionIncident('CLOSED', 'OPEN')).toBe(false);
  });
  it('release gate: no fake pass; WAIVED needs super-admin + reason + future expiry; prod cap', () => {
    const now = 1_000_000;
    expect(evaluateReleaseGateUpdate({ actorRole: 'ADMIN', current: 'NOT_EXECUTED', next: 'PASSED', hasEvidence: false, productionRequired: true, now }).allowed).toBe(false);
    expect(evaluateReleaseGateUpdate({ actorRole: 'ADMIN', current: 'IN_PROGRESS', next: 'PASSED', hasEvidence: true, productionRequired: true, now }).allowed).toBe(true);
    expect(evaluateReleaseGateUpdate({ actorRole: 'ADMIN', current: 'NOT_EXECUTED', next: 'WAIVED', hasEvidence: false, productionRequired: true, reason: 'temporary waiver', expiresAt: now + 1000, now }).allowed).toBe(false); // ADMIN can't waive
    expect(evaluateReleaseGateUpdate({ actorRole: 'SUPER_ADMIN', current: 'NOT_EXECUTED', next: 'WAIVED', hasEvidence: false, productionRequired: true, reason: 'temporary waiver', expiresAt: now - 1, now }).allowed).toBe(false); // past expiry
    expect(evaluateReleaseGateUpdate({ actorRole: 'SUPER_ADMIN', current: 'NOT_EXECUTED', next: 'WAIVED', hasEvidence: false, productionRequired: true, reason: 'temporary waiver', expiresAt: now + 100 * 24 * 3600 * 1000, now }).allowed).toBe(false); // exceeds 30d cap
    expect(evaluateReleaseGateUpdate({ actorRole: 'SUPER_ADMIN', current: 'NOT_EXECUTED', next: 'WAIVED', hasEvidence: false, productionRequired: true, reason: 'temporary waiver', expiresAt: now + 3 * 24 * 3600 * 1000, now }).allowed).toBe(true);
  });
  it('kill switch fail-closed defaults (live-trading scopes active on error)', () => {
    expect(killSwitchDefaultOnError('global_live_trading').active).toBe(true);
    expect(killSwitchDefaultOnError('bitmart_live_trading').active).toBe(true);
    expect(killSwitchDefaultOnError('ai_signal_generation').active).toBe(false);
  });
  it('prompt change lifecycle', () => {
    expect(canTransitionPromptChange('DRAFT', 'REVIEW')).toBe(true);
    expect(canTransitionPromptChange('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransitionPromptChange('STAGED', 'ACTIVE')).toBe(true);
  });
});

describe('redaction', () => {
  it('strips sensitive keys, masks access key', () => {
    const out = redact({ email: 'x@y.com', password_hash: 'H', secretKey: 'S', memo: 'M', sessionToken: 'T', accessKey: 'AKIA1234567890', nested: { openaiKey: 'sk-x', wrapped_dek: 'w' } }) as Record<string, unknown>;
    expect(out.password_hash).toBe('[REDACTED]');
    expect(out.secretKey).toBe('[REDACTED]');
    expect(out.memo).toBe('[REDACTED]');
    expect(out.sessionToken).toBe('[REDACTED]');
    expect(out.accessKeyMasked).toBe('AKIA…7890');
    expect((out.nested as Record<string, unknown>).wrapped_dek).toBe('[REDACTED]');
    expect(JSON.stringify(out)).not.toContain('sk-x');
  });
  it('csvSafe neutralizes formula injection', () => {
    expect(csvSafe('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(csvSafe('normal')).toBe('"normal"');
  });
  it('escapeHtml blocks XSS', () => {
    expect(escapeHtml('<script>alert(1)</script>')).not.toMatch(/<script>/);
  });
  it('maskAccessKey', () => { expect(maskAccessKey('short')).toBe('****'); expect(maskAccessKey('ABCD12345678WXYZ')).toBe('ABCD…WXYZ'); });
  it('token COUNT fields survive redaction, but only as numbers and only by exact name', () => {
    const out = redact({
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: null,
      // Same "token" substring, NOT on the allow-list → still redacted.
      session_token: 'abc',
      refresh_token: 'def',
      // Allow-listed name but a string value → treated as suspect.
      inputTokens: 'not-a-number',
    }) as Record<string, unknown>;
    expect(out.input_tokens).toBe(100);
    expect(out.output_tokens).toBe(50);
    expect(out.total_tokens).toBeNull();
    expect(out.session_token).toBe('[REDACTED]');
    expect(out.refresh_token).toBe('[REDACTED]');
    expect(out.inputTokens).toBe('[REDACTED]');
  });
});
