import { z } from 'zod';
import { INCIDENT_STATES, INCIDENT_SEVERITIES, RELEASE_GATE_STATES, KILL_SWITCH_SCOPES } from '@quantumtrade/admin-domain';

/**
 * Admin API input schemas (docs PHASE5-13). All strings length-limited; unknown keys rejected via
 * .strict(); pagination bounded. Server also applies auth/CSRF/permission/rate-limit/redaction.
 */
const Reason = z.string().min(4).max(500);
const Id = z.string().min(1).max(64);

export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

export const UserStatusActionSchema = z.object({
  reason: Reason,
}).strict();

export const RoleChangeSchema = z.object({
  newRole: z.enum(['USER', 'PRO_USER', 'SUPPORT', 'ANALYST', 'ADMIN', 'SUPER_ADMIN']),
  reason: Reason,
  /*
     ★★ 재인증 확인.

       역할 변경은 **권한 상승 경로**다(USER → SUPER_ADMIN 도 가능). 삭제·이메일
       변경·킬스위치는 모두 재인증을 요구했는데 역할 변경만 CSRF 로 끝났다.
       관리자 세션이 탈취되면 그 세션 하나로 조용히 최고 권한 계정을 만들 수 있다.
  */
  reauth: z.boolean(),
}).strict();

/**
 * 직원 계정 생성.
 *
 * ★★ 왜 별도 경로인가: 지금까지 직원 계정을 만드는 방법은 "직원이 고객으로
 *   가입한 뒤 관리자가 역할을 올리는" 것뿐이었다. 그 사이 그 계정은 고객으로
 *   집계되고(리퍼럴·통계), 어떤 계정이 직원인지 기록이 남지 않는다.
 *
 * ★ 역할은 **직원 역할만** 허용한다. 여기서 SUPER_ADMIN 을 만들 수 있게 하면
 *   계정 생성 한 번으로 최고 권한이 생긴다 — 승격은 기존 역할 변경 경로(재인증·
 *   마지막 SUPER_ADMIN 보호·감사기록)를 그대로 거치게 한다.
 */
export const StaffCreateSchema = z.object({
  email: z.string().email().max(254),
  role: z.enum(['SUPPORT', 'ANALYST', 'ADMIN']),
  /** 표시용 이름(감사 추적을 사람이 읽을 수 있게 한다). */
  name: z.string().max(80).optional(),
  reason: Reason,
  reauth: z.boolean(),
}).strict();

export const IncidentCreateSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(4000),
  severity: z.enum(INCIDENT_SEVERITIES),
  service: z.string().max(80),
  impact: z.string().max(1000).optional(),
}).strict();

