import { Hono, type Context } from 'hono';
import { InMemoryRateLimiter, type RateLimiter } from '../security/rate-limiter';
import { getCookie } from 'hono/cookie';
import { createHash } from 'node:crypto';
import { AuthService, verifyCsrf, originAllowed, normalizeRole } from '@quantumtrade/auth';
import {
  hasAdminPermission, isAdminRole, type AdminPermission, ADMIN_PERMISSIONS,
  canAssignRole, canDisableAdmin, wouldRemoveLastSuperAdmin,
  evaluateReleaseGateUpdate, canTransitionIncident, type IncidentState, redact, csvSafe,
} from '@quantumtrade/admin-domain';
import {
  UserSearchSchema, UserStatusActionSchema, RoleChangeSchema, IncidentCreateSchema, IncidentUpdateSchema,
  FeatureFlagUpdateSchema, KillSwitchUpdateSchema, ReleaseGateUpdateSchema, AuditQuerySchema, ExportRequestSchema,
  AdminOrderQuerySchema, AdminPositionQuerySchema, AdminAiQuerySchema,
  NoQuerySchema, AdminUnlockSchema, LockoutQuerySchema, ADMIN_REPORT_TYPES, ReportGenerateSchema,
  ReportQuerySchema, GatewayActionSchema, IncidentAckSchema, AiPolicyUpdateSchema,
  BrokerRebateQuerySchema,
} from '@quantumtrade/admin-schemas';
import { summarizeRebates, type RebateRecord } from '@quantumtrade/exchange-bitmart';
import type { IAdminRepo } from '../db/admin-repo-contract';

const CSRF = 'qt_csrf';
const corr = () => Math.random().toString(36).slice(2, 10);
const err = (code: string, message: string) => ({ error: { code, message, correlationId: corr() } });

/** Digest of free text so a response can identify WHICH text is deployed without containing it. */
const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Query-parameter parse for the admin GETs, returning the shared 400 envelope on failure. */
const parseQuery = (c: Context) => Object.fromEntries(new URL(c.req.url).searchParams);

/**
 * Statuses `/admin/ai/errors` will serve.
 *
 * A closed family rather than "anything that is not ok": the endpoint's contract is errors, and a client
 * must not be able to widen it to a full run list by passing `status=ok`.
 */
const AI_ERROR_STATUSES = ['error', 'failed', 'timeout', 'aborted'] as const;

/** Report window default: the trailing 24 hours. */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AdminRouterDeps {
  /**
   * 공지 저장소. Postgres 배포에만 주입된다.
   *
   * 없으면 공지 라우트가 503 을 낸다 — 빈 목록을 주면 "공지가 없다" 는
   * 거짓이 되고, 작성 시도가 조용히 성공한 것처럼 보인다.
   */
  notices?: import('../db/notice-repo').PgNoticeRepo;
  /** 고객 지원 티켓 저장소. Postgres 배포에만 주입된다. */
  support?: import('../db/support-repo').PgSupportRepo;
  /** 리퍼럴 저장소. Postgres 배포에만 주입된다. */
  referral?: import('../db/referral-repo').PgReferralRepo;
  /** 포인트 저장소. Postgres 배포에만 주입된다. */
  points?: import('../db/points-repo').PgPointsRepo;
  /** 법적 문서 저장소. */
  legal?: import('../db/legal-repo').PgLegalRepo;
  /**
   * KuCoin 브로커 정산 조회.
   *
   * ★ 운영자 키가 없으면 주입되지 않는다. 그때 화면은 "설정되지 않음" 을 보여준다 —
   *   수익 0 원과 설정 누락은 다른 상태다.
   */
  kucoinBroker?: {
    client: import('@quantumtrade/exchange-kucoin').KucoinBrokerClient;
    operator: { apiKey: string; apiSecret: string; passphrase: string };
    broker: { partner: string; key: string; name: string } | null;
  };
  /**
   * 알림 저장소.
   *
   * ★ 운영자의 행동이 고객에게 전달돼야 할 때 쓴다. 답변을 달아도 고객이 모르면
   *   화면을 다시 열 때까지 기다리게 된다 — 문의한 사람은 답을 기다린다.
   */
  notifications?: import('../db/notification-repo').INotificationRepo;
  service: AuthService;
  repo: IAdminRepo;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  health: () => Record<string, string>; // returns Unavailable/Not Connected/Not Executed etc.
  ratePerMin?: number; // per-actor admin request budget (default 120; raised only for local/e2e via env)
  /** Distributed limiter (Redis in production; in-memory in dev). Injected so the real admin path uses it. */
  rateLimiter?: RateLimiter;
  /**
   * Whether the LOCAL MOCK gateway is controllable in this deployment (ADM-API-08).
   *
   * `controllable:false` makes resync/reconnect report `DISABLED_BY_POLICY` / `NOT_CONNECTED` instead of
   * mutating a row and calling it a reconnect. It is set at MOUNT time from the environment, so no
   * request can influence it.
   */
  gatewayControl?: { controllable: boolean; target: string };
  /**
   * The deployment's ACTUAL trading posture.
   *
   * Previously these three values were hardcoded literals in `/admin/overview`, so the dashboard reported
   * `liveTradingEnabled:false, killSwitch:true` no matter what the deployment was configured to do. An
   * operator checking whether the kill switch is engaged would have been told "yes" while live orders were
   * flowing. Injected at mount time from the environment, so no request can influence it.
   */
  posture?: { mode: string; liveTradingEnabled: boolean; killSwitch: boolean };
  /**
   * Reader for the operator's BitMart API Broker rebate statement.
   *
   * Optional on purpose. A deployment with no operator BitMart key is a legitimate state (the broker
   * account may not be wired yet), and that must be reported as NOT_CONFIGURED rather than as a
   * failure — an operator looking at an empty revenue page needs to know whether it means "no rebate
   * earned" or "we are not asking BitMart".
   *
   * Injected as a function so the route is testable without network access.
   */
  brokerRebates?: {
    brokerId: string;
    fetchSpot: (q: { startTime?: number; endTime?: number }) => Promise<RebateRecord[]>;
  };
}

