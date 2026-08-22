/*
   첫 관리자 승격 규칙 테스트.

   여기서 지켜야 하는 것은 두 가지다.
   1) 관리자가 없을 때는 지정한 계정을 확실히 올린다 — 못 올리면 아무도 /admin 에
      들어갈 수 없다.
   2) 관리자가 이미 있을 때는 절대 올리지 않는다 — 환경변수가 남아 있어도 상시
      승격 경로가 되면 안 된다.
*/

import { describe, it, expect } from 'vitest';
import { bootstrapSuperAdmin, type BootstrapAdminDeps } from '../admin/bootstrap-admin';

type User = { id: string; email: string; role: string; status: string };

function harness(opts: {
  email?: string;
  users?: User[];
  admins?: string[];
  setRoleOk?: boolean;
}) {
  const users = opts.users ?? [];
  const logs: string[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const roleChanges: Array<[string, string]> = [];
  const deps: BootstrapAdminDeps = {
    email: opts.email,
    findByEmail: async (mail) => users.find((u) => u.email === mail) ?? null,
    activeSuperAdminIds: async () => opts.admins ?? [],
    setUserRole: async (id, role) => {
      roleChanges.push([id, role]);
      return opts.setRoleOk ?? true;
    },
    recordAudit: async (e) => { audits.push(e as unknown as Record<string, unknown>); },
    log: (m) => logs.push(m),
    now: () => 1_700_000_000_000,
    newId: () => 'fixed-id',
  };
  return { deps, logs, audits, roleChanges };
}

const owner: User = { id: 'u1', email: 'owner@beomonnuri.com', role: 'user', status: 'active' };

describe('첫 관리자 승격', () => {
  it('변수가 없으면 아무것도 하지 않는다', async () => {
    const h = harness({});
    expect(await bootstrapSuperAdmin(h.deps)).toBe('skipped_not_configured');
    expect(h.roleChanges).toHaveLength(0);
  });

  it('관리자가 없을 때 지정한 계정을 SUPER_ADMIN 으로 올린다', async () => {
    const h = harness({ email: 'owner@beomonnuri.com', users: [owner] });
    expect(await bootstrapSuperAdmin(h.deps)).toBe('promoted');
    expect(h.roleChanges).toEqual([['u1', 'SUPER_ADMIN']]);
  });

  it('대소문자·공백이 섞여도 같은 계정을 찾는다', async () => {
    const h = harness({ email: '  Owner@Beomonnuri.com  ', users: [owner] });
    expect(await bootstrapSuperAdmin(h.deps)).toBe('promoted');
  });

  it('★ 관리자가 이미 있으면 올리지 않는다 (뒷문을 남기지 않는다)', async () => {
    const h = harness({ email: 'owner@beomonnuri.com', users: [owner], admins: ['existing'] });
    expect(await bootstrapSuperAdmin(h.deps)).toBe('skipped_admin_exists');
    expect(h.roleChanges).toHaveLength(0);
  });

  it('가입되지 않은 이메일이면 무엇을 해야 하는지 로그로 알린다', async () => {
    const h = harness({ email: 'nobody@beomonnuri.com' });
    expect(await bootstrapSuperAdmin(h.deps)).toBe('blocked_user_not_found');
    expect(h.logs.join(' ')).toMatch(/먼저 가입/);
    expect(h.roleChanges).toHaveLength(0);
  });

  it('비활성 계정은 올리지 않는다', async () => {
    const h = harness({ email: 'owner@beomonnuri.com', users: [{ ...owner, status: 'disabled' }] });
    expect(await bootstrapSuperAdmin(h.deps)).toBe('blocked_user_not_active');
    expect(h.roleChanges).toHaveLength(0);
  });

  it('승격은 감사 기록에 남는다', async () => {
    const h = harness({ email: 'owner@beomonnuri.com', users: [owner] });
    await bootstrapSuperAdmin(h.deps);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'admin.bootstrap_super_admin',
      target: 'u1',
      actorUserId: null,
    });
    expect((h.audits[0] as { meta: { previousRole: string } }).meta.previousRole).toBe('user');
  });

  it('로그에 이메일 전체를 남기지 않는다', async () => {
    const h = harness({ email: 'owner@beomonnuri.com', users: [owner] });
    await bootstrapSuperAdmin(h.deps);
    const joined = h.logs.join(' ');
    expect(joined).not.toContain('owner@beomonnuri.com');
    expect(joined).toContain('ow***@beomonnuri.com');
  });

  it('감사 기록이 실패해도 승격은 유효하다', async () => {
    const h = harness({ email: 'owner@beomonnuri.com', users: [owner] });
    h.deps.recordAudit = async () => { throw new Error('감사 저장 실패'); };
    expect(await bootstrapSuperAdmin(h.deps)).toBe('promoted');
  });
});