export const IncidentUpdateSchema = z.object({
  status: z.enum(INCIDENT_STATES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  owner: z.string().max(120).optional(),
  rootCause: z.string().max(2000).optional(),
  mitigation: z.string().max(2000).optional(),
  resolution: z.string().max(2000).optional(),
  note: z.string().max(2000).optional(),
  version: z.number().int().nonnegative(), // optimistic lock
}).strict();

export const FeatureFlagUpdateSchema = z.object({
  enabled: z.boolean(),
  reason: Reason,
  expiresAt: z.number().int().positive().optional(),
  version: z.number().int().nonnegative(),
}).strict();

export const KillSwitchUpdateSchema = z.object({
  scope: z.enum(KILL_SWITCH_SCOPES),
  active: z.boolean(),
  target: z.string().max(64).nullable(),
  reason: Reason,
  expiresAt: z.number().int().positive().optional(),
  reauth: z.boolean(), // step-up: must confirm re-auth flag
  version: z.number().int().nonnegative(),
}).strict();

export const ReleaseGateUpdateSchema = z.object({
  status: z.enum(RELEASE_GATE_STATES),
  reason: z.string().max(500).optional(),
  evidencePath: z.string().max(300).optional(),
  expiresAt: z.number().int().positive().optional(),
  version: z.number().int().nonnegative(),
}).strict();

export const AuditQuerySchema = z.object({
  actorId: Id.optional(),
  userId: Id.optional(),
  action: z.string().max(80).optional(),
  resource: z.string().max(80).optional(),
  ip: z.string().max(64).optional(),
  correlationId: z.string().max(64).optional(),
  result: z.enum(['success', 'failure']).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

export const ExportRequestSchema = z.object({
  format: z.enum(['csv', 'json']),
  maxRows: z.coerce.number().int().min(1).max(10_000).default(1000),
}).strict();

/**
 * Admin order/position search. `.strict()` like the other admin queries, so an unexpected parameter is
 * a 400 rather than being silently ignored. Read-only: there is no admin order mutation schema.
 */
export const AdminOrderQuerySchema = z.object({
  q: z.string().max(120).optional(),
  symbol: z.string().max(40).optional(),
  side: z.enum(['buy', 'sell', 'long', 'short']).optional(),
  status: z.string().max(32).optional(),
  type: z.string().max(32).optional(),
  mode: z.string().max(32).optional(),
  userId: z.string().max(64).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

export const AdminPositionQuerySchema = z.object({
  q: z.string().max(120).optional(),
  symbol: z.string().max(40).optional(),
  side: z.enum(['buy', 'sell', 'long', 'short']).optional(),
  userId: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

export const AdminAiQuerySchema = z.object({
  q: z.string().max(120).optional(),
  provider: z.string().max(40).optional(),
  model: z.string().max(60).optional(),
  status: z.string().max(32).optional(),
  userId: z.string().max(64).optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

/**
 * `GET /admin/broker/rebates` query.
 *
 * `from`/`to` are unix SECONDS, matching BitMart's `start_time`/`end_time`. Bounds are optional: with
 * neither, BitMart returns the last 180 days. `.strict()` so a typo'd bound is a 400 rather than a
 * silent full-history read that a reader would mistake for the range they asked for.
 */
export const BrokerRebateQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
}).strict().refine((v) => v.from === undefined || v.to === undefined || v.from <= v.to, {
  message: 'from must not be after to',
  path: ['from'],
});

export const UserSearchSchema = z.object({  q: z.string().max(120).optional(),
  status: z.enum(['active', 'disabled', 'locked']).optional(),
  role: z.string().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

/**
 * Rejects EVERY query parameter.
 *
 * Used by the aggregate-only admin GETs that take no input. Silently ignoring `?limit=1` on an endpoint
 * that does not paginate teaches a caller that its parameter worked; a 400 says it did not.
 */
export const NoQuerySchema = z.object({}).strict();

// ---------------------------------------------------------------------------
// ADM-API-13 — security summary / account unlock
// ---------------------------------------------------------------------------

/**
 * Account unlock (ADM-API-13).
 *
 * `reauth` is the step-up acknowledgement, using the same shape the kill-switch contract established
 * rather than inventing a second convention. There is deliberately no `userId` field: the target comes
 * from the PATH and the actor from the session, so a body cannot redirect the action at another account.
 */
/**
 * 회원 삭제 요청.
 *
 * ★★ 되돌릴 수 없으므로 세 가지를 함께 요구한다.
 *
 *   reason        — 4~500자. 감사 기록과 삭제 처리 기록에 남는다.
 *   reauth        — 방금 본인 확인을 했다는 표시.
 *   confirmEmail  — **대상의 이메일을 그대로 입력**해야 한다.
 *
 * ★ confirmEmail 이 핵심이다. 권한과 사유만 요구하면 목록에서 잘못된 행을
 *   누른 실수가 그대로 삭제가 된다. 이메일을 직접 입력하게 하면 "지금 누구를
 *   지우는지" 를 한 번 더 확인하게 된다(서버가 대상과 대조한다).
 */
export const UserDeleteSchema = z.object({
  reason: Reason,
  reauth: z.boolean(),
  confirmEmail: z.string().min(3).max(320),
}).strict();

/**
 * 관리자에 의한 이메일 변경.
 *
 * ★★ 이메일은 로그인 식별자다. 바뀌면 이용자는 이전 주소로 로그인할 수 없다.
 *   잘못 입력하면 그 사람이 자기 계정에서 잠긴다. 그래서 재인증과 사유를
 *   함께 요구한다.
 *
 * ★ 형식 검사는 최소한만 한다(z.string().email()). 지나치게 엄격한 정규식은
 *   유효한 주소를 거부하는 쪽으로 실패하며, 실제 도달 가능성은 어차피
 *   확인 메일로만 알 수 있다.
 */
export const UserEmailChangeSchema = z.object({
  email: z.string().email().max(320),
  reason: Reason,
  reauth: z.boolean(),
}).strict();

export const AdminUnlockSchema = z.object({
  reason: Reason,
  reauth: z.boolean(),
}).strict();

export const LockoutQuerySchema = z.object({
  /** `active` = currently locked; `expired` = failure history whose lock has elapsed. */
  state: z.enum(['active', 'expired', 'any']).default('active'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

// ---------------------------------------------------------------------------
// ADM-API-12 — reports
// ---------------------------------------------------------------------------

/**
 * The report allowlist. SERVER-SIDE and closed: an unrecognised `type` is a 422, never a generic report.
 * Each entry names aggregates that exist in this database — nothing here invents a data source.
 */
export const ADMIN_REPORT_TYPES = [
  'daily_operations',
  'trading_activity',
  'ai_cost',
  'security_posture',
  'compliance_audit',
] as const;
export type AdminReportType = (typeof ADMIN_REPORT_TYPES)[number];

export const ReportGenerateSchema = z.object({
  type: z.enum(ADMIN_REPORT_TYPES),
  /** Optional closed time window; defaults to the type's own window (24h or all-time). */
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional(),
}).strict();

export const ReportQuerySchema = z.object({
  type: z.enum(ADMIN_REPORT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();

// ---------------------------------------------------------------------------
// ADM-API-08 — LOCAL MOCK gateway control
// ---------------------------------------------------------------------------

/**
 * Mock-gateway resync/reconnect. The ACTION is part of the path, so a replayed body cannot be retargeted
 * at the other operation. `idempotencyKey` is required: a control action that is safe to retry must be
 * provably the same action, and the server stores the key so a retry returns the first outcome.
 */
export const GatewayActionSchema = z.object({
  reason: Reason,
  reauth: z.boolean(),
  version: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(8).max(64).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();

// ---------------------------------------------------------------------------
// ADM-API-09 — incident acknowledgement
// ---------------------------------------------------------------------------

export const IncidentAckSchema = z.object({
  version: z.number().int().nonnegative(), // optimistic lock
  note: z.string().max(500).optional(),
}).strict();

// ---------------------------------------------------------------------------
// ADM-API-11 — AI policy write
// ---------------------------------------------------------------------------

/**
 * AI policy update.
 *
 * `liveExecutionEnabled` is a `z.literal(false)`: the only accepted value is `false`, so a request that
 * tries to turn live AI execution on is a 422 at the PARSER — it never reaches a handler that could get
 * the branch wrong. The database carries the same rule as a CHECK constraint (migration 0009).
 *
 * `systemPrompt` is accepted but never stored or echoed: the server keeps a SHA-256 digest, the digest
 * algorithm and the length. An operator can therefore verify WHICH prompt is deployed without the
 * console becoming a place to read or exfiltrate it.
 */
export const AiPolicyUpdateSchema = z.object({
  maxOutputTokens: z.number().int().min(1).max(32_000),
  dailyCostLimitMicros: z.number().int().min(0).max(1_000_000_000),
  allowedTools: z.array(z.string().min(1).max(60)).max(40),
  systemPrompt: z.string().min(1).max(20_000).optional(),
  promptVersion: z.string().min(1).max(40).optional(),
  liveExecutionEnabled: z.literal(false).optional(),
  reason: Reason,
  reauth: z.boolean(),
  version: z.number().int().nonnegative(),
}).strict();

export type RoleChangeInput = z.infer<typeof RoleChangeSchema>;
export type StaffCreateInput = z.infer<typeof StaffCreateSchema>;
export type KillSwitchUpdateInput = z.infer<typeof KillSwitchUpdateSchema>;
export type ReleaseGateUpdateInput = z.infer<typeof ReleaseGateUpdateSchema>;
export type IncidentCreateInput = z.infer<typeof IncidentCreateSchema>;
