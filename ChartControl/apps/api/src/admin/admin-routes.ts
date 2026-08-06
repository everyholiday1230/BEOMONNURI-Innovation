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
      // Distinguishable from "earned nothing": no operator BitMart key is wired in this deployment.
      return c.json(
        {
          ...err('NOT_CONFIGURED', 'no operator BitMart credential is configured for rebate queries'),
          configured: false,
        },
        503,
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