export function createAdminRouter(d: AdminRouterDeps): Hono {
  const app = new Hono();
  const adminLimit = d.ratePerMin ?? 120;
  const rl: RateLimiter = d.rateLimiter ?? new InMemoryRateLimiter();

  // Resolved at MOUNT time from the deps, never from a request.
  const gatewayControl = d.gatewayControl ?? { controllable: true, target: 'LOCAL_MOCK' };

  // Singleton rows the B7 contracts read (idempotent; `INSERT OR IGNORE`). Seeded here so every caller —
  // including the test harnesses — gets a router whose GETs return a row rather than a 404 that would only
  // reproduce on some deployments. Guarded because an older schema (pre-0009) must degrade to a disabled
  // endpoint rather than a router that fails to construct.
  // Singleton rows the B7 contracts read. The factory is synchronous, so this is fire-and-forget:
  // Promise.all CALLS both async seed methods synchronously (the SQLite adapter's inner runs inline, so
  // dev/test rows exist immediately), and production also seeds explicitly at startup. Idempotent
  // (ON CONFLICT DO NOTHING), so a pre-0009 schema simply degrades to 404 rather than a construction error.
  void Promise.all([d.repo.seedMockGateway(), d.repo.seedAiPolicy()]).catch(() => {});

  // no-store on every admin response
  app.use('*', async (c, next) => { await next(); c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff'); });

  const authed = async (c: Context) => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null; // rejects disabled users
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret, raw: raw! } : null;
  };
  const csrfOk = (c: Context, secret: string) =>
    originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF), secret, d.csrfKey);

  /** Guard: authenticated + admin role + specific permission (default deny) + rate limit. */
  const guard = async (c: Context, perm: AdminPermission) => {
    const a = await authed(c);
    if (!a) return { err: c.json(err('UNAUTHENTICATED', ''), 401) };
    if (!isAdminRole(a.user.role)) return { err: c.json(err('FORBIDDEN', 'admin access denied'), 403) }; // USER/PRO_USER blocked
    if (!(await rl.allow(`admin:${a.user.id}`, adminLimit, 60_000)).ok) return { err: c.json(err('RATE_LIMITED', 'too many admin requests'), 429) };
    if (!hasAdminPermission(a.user.role, perm)) return { err: c.json(err('FORBIDDEN', `missing ${perm}`), 403) };
    return { a };
  };
  const mutateGuard = async (c: Context, perm: AdminPermission) => {
    const g = await guard(c, perm);
    if ('err' in g) return g;
    if (!csrfOk(c, g.a.csrfSecret)) return { err: c.json(err('CSRF_FAILED', ''), 403) };
    return g;
  };
  const ip = (c: Context) => c.req.header('x-forwarded-for') ?? null;

  // ---------- identity ----------
  // The admin UI must derive navigation/action visibility from the SERVER's view of the session, not
  // from a role cached in localStorage. This returns the effective permission set for the current
  // session so the client renders the same decision the guards enforce. Read-only, no secrets: the
  // session id, csrf secret and password hash are never part of the payload.
  app.get('/admin/me', async (c) => {
    const g = await guard(c, 'admin.dashboard.read'); if ('err' in g) return g.err;
    const role = normalizeRole(g.a.user.role) ?? g.a.user.role;
    // ADMIN and SUPER_ADMIN hold the SAME permission set, so a permission-only client cannot tell them
    // apart. The two operations docs/PHASE5-02 reserves for SUPER_ADMIN are enforced by the INVARIANT
    // layer (`canAssignRole`, `evaluateReleaseGateUpdate`), not by a permission — so they are reported
    // here as capabilities, derived from those same functions. The client consumes capabilities and
    // never compares `role === 'SUPER_ADMIN'` itself.
    const capabilities: string[] = [];
    if (
      canAssignRole({
        actorRole: role,
        actorUserId: g.a.user.id,
        targetUserId: `${g.a.user.id}-probe`,
        targetCurrentRole: 'USER',
        newRole: 'SUPER_ADMIN',
      }).allowed
    ) {
      capabilities.push('admin.roles.assignPrivileged');
    }
    if (
      evaluateReleaseGateUpdate({
        actorRole: role,
        current: 'NOT_EXECUTED',
        next: 'WAIVED',
        hasEvidence: true,
        reason: 'capability probe reason',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        productionRequired: false,
        now: Date.now(),
      }).allowed
    ) {
      capabilities.push('admin.release.waive');
    }
    return c.json({
      userId: g.a.user.id,
      email: g.a.user.email,
      role,
      permissions: ADMIN_PERMISSIONS.filter((p) => hasAdminPermission(g.a.user.role, p)),
      capabilities,
    });
  });

  // ---------- overview / health ----------
  app.get('/admin/overview', async (c) => {
    const g = await guard(c, 'admin.dashboard.read'); if ('err' in g) return g.err;
    // Unmeasured metrics are reported as Unavailable / Not Connected / Not Executed (never fake 0/OK).
    // Real counts from the users table. Reported as Unavailable on failure rather than as 0 — a dashboard
    // showing zero users when the store is unreachable is worse than showing nothing.
    let users: unknown;
    try {
      users = await d.repo.countUsers({});
    } catch {
      users = { total: 'Unavailable', byStatus: 'Unavailable', byRole: 'Unavailable' };
    }
    return c.json({
      users,
      exchange: {
        // Read from the deployment, not asserted. These were literals until 2026-08-03.
        liveMode: d.posture?.mode ?? 'Unavailable',
        privateWs: 'Not Connected',
        reconciliationMismatches: 'Unavailable',
      },
      trading: {
        liveTradingEnabled: d.posture?.liveTradingEnabled ?? 'Unavailable',
        killSwitch: d.posture?.killSwitch ?? 'Unavailable',
        realOrders: 'Not Executed',
        // Stated so a consumer can tell a missing posture from a false one.
        postureSource: d.posture ? 'deployment' : 'unavailable',
      },
      ai: { provider: d.health().aiProvider ?? 'Unavailable', liveModel: 'Not Executed' },
      system: d.health(),
    });
  });
  app.get('/admin/system/health', async (c) => {
    const g = await guard(c, 'admin.dashboard.read'); if ('err' in g) return g.err;
    return c.json(d.health());
  });

  // ---------- users ----------
  app.get('/admin/users', async (c) => {
    const g = await guard(c, 'admin.user.read'); if ('err' in g) return g.err;
    const parsed = UserSearchSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json(err('BAD_REQUEST', 'invalid query'), 400);
    // `total` is the count for the same filter, so the UI can paginate instead of guessing from page size.
    const [rows, counts] = await Promise.all([
      d.repo.searchUsers(parsed.data),
      d.repo.countUsers({ ...(parsed.data.q ? { q: parsed.data.q } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}), ...(parsed.data.role ? { role: parsed.data.role } : {}) }),
    ]);
    return c.json({
      users: redact(rows),
      total: counts.total,
      byStatus: counts.byStatus,
      byRole: counts.byRole,
      page: { limit: parsed.data.limit, offset: parsed.data.offset, hasMore: parsed.data.offset + rows.length < counts.total },
    });
  });
  app.get('/admin/users/:id', async (c) => {
    const g = await guard(c, 'admin.user.read'); if ('err' in g) return g.err;
    const u = await d.repo.getUser(c.req.param('id'));
    if (!u) return c.json(err('NOT_FOUND', 'user not found'), 404); // IDOR-safe: admin scope, but redacted
    return c.json(redact({ user: u, stats: await d.repo.userStats(u.id) })); // password_hash never selected; redact any sensitive
  });
  app.post('/admin/users/:id/disable', async (c) => {
    const g = await mutateGuard(c, 'admin.user.status.write'); if ('err' in g) return g.err;
    const body = UserStatusActionSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json(err('BAD_REQUEST', 'reason required'), 400);
    const target = await d.repo.getUser(c.req.param('id'));
    if (!target) return c.json(err('NOT_FOUND', ''), 404);
    const dec = canDisableAdmin({ role: target.role, userId: target.id }, await d.repo.activeSuperAdminIds());
    if (!dec.allowed) { await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'user.disable', resource: 'user', resourceId: target.id, targetUserId: target.id, result: 'failure', riskLevel: 'high', ip: ip(c), reason: dec.reason }); return c.json(err('FORBIDDEN', dec.reason ?? ''), 403); }
    await d.repo.setUserStatus(target.id, 'disabled');
    const revoked = await d.repo.revokeUserSessions(target.id); // disabled admin sessions revoked immediately
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'user.disable', resource: 'user', resourceId: target.id, targetUserId: target.id, result: 'success', riskLevel: 'high', ip: ip(c), reason: body.data.reason, before: { status: target.status }, after: { status: 'disabled', sessionsRevoked: revoked } });
    return c.json({ ok: true, sessionsRevoked: revoked });
  });
  app.post('/admin/users/:id/enable', async (c) => {
    const g = await mutateGuard(c, 'admin.user.status.write'); if ('err' in g) return g.err;
    const body = UserStatusActionSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json(err('BAD_REQUEST', 'reason required'), 400);
    const target = await d.repo.getUser(c.req.param('id'));
    if (!target) return c.json(err('NOT_FOUND', ''), 404);
    await d.repo.setUserStatus(target.id, 'active');
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'user.enable', resource: 'user', resourceId: target.id, targetUserId: target.id, result: 'success', riskLevel: 'medium', ip: ip(c), reason: body.data.reason });
    return c.json({ ok: true });
  });
  app.post('/admin/users/:id/revoke-sessions', async (c) => {
    const g = await mutateGuard(c, 'admin.user.status.write'); if ('err' in g) return g.err;
    const target = await d.repo.getUser(c.req.param('id'));
    if (!target) return c.json(err('NOT_FOUND', ''), 404);
    const n = await d.repo.revokeUserSessions(target.id);
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'user.revoke_sessions', resource: 'user', resourceId: target.id, targetUserId: target.id, result: 'success', riskLevel: 'medium', ip: ip(c), after: { revoked: n } });
    return c.json({ ok: true, revoked: n });
  });
  app.patch('/admin/users/:id/role', async (c) => {
    const g = await mutateGuard(c, 'admin.role.write'); if ('err' in g) return g.err;
    const body = RoleChangeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) return c.json(err('BAD_REQUEST', 'invalid role change'), 400);
    const target = await d.repo.getUser(c.req.param('id'));
    if (!target) return c.json(err('NOT_FOUND', ''), 404);
    const reqRole = { actorRole: g.a.user.role, actorUserId: g.a.user.id, targetUserId: target.id, targetCurrentRole: target.role, newRole: body.data.newRole };
    const dec = canAssignRole(reqRole);
    if (!dec.allowed || wouldRemoveLastSuperAdmin(reqRole, await d.repo.activeSuperAdminIds())) {
      const reason = dec.allowed ? 'cannot remove last SUPER_ADMIN' : dec.reason;
      await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'user.role.change', resource: 'user', resourceId: target.id, targetUserId: target.id, result: 'failure', riskLevel: 'high', ip: ip(c), reason });
      return c.json(err('FORBIDDEN', reason ?? ''), 403);
    }
    await d.repo.setUserRole(target.id, body.data.newRole);
    const revoked = await d.repo.revokeUserSessions(target.id); // role change → re-auth
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'user.role.change', resource: 'user', resourceId: target.id, targetUserId: target.id, result: 'success', riskLevel: 'high', ip: ip(c), reason: body.data.reason, before: { role: target.role }, after: { role: body.data.newRole, sessionsRevoked: revoked } });
    return c.json({ ok: true });
  });

  // ---------- trading ops (READ-ONLY) ----------
  app.get('/admin/exchange-connections', async (c) => {
    const g = await guard(c, 'admin.exchange.read'); if ('err' in g) return g.err;
    const parsed = AdminPositionQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json(err('BAD_REQUEST', 'invalid query'), 400);
    // No secret material: `exchange_credentials` is never joined and only a masked tail is exposed.
    return c.json({
      connections: redact(await d.repo.searchExchangeConnections(parsed.data)),
      total: await d.repo.countExchangeConnections(),
      gateway: await d.repo.gatewaySummary(),
      privateWs: d.health().bitmartWs ?? 'Unavailable',
      readOnly: true,
      note: 'read-only; access keys masked, secret/memo/auth headers/KMS data never returned',
    });
  });
  // ---------- orders / positions (READ-ONLY) ----------
  // There is NO admin write path here by policy: no submit, no modify, no cancel, no leverage or
  // margin change, no position close. These two routes are SELECT-only.
  app.get('/admin/orders', async (c) => {
    const g = await guard(c, 'admin.order.read'); if ('err' in g) return g.err;
    const parsed = AdminOrderQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json(err('BAD_REQUEST', 'invalid query'), 400);
    const q = parsed.data;
    return c.json({
      orders: redact(await d.repo.searchOrders(q)),
      total: await d.repo.countOrders(q),
      readOnly: true,
      note: 'read-only; no admin order submission, modification or cancellation',
    });
  });
  app.get('/admin/positions', async (c) => {
    const g = await guard(c, 'admin.position.read'); if ('err' in g) return g.err;
    const parsed = AdminPositionQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json(err('BAD_REQUEST', 'invalid query'), 400);
    const q = parsed.data;
    return c.json({
      positions: redact(await d.repo.searchPositions(q)),
      total: await d.repo.countPositions(q),
      readOnly: true,
      note: 'read-only; no close, leverage or margin-mode change',
    });
  });

  // ---------- AI ops ----------
  // ---------- AI ops (READ-ONLY) ----------
  // Prompt and response TEXT is never returned: an operator must not be able to read a user's
  // conversation from the console. Token counts, cost, model, fallback and tool-call counts are.
  app.get('/admin/ai/usage', async (c) => {
    const g = await guard(c, 'admin.ai.read'); if ('err' in g) return g.err;
    const parsed = AdminAiQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json(err('BAD_REQUEST', 'invalid query'), 400);
    const q = parsed.data;
    return c.json({
      provider: d.health().aiProvider ?? 'Unavailable',
      liveModel: 'Not Executed',
      summary: await d.repo.aiUsageSummary(),
      runs: redact(await d.repo.searchAiRuns(q)),
      total: await d.repo.countAiRuns(q),
      readOnly: true,
      promptRedacted: true,
      note: 'read-only; prompt/response text is never returned',
    });
  });
  /**
   * B8 — AI error runs.
   *
   * Was a fixed `limit 50 / offset 0` with no filters and no client. It now paginates and filters, and
   * the response states the two SAFE identifiers the console is allowed to show: the trace (correlation)
   * id and the error CLASS. Prompt and response text are not in the projection at all — `searchAiRuns`
   * selects operational metadata only, and `ai_messages` is never joined — so there is nothing here for a
   * caller to widen into a conversation dump.
   *
   * The status filter is SERVER-CONSTRAINED to the error family. A client cannot pass `status=ok` and
   * turn the "errors" endpoint into an unfiltered run list.
   */
  app.get('/admin/ai/errors', async (c) => {
    const g = await guard(c, 'admin.ai.read'); if ('err' in g) return g.err;
    const parsed = AdminAiQuerySchema.safeParse(parseQuery(c));
    if (!parsed.success) return c.json(err('BAD_REQUEST', 'invalid query'), 400);
    const { status, ...rest } = parsed.data;
    if (status !== undefined && !(AI_ERROR_STATUSES as readonly string[]).includes(status)) {
      // Rejected rather than ignored, and the rejected value is NOT echoed back.
      return c.json(err('VALIDATION_FAILED', `status must be one of the error statuses: ${AI_ERROR_STATUSES.join(', ')}`), 422);
    }
    const q = { ...rest, statusIn: status ? [status] : AI_ERROR_STATUSES };
    const runs = await d.repo.searchAiRuns(q) as Record<string, unknown>[];
    return c.json({
      errors: redact(
        runs.map((r) => ({
          ...r,
          // Explicit safe identifiers for the UI, so a screen does not have to guess which field is safe.
          traceId: r.correlation_id ?? null,
          errorClass: r.status ?? null,
          // This deployment records no separate provider error CODE on `ai_runs`; reported as absent
          // rather than back-filled from the status.
          errorCode: null,
        })),
      ),
      total: await d.repo.countAiRuns(q),
      errorStatuses: AI_ERROR_STATUSES,
      limit: q.limit,
      offset: q.offset,
      readOnly: true,
      promptRedacted: true,
      unavailable: ['errorCode', 'providerErrorBody'],
      note: 'read-only; prompt and response text are never returned, and no provider error body is stored',
    });
  });

  // ---------- audit ----------
  app.get('/admin/audit', async (c) => {
    const g = await guard(c, 'admin.audit.read'); if ('err' in g) return g.err;
    const parsed = AuditQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json(err('BAD_REQUEST', 'invalid query'), 400);
    return c.json({ entries: redact(await d.repo.listAudit(parsed.data)), total: await d.repo.countAudit(parsed.data), appendOnly: true });
  });
  app.get('/admin/audit/export', async (c) => {
    const g = await guard(c, 'admin.audit.export'); if ('err' in g) return g.err; // separate permission
    const parsed = ExportRequestSchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
    if (!parsed.success) return c.json(err('BAD_REQUEST', 'invalid export'), 400);
    const rows = await d.repo.listAudit({ limit: parsed.data.maxRows, offset: 0 }) as Record<string, unknown>[];
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'audit.export', resource: 'audit', result: 'success', riskLevel: 'medium', ip: ip(c), after: { rows: rows.length, format: parsed.data.format } });
    if (parsed.data.format === 'json') return c.json({ rows: redact(rows) });
    const cols = ['id', 'actor_user_id', 'actor_role', 'action', 'resource', 'result', 'risk_level', 'at'];
    const csv = [cols.join(','), ...rows.map((r) => cols.map((k) => csvSafe((r as Record<string, unknown>)[k])).join(','))].join('\n');
    c.header('Content-Type', 'text/csv');
    return c.body(csv);
  });

  // ---------- incidents ----------
  app.get('/admin/incidents', async (c) => { const g = await guard(c, 'admin.incident.read'); if ('err' in g) return g.err; return c.json({ incidents: await d.repo.listIncidents() }); });
  app.post('/admin/incidents', async (c) => {
    const g = await mutateGuard(c, 'admin.incident.write'); if ('err' in g) return g.err;
    const b = IncidentCreateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json(err('BAD_REQUEST', 'invalid incident'), 400);
    const id = await d.repo.createIncident({ ...b.data, impact: b.data.impact, by: g.a.user.id });
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'incident.create', resource: 'incident', resourceId: id, result: 'success', riskLevel: 'medium', ip: ip(c) });
    return c.json({ id }, 201);
  });
  app.patch('/admin/incidents/:id', async (c) => {
    const g = await mutateGuard(c, 'admin.incident.write'); if ('err' in g) return g.err;
    const b = IncidentUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json(err('BAD_REQUEST', 'invalid update'), 400);
    const cur = await d.repo.getIncident(c.req.param('id'));
    if (!cur) return c.json(err('NOT_FOUND', ''), 404);
    if (b.data.status && !canTransitionIncident(cur.status as IncidentState, b.data.status)) return c.json(err('BAD_STATE', `illegal transition ${cur.status}→${b.data.status}`), 409);
    const patch: Record<string, string | undefined> = { status: b.data.status, severity: b.data.severity, owner: b.data.owner, rootCause: b.data.rootCause, mitigation: b.data.mitigation, resolution: b.data.resolution, note: b.data.note };
    const r = await d.repo.updateIncident(cur.id, patch, b.data.version, g.a.user.id);
    if (r.conflict) return c.json(err('CONFLICT', 'version conflict (concurrent edit)'), 409);
    if (!r.ok) return c.json(err('NOT_FOUND', ''), 404);
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'incident.update', resource: 'incident', resourceId: cur.id, result: 'success', riskLevel: 'low', ip: ip(c) });
    return c.json({ ok: true });
  });

  // ---------- feature flags ----------
  app.get('/admin/feature-flags', async (c) => { const g = await guard(c, 'admin.feature_flag.read'); if ('err' in g) return g.err; return c.json({ flags: await d.repo.listFlags() }); });
  app.patch('/admin/feature-flags/:id', async (c) => {
    const g = await mutateGuard(c, 'admin.feature_flag.write'); if ('err' in g) return g.err;
    const b = FeatureFlagUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json(err('BAD_REQUEST', 'invalid flag update'), 400);
    const r = await d.repo.updateFlag(c.req.param('id'), b.data.enabled, b.data.reason, b.data.version, g.a.user.id, corr());
    if (r.conflict) return c.json(err('CONFLICT', 'version conflict'), 409);
    if (!r.ok) return c.json(err('NOT_FOUND', ''), 404);
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'feature_flag.update', resource: 'feature_flag', resourceId: c.req.param('id'), result: 'success', riskLevel: 'medium', ip: ip(c), reason: b.data.reason, after: { enabled: b.data.enabled } });
    return c.json({ ok: true });
  });

  // ---------- kill switches (fail-closed + step-up reauth) ----------
  app.get('/admin/kill-switches', async (c) => { const g = await guard(c, 'admin.kill_switch.read'); if ('err' in g) return g.err; return c.json({ killSwitches: await d.repo.listKill() }); });
  app.patch('/admin/kill-switches/:id', async (c) => {
    const g = await mutateGuard(c, 'admin.kill_switch.write'); if ('err' in g) return g.err;
    const b = KillSwitchUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json(err('BAD_REQUEST', 'invalid kill-switch update'), 400);
    if (!b.data.reauth) return c.json(err('STEP_UP_REQUIRED', 'high-risk action requires re-authentication'), 403);
    const r = await d.repo.updateKill(c.req.param('id'), b.data.active, b.data.reason, b.data.version, g.a.user.id, corr());
    if (r.conflict) return c.json(err('CONFLICT', 'version conflict (concurrent edit)'), 409);
    if (!r.ok) return c.json(err('NOT_FOUND', ''), 404);
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'kill_switch.update', resource: 'kill_switch', resourceId: c.req.param('id'), result: 'success', riskLevel: 'high', ip: ip(c), reason: b.data.reason, after: { scope: b.data.scope, active: b.data.active } });
    return c.json({ ok: true, note: 'live-trading scopes are fail-closed on store error' });
  });

  // ---------- release gates (no fake pass; WAIVED guard) ----------
  app.get('/admin/release-gates', async (c) => { const g = await guard(c, 'admin.release_gate.read'); if ('err' in g) return g.err; return c.json({ gates: await d.repo.listGates() }); });
  app.patch('/admin/release-gates/:id', async (c) => {
    const g = await mutateGuard(c, 'admin.release_gate.write'); if ('err' in g) return g.err;
    const b = ReleaseGateUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json(err('BAD_REQUEST', 'invalid gate update'), 400);
    const cur = await d.repo.getGate(c.req.param('id'));
    if (!cur) return c.json(err('NOT_FOUND', ''), 404);
    const willHaveEvidence = await d.repo.hasEvidence(cur.id) || !!b.data.evidencePath;
    const dec = evaluateReleaseGateUpdate({ actorRole: g.a.user.role, current: cur.status as never, next: b.data.status, hasEvidence: willHaveEvidence, productionRequired: cur.production_required === 1, reason: b.data.reason, expiresAt: b.data.expiresAt, now: Date.now() });
    if (!dec.allowed) {
      await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'release_gate.update', resource: 'release_gate', resourceId: cur.id, result: 'failure', riskLevel: 'high', ip: ip(c), reason: dec.reason, after: { status: b.data.status } });
      return c.json(err('FORBIDDEN', dec.reason ?? ''), 403);
    }
    const r = await d.repo.updateGate(cur.id, b.data.status, b.data.version, g.a.user.id, { reason: b.data.reason, expiresAt: b.data.expiresAt, evidencePath: b.data.evidencePath });
    if (r.conflict) return c.json(err('CONFLICT', 'version conflict'), 409);
    if (!r.ok) return c.json(err('NOT_FOUND', ''), 404);
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'release_gate.update', resource: 'release_gate', resourceId: cur.id, result: 'success', riskLevel: 'high', ip: ip(c), reason: b.data.reason, after: { status: b.data.status } });
    return c.json({ ok: true });
  });

  // =========================================================================
  // Prompt 5 / B7 — admin operational contracts
  //
  // Every route below reuses the SAME guards as the rest of this router: `guard`/`mutateGuard` (session →
  // admin role → rate limit → specific permission, default deny), the CSRF check on unsafe methods, the
  // `err()` envelope, the no-store middleware, and the append-only audit repo with the actor separated
  // from the target. Nothing here trusts a client-supplied role, permission or capability.
  // =========================================================================

  // ---------- ADM-API-13 security summary + account unlock ----------

  /**
   * Aggregate security posture. COUNTS ONLY.
   *
   * There is no MFA secret, seed, otpauth URI, QR payload, recovery-code (hash or plaintext) or password
   * hash anywhere in this payload — those columns are never selected by `securitySummary()`, so this is a
   * structural property rather than a filtering step that could be forgotten. Asserted by test.
   */
  app.get('/admin/security/summary', async (c) => {
    const g = await guard(c, 'admin.user.read'); if ('err' in g) return g.err;
    if (!NoQuerySchema.safeParse(parseQuery(c)).success) return c.json(err('BAD_REQUEST', 'this endpoint takes no query parameters'), 400);
    return c.json({ ...await d.repo.securitySummary(), readOnly: true, aggregatesOnly: true });
  });

  /**
   * Accounts that currently hold lockout state, so the unlock action has a real target list instead of
   * asking an operator to paste a user id. Aggregates plus identity (id/e-mail/counters) — no MFA
   * material, because `mfa_credentials` is not joined.
   */
  app.get('/admin/security/lockouts', async (c) => {
    const g = await guard(c, 'admin.user.read'); if ('err' in g) return g.err;
    const parsed = LockoutQuerySchema.safeParse(parseQuery(c));
    if (!parsed.success) return c.json(err('BAD_REQUEST', 'invalid query'), 400);
    return c.json({
      lockouts: redact(await d.repo.listLockouts(parsed.data)),
      total: await d.repo.countLockouts(parsed.data.state),
      state: parsed.data.state,
      source: { table: 'account_lockouts', note: 'persisted brute-force lockout state (migration 0009)' },
      readOnly: true,
    });
  });

  /**
   * Clear a lockout.
   *
   * DECISION — the actor may NOT unlock their own account (403 SELF_ACTION_FORBIDDEN).
   *
   * A lockout is a containment control against credential brute force. If the locked party can clear
   * their own containment, the control does not exist: an attacker who has the session cookie of a
   * partially-compromised admin account, or an admin being throttled on MFA verification, could simply
   * reset the counter and keep going. Making it a two-person operation costs an admin one message to a
   * colleague and removes the self-service bypass entirely. Disable/enable already separates actor from
   * target this way; unlock is the higher-risk case, not the exception.
   *
   * The response contains no MFA material of any kind — only the target id, whether anything changed, and
   * the resulting (cleared) lockout state.
   */
  app.post('/admin/users/:id/unlock', async (c) => {
    const g = await mutateGuard(c, 'admin.user.status.write'); if ('err' in g) return g.err;
    const b = AdminUnlockSchema.safeParse(await c.req.json().catch(() => ({})));
    // The rejected input is deliberately NOT echoed back into the error body.
    if (!b.success) return c.json(err('VALIDATION_FAILED', 'a reason (4-500 chars) and a reauth acknowledgement are required'), 422);
    if (!b.data.reauth) return c.json(err('STEP_UP_REQUIRED', 'clearing a lockout requires re-authentication'), 403);
    const target = await d.repo.getUser(c.req.param('id'));
    if (!target) return c.json(err('NOT_FOUND', 'user not found'), 404);
    if (target.id === g.a.user.id) {
      await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'user.unlock', resource: 'user', resourceId: target.id, targetUserId: target.id, result: 'failure', riskLevel: 'high', ip: ip(c), reason: 'self-unlock refused: a lockout must be cleared by a different admin' });
      return c.json(err('SELF_ACTION_FORBIDDEN', 'a lockout must be cleared by a different administrator'), 403);
    }
    const r = await d.repo.clearLockout(target.id, g.a.user.id);
    await d.repo.recordAction({
      actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'user.unlock', resource: 'user',
      resourceId: target.id, targetUserId: target.id, result: 'success', riskLevel: 'high', ip: ip(c),
      reason: b.data.reason,
      // Counters only. No credential material reaches the audit trail either.
      before: r.before, after: { locked: false, changed: r.changed },
    });
    return c.json({
      ok: true,
      changed: r.changed,
      userId: target.id,
      lockout: { locked: false, fails: 0, lockedUntil: 0 },
      note: r.changed ? 'lockout cleared' : 'no lockout was in effect for this account',
    });
  });

  // ---------- ADM-API-12 reports ----------

  /**
   * Report list + the SERVER's allowlist of report types.
   *
   * The allowlist ships in the response so the UI populates its selector from the server rather than from
   * a duplicated client list that could drift into offering a type the server rejects.
   */
  app.get('/admin/reports', async (c) => {
    const g = await guard(c, 'admin.audit.read'); if ('err' in g) return g.err;
    const parsed = ReportQuerySchema.safeParse(parseQuery(c));
    if (!parsed.success) return c.json(err('BAD_REQUEST', 'invalid query'), 400);
    const rows = (await d.repo.listReports(parsed.data) as Record<string, unknown>[]).map((r) => ({
      ...r,
      source: safeJson(r.source_json),
      source_json: undefined,
    }));
    return c.json({
      types: ADMIN_REPORT_TYPES,
      reports: redact(rows),
      total: await d.repo.countReports(parsed.data.type),
      immutable: true,
      note: 'reports are immutable aggregate snapshots over existing tables; there is no edit or delete route',
    });
  });

  /**
   * Generate a report.
   *
   * `admin.audit.export` — not `admin.audit.read` — because generating MATERIALISES an aggregate of
   * user/order/audit data and stores it for later retrieval, which is the same sensitivity as exporting
   * the audit log. SUPPORT holds neither and is refused.
   *
   * An unrecognised type is a 422 from the schema. There is no default branch and no generic report:
   * `computeReport` throws on an unknown type rather than returning something empty that would look like
   * a successful report with no findings.
   */
  app.post('/admin/reports', async (c) => {
    const g = await mutateGuard(c, 'admin.audit.export'); if ('err' in g) return g.err;
    const b = ReportGenerateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json(err('VALIDATION_FAILED', `type must be one of: ${ADMIN_REPORT_TYPES.join(', ')}`), 422);
    const now = Date.now();
    const to = b.data.to ?? now;
    const from = b.data.from ?? to - DAY_MS;
    if (from > to) return c.json(err('VALIDATION_FAILED', 'the window start must not be after its end'), 422);
    const computed = await d.repo.computeReport(b.data.type, { from, to });
    const source = {
      kind: 'LOCAL_DB_AGGREGATE',
      tables: computed.tables,
      window: { from, to },
      unavailable: computed.unavailable,
      generatedAt: now,
      note: 'aggregate counts over existing tables; no external system was queried',
    };
    const id = await d.repo.insertReport({ type: b.data.type, data: computed.data, source, rowCount: computed.rowCount, from, to, by: g.a.user.id });
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'report.generate', resource: 'report', resourceId: id, result: 'success', riskLevel: 'medium', ip: ip(c), after: { type: b.data.type, rowCount: computed.rowCount } });
    return c.json({ id, type: b.data.type, generatedAt: now, generatedBy: g.a.user.id, rowCount: computed.rowCount, source }, 201);
  });

  app.get('/admin/reports/:id', async (c) => {
    const g = await guard(c, 'admin.audit.read'); if ('err' in g) return g.err;
    const r = await d.repo.getReport(c.req.param('id'));
    if (!r) return c.json(err('NOT_FOUND', 'report not found'), 404);
    return c.json(
      redact({
        id: r.id,
        type: r.report_type,
        rowCount: r.row_count,
        window: { from: r.window_from, to: r.window_to },
        generatedBy: r.generated_by,
        generatedAt: r.generated_at,
        source: safeJson(r.source_json),
        data: safeJson(r.data_json),
        immutable: true,
      }),
    );
  });

  // ---------- ADM-API-15 backup status (READ-ONLY; no restore) ----------

  /**
   * What is actually knowable about durability, and nothing else.
   *
   * This deployment's datastore is SQLite, and the response says so. File presence/size/mtime, the
   * journal mode (WAL or not) and the last applied migration are real and reported. Managed-Postgres
   * backup, PITR, retention, encryption-at-rest and restore drills are not knowable from here and are
   * reported as `null` + listed in `unavailable` — never as a fabricated success. The
   * `backup-restore-pitr` release gate's own row is included so this screen cannot imply the gate passed.
   *
   * There is NO restore route. Not a disabled one, not a 403 one — none is mounted.
   */
  app.get('/admin/backup/status', async (c) => {
    const g = await guard(c, 'admin.dashboard.read'); if ('err' in g) return g.err;
    if (!NoQuerySchema.safeParse(parseQuery(c)).success) return c.json(err('BAD_REQUEST', 'this endpoint takes no query parameters'), 400);
    return c.json(await d.repo.backupStatus());
  });

  // ---------- ADM-API-07 gateway stream metrics (LOCAL only) ----------

  /**
   * Stream metrics from the LOCAL `exchange_websocket_sessions` table. No real gateway host is contacted
   * — `source.realGatewayHost` says `Not Connected`, and staleness is reported as `EMPTY` (undecidable)
   * rather than `FRESH` when nothing has been recorded.
   */
  app.get('/admin/gateway/metrics', async (c) => {
    const g = await guard(c, 'admin.exchange.read'); if ('err' in g) return g.err;
    if (!NoQuerySchema.safeParse(parseQuery(c)).success) return c.json(err('BAD_REQUEST', 'this endpoint takes no query parameters'), 400);
    return c.json({
      ...await d.repo.gatewayMetrics(),
      privateWs: d.health().bitmartWs ?? 'Unavailable',
      control: { controllable: gatewayControl.controllable, target: gatewayControl.target },
    });
  });

  // ---------- ADM-API-08 LOCAL MOCK gateway resync / reconnect ----------

  /**
   * Control actions for the LOCAL MOCK gateway only.
   *
   * Requires permission (`admin.gateway.write`, a WRITE permission that the read-only roles do not hold),
   * CSRF, step-up, an idempotency key and an optimistic version, and is audited.
   *
   * When the deployment has no controllable local mock (`controllable:false`), the response is an explicit
   * `applied:false` with `result:'DISABLED_BY_POLICY'` and `target:'NOT_CONNECTED'`. It is HTTP 200
   * because the request was understood and answered — the same shape the B4 order contract uses for
   * `executable:false` — and the body cannot be mistaken for a reconnect that happened.
   */
  const gatewayAction = (action: 'resync' | 'reconnect') => async (c: Context) => {
    const g = await mutateGuard(c, 'admin.gateway.write'); if ('err' in g) return g.err;
    const b = GatewayActionSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json(err('VALIDATION_FAILED', 'reason, reauth, version and idempotencyKey are required'), 422);
    if (!b.data.reauth) return c.json(err('STEP_UP_REQUIRED', 'gateway control requires re-authentication'), 403);

    const scope = `admin.gateway.${action}`;
    // A retried key returns the STORED outcome. Re-running the action would make the key meaningless: the
    // second attempt could reach a different conclusion (e.g. a version conflict) than the first.
    const prior = await d.repo.findIdempotent(b.data.idempotencyKey, scope);
    if (prior) {
      return c.json({ ...(safeJson(prior.result) as Record<string, unknown>), idempotentReplay: true, firstSeenAt: prior.created_at });
    }

    if (!gatewayControl.controllable) {
      const body = {
        ok: false,
        applied: false,
        action,
        result: 'DISABLED_BY_POLICY',
        target: 'NOT_CONNECTED',
        note: 'no controllable local mock gateway in this deployment; no real gateway host is contacted from the admin console',
      };
      await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: `gateway.${action}`, resource: 'gateway', resourceId: gatewayControl.target, result: 'failure', riskLevel: 'medium', ip: ip(c), reason: b.data.reason, after: { result: 'DISABLED_BY_POLICY' } });
      return c.json(body);
    }

    if (!await d.repo.claimIdempotent(b.data.idempotencyKey, scope, g.a.user.id)) {
      // The key was taken between the read above and this insert — a concurrent retry, not a new action.
      return c.json(err('CONFLICT', 'this idempotency key is already in use'), 409);
    }

    const r = await d.repo.applyMockGatewayAction(action, b.data.version, g.a.user.id);
    if (r.conflict) return c.json(err('CONFLICT', 'version conflict (concurrent edit)'), 409);
    if (!r.ok) return c.json(err('NOT_FOUND', 'no local mock gateway state row'), 404);

    const body = {
      ok: true,
      applied: true,
      action,
      result: 'APPLIED_TO_LOCAL_MOCK',
      target: gatewayControl.target,
      state: r.state,
      note: 'this changed the LOCAL MOCK gateway state only; no exchange or real gateway host was contacted',
    };
    await d.repo.storeIdempotentResult(b.data.idempotencyKey, scope, body);
    await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: `gateway.${action}`, resource: 'gateway', resourceId: gatewayControl.target, result: 'success', riskLevel: 'medium', ip: ip(c), reason: b.data.reason, after: { result: 'APPLIED_TO_LOCAL_MOCK', version: r.state?.version } });
    return c.json(body);
  };
  app.post('/admin/gateway/resync', gatewayAction('resync'));
  app.post('/admin/gateway/reconnect', gatewayAction('reconnect'));

  // ---------- ADM-API-09 incident acknowledgement ----------

  /**
   * Acknowledge an incident: who saw it, and when.
   *
   * Acknowledgement is NOT a status transition — an incident can be acknowledged while it is still OPEN —
   * so it is recorded on its own columns rather than being forced through the state machine.
   *
   * A stale `version` is a 409 (checked BEFORE the already-acked branch, so a concurrent edit is reported
   * as a conflict rather than silently accepted). A second ack with the current version is honestly
   * `changed:false`, keeps the FIRST acknowledger and timestamp, and does not bump the version — bumping
   * it would invalidate every other console's version for a no-op.
   */
  app.post('/admin/incidents/:id/ack', async (c) => {
    const g = await mutateGuard(c, 'admin.incident.write'); if ('err' in g) return g.err;
    const b = IncidentAckSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json(err('VALIDATION_FAILED', 'a numeric version is required'), 422);
    const r = await d.repo.ackIncident(c.req.param('id'), b.data.version, g.a.user.id, b.data.note);
    if (r.conflict) return c.json(err('CONFLICT', 'version conflict (concurrent edit)'), 409);
    if (!r.ok) return c.json(err('NOT_FOUND', 'incident not found'), 404);
    // Audited only when something actually changed: an audit entry for a no-op is noise that makes the
    // real acknowledgement harder to find.
    if (r.changed) {
      await d.repo.recordAction({ actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'incident.ack', resource: 'incident', resourceId: c.req.param('id'), result: 'success', riskLevel: 'low', ip: ip(c), after: { acknowledgedAt: r.acknowledgedAt, version: r.version } });
    }
    return c.json({
      ok: true,
      changed: r.changed === true,
      incidentId: c.req.param('id'),
      acknowledgedAt: r.acknowledgedAt ?? null,
      acknowledgedBy: r.acknowledgedBy ?? null,
      version: r.version ?? null,
      idempotent: true,
    });
  });

  // ---------- ADM-API-11 AI policy ----------

  /** Policy view. Digest + metadata only — never the raw system prompt, never a provider credential. */
  app.get('/admin/ai/policy', async (c) => {
    const g = await guard(c, 'admin.ai.read'); if ('err' in g) return g.err;
    if (!NoQuerySchema.safeParse(parseQuery(c)).success) return c.json(err('BAD_REQUEST', 'this endpoint takes no query parameters'), 400);
    const p = await d.repo.getAiPolicy();
    if (!p) return c.json(err('NOT_FOUND', 'no ai policy row'), 404);
    return c.json(aiPolicyView(p, await d.repo.countAiPolicyHistory()));
  });

  /**
   * Write the AI policy.
   *
   * - optimistic `version` → 409 on a concurrent edit
   * - `reauth` step-up → 403 STEP_UP_REQUIRED without it
   * - CSRF + `admin.ai.policy.write` + append-only audit
   * - `liveExecutionEnabled` is a `z.literal(false)` in the schema and a CHECK constraint in the database,
   *   so this endpoint CANNOT enable live AI execution: a request that tries is a 422 at the parser.
   * - The raw system prompt is hashed here and the plaintext is discarded. It is not stored, not audited
   *   and not returned; the response carries the digest, its algorithm and its length so an operator can
   *   verify WHICH prompt is deployed without the console becoming a way to read it.
   */
  app.put('/admin/ai/policy', async (c) => {
    const g = await mutateGuard(c, 'admin.ai.policy.write'); if ('err' in g) return g.err;
    const b = AiPolicyUpdateSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!b.success) return c.json(err('VALIDATION_FAILED', 'invalid ai policy payload (live AI execution cannot be enabled)'), 422);
    if (!b.data.reauth) return c.json(err('STEP_UP_REQUIRED', 'changing AI policy requires re-authentication'), 403);
    const correlationId = corr();
    const digest = b.data.systemPrompt === undefined ? undefined : sha256Hex(b.data.systemPrompt);
    const r = await d.repo.updateAiPolicy(
      {
        maxOutputTokens: b.data.maxOutputTokens,
        dailyCostLimitMicros: b.data.dailyCostLimitMicros,
        allowedTools: b.data.allowedTools,
        promptDigest: digest,
        promptAlgo: digest === undefined ? undefined : 'sha256',
        promptLen: b.data.systemPrompt?.length,
        promptVersion: b.data.promptVersion,
      },
      b.data.version,
      g.a.user.id,
      { reason: b.data.reason, correlationId },
    );
    if (r.conflict) return c.json(err('CONFLICT', 'version conflict (concurrent edit)'), 409);
    if (!r.ok || !r.policy) return c.json(err('NOT_FOUND', 'no ai policy row'), 404);
    await d.repo.recordAction({
      actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'ai_policy.update', resource: 'ai_policy',
      resourceId: 'default', result: 'success', riskLevel: 'high', ip: ip(c), correlationId, reason: b.data.reason,
      // Digest + counters only. The prompt text never reaches the audit trail.
      after: { version: r.policy.version, promptDigest: digest ?? null, promptLen: b.data.systemPrompt?.length ?? null, liveExecutionEnabled: false },
    });
    return c.json({ ok: true, ...aiPolicyView(r.policy, await d.repo.countAiPolicyHistory()) });
  });

  /**
   * G10 — the operator's BitMart API Broker rebate statement.
   *
   * This is COMPANY REVENUE, not a user's payback. BitMart's response is a daily total per currency
   * with no user or order dimension (developer-pro.bitmart.com/en/broker/ → Get Rebate Records), so
   * nothing here can be attributed to an individual user — per-user payback must be derived from our
   * own fill records instead. The response says so explicitly rather than leaving a reader to assume
   * otherwise.
   *
   * Read-only, so it is a GET behind `admin.broker.rebate.read` with no CSRF requirement (no mutation).
   * Restricted to ADMIN/SUPER_ADMIN by the permission map, not by anything checked here.
   */
  app.get('/admin/broker/rebates', async (c) => {
    const g = await guard(c, 'admin.broker.rebate.read'); if ('err' in g) return g.err;

    const parsed = BrokerRebateQuerySchema.safeParse(parseQuery(c));
    if (!parsed.success) {
      // Field path + rule code only; the rejected input is never echoed back.
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code }));
      return c.json({ ...err('BAD_REQUEST', 'invalid rebate query'), issues }, 400);
    }

    if (!d.brokerRebates) {
      /*
         브로커 자격증명이 설정되지 않았다.

         이전에는 503 을 냈다. "earned nothing" 과 구분하려는 의도는 맞지만,
         503 은 **장애** 를 뜻한다. 설정을 아직 안 한 것은 장애가 아니고,
         관리자 화면을 열 때마다 브라우저 콘솔에 오류가 쌓인다. 콘솔이 잡음으로
         차면 진짜 장애를 놓친다 — 이 코드베이스에서 이미 겪은 실패 방식이다.
         (같은 이유로 키 문제는 200 + credentialStatus 로 통일했다.)

         구분은 상태 코드가 아니라 `configured: false` 로 한다. 소비자는
         그 플래그를 봐야 하고, 빈 배열만 보고 "리베이트 0원" 이라고
         판단해서는 안 된다 — 그래서 rebates 를 아예 넣지 않는다.
      */
      return c.json(
        {
          ...err('NOT_CONFIGURED', 'no operator broker credential is configured for rebate queries'),
          configured: false,
        },
        200,
      );
    }

    const q = parsed.data;
    let records: RebateRecord[];
    try {
      records = await d.brokerRebates.fetchSpot({
        ...(q.from !== undefined ? { startTime: q.from } : {}),
        ...(q.to !== undefined ? { endTime: q.to } : {}),
      });
    } catch (e) {
      // Upstream detail is safe here (BitMart error codes, no secrets) and is what an operator needs:
      // 53005 means our key lacks broker permission, which is a fix on BitMart's side, not ours.
      return c.json(err('UPSTREAM_ERROR', (e as Error).message), 502);
    }

    return c.json({
      configured: true,
      brokerId: d.brokerRebates.brokerId,
      records,
      summary: summarizeRebates(records),
      // Contract notes, so a client cannot mistake this for per-user data or for a complete picture.
      scope: 'operator',
      perUserAttributionAvailable: false,
      futures: {
        included: false,
        reason:
          'BitMart documents no futures rebate endpoint; futures rebate eligibility is unconfirmed',
      },
      defaultWindow: q.from === undefined && q.to === undefined ? 'last-180-days' : 'explicit',
      note: 'company rebate revenue as reported by BitMart; not per-user payback',
    });
  });


  // ---- 공지 (전체 사용자에게 나가는 게시물) ----

  /**
   * 공지 목록 (관리자). 초안·게시·보관 전부 보여준다.
   *
   * 운영자(SUPPORT/ANALYST)도 읽을 수 있다 — 고객 문의에 답하려면 어떤 공지가
   * 나갔는지 알아야 한다. 쓰기는 관리자 이상만 가능하다.
   */
  app.get('/admin/notices', async (c) => {
    const g = await guard(c, 'admin.notice.read'); if ('err' in g) return g.err;
    if (!d.notices) {
      return c.json({ ...err('NOT_CONFIGURED', 'notices require the PostgreSQL backend'), notices: [] }, 503);
    }
    const notices = await d.notices.listAll(Number(c.req.query('limit') ?? 100));
    return c.json({ notices, total: notices.length });
  });

  /** 공지 작성. 항상 초안으로 만들어진다 — 실수로 즉시 공개되는 것을 막는다. */
  app.post('/admin/notices', async (c) => {
    const g = await mutateGuard(c, 'admin.notice.write'); if ('err' in g) return g.err;
    if (!d.notices) return c.json(err('NOT_CONFIGURED', 'notices require the PostgreSQL backend'), 503);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(body.title ?? '').trim();
    // 제목 없는 공지는 목록에서 식별할 수 없다.
    if (!title) return c.json(err('BAD_REQUEST', 'title is required'), 400);
    if (title.length > 200) return c.json(err('BAD_REQUEST', 'title too long (max 200)'), 400);

    const notice = await d.notices.create(
      {
        title,
        body: String(body.body ?? ''),
        category: body.category ? String(body.category) : undefined,
        pinned: body.pinned === true,
        publishAt: body.publishAt == null ? null : Number(body.publishAt),
        expiresAt: body.expiresAt == null ? null : Number(body.expiresAt),
        locale: body.locale ? String(body.locale) : undefined,
      },
      g.a.user.id,
    );
    await d.repo.recordAction({
      actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'notice.create',
      resource: 'notice', resourceId: notice.id, result: 'success', riskLevel: 'medium',
      ip: ip(c), reason: title.slice(0, 120),
    });
    return c.json({ notice }, 201);
  });

  /** 내용 수정. 상태(초안/게시)는 바꾸지 않는다 — 별도 동작이다. */
  app.patch('/admin/notices/:id', async (c) => {
    const g = await mutateGuard(c, 'admin.notice.write'); if ('err' in g) return g.err;
    if (!d.notices) return c.json(err('NOT_CONFIGURED', 'notices require the PostgreSQL backend'), 503);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = String(body.title ?? '').trim();
    if (!title) return c.json(err('BAD_REQUEST', 'title is required'), 400);

    const notice = await d.notices.update(
      c.req.param('id'),
      {
        title,
        body: String(body.body ?? ''),
        category: body.category ? String(body.category) : undefined,
        pinned: body.pinned === true,
        publishAt: body.publishAt == null ? null : Number(body.publishAt),
        expiresAt: body.expiresAt == null ? null : Number(body.expiresAt),
        locale: body.locale ? String(body.locale) : undefined,
      },
      g.a.user.id,
    );
    if (!notice) return c.json(err('NOT_FOUND', 'notice not found'), 404);
    await d.repo.recordAction({
      actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'notice.update',
      resource: 'notice', resourceId: notice.id, result: 'success', riskLevel: 'low',
      ip: ip(c),
    });
    return c.json({ notice });
  });

  /*
     상태 변경 — 게시 / 내림 / 보관.

     작성·수정과 분리한 이유: 공지는 전체 사용자에게 나간다. 제목만 고치려다
     실수로 게시되는 일이 있어서는 안 된다. 게시는 별도 동작으로 명시한다.
  */
  for (const [action, verb, risk] of [
    ['publish', 'notice.publish', 'high'],
    ['unpublish', 'notice.unpublish', 'medium'],
    ['archive', 'notice.archive', 'low'],
  ] as const) {
    app.post(`/admin/notices/:id/${action}`, async (c) => {
      const g = await mutateGuard(c, 'admin.notice.write'); if ('err' in g) return g.err;
      if (!d.notices) return c.json(err('NOT_CONFIGURED', 'notices require the PostgreSQL backend'), 503);

      const id = c.req.param('id');
      const notice = action === 'publish' ? await d.notices.publish(id, g.a.user.id)
        : action === 'unpublish' ? await d.notices.unpublish(id, g.a.user.id)
        : await d.notices.archive(id, g.a.user.id);
      if (!notice) return c.json(err('NOT_FOUND', 'notice not found'), 404);

      await d.repo.recordAction({
        actorUserId: g.a.user.id, actorRole: g.a.user.role, action: verb,
        resource: 'notice', resourceId: id, result: 'success', riskLevel: risk,
        ip: ip(c), reason: notice.title.slice(0, 120),
      });
      return c.json({ notice });
    });
  }

  // ---- 고객 지원 티켓 ----

  /*
     운영자(SUPPORT/ANALYST)도 읽고 답할 수 있다 — 승인된 업무 범위가
     "티켓 대응" 이고, 답장을 못 하면 대응이 성립하지 않는다.
     계정 정지 권한과는 분리되어 있다(다른 권한 플래그).
  */
  app.get('/admin/support/tickets', async (c) => {
    const g = await guard(c, 'admin.support.read'); if ('err' in g) return g.err;
    if (!d.support) {
      return c.json({ ...err('NOT_CONFIGURED', 'support tickets require the PostgreSQL backend'), tickets: [], supported: false }, 200);
    }
    const statusRaw = c.req.query('status');
    const status = statusRaw === 'open' || statusRaw === 'pending' || statusRaw === 'resolved' ? statusRaw : undefined;
    const [tickets, counts] = await Promise.all([
      d.support.listAll({ ...(status ? { status } : {}), limit: Number(c.req.query('limit') ?? 100) }),
      d.support.counts(),
    ]);
    return c.json({ tickets, counts, total: tickets.length, supported: true });
  });

  /** 티켓 상세 — 운영자용이므로 내부 메모까지 포함된다. */
  app.get('/admin/support/tickets/:id', async (c) => {
    const g = await guard(c, 'admin.support.read'); if ('err' in g) return g.err;
    if (!d.support) return c.json(err('NOT_CONFIGURED', 'support tickets require the PostgreSQL backend'), 200);
    const found = await d.support.getForStaff(c.req.param('id'));
    if (!found) return c.json(err('NOT_FOUND', 'ticket not found'), 404);
    return c.json(found);
  });

  /**
   * 답장 또는 내부 메모.
   *
   * internal=true 는 고객에게 보이지 않는다. 저장소가 고객용 조회에서
   * SQL 로 걸러내므로, 이 플래그를 잘못 쓰면 노출되는 것이 아니라 반대로
   * 고객이 답을 못 받는다 — 그쪽이 안전한 실패다.
   */
  app.post('/admin/support/tickets/:id/reply', async (c) => {
    const g = await mutateGuard(c, 'admin.support.write'); if ('err' in g) return g.err;
    if (!d.support) return c.json(err('NOT_CONFIGURED', 'support tickets require the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = String(body.body ?? '').trim();
    if (!text) return c.json(err('BAD_REQUEST', 'body is required'), 400);
    if (text.length > 10_000) return c.json(err('BAD_REQUEST', 'body too long (max 10000)'), 400);

    const msg = await d.support.addMessage({
      ticketId: c.req.param('id'),
      authorUserId: g.a.user.id,
      authorSide: 'staff',
      body: text,
      internal: body.internal === true,
    });
    if (!msg) return c.json(err('NOT_FOUND', 'ticket not found'), 404);

    await d.repo.recordAction({
      actorUserId: g.a.user.id, actorRole: g.a.user.role,
      action: body.internal === true ? 'support.note' : 'support.reply',
      resource: 'ticket', resourceId: c.req.param('id'), result: 'success', riskLevel: 'low', ip: ip(c),
    });

    /*
       고객에게 답변이 왔다고 알린다.

       ★★ 내부 메모에는 알리지 않는다. 메모는 고객에게 보이지 않는 내용이므로,
         알림을 보내면 고객이 열어보고 아무것도 없다고 느낀다.

       ★ 알림 생성 실패가 답변 저장을 되돌리면 안 된다. 답변은 이미 기록됐고
         고객은 화면에서 볼 수 있다 — 알림은 편의 기능이다.
    */
    if (d.notifications && body.internal !== true) {
      const ticket = await d.support.getForStaff(c.req.param('id')).catch(() => null);
      const customerId = ticket?.ticket?.userId ?? null;
      if (customerId && ticket) {
        await d.notifications.create({
          userId: customerId,
          type: 'system',
          severity: 'info',
          // 본문을 넣지 않는다. 알림 목록은 요약이고, 내용은 티켓 화면에서 본다.
          message: `문의에 답변이 등록되었습니다: ${String(ticket.ticket.subject).slice(0, 80)}`,
          correlationId: c.req.param('id'),
        }).catch(() => { /* 알림 실패가 답변을 되돌리지 않는다 */ });
      }
    }
    return c.json({ message: msg }, 201);
  });

  /** 상태 변경 (열림 / 고객대기 / 종료). */
  app.post('/admin/support/tickets/:id/status', async (c) => {
    const g = await mutateGuard(c, 'admin.support.write'); if ('err' in g) return g.err;
    if (!d.support) return c.json(err('NOT_CONFIGURED', 'support tickets require the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const status = String(body.status ?? '');
    if (status !== 'open' && status !== 'pending' && status !== 'resolved') {
      return c.json(err('BAD_REQUEST', 'status must be open, pending or resolved'), 400);
    }
    const ticket = await d.support.setStatus(c.req.param('id'), status);
    if (!ticket) return c.json(err('NOT_FOUND', 'ticket not found'), 404);

    await d.repo.recordAction({
      actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'support.status',
      resource: 'ticket', resourceId: ticket.id, result: 'success', riskLevel: 'low', ip: ip(c),
      reason: status,
    });
    return c.json({ ticket });
  });

  /** 우선순위 변경. */
  app.post('/admin/support/tickets/:id/priority', async (c) => {
    const g = await mutateGuard(c, 'admin.support.write'); if ('err' in g) return g.err;
    if (!d.support) return c.json(err('NOT_CONFIGURED', 'support tickets require the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const priority = String(body.priority ?? '');
    if (priority !== 'low' && priority !== 'medium' && priority !== 'high') {
      return c.json(err('BAD_REQUEST', 'priority must be low, medium or high'), 400);
    }
    const ticket = await d.support.setPriority(c.req.param('id'), priority);
    if (!ticket) return c.json(err('NOT_FOUND', 'ticket not found'), 404);
    return c.json({ ticket });
  });

  /** 담당자 지정 — 본인에게 배정하거나 해제한다. */
  app.post('/admin/support/tickets/:id/assign', async (c) => {
    const g = await mutateGuard(c, 'admin.support.write'); if ('err' in g) return g.err;
    if (!d.support) return c.json(err('NOT_CONFIGURED', 'support tickets require the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    // 남을 배정하려면 그 사람의 ID 를 알아야 한다. 지금은 본인 배정/해제만 허용한다 —
    // 임의 ID 를 받으면 존재하지 않는 사용자에 배정돼 목록이 깨진다.
    const target = body.unassign === true ? null : g.a.user.id;
    const ticket = await d.support.assign(c.req.param('id'), target);
    if (!ticket) return c.json(err('NOT_FOUND', 'ticket not found'), 404);
    return c.json({ ticket });
  });

  // ---- 리퍼럴 제도 ----

  /*
     제도 조건 + 초대자 목록.

     운영자도 읽을 수 있다 — 고객이 "얼마 받았나요" 라고 물으면 답해야 한다.
     쓰기는 ADMIN 이상만: 제도를 켜면 전원에게 코드가 발급되고, 비율 변경은
     돈이 나가는 조건이며, 지급 기록은 "실제로 보냈다" 는 주장이다.
  */
  app.get('/admin/referral', async (c) => {
    const g = await guard(c, 'admin.referral.read'); if ('err' in g) return g.err;
    if (!d.referral) {
      return c.json({ ...err('NOT_CONFIGURED', 'referral requires the PostgreSQL backend'), supported: false, referrers: [] }, 200);
    }
    const [settings, referrers] = await Promise.all([
      d.referral.getSettings(),
      d.referral.listReferrers(Number(c.req.query('limit') ?? 100)),
    ]);
    return c.json({
      supported: true,
      settings,
      referrers,
      /*
         ★ 운영자가 알아야 하는 사실.

         우리는 적립액을 계산하지 않는다. 지급액은 거래소 어필리에이트
         대시보드에서 실제 수령액을 확인한 뒤 운영자가 산정해 입력한다.
      */
      disclosures: { accrualComputed: false, autoPayout: false },
    });
  });

  /**
   * 제도 조건 변경.
   *
   * ★ 제도를 켤 때 payoutNote 를 요구한다.
   *   자동 지급이 아니므로 "어떻게 받는지" 를 밝히지 않고 켜면 사용자는
   *   자동 입금을 기대한다. 그 기대를 만들지 않는 것이 이 검증의 목적이다.
   */
  app.post('/admin/referral/settings', async (c) => {
    const g = await mutateGuard(c, 'admin.referral.write'); if ('err' in g) return g.err;
    if (!d.referral) return c.json(err('NOT_CONFIGURED', 'referral requires the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const enabled = body.enabled === true;
    const sharePct = Number(body.sharePct);
    const minPayout = Number(body.minPayout ?? 0);
    const currency = String(body.payoutCurrency ?? 'USDT').trim().toUpperCase();
    const payoutNote = typeof body.payoutNote === 'string' ? body.payoutNote.trim() : '';

    if (!Number.isFinite(sharePct) || sharePct < 0 || sharePct > 100) {
      return c.json(err('BAD_REQUEST', 'sharePct must be between 0 and 100'), 400);
    }
    if (!Number.isFinite(minPayout) || minPayout < 0) {
      return c.json(err('BAD_REQUEST', 'minPayout must be zero or positive'), 400);
    }
    if (!/^[A-Z0-9]{2,10}$/.test(currency)) {
      return c.json(err('BAD_REQUEST', 'payoutCurrency looks invalid'), 400);
    }
    if (enabled && !payoutNote) {
      // 지급 방법을 밝히지 않고 제도를 켤 수 없다.
      return c.json(err('BAD_REQUEST', 'payoutNote is required to enable the programme — users must know how they get paid'), 400);
    }
    if (enabled && sharePct <= 0) {
      // 0% 로 켜면 "보상이 있다" 고 말하면서 0 을 준다.
      return c.json(err('BAD_REQUEST', 'sharePct must be greater than 0 to enable the programme'), 400);
    }

    const settings = await d.referral.updateSettings(
      { enabled, sharePct, minPayout, payoutCurrency: currency, payoutNote: payoutNote || null },
      g.a.user.id,
    );

    await d.repo.recordAction({
      actorUserId: g.a.user.id, actorRole: g.a.user.role,
      action: enabled ? 'referral.enable' : 'referral.disable',
      resource: 'referral', resourceId: 'default', result: 'success',
      // 돈이 나가는 조건이다. 높은 위험으로 기록한다.
      riskLevel: 'high', ip: ip(c),
      reason: `share=${sharePct}% min=${minPayout}${currency}`,
    });
    return c.json({ settings });
  });

  /**
   * 지급 기록.
   *
   * 시스템이 자동으로 만들지 않는다 — 자동 생성하면 "지급됐다고 기록됐는데
   * 실제로는 안 보냈다" 가 가능해진다. 운영자가 보낸 뒤 근거와 함께 입력한다.
   */
  app.post('/admin/referral/payouts', async (c) => {
    const g = await mutateGuard(c, 'admin.referral.write'); if ('err' in g) return g.err;
    if (!d.referral) return c.json(err('NOT_CONFIGURED', 'referral requires the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = String(body.referrerUserId ?? '').trim();
    const amount = Number(body.amount);
    const currency = String(body.currency ?? 'USDT').trim().toUpperCase();
    const method = String(body.method ?? '').trim();

    if (!userId) return c.json(err('BAD_REQUEST', 'referrerUserId is required'), 400);
    if (!Number.isFinite(amount) || amount <= 0) return c.json(err('BAD_REQUEST', 'amount must be positive'), 400);
    if (!/^[A-Z0-9]{2,10}$/.test(currency)) return c.json(err('BAD_REQUEST', 'currency looks invalid'), 400);
    // 근거 없는 지급 기록은 나중에 검증할 수 없다.
    if (!method) return c.json(err('BAD_REQUEST', 'method is required — how the payment was actually sent'), 400);

    try {
      const payout = await d.referral.recordPayout({
        referrerUserId: userId,
        amount,
        currency,
        method,
        reference: typeof body.reference === 'string' ? body.reference.trim() || null : null,
        periodStart: body.periodStart == null ? null : Number(body.periodStart),
        periodEnd: body.periodEnd == null ? null : Number(body.periodEnd),
        note: typeof body.note === 'string' ? body.note.trim() || null : null,
      }, g.a.user.id);

      await d.repo.recordAction({
        actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'referral.payout',
        resource: 'referral_payout', resourceId: payout.id, targetUserId: userId,
        result: 'success', riskLevel: 'high', ip: ip(c),
        reason: `${amount} ${currency} via ${method}`,
      });
      return c.json({ payout }, 201);
    } catch (e) {
      // 존재하지 않는 사용자에 대한 지급은 외래키가 막는다.
      return c.json(err('BAD_REQUEST', (e as Error).message), 400);
    }
  });

  /** 특정 초대자의 상세 (초대 목록 + 지급 이력). */
  app.get('/admin/referral/:userId', async (c) => {
    const g = await guard(c, 'admin.referral.read'); if ('err' in g) return g.err;
    if (!d.referral) return c.json(err('NOT_CONFIGURED', 'referral requires the PostgreSQL backend'), 200);

    const userId = c.req.param('userId');
    const [summary, signups, payouts] = await Promise.all([
      d.referral.summaryFor(userId),
      d.referral.listByReferrer(userId, 200),
      d.referral.listPayouts(userId, 100),
    ]);
    return c.json({ userId, summary, signups, payouts });
  });

  // ---- 포인트 제도 ----

  /*
     ★ 포인트는 **부채**다.

     사용자가 가진 포인트만큼 우리가 가치를 제공할 의무가 있다. 그래서 이
     화면의 첫 숫자는 '미사용 포인트 총액' 이어야 한다 — 적립만 늘리고 그
     값을 보지 않으면 감당할 수 없는 의무가 쌓인다.
  */
  app.get('/admin/points', async (c) => {
    const g = await guard(c, 'admin.points.read'); if ('err' in g) return g.err;
    if (!d.points) {
      return c.json({ ...err('NOT_CONFIGURED', 'points require the PostgreSQL backend'), supported: false }, 200);
    }
    const [settings, totals, catalog, audit] = await Promise.all([
      d.points.getSettings(),
      d.points.totals(),
      d.points.listCatalog(true),
      // 정합성 검사. 항목이 나오면 동시성 결함이 있다는 뜻이다.
      d.points.audit(10),
    ]);
    return c.json({
      supported: true, settings, totals, catalog,
      integrity: { mismatches: audit.length, samples: audit },
      disclosures: { cashConvertible: false, withdrawable: false },
    });
  });

  /**
   * 제도 조건 변경.
   *
   * ★ 현금 구매를 켜려면 결제 대행사가 있어야 한다. 지금은 없으므로 서버가
   *   거부한다. 설정만 켜두면 화면이 구매 버튼을 띄우고 사용자가 돈을 보낼
   *   방법을 찾는다.
   */
  app.post('/admin/points/settings', async (c) => {
    const g = await mutateGuard(c, 'admin.points.write'); if ('err' in g) return g.err;
    if (!d.points) return c.json(err('NOT_CONFIGURED', 'points require the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const enabled = body.enabled === true;
    const unitName = String(body.unitName ?? 'Points').trim();
    const purchaseEnabled = body.purchaseEnabled === true;
    const expiryDays = Number(body.expiryDays ?? 0);
    const referralAsPoints = body.referralAsPoints === true;
    const referralPoints = Number(body.referralPoints ?? 0);

    if (!unitName || unitName.length > 24) return c.json(err('BAD_REQUEST', 'unitName must be 1-24 characters'), 400);
    if (!Number.isInteger(expiryDays) || expiryDays < 0 || expiryDays > 3650) {
      return c.json(err('BAD_REQUEST', 'expiryDays must be 0-3650 (0 = never expires)'), 400);
    }
    if (!Number.isInteger(referralPoints) || referralPoints < 0 || referralPoints > 1_000_000) {
      return c.json(err('BAD_REQUEST', 'referralPoints must be 0-1000000'), 400);
    }
    if (referralAsPoints && referralPoints <= 0) {
      // 0 포인트를 보상이라고 말할 수 없다.
      return c.json(err('BAD_REQUEST', 'referralPoints must be greater than 0 when referral rewards are paid in points'), 400);
    }
    if (purchaseEnabled) {
      /*
         결제 대행사가 연결되지 않았다.

         구매를 허용하면 사용자가 결제를 시도하고 포인트를 받지 못한다.
         결제 라우트를 만든 뒤에 이 검사를 그 조건으로 바꿔야 한다.
      */
      return c.json(err('NOT_CONFIGURED', 'no payment provider is connected — points cannot be sold yet'), 400);
    }

    const settings = await d.points.updateSettings(
      { enabled, unitName, purchaseEnabled: false, expiryDays, referralAsPoints, referralPoints },
      g.a.user.id,
    );
    await d.repo.recordAction({
      actorUserId: g.a.user.id, actorRole: g.a.user.role,
      action: enabled ? 'points.enable' : 'points.disable',
      resource: 'points', resourceId: 'default', result: 'success',
      // 부채를 만드는 제도다. 높은 위험으로 기록한다.
      riskLevel: 'high', ip: ip(c),
      reason: `expiry=${expiryDays}d referralPoints=${referralAsPoints ? referralPoints : 0}`,
    });
    return c.json({ settings });
  });

  /** 상품 등록·수정. */
  app.post('/admin/points/catalog', async (c) => {
    const g = await mutateGuard(c, 'admin.points.write'); if ('err' in g) return g.err;
    if (!d.points) return c.json(err('NOT_CONFIGURED', 'points require the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const id = String(body.id ?? '').trim();
    const nameKey = String(body.nameKey ?? '').trim();
    const kind = String(body.kind ?? '');
    const cost = Number(body.cost);
    const grants = Number(body.grants ?? 1);

    if (!/^[a-z0-9_-]{2,40}$/.test(id)) return c.json(err('BAD_REQUEST', 'id must be lowercase letters, digits, - or _'), 400);
    // 상품명을 DB 에 넣으면 번역할 수 없다. 사전 키를 받는다.
    if (!/^[a-z0-9_]{2,60}$/.test(nameKey)) return c.json(err('BAD_REQUEST', 'nameKey must be a dictionary key'), 400);
    if (kind !== 'ai_run' && kind !== 'competition' && kind !== 'feature') {
      return c.json(err('BAD_REQUEST', 'kind must be ai_run, competition or feature'), 400);
    }
    if (!Number.isInteger(cost) || cost <= 0) return c.json(err('BAD_REQUEST', 'cost must be a positive integer'), 400);
    if (!Number.isInteger(grants) || grants <= 0) return c.json(err('BAD_REQUEST', 'grants must be a positive integer'), 400);

    const item = await d.points.upsertCatalog({
      id, nameKey,
      descKey: typeof body.descKey === 'string' && body.descKey ? body.descKey : null,
      kind, cost, grants,
      enabled: body.enabled === true,
      sortOrder: Number.isInteger(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
    });
    await d.repo.recordAction({
      actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'points.catalog',
      resource: 'point_catalog', resourceId: id, result: 'success', riskLevel: 'medium', ip: ip(c),
      reason: `${kind} cost=${cost} grants=${grants} enabled=${body.enabled === true}`,
    });
    return c.json({ item });
  });

  /**
   * 수동 지급 · 회수.
   *
   * ★ 회수는 삭제가 아니다. 반대 부호 항목을 넣어 상쇄한다 — 잘못이 있었다는
   *   사실과 고쳤다는 사실이 모두 남아야 한다.
   *
   * memo 를 필수로 받는다. 이유 없는 지급·회수는 나중에 검증할 수 없다.
   */
  app.post('/admin/points/adjust', async (c) => {
    const g = await mutateGuard(c, 'admin.points.write'); if ('err' in g) return g.err;
    if (!d.points) return c.json(err('NOT_CONFIGURED', 'points require the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = String(body.userId ?? '').trim();
    const amount = Number(body.amount);
    const direction = String(body.direction ?? '');
    const memo = String(body.memo ?? '').trim();

    if (!userId) return c.json(err('BAD_REQUEST', 'userId is required'), 400);
    if (!Number.isInteger(amount) || amount <= 0) return c.json(err('BAD_REQUEST', 'amount must be a positive integer'), 400);
    if (direction !== 'grant' && direction !== 'revoke') {
      return c.json(err('BAD_REQUEST', 'direction must be grant or revoke'), 400);
    }
    if (!memo) return c.json(err('BAD_REQUEST', 'memo is required — an adjustment without a reason cannot be audited'), 400);

    try {
      const entry = direction === 'grant'
        ? await d.points.grant({ userId, amount, reason: 'admin_grant', memo, actorId: g.a.user.id })
        : await d.points.revoke({ userId, amount, memo, actorId: g.a.user.id });

      /*
         포인트가 바뀐 것을 사용자에게 알린다.

         ★ 회수도 알린다. 잔액이 줄었는데 이유를 모르면 "포인트가 사라졌다" 는
           문의가 온다 — 그 문의를 처리하는 비용이 알림 한 줄보다 크다.
      */
      if (d.notifications) {
        await d.notifications.create({
          userId,
          type: 'system',
          severity: 'info',
          message: direction === 'grant'
            ? `포인트 ${amount}이(가) 지급되었습니다: ${memo.slice(0, 60)}`
            : `포인트 ${amount}이(가) 회수되었습니다: ${memo.slice(0, 60)}`,
          correlationId: entry ? entry.id : null,
        }).catch(() => { /* 알림 실패가 원장을 되돌리지 않는다 */ });
      }

      await d.repo.recordAction({
        actorUserId: g.a.user.id, actorRole: g.a.user.role,
        action: direction === 'grant' ? 'points.grant' : 'points.revoke',
        resource: 'point_ledger', resourceId: entry ? entry.id : 'duplicate',
        targetUserId: userId, result: 'success', riskLevel: 'high', ip: ip(c),
        reason: `${direction} ${amount} · ${memo.slice(0, 100)}`,
      });
      const balance = await d.points.balanceOf(userId);
      return c.json({ entry, balance }, 201);
    } catch (e) {
      const m = (e as Error).message;
      if (m === 'INSUFFICIENT_POINTS') {
        // 잔액보다 많이 회수할 수 없다 — 음수 잔액은 사용자에게 빚을 지우는 셈이다.
        return c.json(err('INSUFFICIENT_POINTS', 'the user does not have that many points'), 409);
      }
      if (m === 'USER_NOT_FOUND') return c.json(err('NOT_FOUND', 'user not found'), 404);
      return c.json(err('UPSTREAM_ERROR', m), 502);
    }
  });

  /** 특정 사용자의 원장 (고객 문의 응대용). */
  app.get('/admin/points/:userId', async (c) => {
    const g = await guard(c, 'admin.points.read'); if ('err' in g) return g.err;
    if (!d.points) return c.json(err('NOT_CONFIGURED', 'points require the PostgreSQL backend'), 200);

    const userId = c.req.param('userId');
    const [balance, history, entitlements] = await Promise.all([
      d.points.balanceOf(userId),
      d.points.history(userId, 200),
      d.points.entitlementsOf(userId),
    ]);
    return c.json({ userId, balance, history, entitlements });
  });

  // ---- 법적 문서 (약관 · 개인정보 · 위험고지) ----

  /*
     ★★ 게시는 되돌릴 수 없다.

       약관을 게시하면 그것이 회사의 법적 약속이 되고, 이미 본 사람이 있으므로
       "안 본 것으로" 만들 수 없다. 그래서:
         · 초안과 게시를 분리한다
         · 게시된 문서는 수정을 거부한다 (새 버전을 만들어야 한다)
         · 쓰기 권한은 SUPER 만 갖는다 (법무 검토 우회 방지)
  */
  app.get('/admin/legal', async (c) => {
    const g = await guard(c, 'admin.legal.read'); if ('err' in g) return g.err;
    if (!d.legal) {
      return c.json({ ...err('NOT_CONFIGURED', 'legal documents require the PostgreSQL backend'), supported: false }, 200);
    }
    const docs = await d.legal.list(200);
    /*
       런칭 준비 상태.

       ★ 약관과 개인정보처리방침이 게시되지 않았으면 런칭할 수 없다.
         회원가입에서 동의를 받는데 동의 대상이 없는 상태다.
    */
    const published = await d.legal.publishedKinds();
    const has = (k: string) => published.some((p) => p.kind === k);
    return c.json({
      supported: true,
      documents: docs,
      published,
      readiness: {
        termsPublished: has('terms'),
        privacyPublished: has('privacy'),
        riskPublished: has('risk'),
        // 이 둘이 없으면 런칭 차단이다.
        canLaunch: has('terms') && has('privacy'),
      },
    });
  });

  app.post('/admin/legal/draft', async (c) => {
    const g = await mutateGuard(c, 'admin.legal.write'); if ('err' in g) return g.err;
    if (!d.legal) return c.json(err('NOT_CONFIGURED', 'legal documents require the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const kind = String(body.kind ?? '');
    const locale = String(body.locale ?? '').trim();
    const version = String(body.version ?? '').trim();
    const title = String(body.title ?? '').trim();
    const text = String(body.body ?? '');

    if (!['terms', 'privacy', 'risk', 'security'].includes(kind)) {
      return c.json(err('BAD_REQUEST', 'kind must be terms, privacy, risk or security'), 400);
    }
    if (!/^[a-zA-Z]{2}(-[a-zA-Z0-9]{2,8})?$/.test(locale)) {
      return c.json(err('BAD_REQUEST', 'locale must be a language tag such as en or ko-KR'), 400);
    }
    if (!version || version.length > 40) return c.json(err('BAD_REQUEST', 'version is required (max 40 chars)'), 400);
    if (!title || title.length > 200) return c.json(err('BAD_REQUEST', 'title is required (max 200 chars)'), 400);
    if (!text.trim()) return c.json(err('BAD_REQUEST', 'body is required'), 400);
    /*
       HTML 을 거부한다.

       화면은 마크다운 부분집합만 렌더한다. HTML 을 저장할 수 있게 두면 관리자
       계정이 침해될 때 모든 방문자에게 스크립트를 실어 보낼 수 있다 — 약관
       페이지는 로그인 전에도 열리므로 특히 위험하다.
    */
    if (/<\s*(script|iframe|object|embed|style|link|meta)\b/i.test(text)) {
      return c.json(err('BAD_REQUEST', 'HTML tags are not allowed — the body is rendered as markdown'), 400);
    }

    const effectiveAt = Number(body.effectiveAt);
    try {
      const doc = await d.legal.createDraft({
        kind: kind as 'terms' | 'privacy' | 'risk' | 'security',
        locale, version, title, body: text,
        effectiveAt: Number.isFinite(effectiveAt) && effectiveAt > 0 ? effectiveAt : null,
        actorId: g.a.user.id,
      });
      await d.repo.recordAction({
        actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'legal.draft',
        resource: 'legal_document', resourceId: doc.id, result: 'success',
        riskLevel: 'medium', ip: ip(c), reason: `${kind}/${locale} v${version}`,
      });
      return c.json({ document: doc }, 201);
    } catch (e) {
      const m = (e as Error).message;
      // 같은 종류·언어에 같은 버전이 두 개면 어느 것에 동의했는지 알 수 없다.
      if (/duplicate key|unique/i.test(m)) {
        return c.json(err('CONFLICT', 'that version already exists for this kind and locale'), 409);
      }
      return c.json(err('UPSTREAM_ERROR', m), 502);
    }
  });

  app.post('/admin/legal/:id/publish', async (c) => {
    const g = await mutateGuard(c, 'admin.legal.write'); if ('err' in g) return g.err;
    if (!d.legal) return c.json(err('NOT_CONFIGURED', 'legal documents require the PostgreSQL backend'), 200);

    try {
      const doc = await d.legal.publish(c.req.param('id'));
      await d.repo.recordAction({
        actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'legal.publish',
        resource: 'legal_document', resourceId: doc.id, result: 'success',
        // 게시는 되돌릴 수 없고 회사의 법적 약속이 된다.
        riskLevel: 'high', ip: ip(c), reason: `${doc.kind}/${doc.locale} v${doc.version}`,
      });
      return c.json({ document: doc });
    } catch (e) {
      const m = (e as Error).message;
      if (m === 'DOC_NOT_FOUND') return c.json(err('NOT_FOUND', 'document not found'), 404);
      if (m === 'ALREADY_PUBLISHED') {
        return c.json(err('ALREADY_PUBLISHED', 'this document is already published — create a new version instead'), 409);
      }
      if (m === 'EMPTY_BODY') return c.json(err('BAD_REQUEST', 'cannot publish an empty document'), 400);
      return c.json(err('UPSTREAM_ERROR', m), 502);
    }
  });

  app.post('/admin/legal/:id', async (c) => {
    const g = await mutateGuard(c, 'admin.legal.write'); if ('err' in g) return g.err;
    if (!d.legal) return c.json(err('NOT_CONFIGURED', 'legal documents require the PostgreSQL backend'), 200);

    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const text = body.body === undefined ? undefined : String(body.body);
    if (text !== undefined && /<\s*(script|iframe|object|embed|style|link|meta)\b/i.test(text)) {
      return c.json(err('BAD_REQUEST', 'HTML tags are not allowed — the body is rendered as markdown'), 400);
    }
    try {
      const doc = await d.legal.updateDraft(c.req.param('id'), {
        ...(body.title === undefined ? {} : { title: String(body.title).trim() }),
        ...(text === undefined ? {} : { body: text }),
        ...(Number.isFinite(Number(body.effectiveAt)) && Number(body.effectiveAt) > 0
          ? { effectiveAt: Number(body.effectiveAt) } : {}),
      });
      return c.json({ document: doc });
    } catch (e) {
      const m = (e as Error).message;
      if (m === 'DOC_NOT_FOUND') return c.json(err('NOT_FOUND', 'document not found'), 404);
      if (m === 'ALREADY_PUBLISHED') {
        // 게시된 문구를 덮어쓰면 누가 무엇에 동의했는지의 증거가 사라진다.
        return c.json(err('ALREADY_PUBLISHED', 'published documents cannot be edited — create a new version'), 409);
      }
      return c.json(err('UPSTREAM_ERROR', m), 502);
    }
  });

  // ---- KuCoin 브로커 정산 (API Broker) ----

  /*
     ★★ 이것이 **우리 수익을 확인하는 유일한 경로**다.

       주문에 브로커 서명을 붙이는 것(`brokerAttached`)은 우리 쪽 주장이고,
       실제로 집계됐는지는 거래소만 안다. 아래 조회의 `...WithTag` 값이 그
       판정이다 — 서명이 새고 있으면 `WithoutTag` 만 늘어난다.

     ★ 자격증명이 없으면 지어내지 않는다. `configured: false` 로 알린다.
       빈 배열만 주면 화면이 "수익 0원" 이라고 표시하고, 운영자는 설정이
       빠진 것을 모른 채 넘어간다.
  */
  app.get('/admin/broker/kucoin/commission', async (c) => {
    const g = await guard(c, 'admin.broker.rebate.read'); if ('err' in g) return g.err;
    if (!d.kucoinBroker) {
      return c.json({
        ...err('NOT_CONFIGURED', 'operator KuCoin credentials are not configured'),
        configured: false,
      }, 200);
    }

    const q = parseQuery(c);
    try {
      const out = await d.kucoinBroker.client.getCommission(
        d.kucoinBroker.operator,
        d.kucoinBroker.broker,
        {
          page: Math.max(1, Number(q.page ?? 1) || 1),
          pageSize: Math.min(Math.max(1, Number(q.pageSize ?? 50) || 50), 500),
          tradeType: 'all',
        },
      );
      return c.json({
        configured: true,
        approved: true,
        // 브로커 헤더 3종이 다 있는지. 없으면 앞으로의 거래도 집계되지 않는다.
        brokerAttached: Boolean(d.kucoinBroker.broker),
        ...out,
      });
    } catch (e) {
      const m = e as { message?: string; code?: string };
      /*
         브로커로 승인되지 않은 키면 권한 오류가 온다.

         ★ 그것은 장애가 아니라 "아직 브로커가 아니다" 는 사실이다. 502 로
           주면 관리자 화면이 장애처럼 보이고 콘솔이 오염된다.
      */
      return c.json({
        configured: true,
        approved: false,
        brokerAttached: Boolean(d.kucoinBroker.broker),
        items: [],
        error: { code: m.code ?? 'UPSTREAM_ERROR', message: m.message ?? 'query failed' },
      }, 200);
    }
  });

  /** 우리를 통해 거래하는 사용자와 각자의 기여. */
  app.get('/admin/broker/kucoin/users', async (c) => {
    const g = await guard(c, 'admin.broker.rebate.read'); if ('err' in g) return g.err;
    if (!d.kucoinBroker) {
      return c.json({ ...err('NOT_CONFIGURED', 'operator KuCoin credentials are not configured'), configured: false }, 200);
    }

    const q = parseQuery(c);
    try {
      const out = await d.kucoinBroker.client.getUserList(
        d.kucoinBroker.operator,
        d.kucoinBroker.broker,
        {
          page: Math.max(1, Number(q.page ?? 1) || 1),
          pageSize: Math.min(Math.max(1, Number(q.pageSize ?? 50) || 50), 500),
          tradeType: 'all',
          ...(typeof q.uid === 'string' && q.uid ? { uid: q.uid } : {}),
        },
      );
      return c.json({ configured: true, approved: true, brokerAttached: Boolean(d.kucoinBroker.broker), ...out });
    } catch (e) {
      const m = e as { message?: string; code?: string };
      return c.json({
        configured: true, approved: false, items: [],
        error: { code: m.code ?? 'UPSTREAM_ERROR', message: m.message ?? 'query failed' },
      }, 200);
    }
  });

  /**
   * 리베이트 원장 CSV 링크.
   *
   * ★★ 링크만 돌려주고 **우리가 내려받지 않는다.** 이 CSV 에는 거래자 UID 와
   *   거래량이 들어 있다. 서버가 사본을 만들면 그 파일을 지키는 책임이 생긴다.
   *   운영자가 필요할 때 직접 받게 한다.
   *
   * ★ 링크는 유효기간이 있으므로 화면이 즉시 열어야 한다.
   */
  app.get('/admin/broker/kucoin/rebate-csv', async (c) => {
    const g = await guard(c, 'admin.broker.rebate.read'); if ('err' in g) return g.err;
    /*
       ★ 입력 검증을 설정 확인보다 **먼저** 한다.

         전에는 순서가 반대여서, 키가 없는 동안 잘못된 날짜를 보내도 200 이
         돌아왔다. 키를 설정한 뒤에야 400 이 나타나면 그때 처음 발견하게 된다 —
         검증은 설정 상태와 무관하게 같은 답을 줘야 한다.
    */
    const q = parseQuery(c);
    const begin = String(q.begin ?? '');
    const end = String(q.end ?? '');
    // YYYYMMDD 만 받는다. ISO 를 보내면 KuCoin 이 조용히 빈 결과를 준다.
    if (!/^\d{8}$/.test(begin) || !/^\d{8}$/.test(end)) {
      return c.json(err('BAD_REQUEST', 'begin and end must be YYYYMMDD'), 400);
    }

    if (!d.kucoinBroker) {
      return c.json({ ...err('NOT_CONFIGURED', 'operator KuCoin credentials are not configured'), configured: false }, 200);
    }

    try {
      const out = await d.kucoinBroker.client.getRebateCsvUrl(
        d.kucoinBroker.operator,
        d.kucoinBroker.broker,
        { begin, end, tradeType: q.tradeType === 'SPOT' ? 'SPOT' : 'FUTURES' },
      );
      await d.repo.recordAction({
        actorUserId: g.a.user.id, actorRole: g.a.user.role, action: 'broker.rebate.export',
        resource: 'broker_rebate', resourceId: `${begin}-${end}`, result: 'success',
        // 거래자 UID 가 담긴 파일을 내보내는 행위다.
        riskLevel: 'medium', ip: ip(c),
      });
      return c.json({ configured: true, approved: true, ...out });
    } catch (e) {
      const m = e as { message?: string; code?: string };
      return c.json({
        configured: true, approved: false, url: null,
        error: { code: m.code ?? 'UPSTREAM_ERROR', message: m.message ?? 'query failed' },
      }, 200);
    }
  });

  return app;
}

/** Parse stored JSON defensively: a corrupt column must not throw inside a response handler. */
function safeJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * The ONLY shape in which AI policy leaves the server.
 *
 * Built field by field from an allowlist rather than by spreading the row, so a column added to
 * `ai_policy` later cannot start appearing in responses by accident. `system_prompt_digest` is renamed to
 * make it unmistakable that it is a digest, and there is no field that could carry prompt text or a
 * provider credential.
 */
function aiPolicyView(p: Record<string, unknown>, historyCount: number): Record<string, unknown> {
  return {
    id: p.id,
    version: p.version,
    maxOutputTokens: p.max_output_tokens,
    dailyCostLimitMicros: p.daily_cost_limit_micros,
    allowedTools: safeJson(p.allowed_tools_json) ?? [],
    systemPrompt: {
      digest: p.system_prompt_digest ?? null,
      algorithm: p.system_prompt_algo ?? null,
      length: p.system_prompt_len ?? null,
      textReturned: false,
    },
    promptVersion: p.prompt_version ?? null,
    // Reported as a literal false, and enforced in two independent places (schema literal + DB CHECK).
    liveExecutionEnabled: false,
    liveExecution: 'Not Executed',
    providerCredentialReturned: false,
    historyEntries: historyCount,
    updatedBy: p.updated_by ?? null,
    updatedAt: p.updated_at ?? null,
  };
}
