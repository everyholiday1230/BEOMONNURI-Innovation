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

  /**
   * 거래 학습 데이터셋 — 현황 조회 / 내보내기.
   *
   * ★★ 별도 권한으로 둔 이유
   *
   *   이 데이터는 **개인의 거래 행동 전체**다. 언제 무엇을 얼마에 샀고 얼마를
   *   잃었는지가 사람 단위로 들어 있다. 회원 목록을 볼 수 있는 권한
   *   (`admin.user.read`)과 성격이 완전히 다르다 — 회원 목록은 "누가 있는가"
   *   이고, 이것은 "그 사람이 어떻게 돈을 잃었는가" 다.
   *
   * ★ 조회(stats)와 내보내기(export)를 나눈다.
   *
   *   현황은 "모이고 있는가" 를 확인하는 운영 정보라서 관리자에게 필요하다.
   *   내보내기는 **데이터가 우리 시스템 밖으로 나가는 행위**다. 파일이 한 번
   *   나가면 회수할 수 없으므로 더 좁은 권한으로 둔다.
   */
  'admin.learning.read',
  'admin.learning.export',

  /**
   * 등급 혜택 환급 집행 스위치.
   *
   * ★★ SUPER 전용이다. 켜는 순간 고객에게 돈이 나가기 시작한다.
   *
   *   우리는 브로커 리베이트가 실제로 입금되는 것을 아직 확인하지 못했다.
   *   확인 전에 켜면 들어오지 않는 수입을 근거로 약속하게 되므로, 열람 권한과
   *   같은 등급에 두지 않는다.
   */
  'admin.tier.payouts.write',

  /**
   * 공지 읽기 / 쓰기.
   *
   * 별도 권한으로 둔 이유: 공지는 **전체 사용자에게** 나간다. 사용자 상태를
   * 바꾸는 권한(admin.user.status.write)과 성격이 다르고, 한쪽을 가진 사람이
   * 다른 쪽까지 할 수 있으면 안 된다.
   *
   * 읽기는 운영자(SUPPORT/ANALYST)에게도 준다 — 고객 문의에 답하려면 어떤
   * 공지가 나갔는지 알아야 한다. 쓰기는 관리자 이상만 갖는다.
   */
  'admin.notice.read',
  'admin.notice.write',

  /**
   * 고객 지원 티켓 읽기 / 쓰기.
   *
   * 운영자(SUPPORT/ANALYST)에게 **쓰기까지** 준다. 승인된 업무 범위가
   * "티켓 대응" 이고, 답장을 못 하면 대응이 성립하지 않는다.
   *
   * 사용자 상태 변경(admin.user.status.write)과는 다른 권한이다 — 티켓에
   * 답장할 수 있는 사람이 계정을 정지시킬 수 있어서는 안 된다.
   */
  'admin.support.read',
  'admin.support.write',

  /**
   * 리퍼럴 제도 읽기 / 쓰기.
   *
   * ★ 쓰기를 ADMIN 이상에만 준다. 이 권한으로 할 수 있는 일:
   *     · 제도를 켜고 끄기 (모든 사용자에게 코드가 발급된다)
   *     · 환급 비율 변경 (돈이 나가는 조건)
   *     · **지급 기록 입력** — 실제로 보냈다는 주장을 남긴다
   *   운영자(SUPPORT/ANALYST)가 지급 기록을 만들 수 있으면 회계 통제가 없다.
   *
   * 읽기는 운영자에게도 준다 — 고객이 "얼마 받았나요" 물으면 답해야 한다.
   */
  'admin.referral.read',
  'admin.referral.write',

  /**
   * 포인트 제도 읽기 / 쓰기.
   *
   * ★ 쓰기를 ADMIN 이상에만 준다. 이 권한으로 할 수 있는 일:
   *     · 제도를 켜고 끄기
   *     · 상품 가격 변경
   *     · **포인트 직접 지급·회수** — 부채를 만들거나 없애는 행위다
   *   포인트는 부채다. 운영자가 임의로 지급할 수 있으면 통제가 없다.
   *
   * 읽기는 운영자에게도 준다 — 고객이 "포인트가 왜 줄었나요" 물으면
   * 원장을 보고 답해야 한다.
   */
  'admin.points.read',
  'admin.points.write',

  /**
   * 법적 문서 (이용약관·개인정보처리방침·위험고지).
   *
   * ★ 쓰기를 SUPER 에만 준다.
   *   약관을 게시하면 그것이 회사의 법적 약속이 된다. 게시는 되돌릴 수 없고
   *   (이미 본 사람이 있다), 문구 하나가 분쟁의 결론을 바꾼다. ADMIN 이 혼자
   *   게시할 수 있게 두면 법무 검토를 건너뛸 경로가 생긴다.
   *
   * 읽기는 운영자에게도 준다 — 고객이 약관 내용을 물으면 답해야 한다.
   */
  'admin.legal.read',
  'admin.legal.write',

  /**
   * 회원 삭제 (법정 보관분은 분리 보관).
   *
   * ★★ SUPER 에만 준다.
   *
   *   되돌릴 수 없다. 계정과 그에 딸린 설정·거래소 연동·AI 기록이 사라지고,
   *   약관 동의와 주문 기록은 분리 보관 테이블로 옮겨진 뒤 원본이 지워진다.
   *   잘못된 대상을 지우면 그 사람의 계정을 되살릴 방법이 없다.
   *
   *   ADMIN 에게 주지 않는 이유는 admin.legal.write 와 같다 — 되돌릴 수 없는
   *   작업은 한 사람이 혼자 실행할 수 있게 두지 않는다.
   *
   * ★ 이 권한이 있어도 서버는 재인증과 이메일 확인 입력을 함께 요구한다.
   *   권한만으로 실행되면 실수 한 번이 그대로 삭제가 된다.
   */
  'admin.user.delete',
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Roles that may access the admin dashboard at all. */
export const ADMIN_ROLES: readonly RoleName[] = ['SUPPORT', 'ANALYST', 'ADMIN', 'SUPER_ADMIN'];

