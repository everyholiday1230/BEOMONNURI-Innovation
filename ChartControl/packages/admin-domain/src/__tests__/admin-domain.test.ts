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

describe('공지 권한 (전체 사용자에게 나가는 게시물)', () => {
  it('일반 사용자는 공지를 읽지도 쓰지도 못한다', () => {
    for (const role of ['USER', 'PRO_USER'] as const) {
      expect(hasAdminPermission(role, 'admin.notice.read')).toBe(false);
      expect(hasAdminPermission(role, 'admin.notice.write')).toBe(false);
    }
  });

  it('운영자는 읽기만 — 고객 문의에 답하려면 무엇이 나갔는지 알아야 한다', () => {
    for (const role of ['SUPPORT', 'ANALYST'] as const) {
      expect(hasAdminPermission(role, 'admin.notice.read')).toBe(true);
      // 전체 사용자에게 나가는 글을 쓸 권한은 없다.
      expect(hasAdminPermission(role, 'admin.notice.write')).toBe(false);
    }
  });

  it('관리자 이상은 작성·게시할 수 있다', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      expect(hasAdminPermission(role, 'admin.notice.read')).toBe(true);
      expect(hasAdminPermission(role, 'admin.notice.write')).toBe(true);
    }
  });

  it('공지 쓰기와 사용자 상태 변경은 별개다', () => {
    /*
       한쪽을 가진 사람이 다른 쪽까지 할 수 있으면 안 된다.
       ANALYST 가 그 경계를 증명한다: 공지는 읽지만 사용자 상태는 못 바꾼다.

       ★ SUPPORT 로 검증하지 않는 이유: SUPPORT 는 admin.user.status.write 를
         갖고 있다(원 개발자 설계 — 침해된 계정을 지원 담당이 즉시 정지할 수 있게).
         이 테스트는 그 설계를 판단하지 않고, 권한이 서로 독립임만 확인한다.
    */
    expect(hasAdminPermission('ANALYST', 'admin.notice.read')).toBe(true);
    expect(hasAdminPermission('ANALYST', 'admin.user.status.write')).toBe(false);
    expect(hasAdminPermission('ANALYST', 'admin.notice.write')).toBe(false);
  });
});

describe('리퍼럴 권한 (돈이 나가는 조건)', () => {
  it('일반 사용자는 읽지도 쓰지도 못한다', () => {
    for (const role of ['USER', 'PRO_USER'] as const) {
      expect(hasAdminPermission(role, 'admin.referral.read')).toBe(false);
      expect(hasAdminPermission(role, 'admin.referral.write')).toBe(false);
    }
  });

  it('운영자는 읽기만 — 고객 문의에 답하려면 지급 내역을 봐야 한다', () => {
    for (const role of ['SUPPORT', 'ANALYST'] as const) {
      expect(hasAdminPermission(role, 'admin.referral.read')).toBe(true);
      /*
         쓰기를 주지 않는 이유: 이 권한으로 제도를 켜고(전원에게 코드 발급),
         환급 비율을 바꾸고, **지급 기록을 만들 수 있다**. 지급 기록은
         "실제로 보냈다" 는 주장이므로, 운영자가 만들 수 있으면 회계 통제가 없다.
      */
      expect(hasAdminPermission(role, 'admin.referral.write')).toBe(false);
    }
  });

  it('관리자 이상만 조건 변경과 지급 기록을 할 수 있다', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      expect(hasAdminPermission(role, 'admin.referral.read')).toBe(true);
      expect(hasAdminPermission(role, 'admin.referral.write')).toBe(true);
    }
  });

  it('티켓 답변 권한이 지급 권한을 주지 않는다', () => {
    // 두 권한이 독립임을 확인한다. 운영자가 그 경계를 증명한다.
    expect(hasAdminPermission('SUPPORT', 'admin.support.write')).toBe(true);
    expect(hasAdminPermission('SUPPORT', 'admin.referral.write')).toBe(false);
  });
});

describe('포인트 권한', () => {
  /*
     ★ 포인트 지급은 **부채 생성**이다.

       SUPPORT(=ops)가 포인트를 줄 수 있으면 통제가 없다 — 고객 응대 중
       "죄송합니다, 포인트 드리겠습니다" 로 임의 지급이 쌓인다. 그래서 write 는
       ADMIN 이상만 갖는다.

     ★ 읽기는 SUPPORT 에게 준다 — 고객이 "포인트가 왜 줄었나요" 물으면 원장을
       보고 답해야 한다.
  */
  it('SUPPORT·ANALYST 는 읽기만 갖는다', () => {
    for (const role of ['SUPPORT', 'ANALYST'] as const) {
      expect(hasAdminPermission(role, 'admin.points.read')).toBe(true);
      expect(hasAdminPermission(role, 'admin.points.write')).toBe(false);
    }
  });

  it('ADMIN·SUPER_ADMIN 은 지급도 할 수 있다', () => {
    for (const role of ['ADMIN', 'SUPER_ADMIN'] as const) {
      expect(hasAdminPermission(role, 'admin.points.read')).toBe(true);
      expect(hasAdminPermission(role, 'admin.points.write')).toBe(true);
    }
  });

  it('일반 사용자는 아무 권한도 없다', () => {
    expect(hasAdminPermission('USER', 'admin.points.read')).toBe(false);
    expect(hasAdminPermission('USER', 'admin.points.write')).toBe(false);
  });
});

describe('법적 문서 권한', () => {
  /*
     ★ 게시는 회사의 법적 약속을 만든다.

       약관을 게시하면 되돌릴 수 없고(이미 본 사람이 있다), 문구 하나가 분쟁의
       결론을 바꾼다. ADMIN 이 혼자 게시할 수 있으면 법무 검토를 건너뛸 경로가
       생기므로 쓰기는 SUPER_ADMIN 만 갖는다.

     ★ 읽기는 SUPPORT 에게도 준다 — 고객이 약관 내용을 물으면 답해야 한다.
  */
  it('ADMIN 은 읽을 수 있지만 게시하지 못한다', () => {
    expect(hasAdminPermission('ADMIN', 'admin.legal.read')).toBe(true);
    expect(hasAdminPermission('ADMIN', 'admin.legal.write')).toBe(false);
  });

  it('SUPER_ADMIN 만 게시할 수 있다', () => {
    expect(hasAdminPermission('SUPER_ADMIN', 'admin.legal.write')).toBe(true);
    for (const role of ['SUPPORT', 'ANALYST', 'ADMIN'] as const) {
      expect(hasAdminPermission(role, 'admin.legal.write')).toBe(false);
    }
  });

  it('SUPPORT 는 읽을 수 있다', () => {
    expect(hasAdminPermission('SUPPORT', 'admin.legal.read')).toBe(true);
  });

  it('일반 사용자는 아무 권한도 없다', () => {
    expect(hasAdminPermission('USER', 'admin.legal.read')).toBe(false);
    expect(hasAdminPermission('USER', 'admin.legal.write')).toBe(false);
  });
});
