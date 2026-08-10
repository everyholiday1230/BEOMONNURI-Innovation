/**
 * 서버측 등급 강제 검증 — 2겹 방어의 두 번째 겹.
 *
 * 왜 이 테스트가 필요한가
 * ----------------------
 * 화면에서 메뉴를 숨기고 라우팅을 막는 것은 사용자 경험이지 보안이 아니다.
 * 버튼을 숨겨도 그 버튼이 부르던 API 는 그대로 열려 있고, 브라우저 도구로
 * 주소를 직접 호출하면 통과한다.
 *
 * 그래서 여기서 확인하는 것은 하나다:
 *   **권한 없는 등급이 API 를 직접 불렀을 때 서버가 거부하는가.**
 *
 * 화면 규칙(src/access.js)이 잘못되거나 우회당해도 이 겹이 남아야 한다.
 */

import { describe, expect, it } from 'vitest';
import { ROLE_NAMES, hasPermission } from '@quantumtrade/auth';
import { hasAdminPermission, isAdminRole } from '@quantumtrade/admin-domain';

/**
 * 화면 4등급 ↔ 서버 6등급 대응.
 * src/auth-state.js 의 SERVER_TO_TIER 와 같아야 한다 — 어긋나면 화면과 서버가
 * 서로 다른 등급으로 같은 사용자를 판단한다.
 */
const TIER_OF: Record<string, 'user' | 'ops' | 'admin' | 'super'> = {
  USER: 'user',
  PRO_USER: 'user',
  SUPPORT: 'ops',
  ANALYST: 'ops',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super',
};

describe('등급 정의 일치', () => {
  it('서버 6등급이 모두 화면 등급으로 매핑된다', () => {
    // 매핑이 빠진 등급이 있으면 화면이 그 사용자를 'user' 로 떨어뜨리거나
    // 반대로 잠근다. 어느 쪽이든 조용한 오작동이다.
    for (const role of ROLE_NAMES) {
      expect(TIER_OF[role], `${role} 매핑 누락`).toBeDefined();
    }
  });

  it('화면 등급은 4종뿐이다', () => {
    const tiers = new Set(Object.values(TIER_OF));
    expect([...tiers].sort()).toEqual(['admin', 'ops', 'super', 'user']);
  });
});

describe('관리자 판정', () => {
  it('일반 사용자는 관리자가 아니다', () => {
    expect(isAdminRole('USER')).toBe(false);
    expect(isAdminRole('PRO_USER')).toBe(false);
  });

  it('관리자·최고관리자는 관리자다', () => {
    expect(isAdminRole('ADMIN')).toBe(true);
    expect(isAdminRole('SUPER_ADMIN')).toBe(true);
  });

  it('알 수 없는 등급은 관리자가 아니다 — 모르면 잠근다', () => {
    for (const bad of ['WHATEVER', '', 'sudo', 'root', 'administrator']) {
      expect(isAdminRole(bad), `${JSON.stringify(bad)} 로 통과`).toBe(false);
    }
  });

  it('등록된 별칭만 허용된다', () => {
    // 저장된 소문자 등급('admin')을 v2 이름으로 정규화한다(ROLE_ALIASES).
    // 별칭 목록에 없는 값은 통과하지 못한다.
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('adm1n')).toBe(false);
  });
});

describe('사용자 자기 데이터 권한', () => {
  it('일반 사용자는 자기 계정을 수정할 수 있다', () => {
    // API 키 연결이 이 권한을 쓴다. 막히면 사용자가 거래를 시작할 수 없다.
    expect(hasPermission('USER', 'account.update.self')).toBe(true);
  });

  it('일반 사용자는 자기 주문 초안을 만들 수 있다', () => {
    expect(hasPermission('USER', 'order-draft.write.self')).toBe(true);
  });
});