const READ_ONLY: AdminPermission[] = ['admin.notice.read', 'admin.support.read', 'admin.referral.read', 'admin.points.read', 'admin.legal.read', 'admin.dashboard.read', 'admin.user.read', 'admin.role.read', 'admin.exchange.read', 'admin.order.read', 'admin.position.read', 'admin.ai.read', 'admin.incident.read', 'admin.feature_flag.read', 'admin.kill_switch.read', 'admin.release_gate.read'];

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
  /*
     SUPPORT (화면 등급 'ops') — 열람 전용.

     원래 admin.user.status.write 를 갖고 있었다(지원 담당이 침해된 계정을 즉시
     정지할 수 있게 한 설계로 보인다). 운영 방침을 "ops 는 열람만, 변경 없음" 으로
     확정해 제거했다.

     ★ 운영상 결과: 계정 침해 신고가 들어와도 지원 담당은 정지시킬 수 없다.
       ADMIN 이상에게 에스컬레이션해야 한다. 야간·주말에 ADMIN 이 없으면
       대응이 늦어진다 — 당직 ADMIN 을 두거나, 침해 대응 전용 권한을 따로
       만드는 편이 낫다. 지금은 방침대로 열람 전용으로 둔다.
  */
  SUPPORT: new Set<AdminPermission>([...READ_ONLY, 'admin.support.write']),
  ANALYST: new Set<AdminPermission>([...READ_ONLY, 'admin.audit.read', 'admin.audit.export', 'admin.support.write']),
  ADMIN: new Set<AdminPermission>([...READ_ONLY, 'admin.user.status.write', 'admin.audit.read', 'admin.audit.export', 'admin.role.write', 'admin.incident.write', 'admin.feature_flag.write', 'admin.kill_switch.write', 'admin.release_gate.write', 'admin.ai.policy.write', 'admin.gateway.write', 'admin.broker.rebate.read',
    /*
       학습 데이터 현황은 ADMIN 도 본다 — "모이고 있는가" 는 운영 정보다.

       ★ 내보내기(admin.learning.export)는 주지 않는다. 파일이 한 번 나가면
         회수할 수 없고, 그 파일에는 개인의 거래 행동 전체가 들어 있다.
         SUPER_ADMIN 만 갖는다.
    */
    'admin.learning.read', 'admin.notice.write', 'admin.support.write', 'admin.referral.write', 'admin.points.write']),
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
