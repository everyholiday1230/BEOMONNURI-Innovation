/*
   첫 관리자 만들기.

   무엇이 문제였나
   -------------
   개발용 씨드(admin@qt.local 등)는 `NODE_ENV=production` 에서 아예 돌지 않는다.
   그리고 가입 경로는 모든 사용자에게 'user' 역할을 준다. 즉 **프로덕션에는
   관리자가 한 명도 없고, 화면으로 만들 방법도 없었다.** 배포하고 나서
   /admin 에 들어가려 하면 아무도 들어갈 수 없다.

   어떻게 푸는가
   -----------
   운영자가 평소처럼 **자기 실제 이메일로 가입**한 다음, 그 이메일을
   `BOOTSTRAP_ADMIN_EMAIL` 에 넣고 재시작하면 그 계정을 SUPER_ADMIN 으로
   올린다.

   ★★ 비밀번호를 환경변수에 넣지 않는다. 계정은 사람이 가입 화면에서 만들고
     우리는 역할만 올린다. 환경변수에 담긴 비밀번호는 배포 로그·설정 화면·
     백업에 남고 바꾸기도 어렵다.

   ★★ 이미 활동 중인 SUPER_ADMIN 이 있으면 아무것도 하지 않는다. 변수를
     지우지 않고 그대로 두어도 상시 승격 경로(뒷문)가 되지 않게 하려는 것이다.
     승격은 "관리자가 0명일 때" 만 일어난다.

   ★ 결과는 반드시 로그로 남기고 감사 기록에도 넣는다. 조용히 역할을 바꾸면
     나중에 "누가 언제 관리자가 됐나" 를 답할 수 없다.
*/

export type BootstrapAdminOutcome =
  | 'skipped_not_configured'
  | 'skipped_admin_exists'
  | 'blocked_user_not_found'
  | 'blocked_user_not_active'
  | 'promoted';

export interface BootstrapAdminDeps {
  /** BOOTSTRAP_ADMIN_EMAIL 값. 비어 있으면 아무것도 하지 않는다. */
  email: string | undefined;
  findByEmail(email: string): Promise<{ id: string; email: string; role: string; status: string } | null>;
  activeSuperAdminIds(): Promise<string[]>;
  setUserRole(userId: string, role: string): Promise<boolean>;
  recordAudit?(entry: {
    id: string;
    actorUserId: string | null;
    action: string;
    target?: string | null;
    at: number;
    meta?: Record<string, unknown> | null;
  }): Promise<void>;
  log(message: string): void;
  now?: () => number;
  newId?: () => string;
}

/** 로그에 이메일 전체를 남기지 않는다 — 로그는 우리 것이 아닐 수 있다. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export async function bootstrapSuperAdmin(deps: BootstrapAdminDeps): Promise<BootstrapAdminOutcome> {
  const email = deps.email?.trim().toLowerCase();
  if (!email) return 'skipped_not_configured';

  const existing = await deps.activeSuperAdminIds();
  if (existing.length > 0) {
    /*
       이미 관리자가 있다 — 변수가 남아 있어도 다시 승격하지 않는다.
       운영자가 변수를 지우는 것을 잊어도 안전하도록.
    */
    deps.log(
      `[api] BOOTSTRAP_ADMIN_EMAIL 은 무시했다 — 이미 활동 중인 SUPER_ADMIN 이 ${existing.length}명 있다. ` +
        '역할 변경은 관리자 화면에서 한다.',
    );
    return 'skipped_admin_exists';
  }

  const user = await deps.findByEmail(email);
  if (!user) {
    deps.log(
      `[api] BOOTSTRAP_ADMIN_EMAIL(${maskEmail(email)}) 로 가입된 계정이 없다. ` +
        '가입 화면에서 그 이메일로 먼저 가입한 뒤 다시 시작하면 관리자로 올린다.',
    );
    return 'blocked_user_not_found';
  }
  if (user.status !== 'active') {
    deps.log(
      `[api] BOOTSTRAP_ADMIN_EMAIL(${maskEmail(email)}) 계정 상태가 '${user.status}' 라서 올리지 않았다. ` +
        '활성 계정만 관리자가 될 수 있다.',
    );
    return 'blocked_user_not_active';
  }

  const ok = await deps.setUserRole(user.id, 'SUPER_ADMIN');
  if (!ok) {
    deps.log(`[api] BOOTSTRAP_ADMIN_EMAIL(${maskEmail(email)}) 역할 변경이 반영되지 않았다.`);
    return 'blocked_user_not_found';
  }

  const now = deps.now ? deps.now() : Date.now();
  if (deps.recordAudit) {
    try {
      await deps.recordAudit({
        id: deps.newId ? deps.newId() : `bootstrap-${now}`,
        actorUserId: null, // 사람이 아니라 기동 절차가 한 일이다
        action: 'admin.bootstrap_super_admin',
        target: user.id,
        at: now,
        meta: { source: 'BOOTSTRAP_ADMIN_EMAIL', previousRole: user.role },
      });
    } catch {
      /* 감사 기록 실패가 승격을 무르지는 않는다 — 로그에는 남는다. */
    }
  }

  deps.log(
    `[api] ${maskEmail(email)} 를 SUPER_ADMIN 으로 올렸다(이전 역할: ${user.role}). ` +
      '★ BOOTSTRAP_ADMIN_EMAIL 은 이제 지워도 된다. 추가 관리자는 관리자 화면에서 지정한다.',
  );
  return 'promoted';
}