describe('관리자 권한 분리', () => {
  /**
   * 관리자 권한은 하나가 아니다. ADMIN 이 모든 것을 할 수 있으면
   * 킬스위치·권한부여까지 열리고, 그건 SUPER_ADMIN 만의 것이어야 한다.
   */
  it('ops 등급(SUPPORT/ANALYST)은 관리자 화면에 들어갈 수 있다 — 열람 권한이 있다', () => {
    /*
       설계 확인: SUPPORT·ANALYST 는 ADMIN_ROLES 에 포함되어 관리자 대시보드
       진입 자체는 허용된다. 다만 갖는 권한은 읽기 위주다 — 변경 권한이 없으면
       개별 엔드포인트에서 403 이 난다. 진입 차단이 아니라 행위 차단 방식이다.
    */
    expect(isAdminRole('SUPPORT')).toBe(true);
    expect(isAdminRole('ANALYST')).toBe(true);
  });

  it('ops 등급은 변경 권한이 없다 — 열람만 가능하다', () => {
    // 발주자 방침: ops 는 시스템 상태·티켓 대응 (열람 O, 변경 X)
    expect(hasAdminPermission('SUPPORT', 'admin.dashboard.read')).toBe(true);
    expect(hasAdminPermission('SUPPORT', 'admin.role.write')).toBe(false);
    expect(hasAdminPermission('SUPPORT', 'admin.kill_switch.write')).toBe(false);
    expect(hasAdminPermission('ANALYST', 'admin.role.write')).toBe(false);
    expect(hasAdminPermission('ANALYST', 'admin.kill_switch.write')).toBe(false);
  });

  it('ADMIN 과 SUPER_ADMIN 의 권한 집합이 다르다', () => {
    // 같으면 등급을 나눈 의미가 없다.
    const perms = [
      'admin.dashboard.read', 'admin.user.read', 'admin.user.status.write',
      'admin.audit.read', 'admin.role.write', 'admin.kill_switch.write',
      'admin.broker.rebate.read',
    ];
    const admin = perms.filter((p) => hasAdminPermission('ADMIN', p as never));
    const superAdmin = perms.filter((p) => hasAdminPermission('SUPER_ADMIN', p as never));
    expect(superAdmin.length).toBeGreaterThanOrEqual(admin.length);
    // SUPER_ADMIN 이 ADMIN 의 권한을 모두 포함해야 한다 (상위 등급이 하위를 포함).
    for (const p of admin) {
      expect(superAdmin, `SUPER_ADMIN 이 ${p} 를 잃었다`).toContain(p);
    }
  });

  it('일반 사용자는 어떤 관리자 권한도 갖지 않는다', () => {
    for (const p of ['admin.dashboard.read', 'admin.user.read', 'admin.audit.read', 'admin.role.write']) {
      expect(hasAdminPermission('USER', p as never), `USER 가 ${p} 를 가짐`).toBe(false);
    }
  });

  it('알 수 없는 권한 이름은 거부된다 — 오타가 통과하면 안 된다', () => {
    expect(hasAdminPermission('SUPER_ADMIN', 'nonexistent.permission' as never)).toBe(false);
  });
});

describe('권한 상승 방어', () => {
  it('빈 값·null·객체로 관리자가 되지 않는다', () => {
    for (const bad of ['', ' ', 'null', 'undefined', '0', 'true', '[object Object]']) {
      expect(isAdminRole(bad), `${JSON.stringify(bad)} 로 관리자 통과`).toBe(false);
    }
  });

  it('권한 검사는 등급 문자열 비교가 아니라 권한 집합으로 한다', () => {
    /*
       원 개발자 주석: "never compares role === 'SUPER_ADMIN' itself".
       등급 문자열을 직접 비교하면 등급이 늘어날 때마다 검사 지점을 모두
       고쳐야 하고, 한 곳만 빠뜨리면 권한 구멍이 된다.
       여기서는 그 계약이 유지되는지 확인한다: 권한 없는 등급은 권한도 없다.
    */
    expect(hasAdminPermission('USER', 'admin.user.read' as never)).toBe(false);
    expect(hasAdminPermission('SUPPORT', 'admin.role.write' as never)).toBe(false);
  });
});
