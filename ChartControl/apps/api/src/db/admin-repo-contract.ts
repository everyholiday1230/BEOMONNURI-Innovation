import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { AdminActionInput, SqliteAdminRepo } from './admin-repos';

/**
 * UUID 형식 검사.
 *
 * Postgres 의 uuid 컬럼에 형식이 다른 문자열을 넘기면 드라이버가 예외를
 * 던지고 그것이 500 이 된다. 조회 전에 걸러서 "그런 사용자는 없다"(404)로
 * 응답하게 한다. 버전 비트까지 엄격히 보지 않는 이유는, 우리가 생성하지 않은
 * UUID(외부 시스템 값)도 조회 대상이 될 수 있기 때문이다.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * BATCH_3 / BL-10 — admin/gateway/ai-policy repository CONTRACT.
 *
 * `SqliteAdminRepo` (in ./admin-repos.ts) is the synchronous better-sqlite3 engine and is left unchanged
 * (its direct callers — the dev seed CLI and the existing admin unit tests — keep working). This file adds
 * the async contract the admin routes depend on, with two implementations selected by the SERVER:
 *
 *   • `SqliteAdminRepoAdapter` — dev/test/E2E, an async wrapper over the sync engine.
 *   • `PgAdminRepo`            — production, real PostgreSQL over migrations 0005/0009 (+ read models
 *                                over the 0001–0004 tables).
 *
 * One repository serves THREE required-guard domains — `admin_operations`, `gateway_state`, `ai_policy` —
 * so the factory reports three descriptors for it. When the backend is PostgreSQL, all three are PG; the
 * guard cannot be satisfied by any of them while this repo is SQLite.
 *
 * Parity rules that keep the two backends behaviourally identical (verified by admin-ops-contract.test):
 *   • Admin-owned tables store epoch-ms as BIGINT (same as SQLite); cross-domain tables (orders,
 *     positions, ai_runs, ai_usage_records, sessions, audit_logs, …) store TIMESTAMPTZ, so PG converts
 *     with `to_timestamp($/1000)` on the way in and `EXTRACT(EPOCH …)*1000` on the way out.
 *   • BOOLEAN columns are normalized to 0/1 integers on read so both backends return the same shape.
 *   • No method can enable live execution: `ai_policy.live_execution_enabled` is 0 and the DB CHECK
 *     keeps it 0; there is no order-submit path anywhere in this repo.
 */

export type AdminActionResult = { ok: boolean; conflict?: boolean };

export interface IAdminRepo {
  // append-only admin audit
  recordAction(a: AdminActionInput): Promise<void>;
  listAudit(q: { actorId?: string; userId?: string; action?: string; resource?: string; result?: string; from?: number; to?: number; limit: number; offset: number }): Promise<unknown[]>;
  countAudit(q: Parameters<IAdminRepo['listAudit']>[0]): Promise<number>;
  // orders / positions (read-only)
  searchOrders(q: { q?: string; symbol?: string; side?: string; status?: string; type?: string; mode?: string; userId?: string; from?: number; to?: number; limit: number; offset: number }): Promise<unknown[]>;
  countOrders(q: Parameters<IAdminRepo['searchOrders']>[0]): Promise<number>;
  searchPositions(q: { q?: string; symbol?: string; side?: string; userId?: string; limit: number; offset: number }): Promise<unknown[]>;
  countPositions(q: Parameters<IAdminRepo['searchPositions']>[0]): Promise<number>;
  // AI ops (read-only)
  searchAiRuns(q: { q?: string; provider?: string; model?: string; status?: string; statusIn?: readonly string[]; userId?: string; from?: number; to?: number; limit: number; offset: number }): Promise<unknown[]>;
  countAiRuns(q: Parameters<IAdminRepo['searchAiRuns']>[0]): Promise<number>;
  aiUsageSummary(): Promise<Record<string, number | null>>;
  // exchange / gateway (read-only)
  searchExchangeConnections(q: { limit: number; offset: number }): Promise<unknown[]>;
  countExchangeConnections(): Promise<number>;
  gatewaySummary(): Promise<Record<string, number | string | null>>;
  // users
  searchUsers(q: { q?: string; status?: string; role?: string; limit: number; offset: number }): Promise<unknown[]>;
  /**
   * Row count for the SAME filter as `searchUsers`, ignoring limit/offset.
   *
   * Needed for two things the UI cannot fake: real pagination, and a user count on the admin dashboard.
   * Counting the returned page would report the page size as the total.
   */
  countUsers(q: { q?: string; status?: string; role?: string }): Promise<{ total: number; byStatus: Record<string, number>; byRole: Record<string, number> }>;
  getUser(id: string): Promise<{ id: string; email: string; role: string; status: string; mfa_enabled: number } | undefined>;
  userStats(id: string): Promise<Record<string, number>>;
  activeSuperAdminIds(): Promise<string[]>;
  setUserStatus(id: string, status: 'active' | 'disabled'): Promise<boolean>;
  setUserRole(id: string, role: string): Promise<boolean>;
  revokeUserSessions(id: string): Promise<number>;
  /**
   * Clear a user's two-factor credential so they can sign in with the password
   * again and enrol a new device.
   *
   * ★★ This exists because losing the phone otherwise means losing the account.
   *   Recovery codes are shown once; a user who did not save them and then
   *   replaced their phone has no way back in, and support has nothing to offer.
   *
   * ★★ It is also a security bypass by design — it removes a factor. The route
   *   therefore requires re-authentication, records a high-risk audit entry, and
   *   revokes the user's sessions so an attacker who triggered it cannot ride an
   *   existing session.
   *
   * @returns true if a credential existed and was cleared.
   */
  clearUserMfa(id: string): Promise<boolean>;

  /**
   * Change a user's email address.
   *
   * ★★ The email IS the login identifier. After this the user cannot sign in
   *   with the old address, so getting it wrong locks them out of their own
   *   account. The route therefore requires re-authentication and a reason.
   *
   * ★ `email_verified` is reset to false. The new address has not been proven to
   *   belong to them, and leaving it verified would let a wrong address look
   *   confirmed — password resets would then go to someone else's inbox.
   *
   * @returns 'ok' | 'taken' (another account has that address) | 'not_found'
   */
  setUserEmail(input: { userId: string; email: string }): Promise<'ok' | 'taken' | 'not_found'>;

  /*
     ---- 관리자 노트 (회원별 운영 메모) ----

     ★ 개인정보가 담길 수 있는 자유 서식 글이다. 그래서 회원 삭제 시 함께
       사라지고(CASCADE), 조회·작성·수정·삭제를 모두 감사에 남긴다(라우트에서).
     ★ 분리 보관 대상이 아니다 — 법령이 보관을 요구하는 자료가 아니다.
  */
  listUserNotes(userId: string): Promise<Array<{
    id: string; body: string; author_email: string | null;
    created_at: string | number; updated_at: string | number;
  }>>;
  addUserNote(input: { userId: string; authorUserId: string; authorEmail: string; body: string }): Promise<{ id: string } | null>;
  /** @returns true if a note with that id belonged to that user and was removed. */
  deleteUserNote(input: { noteId: string; userId: string }): Promise<boolean>;
  /**
   * Delete a user, moving legally-required records to separate retention tables.
   *
   * ★★ Our published privacy policy (§6) promises BOTH of these:
   *      "account and exchange-link data are destroyed without delay on withdrawal"
   *      "data the law requires us to keep is stored separately for that period,
   *       then destroyed"
   *   and §1 sets the periods: orders 5 years, consent records 5 years.
   *
   *   The schema used to CASCADE those records away with the account, so
   *   honouring the deletion promise broke the retention promise and vice versa.
   *   This method copies them into `retained_*` tables (which do NOT reference
   *   `users`) and then deletes the account, so both promises hold.
   *
   * ★ Everything not legally required goes away: password hash, sessions,
   *   exchange credentials, preferences, favourites, chart templates, equity
   *   snapshots, AI history. Those are covered by the CASCADE rules already.
   *
   * ★ The operation is one transaction. A partial run is the worst outcome —
   *   the account gone but the retention copy missing means we destroyed data we
   *   promised to keep, with no way to notice.
   *
   * @returns counts of what was retained, for the deletion record.
   */
  deleteUserWithRetention(input: {
    userId: string;
    requestedBy: 'self' | 'admin';
    actorUserId?: string | null;
    actorEmail?: string | null;
    reason: string;
  }): Promise<{ deleted: boolean; retainedConsents: number; retainedOrders: number } | null>;
  // feature flags
  seedFlag(key: string, enabled: boolean, description: string): Promise<void>;
  listFlags(): Promise<unknown[]>;
  updateFlag(id: string, enabled: boolean, reason: string, version: number, by: string, corr?: string): Promise<AdminActionResult>;
  // kill switches
  seedKill(scope: string, target: string | null, active: boolean): Promise<void>;
  listKill(): Promise<unknown[]>;
  getKill(id: string): Promise<{ id: string; scope: string; active: number; version: number } | undefined>;
  updateKill(id: string, active: boolean, reason: string, version: number, by: string, corr?: string): Promise<AdminActionResult>;
  // incidents
  createIncident(i: { title: string; description: string; severity: string; service: string; impact?: string; by: string }): Promise<string>;
  listIncidents(): Promise<unknown[]>;
  getIncident(id: string): Promise<{ id: string; status: string; version: number } | undefined>;
  updateIncident(id: string, patch: Record<string, string | undefined>, version: number, by: string): Promise<AdminActionResult>;
  ackIncident(id: string, version: number, by: string, note?: string): Promise<{ ok: boolean; conflict?: boolean; changed?: boolean; acknowledgedAt?: number; acknowledgedBy?: string; version?: number }>;
  // release gates
  seedGate(g: { key: string; phase: string; description: string; status: string; productionRequired: boolean; owner?: string; exitCriteria?: string }): Promise<void>;
  listGates(): Promise<unknown[]>;
  getGate(id: string): Promise<{ id: string; status: string; production_required: number; version: number } | undefined>;
  hasEvidence(id: string): Promise<boolean>;
  updateGate(id: string, status: string, version: number, by: string, opts: { reason?: string; expiresAt?: number; evidencePath?: string }): Promise<AdminActionResult>;
  // security summary + lockouts
  securitySummary(): Promise<Record<string, unknown>>;
  listLockouts(q: { state: 'active' | 'expired' | 'any'; limit: number; offset: number }): Promise<unknown[]>;
  countLockouts(state: 'active' | 'expired' | 'any'): Promise<number>;
  clearLockout(userId: string, actorUserId: string): Promise<{ changed: boolean; before: { fails: number; lockedUntil: number } | null }>;
  // reports
  computeReport(type: string, window: { from: number; to: number }): Promise<{ data: Record<string, unknown>; tables: string[]; rowCount: number; unavailable: string[] }>;
  insertReport(r: { type: string; data: Record<string, unknown>; source: Record<string, unknown>; rowCount: number; from: number; to: number; by: string }): Promise<string>;
  listReports(q: { type?: string; limit: number; offset: number }): Promise<unknown[]>;
  countReports(type?: string): Promise<number>;
  getReport(id: string): Promise<{ id: string; report_type: string; row_count: number; window_from: number | null; window_to: number | null; generated_by: string; generated_at: number; source_json: string; data_json: string } | undefined>;
  backupStatus(): Promise<Record<string, unknown>>;
  // gateway (local mock only)
  seedMockGateway(id?: string): Promise<void>;
  mockGatewayState(id?: string): Promise<Record<string, unknown> | null>;
  applyMockGatewayAction(action: 'resync' | 'reconnect', version: number, by: string, id?: string): Promise<{ ok: boolean; conflict?: boolean; state?: Record<string, unknown> }>;
  gatewayMetrics(staleThresholdMs?: number): Promise<Record<string, unknown>>;
  // ai policy
  seedAiPolicy(id?: string): Promise<void>;
  getAiPolicy(id?: string): Promise<Record<string, unknown> | null>;
  updateAiPolicy(input: { maxOutputTokens: number; dailyCostLimitMicros: number; allowedTools: string[]; promptDigest?: string; promptAlgo?: string; promptLen?: number; promptVersion?: string }, version: number, by: string, opts?: { reason?: string; correlationId?: string; id?: string }): Promise<{ ok: boolean; conflict?: boolean; policy?: Record<string, unknown> }>;
  countAiPolicyHistory(id?: string): Promise<number>;
  // shared idempotency
  findIdempotent(key: string, scope: string): Promise<{ result: string | null; created_at: number } | null>;
  claimIdempotent(key: string, scope: string, userId: string): Promise<boolean>;
  storeIdempotentResult(key: string, scope: string, result: unknown): Promise<void>;
}

/**
 * Development / test — async-over-sync wrapper around the better-sqlite3 SqliteAdminRepo. Every method
 * delegates to the identical sync method, so dev/E2E behaviour is byte-for-byte the current behaviour.
 */
export class SqliteAdminRepoAdapter implements IAdminRepo {
  constructor(private readonly inner: SqliteAdminRepo) {}
  async recordAction(a: AdminActionInput): Promise<void> { this.inner.recordAction(a); }
  async listAudit(q: Parameters<IAdminRepo['listAudit']>[0]) { return this.inner.listAudit(q); }
  async countAudit(q: Parameters<IAdminRepo['listAudit']>[0]) { return this.inner.countAudit(q); }
  async searchOrders(q: Parameters<IAdminRepo['searchOrders']>[0]) { return this.inner.searchOrders(q); }
  async countOrders(q: Parameters<IAdminRepo['searchOrders']>[0]) { return this.inner.countOrders(q); }
  async searchPositions(q: Parameters<IAdminRepo['searchPositions']>[0]) { return this.inner.searchPositions(q); }
  async countPositions(q: Parameters<IAdminRepo['searchPositions']>[0]) { return this.inner.countPositions(q); }
  async searchAiRuns(q: Parameters<IAdminRepo['searchAiRuns']>[0]) { return this.inner.searchAiRuns(q); }
  async countAiRuns(q: Parameters<IAdminRepo['searchAiRuns']>[0]) { return this.inner.countAiRuns(q); }
  async aiUsageSummary() { return this.inner.aiUsageSummary(); }
  async searchExchangeConnections(q: { limit: number; offset: number }) { return this.inner.searchExchangeConnections(q); }
  async countExchangeConnections() { return this.inner.countExchangeConnections(); }
  async gatewaySummary() { return this.inner.gatewaySummary(); }
  async searchUsers(q: Parameters<IAdminRepo['searchUsers']>[0]) { return this.inner.searchUsers(q); }
  async countUsers(q: Parameters<IAdminRepo['countUsers']>[0]) { return this.inner.countUsers(q); }
  async getUser(id: string) { return this.inner.getUser(id); }
  async userStats(id: string) { return this.inner.userStats(id); }
  async activeSuperAdminIds() { return this.inner.activeSuperAdminIds(); }
  async setUserStatus(id: string, status: 'active' | 'disabled') { return this.inner.setUserStatus(id, status); }
  async setUserRole(id: string, role: string) { return this.inner.setUserRole(id, role); }
  async revokeUserSessions(id: string) { return this.inner.revokeUserSessions(id); }
  async clearUserMfa(id: string) { return this.inner.clearUserMfa(id); }
  async setUserEmail(input: Parameters<IAdminRepo['setUserEmail']>[0]) { return this.inner.setUserEmail(input); }
  async listUserNotes(userId: string) { return this.inner.listUserNotes(userId); }
  async addUserNote(input: Parameters<IAdminRepo['addUserNote']>[0]) { return this.inner.addUserNote(input); }
  async deleteUserNote(input: Parameters<IAdminRepo['deleteUserNote']>[0]) { return this.inner.deleteUserNote(input); }
  async deleteUserWithRetention(input: Parameters<IAdminRepo['deleteUserWithRetention']>[0]) {
    return this.inner.deleteUserWithRetention(input);
  }
  async seedFlag(key: string, enabled: boolean, description: string) { this.inner.seedFlag(key, enabled, description); }
  async listFlags() { return this.inner.listFlags(); }
  async updateFlag(id: string, enabled: boolean, reason: string, version: number, by: string, corr?: string) { return this.inner.updateFlag(id, enabled, reason, version, by, corr); }
  async seedKill(scope: string, target: string | null, active: boolean) { this.inner.seedKill(scope, target, active); }
  async listKill() { return this.inner.listKill(); }
  async getKill(id: string) { return this.inner.getKill(id); }
  async updateKill(id: string, active: boolean, reason: string, version: number, by: string, corr?: string) { return this.inner.updateKill(id, active, reason, version, by, corr); }
  async createIncident(i: Parameters<IAdminRepo['createIncident']>[0]) { return this.inner.createIncident(i); }
  async listIncidents() { return this.inner.listIncidents(); }
  async getIncident(id: string) { return this.inner.getIncident(id); }
  async updateIncident(id: string, patch: Record<string, string | undefined>, version: number, by: string) { return this.inner.updateIncident(id, patch, version, by); }
  async ackIncident(id: string, version: number, by: string, note?: string) { return this.inner.ackIncident(id, version, by, note); }
  async seedGate(g: Parameters<IAdminRepo['seedGate']>[0]) { this.inner.seedGate(g); }
  async listGates() { return this.inner.listGates(); }
  async getGate(id: string) { return this.inner.getGate(id); }
  async hasEvidence(id: string) { return this.inner.hasEvidence(id); }
  async updateGate(id: string, status: string, version: number, by: string, opts: { reason?: string; expiresAt?: number; evidencePath?: string }) { return this.inner.updateGate(id, status, version, by, opts); }
  async securitySummary() { return this.inner.securitySummary(); }
  async listLockouts(q: Parameters<IAdminRepo['listLockouts']>[0]) { return this.inner.listLockouts(q); }
  async countLockouts(state: 'active' | 'expired' | 'any') { return this.inner.countLockouts(state); }
  async clearLockout(userId: string, actorUserId: string) { return this.inner.clearLockout(userId, actorUserId); }
  async computeReport(type: string, window: { from: number; to: number }) { return this.inner.computeReport(type, window); }
  async insertReport(r: Parameters<IAdminRepo['insertReport']>[0]) { return this.inner.insertReport(r); }
  async listReports(q: Parameters<IAdminRepo['listReports']>[0]) { return this.inner.listReports(q); }
  async countReports(type?: string) { return this.inner.countReports(type); }
  async getReport(id: string) { return this.inner.getReport(id); }
  async backupStatus() { return this.inner.backupStatus(); }
  async seedMockGateway(id?: string) { this.inner.seedMockGateway(id); }
  async mockGatewayState(id?: string) { return this.inner.mockGatewayState(id); }
  async applyMockGatewayAction(action: 'resync' | 'reconnect', version: number, by: string, id?: string) { return this.inner.applyMockGatewayAction(action, version, by, id); }
  async gatewayMetrics(staleThresholdMs?: number) { return this.inner.gatewayMetrics(staleThresholdMs); }
  async seedAiPolicy(id?: string) { this.inner.seedAiPolicy(id); }
  async getAiPolicy(id?: string) { return this.inner.getAiPolicy(id); }
  async updateAiPolicy(input: Parameters<IAdminRepo['updateAiPolicy']>[0], version: number, by: string, opts?: { reason?: string; correlationId?: string; id?: string }) { return this.inner.updateAiPolicy(input, version, by, opts); }
  async countAiPolicyHistory(id?: string) { return this.inner.countAiPolicyHistory(id); }
  async findIdempotent(key: string, scope: string) { return this.inner.findIdempotent(key, scope); }
  async claimIdempotent(key: string, scope: string, userId: string) { return this.inner.claimIdempotent(key, scope, userId); }
  async storeIdempotentResult(key: string, scope: string, result: unknown) { this.inner.storeIdempotentResult(key, scope, result); }
}

/**
 * Production — real PostgreSQL over migrations 0005/0009 (admin-owned) and read models across 0001–0004.
 * Every query is parameterized; optimistic-version mutations bump `version` under a `WHERE ... version=$`
 * guard; BOOLEAN columns are returned as 0/1 to match the SQLite contract; cross-domain TIMESTAMPTZ
 * columns are converted to/from epoch-ms so callers see the same numbers on both backends.
 */
export class PgAdminRepo implements IAdminRepo {
  constructor(private readonly pool: Pool, private readonly now: () => number = Date.now) {}

  private async one(sql: string, params: unknown[] = []): Promise<number> {
    const r = await this.pool.query(sql, params);
    return Number(r.rows[0]?.n ?? 0);
  }

  // ---- append-only admin audit ----
  async recordAction(a: AdminActionInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO admin_actions (id,actor_user_id,actor_role,action,resource,resource_id,target_user_id,result,risk_level,ip,correlation_id,before_json,after_json,reason,at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15)`,
      [randomUUID(), a.actorUserId, a.actorRole, a.action, a.resource, a.resourceId ?? null, a.targetUserId ?? null,
        a.result, a.riskLevel ?? 'low', a.ip ?? null, a.correlationId ?? null,
        a.before === undefined ? null : JSON.stringify(a.before), a.after === undefined ? null : JSON.stringify(a.after),
        a.reason ?? null, this.now()],
    );
  }

  private auditWhere(q: Parameters<IAdminRepo['listAudit']>[0], p: unknown[]): string {
    const w: string[] = [];
    if (q.actorId) { p.push(q.actorId); w.push(`actor_user_id=$${p.length}`); }
    if (q.userId) { p.push(q.userId); w.push(`target_user_id=$${p.length}`); }
    if (q.action) { p.push(q.action); w.push(`action=$${p.length}`); }
    if (q.resource) { p.push(q.resource); w.push(`resource=$${p.length}`); }
    if (q.result) { p.push(q.result); w.push(`result=$${p.length}`); }
    if (q.from) { p.push(q.from); w.push(`at>=$${p.length}`); }
    if (q.to) { p.push(q.to); w.push(`at<=$${p.length}`); }
    return w.length ? `WHERE ${w.join(' AND ')}` : '';
  }
  async listAudit(q: Parameters<IAdminRepo['listAudit']>[0]) {
    const p: unknown[] = [];
    const where = this.auditWhere(q, p);
    p.push(q.limit); const lim = p.length; p.push(q.offset); const off = p.length;
    const r = await this.pool.query(
      `SELECT id,actor_user_id,actor_role,action,resource,resource_id,target_user_id,result,risk_level,ip,correlation_id,reason,at
       FROM admin_actions ${where} ORDER BY at DESC LIMIT $${lim} OFFSET $${off}`,
      p,
    );
    return r.rows;
  }
  async countAudit(q: Parameters<IAdminRepo['listAudit']>[0]) {
    const p: unknown[] = [];
    const where = this.auditWhere(q, p);
    return this.one(`SELECT COUNT(*) n FROM admin_actions ${where}`, p);
  }

  // ---- orders (read-only). orders.created_at is TIMESTAMPTZ → convert. ----
  private ordersWhere(q: Parameters<IAdminRepo['searchOrders']>[0], p: unknown[]): string {
    const w: string[] = [];
    if (q.q) { p.push(`%${q.q}%`); const i = p.length; w.push(`(o.symbol ILIKE $${i} OR o.internal_order_id ILIKE $${i} OR u.email ILIKE $${i})`); }
    if (q.symbol) { p.push(q.symbol); w.push(`o.symbol=$${p.length}`); }
    if (q.side) { p.push(q.side); w.push(`o.side=$${p.length}`); }
    if (q.status) { p.push(q.status); w.push(`o.status=$${p.length}`); }
    if (q.type) { p.push(q.type); w.push(`o.type=$${p.length}`); }
    if (q.mode) { p.push(q.mode); w.push(`o.mode=$${p.length}`); }
    if (q.userId) { p.push(q.userId); w.push(`o.user_id=$${p.length}`); }
    if (q.from) { p.push(q.from); w.push(`o.created_at>=to_timestamp($${p.length}/1000.0)`); }
    if (q.to) { p.push(q.to); w.push(`o.created_at<=to_timestamp($${p.length}/1000.0)`); }
    return w.length ? `WHERE ${w.join(' AND ')}` : '';
  }
  async searchOrders(q: Parameters<IAdminRepo['searchOrders']>[0]) {
    const p: unknown[] = [];
    const where = this.ordersWhere(q, p);
    p.push(q.limit); const lim = p.length; p.push(q.offset); const off = p.length;
    const r = await this.pool.query(
      `SELECT o.internal_order_id, o.client_order_id, o.exchange_order_id, o.correlation_id,
              o.user_id, u.email AS user_email, o.symbol, o.side, o.type, o.price, o.quantity,
              o.filled_quantity, o.status, o.mode,
              (EXTRACT(EPOCH FROM o.created_at)*1000)::bigint AS created_at,
              (EXTRACT(EPOCH FROM o.updated_at)*1000)::bigint AS updated_at
       FROM orders o LEFT JOIN users u ON u.id = o.user_id
       ${where} ORDER BY o.created_at DESC LIMIT $${lim} OFFSET $${off}`,
      p,
    );
    return r.rows;
  }
  async countOrders(q: Parameters<IAdminRepo['searchOrders']>[0]) {
    const p: unknown[] = [];
    const where = this.ordersWhere(q, p);
    return this.one(`SELECT COUNT(*) n FROM orders o LEFT JOIN users u ON u.id = o.user_id ${where}`, p);
  }

  // ---- positions (read-only) ----
  private positionsWhere(q: Parameters<IAdminRepo['searchPositions']>[0], p: unknown[]): string {
    const w: string[] = [];
    if (q.q) { p.push(`%${q.q}%`); const i = p.length; w.push(`(p.symbol ILIKE $${i} OR u.email ILIKE $${i})`); }
    if (q.symbol) { p.push(q.symbol); w.push(`p.symbol=$${p.length}`); }
    if (q.side) { p.push(q.side); w.push(`p.side=$${p.length}`); }
    if (q.userId) { p.push(q.userId); w.push(`p.user_id=$${p.length}`); }
    return w.length ? `WHERE ${w.join(' AND ')}` : '';
  }
  async searchPositions(q: Parameters<IAdminRepo['searchPositions']>[0]) {
    const p: unknown[] = [];
    const where = this.positionsWhere(q, p);
    p.push(q.limit); const lim = p.length; p.push(q.offset); const off = p.length;
    const r = await this.pool.query(
      `SELECT p.id, p.user_id, u.email AS user_email, p.symbol, p.side, p.size, p.entry_price,
              p.mark_price, p.liquidation_price, p.leverage, p.margin_mode, p.unrealized_pnl,
              (EXTRACT(EPOCH FROM p.updated_at)*1000)::bigint AS updated_at
       FROM positions p LEFT JOIN users u ON u.id = p.user_id
       ${where} ORDER BY p.updated_at DESC LIMIT $${lim} OFFSET $${off}`,
      p,
    );
    return r.rows;
  }
  async countPositions(q: Parameters<IAdminRepo['searchPositions']>[0]) {
    const p: unknown[] = [];
    const where = this.positionsWhere(q, p);
    return this.one(`SELECT COUNT(*) n FROM positions p LEFT JOIN users u ON u.id = p.user_id ${where}`, p);
  }

  // ---- AI runs (read-only). ai_runs.created_at TIMESTAMPTZ ----
  private aiRunsWhere(q: Parameters<IAdminRepo['searchAiRuns']>[0], p: unknown[]): string {
    const w: string[] = [];
    if (q.q) { p.push(`%${q.q}%`); const i = p.length; w.push(`(r.model ILIKE $${i} OR r.provider ILIKE $${i} OR u.email ILIKE $${i} OR r.correlation_id ILIKE $${i})`); }
    if (q.provider) { p.push(q.provider); w.push(`r.provider=$${p.length}`); }
    if (q.model) { p.push(q.model); w.push(`r.model=$${p.length}`); }
    if (q.status) { p.push(q.status); w.push(`r.status=$${p.length}`); }
    if (q.statusIn && q.statusIn.length > 0) { const ph = q.statusIn.map((s) => { p.push(s); return `$${p.length}`; }); w.push(`r.status IN (${ph.join(',')})`); }
    if (q.userId) { p.push(q.userId); w.push(`r.user_id=$${p.length}`); }
    if (q.from) { p.push(q.from); w.push(`r.created_at>=to_timestamp($${p.length}/1000.0)`); }
    if (q.to) { p.push(q.to); w.push(`r.created_at<=to_timestamp($${p.length}/1000.0)`); }
    return w.length ? `WHERE ${w.join(' AND ')}` : '';
  }
  async searchAiRuns(q: Parameters<IAdminRepo['searchAiRuns']>[0]) {
    const p: unknown[] = [];
    const where = this.aiRunsWhere(q, p);
    p.push(q.limit); const lim = p.length; p.push(q.offset); const off = p.length;
    const r = await this.pool.query(
      `SELECT r.id, r.user_id, u.email AS user_email, r.provider, r.model, r.prompt_version,
              r.fallback_used::int AS fallback_used, r.status, r.correlation_id,
              (EXTRACT(EPOCH FROM r.created_at)*1000)::bigint AS created_at,
              (SELECT COUNT(*) FROM ai_tool_calls tc WHERE tc.run_id = r.id) AS tool_calls,
              (SELECT SUM(input_tokens) FROM ai_usage_records ur WHERE ur.correlation_id = r.correlation_id) AS input_tokens,
              (SELECT SUM(output_tokens) FROM ai_usage_records ur WHERE ur.correlation_id = r.correlation_id) AS output_tokens,
              (SELECT SUM(estimated_cost_micros) FROM ai_usage_records ur WHERE ur.correlation_id = r.correlation_id) AS estimated_cost_micros
       FROM ai_runs r LEFT JOIN users u ON u.id = r.user_id
       ${where} ORDER BY r.created_at DESC LIMIT $${lim} OFFSET $${off}`,
      p,
    );
    return r.rows;
  }
  async countAiRuns(q: Parameters<IAdminRepo['searchAiRuns']>[0]) {
    const p: unknown[] = [];
    const where = this.aiRunsWhere(q, p);
    return this.one(`SELECT COUNT(*) n FROM ai_runs r LEFT JOIN users u ON u.id = r.user_id ${where}`, p);
  }
  async aiUsageSummary(): Promise<Record<string, number | null>> {
    const r = await this.pool.query(
      `SELECT COUNT(*) AS records, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
              SUM(estimated_cost_micros) AS estimated_cost_micros, SUM(actual_cost_micros) AS actual_cost_micros,
              SUM(fallback_used::int) AS fallback_count
       FROM ai_usage_records`,
    );
    const row = r.rows[0];
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return { records: Number(row.records), input_tokens: num(row.input_tokens), output_tokens: num(row.output_tokens), estimated_cost_micros: num(row.estimated_cost_micros), actual_cost_micros: num(row.actual_cost_micros), fallback_count: num(row.fallback_count) };
  }

  // ---- exchange / gateway (read-only) ----
  async searchExchangeConnections(q: { limit: number; offset: number }) {
    const r = await this.pool.query(
      `SELECT ec.id, ec.user_id, u.email AS user_email, ec.mode, ec.status,
              (EXTRACT(EPOCH FROM ec.created_at)*1000)::bigint AS created_at,
              (EXTRACT(EPOCH FROM ec.updated_at)*1000)::bigint AS updated_at,
              '…' || right(ec.credential_id, 4) AS credential_ref
       FROM exchange_connections ec LEFT JOIN users u ON u.id = ec.user_id
       ORDER BY ec.updated_at DESC LIMIT $1 OFFSET $2`,
      [q.limit, q.offset],
    );
    return r.rows;
  }
  async countExchangeConnections() { return this.one('SELECT COUNT(*) n FROM exchange_connections'); }
  async gatewaySummary(): Promise<Record<string, number | string | null>> {
    const r = await this.pool.query(
      `SELECT COUNT(*) AS sessions,
              SUM(CASE WHEN status='connected' THEN 1 ELSE 0 END) AS connected,
              SUM(reconnects) AS reconnects,
              (EXTRACT(EPOCH FROM MAX(connected_at))*1000)::bigint AS last_connected_at,
              (EXTRACT(EPOCH FROM MAX(disconnected_at))*1000)::bigint AS last_disconnected_at
       FROM exchange_websocket_sessions`,
    );
    const row = r.rows[0];
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return { sessions: Number(row.sessions), connected: num(row.connected), reconnects: num(row.reconnects), last_connected_at: num(row.last_connected_at), last_disconnected_at: num(row.last_disconnected_at) };
  }

  // ---- users. users.created_at/updated_at TIMESTAMPTZ; mfa_enabled BOOLEAN ----
  async searchUsers(q: Parameters<IAdminRepo['searchUsers']>[0]) {
    const p: unknown[] = []; const w: string[] = [];
    if (q.q) { p.push(`%${q.q}%`); w.push(`email ILIKE $${p.length}`); }
    if (q.status) { p.push(q.status); w.push(`status=$${p.length}`); }
    if (q.role) { p.push(q.role); w.push(`role=$${p.length}`); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    p.push(q.limit); const lim = p.length; p.push(q.offset); const off = p.length;
    const r = await this.pool.query(
      `SELECT id,email,role,status,mfa_enabled::int AS mfa_enabled,
              (EXTRACT(EPOCH FROM created_at)*1000)::bigint AS created_at,
              (EXTRACT(EPOCH FROM updated_at)*1000)::bigint AS updated_at
       FROM users ${where} ORDER BY created_at DESC LIMIT $${lim} OFFSET $${off}`,
      p,
    );
    return r.rows;
  }
  async countUsers(q: Parameters<IAdminRepo['countUsers']>[0]) {
    const p: unknown[] = []; const w: string[] = [];
    if (q.q) { p.push(`%${q.q}%`); w.push(`email ILIKE $${p.length}`); }
    if (q.status) { p.push(q.status); w.push(`status=$${p.length}`); }
    if (q.role) { p.push(q.role); w.push(`role=$${p.length}`); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    // One grouped scan rather than three queries: the breakdowns must be consistent with the total, and
    // separate queries can straddle a concurrent write.
    const r = await this.pool.query(`SELECT status, role, COUNT(*)::int AS n FROM users ${where} GROUP BY status, role`, p);
    let total = 0; const byStatus: Record<string, number> = {}; const byRole: Record<string, number> = {};
    for (const row of r.rows as { status: string; role: string; n: number }[]) {
      total += row.n;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + row.n;
      byRole[row.role] = (byRole[row.role] ?? 0) + row.n;
    }
    return { total, byStatus, byRole };
  }
  async getUser(id: string) {
    /*
       ★★ id 형식을 먼저 확인한다.

         `users.id` 는 UUID 다. UUID 가 아닌 문자열을 그대로 넘기면 Postgres 가
         `invalid input syntax for type uuid` 를 던지고, 그 예외가 핸들러 밖으로
         나가 **500 Internal Server Error** 가 된다. 실제로 관리자 화면에서
         `?id=usr_kuri001`(옛 목업 id)로 들어가면 500 이 났다.

         500 은 두 가지로 해롭다. 잘못된 입력인데 서버 잘못처럼 보이고, 오류
         로그가 실제 장애와 섞인다. 형식이 UUID 가 아니면 그런 사용자는
         존재할 수 없으므로 `undefined` 를 돌려준다 — 호출하는 라우트가 404 로
         응답한다(이미 그렇게 되어 있다).

       ★ 이 한 곳을 고치면 이 repo 를 쓰는 모든 라우트가 함께 해결된다
         (users/:id · disable · enable · revoke-sessions · unlock · role).
    */
    if (!UUID_RE.test(id)) return undefined;
    const r = await this.pool.query(
      `SELECT id,email,role,status,mfa_enabled::int AS mfa_enabled,
              (EXTRACT(EPOCH FROM created_at)*1000)::bigint AS created_at,
              (EXTRACT(EPOCH FROM updated_at)*1000)::bigint AS updated_at FROM users WHERE id=$1`,
      [id],
    );
    return r.rows[0] as { id: string; email: string; role: string; status: string; mfa_enabled: number } | undefined;
  }
  async userStats(id: string): Promise<Record<string, number>> {
    const one = async (sql: string) => { try { return await this.one(sql, [id]); } catch { return 0; } };
    return {
      sessions: await one('SELECT COUNT(*) n FROM sessions WHERE user_id=$1'),
      aiConversations: await one('SELECT COUNT(*) n FROM ai_conversations WHERE user_id=$1'),
      aiSignals: await one('SELECT COUNT(*) n FROM ai_signals WHERE user_id=$1'),
      orders: await one('SELECT COUNT(*) n FROM orders WHERE user_id=$1'),
      exchangeCredentials: await one('SELECT COUNT(*) n FROM exchange_credentials WHERE user_id=$1 AND revoked_at IS NULL'),
    };
  }
  async activeSuperAdminIds(): Promise<string[]> {
    const r = await this.pool.query("SELECT id FROM users WHERE role='SUPER_ADMIN' AND status='active'");
    return r.rows.map((x) => x.id as string);
  }
  async setUserStatus(id: string, status: 'active' | 'disabled') {
    const r = await this.pool.query('UPDATE users SET status=$1, updated_at=now() WHERE id=$2', [status, id]);
    return (r.rowCount ?? 0) > 0;
  }
  async setUserRole(id: string, role: string) {
    const r = await this.pool.query('UPDATE users SET role=$1, updated_at=now() WHERE id=$2', [role, id]);
    return (r.rowCount ?? 0) > 0;
  }
  async revokeUserSessions(id: string) {
    const r = await this.pool.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    return r.rowCount ?? 0;
  }

  async deleteUserWithRetention(input: {
    userId: string;
    requestedBy: 'self' | 'admin';
    actorUserId?: string | null;
    actorEmail?: string | null;
    reason: string;
  }) {
    if (!UUID_RE.test(input.userId)) return null;

    /*
       보유 기간은 방침 1절 표에 적힌 값이다.

       ★ 코드에 상수로 두되, **옮기는 시점의 값을 행에 적어** 둔다(purge_after).
         나중에 이 상수를 바꾸면 이미 보관 중인 행의 기준이 함께 움직여
         "그때 약속한 기간" 을 알 수 없게 된다.
    */
    const FIVE_YEARS = "5 years";

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 대상 확인. 트랜잭션 안에서 다시 읽는다 — 바깥에서 읽은 값은 그 사이 바뀔 수 있다.
      const u = await client.query('SELECT id, email FROM users WHERE id=$1 FOR UPDATE', [input.userId]);
      if (!u.rows[0]) { await client.query('ROLLBACK'); return null; }
      const email = String((u.rows[0] as { email: string }).email);

      /*
         1) 약관 동의 기록 → 분리 보관 (5년)

         ★ document_id 는 옮기지 않는다. 증명에 필요한 것은 종류·버전·시각이다
           (문서 자체는 legal_documents 에 그대로 남는다).
      */
      const consents = await client.query(
        `INSERT INTO retained_legal_consents
           (former_user_id, former_email, kind, version, agreed_at, retention_reason, purge_after)
         SELECT user_id, $2, kind, version, agreed_at, $3, now() + INTERVAL '${FIVE_YEARS}'
         FROM user_legal_consents WHERE user_id = $1`,
        [input.userId, email, 'privacy policy 1 - consent proof - 5 years'],
      );

      /*
         2) 주문 기록 → 분리 보관 (5년)

         ★ credential_id 는 옮기지 않는다(어느 키로 냈는지는 보관 목적에 필요
           하지 않고, 남기면 삭제된 키를 가리키는 값이 남는다).
         ★ mode 는 반드시 옮긴다 — 모의 거래를 실거래로 읽으면 분쟁 판단이
           처음부터 틀어진다.
      */
      const orders = await client.query(
        `INSERT INTO retained_orders
           (former_user_id, former_email, internal_order_id, exchange_order_id, symbol, side, type,
            price, quantity, filled_quantity, status, mode, ordered_at, retention_reason, purge_after)
         SELECT user_id, $2, internal_order_id, exchange_order_id, symbol, side, type,
                price, quantity, filled_quantity, status, mode, created_at, $3,
                now() + INTERVAL '${FIVE_YEARS}'
         FROM orders WHERE user_id = $1`,
        [input.userId, email, 'privacy policy 1 - trade history - 5 years'],
      );

      /*
         3) 삭제 처리 기록 (영구)

         ★ 계정을 지우기 **전에** 남긴다. 지운 뒤에 남기려다 실패하면 무엇을
           지웠는지 모르는 상태가 된다.
      */
      await client.query(
        `INSERT INTO user_deletion_records
           (former_user_id, former_email, requested_by, actor_user_id, actor_email, reason,
            retained_consents, retained_orders)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          input.userId, email, input.requestedBy,
          input.actorUserId && UUID_RE.test(input.actorUserId) ? input.actorUserId : null,
          input.actorEmail ?? null,
          input.reason,
          consents.rowCount ?? 0,
          orders.rowCount ?? 0,
        ],
      );

      /*
         4) 계정 삭제.

         나머지는 FK 의 ON DELETE 규칙이 처리한다 — 세션·거래소 자격증명·설정·
         즐겨찾기·차트 템플릿·자산 스냅샷·AI 기록은 CASCADE 로 사라지고,
         감사 로그는 0021 에서 SET NULL 로 바꿨으므로 **남는다.**
      */
      const del = await client.query('DELETE FROM users WHERE id=$1', [input.userId]);

      await client.query('COMMIT');
      return {
        deleted: (del.rowCount ?? 0) > 0,
        retainedConsents: consents.rowCount ?? 0,
        retainedOrders: orders.rowCount ?? 0,
      };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async listUserNotes(userId: string) {
    if (!UUID_RE.test(userId)) return [];
    const r = await this.pool.query(
      `SELECT id, body, author_email,
              (EXTRACT(EPOCH FROM created_at)*1000)::bigint AS created_at,
              (EXTRACT(EPOCH FROM updated_at)*1000)::bigint AS updated_at
       FROM admin_user_notes WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [userId],
    );
    return r.rows as Array<{ id: string; body: string; author_email: string | null; created_at: string | number; updated_at: string | number }>;
  }

  async addUserNote(input: { userId: string; authorUserId: string; authorEmail: string; body: string }) {
    if (!UUID_RE.test(input.userId)) return null;
    /*
       ★ 본문 길이는 DB 의 CHECK 로도 막지만 여기서 먼저 자른다.
         DB 오류로 500 이 나가는 것보다, 라우트가 400 으로 답하게 하는 편이
         호출자에게 유용하다.
    */
    const body = String(input.body ?? '').trim();
    if (!body || body.length > 4000) return null;
    const r = await this.pool.query(
      `INSERT INTO admin_user_notes (user_id, author_user_id, author_email, body)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.userId, UUID_RE.test(input.authorUserId) ? input.authorUserId : null, input.authorEmail, body],
    );
    return r.rows[0] as { id: string };
  }

  async deleteUserNote(input: { noteId: string; userId: string }) {
    if (!UUID_RE.test(input.noteId) || !UUID_RE.test(input.userId)) return false;
    /*
       ★ user_id 를 조건에 반드시 넣는다.

         노트 id 만으로 지우면 다른 회원의 노트를 지울 수 있다(id 를 알아내면).
         화면이 올바른 조합을 보낸다고 가정하지 않는다.
    */
    const r = await this.pool.query(
      'DELETE FROM admin_user_notes WHERE id=$1 AND user_id=$2',
      [input.noteId, input.userId],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async setUserEmail(input: { userId: string; email: string }): Promise<'ok' | 'taken' | 'not_found'> {
    if (!UUID_RE.test(input.userId)) return 'not_found';
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!email) return 'not_found';

    /*
       ★ email_verified 를 false 로 되돌린다.

         새 주소가 그 사람의 것이라는 증거가 없다. 확인된 상태로 두면 잘못
         입력된 주소가 확인된 것처럼 보이고, 그 뒤 비밀번호 재설정 링크가
         남의 메일함으로 간다.
    */
    try {
      const r = await this.pool.query(
        'UPDATE users SET email=$2, email_verified=false, updated_at=now() WHERE id=$1',
        [input.userId, email],
      );
      return (r.rowCount ?? 0) > 0 ? 'ok' : 'not_found';
    } catch (e) {
      /*
         ★ 중복은 오류가 아니라 결과다.

           users.email 에 UNIQUE 제약이 있으므로 이미 쓰는 주소면 23505 가 온다.
           그것을 500 으로 흘리면 "서버 문제" 로 보이고, 담당자는 무엇이
           잘못됐는지 알 수 없다.
      */
      const code = (e as { code?: string } | null)?.code;
      if (code === '23505') return 'taken';
      throw e;
    }
  }

  async clearUserMfa(id: string) {
    if (!UUID_RE.test(id)) return false;
    /*
       한 트랜잭션으로 처리한다.

       ★ credential 만 지우고 users.mfa_enabled 를 남기면 로그인 흐름이
         "MFA 필요" 로 판단하는데 검증할 secret 이 없어 **아무도 로그인할 수
         없는 상태**가 된다. 그 반대도 마찬가지다. 둘은 함께 바뀌어야 한다.
       ★ 진행 중인 챌린지도 지운다 — 남겨 두면 예전 시도가 유효한 채로 남는다.
    */
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const del = await client.query('DELETE FROM mfa_credentials WHERE user_id=$1', [id]);
      await client.query('DELETE FROM mfa_challenges WHERE user_id=$1', [id]);
      await client.query('UPDATE users SET mfa_enabled=false, updated_at=now() WHERE id=$1', [id]);
      await client.query('COMMIT');
      return (del.rowCount ?? 0) > 0;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  // ---- feature flags (BOOLEAN enabled; BIGINT ms) ----
  async seedFlag(key: string, enabled: boolean, description: string) {
    await this.pool.query(
      'INSERT INTO feature_flags (id,key,enabled,description,version,updated_at) VALUES ($1,$2,$3,$4,0,$5) ON CONFLICT (key) DO NOTHING',
      [randomUUID(), key, enabled, description, this.now()],
    );
  }
  async listFlags() {
    const r = await this.pool.query('SELECT id,key,enabled::int AS enabled,description,expires_at,version,updated_by,updated_at FROM feature_flags ORDER BY key');
    return r.rows;
  }
  async updateFlag(id: string, enabled: boolean, reason: string, version: number, by: string, corr?: string): Promise<AdminActionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = (await client.query('SELECT enabled::int AS enabled, version FROM feature_flags WHERE id=$1 FOR UPDATE', [id])).rows[0] as { enabled: number; version: number } | undefined;
      if (!cur) { await client.query('ROLLBACK'); return { ok: false }; }
      if (cur.version !== version) { await client.query('ROLLBACK'); return { ok: false, conflict: true }; }
      await client.query('UPDATE feature_flags SET enabled=$1, version=version+1, updated_by=$2, updated_at=$3 WHERE id=$4 AND version=$5', [enabled, by, this.now(), id, version]);
      await client.query('INSERT INTO feature_flag_history (id,flag_id,before_enabled,after_enabled,reason,changed_by,correlation_id,at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), id, cur.enabled === 1, enabled, reason, by, corr ?? null, this.now()]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  // ---- kill switches ----
  async seedKill(scope: string, target: string | null, active: boolean) {
    /*
       ★★ 멱등 시드. 예전 구현은 `ON CONFLICT (scope,target)` 였는데 target 이 NULL 이면
         Postgres 는 NULL 을 서로 다르게 취급해 충돌을 못 잡았다 → 배포마다 같은 스코프가
         새 행으로 쌓였다(스코프당 수백 행). scope+target(NULL 포함)이 이미 있으면 넣지
         않도록 IS NOT DISTINCT FROM 으로 판정한다.
    */
    await this.pool.query(
      `INSERT INTO kill_switches (id,scope,target,active,version,updated_at)
       SELECT $1,$2,$3,$4,0,$5
       WHERE NOT EXISTS (
         SELECT 1 FROM kill_switches WHERE scope=$2 AND target IS NOT DISTINCT FROM $3
       )`,
      [randomUUID(), scope, target, active, this.now()],
    );
  }
  async listKill() {
    const r = await this.pool.query('SELECT id,scope,target,active::int AS active,allow_cancel_reduce::int AS allow_cancel_reduce,reason,expires_at,version,updated_by,updated_at FROM kill_switches ORDER BY scope');
    return r.rows;
  }
  async getKill(id: string) {
    const r = await this.pool.query('SELECT id,scope,active::int AS active,version FROM kill_switches WHERE id=$1', [id]);
    return r.rows[0] as { id: string; scope: string; active: number; version: number } | undefined;
  }
  async updateKill(id: string, active: boolean, reason: string, version: number, by: string, corr?: string): Promise<AdminActionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = (await client.query('SELECT active::int AS active, version FROM kill_switches WHERE id=$1 FOR UPDATE', [id])).rows[0] as { active: number; version: number } | undefined;
      if (!cur) { await client.query('ROLLBACK'); return { ok: false }; }
      if (cur.version !== version) { await client.query('ROLLBACK'); return { ok: false, conflict: true }; }
      await client.query('UPDATE kill_switches SET active=$1, reason=$2, version=version+1, updated_by=$3, updated_at=$4 WHERE id=$5 AND version=$6', [active, reason, by, this.now(), id, version]);
      await client.query('INSERT INTO kill_switch_history (id,kill_switch_id,before_active,after_active,reason,changed_by,correlation_id,at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), id, cur.active === 1, active, reason, by, corr ?? null, this.now()]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  // ---- incidents ----
  async createIncident(i: Parameters<IAdminRepo['createIncident']>[0]): Promise<string> {
    const id = randomUUID(); const t = this.now();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO incidents (id,title,description,severity,service,status,impact,version,detected_at,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11)', [id, i.title, i.description, i.severity, i.service, 'OPEN', i.impact ?? null, t, i.by, t, t]);
      await client.query('INSERT INTO incident_events (id,incident_id,kind,note,actor,at) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, 'created', i.title, i.by, t]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
    return id;
  }
  async listIncidents() {
    const r = await this.pool.query('SELECT id,title,severity,service,status,owner,version,acknowledged_at,acknowledged_by,detected_at,created_at,updated_at FROM incidents ORDER BY created_at DESC LIMIT 200');
    return r.rows;
  }
  async getIncident(id: string) {
    const r = await this.pool.query('SELECT id,status,version FROM incidents WHERE id=$1', [id]);
    return r.rows[0] as { id: string; status: string; version: number } | undefined;
  }
  async updateIncident(id: string, patch: Record<string, string | undefined>, version: number, by: string): Promise<AdminActionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = (await client.query('SELECT version FROM incidents WHERE id=$1 FOR UPDATE', [id])).rows[0] as { version: number } | undefined;
      if (!cur) { await client.query('ROLLBACK'); return { ok: false }; }
      if (cur.version !== version) { await client.query('ROLLBACK'); return { ok: false, conflict: true }; }
      const cols = ['status', 'severity', 'owner', 'root_cause', 'mitigation', 'resolution'] as const;
      const map: Record<string, string | undefined> = { status: patch.status, severity: patch.severity, owner: patch.owner, root_cause: patch.rootCause, mitigation: patch.mitigation, resolution: patch.resolution };
      const params: unknown[] = [];
      const set = cols.filter((c) => map[c] !== undefined).map((c) => { params.push(map[c]); return `${c}=$${params.length}`; });
      params.push(this.now()); const tIdx = params.length;
      params.push(id); const idIdx = params.length;
      params.push(version); const vIdx = params.length;
      await client.query(`UPDATE incidents SET ${[...set, `version=version+1`, `updated_at=$${tIdx}`].join(', ')} WHERE id=$${idIdx} AND version=$${vIdx}`, params);
      await client.query('INSERT INTO incident_events (id,incident_id,kind,note,actor,at) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, 'update', patch.note ?? patch.status ?? 'update', by, this.now()]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }
  async ackIncident(id: string, version: number, by: string, note?: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = (await client.query('SELECT version, acknowledged_at, acknowledged_by FROM incidents WHERE id=$1 FOR UPDATE', [id])).rows[0] as { version: number; acknowledged_at: number | null; acknowledged_by: string | null } | undefined;
      if (!cur) { await client.query('ROLLBACK'); return { ok: false }; }
      if (cur.version !== version) { await client.query('ROLLBACK'); return { ok: false, conflict: true }; }
      if (cur.acknowledged_at !== null) { await client.query('ROLLBACK'); return { ok: true, changed: false, acknowledgedAt: Number(cur.acknowledged_at), acknowledgedBy: cur.acknowledged_by ?? undefined, version: cur.version }; }
      const t = this.now();
      await client.query('UPDATE incidents SET acknowledged_at=$1, acknowledged_by=$2, version=version+1, updated_at=$3 WHERE id=$4 AND version=$5', [t, by, t, id, version]);
      await client.query('INSERT INTO incident_events (id,incident_id,kind,note,actor,at) VALUES ($1,$2,$3,$4,$5,$6)', [randomUUID(), id, 'acknowledged', note ?? null, by, t]);
      await client.query('COMMIT');
      return { ok: true, changed: true, acknowledgedAt: t, acknowledgedBy: by, version: cur.version + 1 };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  // ---- release gates ----
  async seedGate(g: Parameters<IAdminRepo['seedGate']>[0]) {
    await this.pool.query(
      'INSERT INTO release_gates (id,gate_key,phase,description,owner,exit_criteria,status,production_required,version,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9) ON CONFLICT (gate_key) DO NOTHING',
      [randomUUID(), g.key, g.phase, g.description, g.owner ?? null, g.exitCriteria ?? null, g.status, g.productionRequired, this.now()],
    );
  }
  async listGates() {
    const r = await this.pool.query('SELECT id,gate_key,phase,description,owner,exit_criteria,status,production_required::int AS production_required,reason,approved_by,expires_at,version,updated_at FROM release_gates ORDER BY phase,gate_key');
    return r.rows;
  }
  async getGate(id: string) {
    const r = await this.pool.query('SELECT id,status,production_required::int AS production_required,version FROM release_gates WHERE id=$1', [id]);
    return r.rows[0] as { id: string; status: string; production_required: number; version: number } | undefined;
  }
  async hasEvidence(id: string) { return (await this.one('SELECT COUNT(*) n FROM release_gate_evidence WHERE gate_id=$1', [id])) > 0; }
  async updateGate(id: string, status: string, version: number, by: string, opts: { reason?: string; expiresAt?: number; evidencePath?: string }): Promise<AdminActionResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = (await client.query('SELECT version FROM release_gates WHERE id=$1 FOR UPDATE', [id])).rows[0] as { version: number } | undefined;
      if (!cur) { await client.query('ROLLBACK'); return { ok: false }; }
      if (cur.version !== version) { await client.query('ROLLBACK'); return { ok: false, conflict: true }; }
      if (opts.evidencePath) await client.query('INSERT INTO release_gate_evidence (id,gate_id,evidence_path,added_by,at) VALUES ($1,$2,$3,$4,$5)', [randomUUID(), id, opts.evidencePath, by, this.now()]);
      await client.query('UPDATE release_gates SET status=$1, reason=$2, approved_by=$3, expires_at=$4, version=version+1, updated_at=$5 WHERE id=$6 AND version=$7', [status, opts.reason ?? null, by, opts.expiresAt ?? null, this.now(), id, version]);
      await client.query('COMMIT');
      return { ok: true };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  // ---- security summary (aggregate counts only; no credential material) ----
  async securitySummary(): Promise<Record<string, unknown>> {
    const t = this.now();
    const dayAgo = t - 24 * 60 * 60 * 1000;
    const n = async (sql: string, p: unknown[] = []) => this.one(sql, p);
    const nullable = async (sql: string, p: unknown[] = []): Promise<number | null> => { try { return await this.one(sql, p); } catch { return null; } };
    const usersTotal = await n('SELECT COUNT(*) n FROM users');
    const mfaCredentialsEnabled = await nullable('SELECT COUNT(*) n FROM mfa_credentials WHERE enabled=true');
    const loginCount = (result: string) => nullable("SELECT COUNT(*) n FROM audit_logs WHERE action='auth.login' AND at>=to_timestamp($1/1000.0) AND meta->>'result'=$2", [dayAgo, result]);
    return {
      generatedAt: t,
      source: { tables: ['users', 'mfa_credentials', 'mfa_challenges', 'sessions', 'account_lockouts', 'audit_logs', 'admin_actions'], scope: 'LOCAL_DB', aggregatesOnly: true },
      users: {
        total: usersTotal,
        active: await n("SELECT COUNT(*) n FROM users WHERE status='active'"),
        disabled: await n("SELECT COUNT(*) n FROM users WHERE status='disabled'"),
        statusLocked: await n("SELECT COUNT(*) n FROM users WHERE status='locked'"),
        adminRoles: await n("SELECT COUNT(*) n FROM users WHERE role IN ('SUPPORT','ANALYST','ADMIN','SUPER_ADMIN')"),
      },
      mfa: {
        usersFlagged: await n('SELECT COUNT(*) n FROM users WHERE mfa_enabled=true'),
        credentialsEnabled: mfaCredentialsEnabled,
        pendingEnrollments: await nullable('SELECT COUNT(*) n FROM mfa_credentials WHERE pending_secret_encrypted IS NOT NULL'),
        adoptionPct: mfaCredentialsEnabled === null || usersTotal === 0 ? null : Math.round((mfaCredentialsEnabled / usersTotal) * 1000) / 10,
        pendingChallenges: await nullable('SELECT COUNT(*) n FROM mfa_challenges WHERE expires_at>$1', [t]),
      },
      lockouts: {
        activeNow: await n('SELECT COUNT(*) n FROM account_lockouts WHERE locked_until>$1', [t]),
        expired: await n('SELECT COUNT(*) n FROM account_lockouts WHERE locked_until>0 AND locked_until<=$1', [t]),
        withFailuresNotLocked: await n('SELECT COUNT(*) n FROM account_lockouts WHERE fails>0 AND locked_until<=$1', [t]),
        clearedByAdmin: await n('SELECT COUNT(*) n FROM account_lockouts WHERE cleared_at IS NOT NULL'),
      },
      sessions: {
        active: await n('SELECT COUNT(*) n FROM sessions WHERE expires_at>now()'),
        expiredNotReaped: await n('SELECT COUNT(*) n FROM sessions WHERE expires_at<=now()'),
        distinctUsers: await n('SELECT COUNT(DISTINCT user_id) n FROM sessions WHERE expires_at>now()'),
      },
      logins24h: { failed: await loginCount('failure'), rateLimited: await loginCount('ratelimited'), succeeded: await loginCount('success'), disabledBlocked: await loginCount('disabled') },
      adminActions24h: {
        total: await n('SELECT COUNT(*) n FROM admin_actions WHERE at>=$1', [dayAgo]),
        failures: await n("SELECT COUNT(*) n FROM admin_actions WHERE at>=$1 AND result='failure'", [dayAgo]),
        highRisk: await n("SELECT COUNT(*) n FROM admin_actions WHERE at>=$1 AND risk_level='high'", [dayAgo]),
      },
      unavailable: ['totpReplayBlocked', 'recoveryCodeRedemptions', 'stepUpVerifications', 'securityAlerts'],
    };
  }

  // ---- lockouts (account_lockouts BIGINT ms) ----
  async listLockouts(q: { state: 'active' | 'expired' | 'any'; limit: number; offset: number }) {
    const t = this.now();
    const p: unknown[] = []; let where = '';
    if (q.state === 'active') { p.push(t); where = `WHERE l.locked_until>$${p.length}`; }
    else if (q.state === 'expired') { p.push(t); where = `WHERE l.locked_until>0 AND l.locked_until<=$${p.length}`; }
    p.push(q.limit); const lim = p.length; p.push(q.offset); const off = p.length;
    const r = await this.pool.query(
      `SELECT l.user_id, u.email AS user_email, u.status AS user_status, l.fails, l.first_fail_at,
              l.locked_until, l.source, l.version, l.updated_at, l.cleared_at, l.cleared_by
       FROM account_lockouts l LEFT JOIN users u ON u.id = l.user_id
       ${where} ORDER BY l.locked_until DESC, l.user_id ASC LIMIT $${lim} OFFSET $${off}`,
      p,
    );
    return r.rows;
  }
  async countLockouts(state: 'active' | 'expired' | 'any') {
    const t = this.now();
    if (state === 'active') return this.one('SELECT COUNT(*) n FROM account_lockouts WHERE locked_until>$1', [t]);
    if (state === 'expired') return this.one('SELECT COUNT(*) n FROM account_lockouts WHERE locked_until>0 AND locked_until<=$1', [t]);
    return this.one('SELECT COUNT(*) n FROM account_lockouts');
  }
  async clearLockout(userId: string, actorUserId: string): Promise<{ changed: boolean; before: { fails: number; lockedUntil: number } | null }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = (await client.query('SELECT fails, locked_until FROM account_lockouts WHERE user_id=$1 FOR UPDATE', [userId])).rows[0] as { fails: number; locked_until: number } | undefined;
      if (!cur) { await client.query('ROLLBACK'); return { changed: false, before: null }; }
      if (Number(cur.fails) === 0 && Number(cur.locked_until) === 0) { await client.query('ROLLBACK'); return { changed: false, before: { fails: 0, lockedUntil: 0 } }; }
      await client.query('UPDATE account_lockouts SET fails=0, locked_until=0, version=version+1, updated_at=$1, cleared_at=$2, cleared_by=$3 WHERE user_id=$4', [this.now(), this.now(), actorUserId, userId]);
      await client.query('COMMIT');
      return { changed: true, before: { fails: Number(cur.fails), lockedUntil: Number(cur.locked_until) } };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }

  // ---- reports (admin_reports source_json/data_json are TEXT; window BIGINT ms) ----
  async computeReport(type: string, window: { from: number; to: number }) {
    const unavailable: string[] = [];
    const n = async (label: string, sql: string, p: unknown[] = []): Promise<number | null> => { try { return await this.one(sql, p); } catch { unavailable.push(label); return null; } };
    const s = async (label: string, sql: string, p: unknown[] = []): Promise<number | null> => { try { const r = await this.pool.query(sql, p); const v = r.rows[0]?.v; return v === null || v === undefined ? null : Number(v); } catch { unavailable.push(label); return null; } };
    const rows = async (label: string, sql: string, p: unknown[] = []): Promise<unknown[]> => { try { return (await this.pool.query(sql, p)).rows; } catch { unavailable.push(label); return []; } };
    const { from, to } = window;
    const ts = (col: string, op: string, idx: number) => `${col}${op}to_timestamp($${idx}/1000.0)`;
    switch (type) {
      case 'daily_operations': {
        const data = {
          usersTotal: await n('users', 'SELECT COUNT(*) n FROM users'),
          usersCreatedInWindow: await n('users', `SELECT COUNT(*) n FROM users WHERE ${ts('created_at', '>=', 1)} AND ${ts('created_at', '<=', 2)}`, [from, to]),
          activeSessions: await n('sessions', 'SELECT COUNT(*) n FROM sessions WHERE expires_at>now()'),
          ordersInWindow: await n('orders', `SELECT COUNT(*) n FROM orders WHERE ${ts('created_at', '>=', 1)} AND ${ts('created_at', '<=', 2)}`, [from, to]),
          adminActionsInWindow: await n('admin_actions', 'SELECT COUNT(*) n FROM admin_actions WHERE at>=$1 AND at<=$2', [from, to]),
          incidentsOpen: await n('incidents', "SELECT COUNT(*) n FROM incidents WHERE status IN ('OPEN','INVESTIGATING')"),
          notificationsInWindow: await n('notifications', `SELECT COUNT(*) n FROM notifications WHERE ${ts('created_at', '>=', 1)} AND ${ts('created_at', '<=', 2)}`, [from, to]),
        };
        return { data, tables: ['users', 'sessions', 'orders', 'admin_actions', 'incidents', 'notifications'], rowCount: Object.keys(data).length, unavailable };
      }
      case 'trading_activity': {
        const byStatus = await rows('orders', `SELECT status, COUNT(*) AS count FROM orders WHERE ${ts('created_at', '>=', 1)} AND ${ts('created_at', '<=', 2)} GROUP BY status ORDER BY status`, [from, to]);
        const byMode = await rows('orders_mode', `SELECT mode, COUNT(*) AS count FROM orders WHERE ${ts('created_at', '>=', 1)} AND ${ts('created_at', '<=', 2)} GROUP BY mode ORDER BY mode`, [from, to]);
        const data = {
          ordersInWindow: await n('orders', `SELECT COUNT(*) n FROM orders WHERE ${ts('created_at', '>=', 1)} AND ${ts('created_at', '<=', 2)}`, [from, to]),
          ordersByStatus: byStatus,
          ordersByMode: byMode,
          executionsInWindow: await n('executions', `SELECT COUNT(*) n FROM executions WHERE ${ts('at', '>=', 1)} AND ${ts('at', '<=', 2)}`, [from, to]),
          openPositions: await n('positions', 'SELECT COUNT(*) n FROM positions'),
          distinctSymbols: await n('orders', `SELECT COUNT(DISTINCT symbol) n FROM orders WHERE ${ts('created_at', '>=', 1)} AND ${ts('created_at', '<=', 2)}`, [from, to]),
          liveOrdersExecuted: 0,
          liveOrderPathNote: 'no live submit endpoint exists in this deployment',
        };
        return { data, tables: ['orders', 'executions', 'positions'], rowCount: Object.keys(data).length, unavailable };
      }
      case 'ai_cost': {
        const data = {
          runsInWindow: await n('ai_runs', `SELECT COUNT(*) n FROM ai_runs WHERE ${ts('created_at', '>=', 1)} AND ${ts('created_at', '<=', 2)}`, [from, to]),
          errorRunsInWindow: await n('ai_runs', `SELECT COUNT(*) n FROM ai_runs WHERE status='error' AND ${ts('created_at', '>=', 1)} AND ${ts('created_at', '<=', 2)}`, [from, to]),
          fallbackRunsInWindow: await n('ai_runs', `SELECT COUNT(*) n FROM ai_runs WHERE fallback_used=true AND ${ts('created_at', '>=', 1)} AND ${ts('created_at', '<=', 2)}`, [from, to]),
          inputTokens: await s('ai_usage_records', `SELECT SUM(input_tokens) v FROM ai_usage_records WHERE ${ts('at', '>=', 1)} AND ${ts('at', '<=', 2)}`, [from, to]),
          outputTokens: await s('ai_usage_records', `SELECT SUM(output_tokens) v FROM ai_usage_records WHERE ${ts('at', '>=', 1)} AND ${ts('at', '<=', 2)}`, [from, to]),
          estimatedCostMicros: await s('ai_usage_records', `SELECT SUM(estimated_cost_micros) v FROM ai_usage_records WHERE ${ts('at', '>=', 1)} AND ${ts('at', '<=', 2)}`, [from, to]),
          actualCostMicros: await s('ai_usage_records', `SELECT SUM(actual_cost_micros) v FROM ai_usage_records WHERE ${ts('at', '>=', 1)} AND ${ts('at', '<=', 2)}`, [from, to]),
          toolCallsInWindow: await n('ai_tool_calls', `SELECT COUNT(*) n FROM ai_tool_calls WHERE ${ts('at', '>=', 1)} AND ${ts('at', '<=', 2)}`, [from, to]),
        };
        return { data, tables: ['ai_runs', 'ai_usage_records', 'ai_tool_calls'], rowCount: Object.keys(data).length, unavailable };
      }
      case 'security_posture': {
        const data = {
          mfaCredentialsEnabled: await n('mfa_credentials', 'SELECT COUNT(*) n FROM mfa_credentials WHERE enabled=true'),
          usersTotal: await n('users', 'SELECT COUNT(*) n FROM users'),
          lockoutsActive: await n('account_lockouts', 'SELECT COUNT(*) n FROM account_lockouts WHERE locked_until>$1', [this.now()]),
          failedLoginsInWindow: await n('audit_logs', `SELECT COUNT(*) n FROM audit_logs WHERE action='auth.login' AND meta->>'result'='failure' AND ${ts('at', '>=', 1)} AND ${ts('at', '<=', 2)}`, [from, to]),
          activeSessions: await n('sessions', 'SELECT COUNT(*) n FROM sessions WHERE expires_at>now()'),
          highRiskAdminActionsInWindow: await n('admin_actions', "SELECT COUNT(*) n FROM admin_actions WHERE risk_level='high' AND at>=$1 AND at<=$2", [from, to]),
          disabledAccounts: await n('users', "SELECT COUNT(*) n FROM users WHERE status='disabled'"),
        };
        return { data, tables: ['users', 'mfa_credentials', 'account_lockouts', 'audit_logs', 'sessions', 'admin_actions'], rowCount: Object.keys(data).length, unavailable };
      }
      case 'compliance_audit': {
        const byResult = await rows('admin_actions', 'SELECT result, COUNT(*) AS count FROM admin_actions WHERE at>=$1 AND at<=$2 GROUP BY result ORDER BY result', [from, to]);
        const gates = await rows('release_gates', 'SELECT status, COUNT(*) AS count FROM release_gates GROUP BY status ORDER BY status');
        const data = {
          adminActionsInWindow: await n('admin_actions', 'SELECT COUNT(*) n FROM admin_actions WHERE at>=$1 AND at<=$2', [from, to]),
          adminActionsByResult: byResult,
          authAuditEntriesInWindow: await n('audit_logs', `SELECT COUNT(*) n FROM audit_logs WHERE ${ts('at', '>=', 1)} AND ${ts('at', '<=', 2)}`, [from, to]),
          incidentsInWindow: await n('incidents', 'SELECT COUNT(*) n FROM incidents WHERE created_at>=$1 AND created_at<=$2', [from, to]),
          incidentsAcknowledged: await n('incidents', 'SELECT COUNT(*) n FROM incidents WHERE acknowledged_at IS NOT NULL'),
          releaseGatesByStatus: gates,
          killSwitchesActive: await n('kill_switches', 'SELECT COUNT(*) n FROM kill_switches WHERE active=true'),
        };
        return { data, tables: ['admin_actions', 'audit_logs', 'incidents', 'release_gates', 'kill_switches'], rowCount: Object.keys(data).length, unavailable };
      }
      default:
        throw new Error('unknown report type');
    }
  }
  async insertReport(r: Parameters<IAdminRepo['insertReport']>[0]): Promise<string> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO admin_reports (id, report_type, source_json, data_json, row_count, window_from, window_to, generated_by, generated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, r.type, JSON.stringify(r.source), JSON.stringify(r.data), r.rowCount, r.from, r.to, r.by, this.now()],
    );
    return id;
  }
  async listReports(q: { type?: string; limit: number; offset: number }) {
    const p: unknown[] = []; let where = '';
    if (q.type) { p.push(q.type); where = `WHERE report_type=$${p.length}`; }
    p.push(q.limit); const lim = p.length; p.push(q.offset); const off = p.length;
    const r = await this.pool.query(
      `SELECT id, report_type, row_count, window_from, window_to, generated_by, generated_at, source_json
       FROM admin_reports ${where} ORDER BY generated_at DESC, id ASC LIMIT $${lim} OFFSET $${off}`,
      p,
    );
    return r.rows;
  }
  async countReports(type?: string) {
    if (type) return this.one('SELECT COUNT(*) n FROM admin_reports WHERE report_type=$1', [type]);
    return this.one('SELECT COUNT(*) n FROM admin_reports');
  }
  async getReport(id: string) {
    const r = await this.pool.query('SELECT id, report_type, row_count, window_from, window_to, generated_by, generated_at, source_json, data_json FROM admin_reports WHERE id=$1', [id]);
    return r.rows[0] as { id: string; report_type: string; row_count: number; window_from: number | null; window_to: number | null; generated_by: string; generated_at: number; source_json: string; data_json: string } | undefined;
  }

  // ---- backup status (PostgreSQL engine; honest read-only facts) ----
  async backupStatus(): Promise<Record<string, unknown>> {
    const lastMigration = await (async () => {
      try { const r = await this.pool.query('SELECT version, (EXTRACT(EPOCH FROM applied_at)*1000)::bigint AS applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1'); return r.rows[0] ? { version: r.rows[0].version as string, applied_at: Number(r.rows[0].applied_at) } : null; } catch { return null; }
    })();
    const migrationCount = await (async () => { try { return await this.one('SELECT COUNT(*) n FROM schema_migrations'); } catch { return null; } })();
    const gate = await (async () => {
      try { const r = await this.pool.query("SELECT gate_key, status, production_required::int AS production_required FROM release_gates WHERE gate_key='backup-restore-pitr'"); const g = r.rows[0]; return g ? { key: g.gate_key, status: g.status, productionRequired: g.production_required === 1 } : null; } catch { return null; }
    })();
    return {
      generatedAt: this.now(),
      engine: 'postgres',
      engineNote: "this deployment's datastore is managed PostgreSQL",
      managedPostgres: 'Connected',
      migrations: { last: lastMigration, appliedCount: migrationCount },
      backup: { lastBackupAt: null, schedule: null, retentionDays: null, encryptionAtRest: null, pitr: null, lastRestoreDrillAt: null, offsiteCopy: null },
      // Managed-Postgres backup/PITR/retention are properties of the RDS/infra layer, not knowable from a
      // SQL session, so they are null + named rather than fabricated as "OK".
      unavailable: ['lastBackupAt', 'schedule', 'retentionDays', 'encryptionAtRest', 'pitr', 'lastRestoreDrillAt', 'offsiteCopy', 'managedPostgresBackup'],
      restore: { supported: false, reason: 'DISABLED_BY_POLICY', note: 'no restore endpoint exists; executing a restore from the console is out of scope' },
      releaseGate: gate,
      readOnly: true,
    };
  }

  // ---- gateway (LOCAL MOCK only; never a real exchange) ----
  async seedMockGateway(id = 'local-mock') {
    await this.pool.query("INSERT INTO mock_gateway_state (id,status,version,updated_at) VALUES ($1,'MOCK_IDLE',0,$2) ON CONFLICT (id) DO NOTHING", [id, this.now()]);
  }
  async mockGatewayState(id = 'local-mock'): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query('SELECT id,status,resync_count,reconnect_count,last_resync_at,last_reconnect_at,version,updated_by,updated_at FROM mock_gateway_state WHERE id=$1', [id]);
    return r.rows[0] ?? null;
  }
  async applyMockGatewayAction(action: 'resync' | 'reconnect', version: number, by: string, id = 'local-mock'): Promise<{ ok: boolean; conflict?: boolean; state?: Record<string, unknown> }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const cur = (await client.query('SELECT version FROM mock_gateway_state WHERE id=$1 FOR UPDATE', [id])).rows[0] as { version: number } | undefined;
      if (!cur) { await client.query('ROLLBACK'); return { ok: false }; }
      if (cur.version !== version) { await client.query('ROLLBACK'); return { ok: false, conflict: true }; }
      const t = this.now();
      if (action === 'resync') {
        await client.query("UPDATE mock_gateway_state SET status='MOCK_RESYNCED', resync_count=resync_count+1, last_resync_at=$1, version=version+1, updated_by=$2, updated_at=$3 WHERE id=$4 AND version=$5", [t, by, t, id, version]);
      } else {
        await client.query("UPDATE mock_gateway_state SET status='MOCK_RECONNECTED', reconnect_count=reconnect_count+1, last_reconnect_at=$1, version=version+1, updated_by=$2, updated_at=$3 WHERE id=$4 AND version=$5", [t, by, t, id, version]);
      }
      const state = (await client.query('SELECT id,status,resync_count,reconnect_count,last_resync_at,last_reconnect_at,version,updated_by,updated_at FROM mock_gateway_state WHERE id=$1', [id])).rows[0];
      await client.query('COMMIT');
      return { ok: true, state: state ?? undefined };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }
  async gatewayMetrics(staleThresholdMs = 60_000): Promise<Record<string, unknown>> {
    const t = this.now();
    const agg = (await this.pool.query(
      `SELECT COUNT(*) AS sessions,
              SUM(CASE WHEN status='connected' THEN 1 ELSE 0 END) AS connected,
              SUM(CASE WHEN status='disconnected' THEN 1 ELSE 0 END) AS disconnected,
              SUM(reconnects) AS reconnects,
              (EXTRACT(EPOCH FROM MAX(connected_at))*1000)::bigint AS last_connected_at,
              (EXTRACT(EPOCH FROM MAX(disconnected_at))*1000)::bigint AS last_disconnected_at,
              COUNT(DISTINCT user_id) AS distinct_users
       FROM exchange_websocket_sessions`,
    )).rows[0] as Record<string, number | null>;
    const byStatus = (await this.pool.query('SELECT status, COUNT(*) AS count FROM exchange_websocket_sessions GROUP BY status ORDER BY status')).rows;
    const newest = Math.max(Number(agg.last_connected_at ?? 0), Number(agg.last_disconnected_at ?? 0));
    const ageMs = newest > 0 ? t - newest : null;
    return {
      generatedAt: t,
      source: { kind: 'LOCAL_DB', table: 'exchange_websocket_sessions', realGatewayHost: 'Not Connected' },
      sessions: {
        total: Number(agg.sessions ?? 0),
        connected: agg.connected === null ? null : Number(agg.connected),
        disconnected: agg.disconnected === null ? null : Number(agg.disconnected),
        distinctUsers: Number(agg.distinct_users ?? 0),
        reconnects: agg.reconnects === null ? null : Number(agg.reconnects),
        byStatus,
      },
      lastConnectedAt: agg.last_connected_at === null ? null : Number(agg.last_connected_at),
      lastDisconnectedAt: agg.last_disconnected_at === null ? null : Number(agg.last_disconnected_at),
      freshness: { ageMs, staleThresholdMs, stale: ageMs === null ? null : ageMs > staleThresholdMs, state: ageMs === null ? 'EMPTY' : ageMs > staleThresholdMs ? 'STALE' : 'FRESH' },
      mockGateway: await this.mockGatewayState(),
      unavailable: ['messageRate', 'duplicateMessages', 'gapFill', 'queueDepth', 'backPressure', 'circuitBreaker', 'subscribedSymbols'],
      readOnly: true,
    };
  }

  // ---- AI policy (live_execution_enabled stays 0 by DB CHECK; no raw prompt persisted) ----
  async seedAiPolicy(id = 'default') {
    await this.pool.query(
      `INSERT INTO ai_policy (id, live_execution_enabled, max_output_tokens, daily_cost_limit_micros, allowed_tools_json, version, updated_at)
       VALUES ($1,0,1024,0,'[]',0,$2) ON CONFLICT (id) DO NOTHING`,
      [id, this.now()],
    );
  }
  async getAiPolicy(id = 'default'): Promise<Record<string, unknown> | null> {
    const r = await this.pool.query(
      `SELECT id, live_execution_enabled, max_output_tokens, daily_cost_limit_micros, allowed_tools_json,
              system_prompt_digest, system_prompt_algo, system_prompt_len, prompt_version, version, updated_by, updated_at
       FROM ai_policy WHERE id=$1`,
      [id],
    );
    return r.rows[0] ?? null;
  }
  async updateAiPolicy(input: Parameters<IAdminRepo['updateAiPolicy']>[0], version: number, by: string, opts: { reason?: string; correlationId?: string; id?: string } = {}): Promise<{ ok: boolean; conflict?: boolean; policy?: Record<string, unknown> }> {
    const id = opts.id ?? 'default';
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const before = (await client.query('SELECT id, live_execution_enabled, max_output_tokens, daily_cost_limit_micros, allowed_tools_json, system_prompt_digest, system_prompt_algo, system_prompt_len, prompt_version, version, updated_by, updated_at FROM ai_policy WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!before) { await client.query('ROLLBACK'); return { ok: false }; }
      if (Number(before.version) !== version) { await client.query('ROLLBACK'); return { ok: false, conflict: true }; }
      const t = this.now();
      await client.query(
        `UPDATE ai_policy SET max_output_tokens=$1, daily_cost_limit_micros=$2, allowed_tools_json=$3,
                system_prompt_digest=COALESCE($4, system_prompt_digest),
                system_prompt_algo=COALESCE($5, system_prompt_algo),
                system_prompt_len=COALESCE($6, system_prompt_len),
                prompt_version=COALESCE($7, prompt_version),
                version=version+1, updated_by=$8, updated_at=$9
         WHERE id=$10 AND version=$11`,
        [input.maxOutputTokens, input.dailyCostLimitMicros, JSON.stringify(input.allowedTools), input.promptDigest ?? null, input.promptAlgo ?? null, input.promptLen ?? null, input.promptVersion ?? null, by, t, id, version],
      );
      const after = (await client.query('SELECT id, live_execution_enabled, max_output_tokens, daily_cost_limit_micros, allowed_tools_json, system_prompt_digest, system_prompt_algo, system_prompt_len, prompt_version, version, updated_by, updated_at FROM ai_policy WHERE id=$1', [id])).rows[0];
      await client.query('INSERT INTO ai_policy_history (id,policy_id,before_json,after_json,reason,changed_by,correlation_id,at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), id, JSON.stringify(before), JSON.stringify(after), opts.reason ?? null, by, opts.correlationId ?? null, t]);
      await client.query('COMMIT');
      return { ok: true, policy: after ?? undefined };
    } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
  }
  async countAiPolicyHistory(id = 'default') { return this.one('SELECT COUNT(*) n FROM ai_policy_history WHERE policy_id=$1', [id]); }

  // ---- shared idempotency (idempotency_records.result JSONB, created_at TIMESTAMPTZ) ----
  async findIdempotent(key: string, scope: string): Promise<{ result: string | null; created_at: number } | null> {
    const r = await this.pool.query('SELECT result::text AS result, (EXTRACT(EPOCH FROM created_at)*1000)::bigint AS created_at FROM idempotency_records WHERE idempotency_key=$1 AND scope=$2', [key, scope]);
    return r.rows[0] ? { result: r.rows[0].result ?? null, created_at: Number(r.rows[0].created_at) } : null;
  }
  async claimIdempotent(key: string, scope: string, userId: string): Promise<boolean> {
    const r = await this.pool.query('INSERT INTO idempotency_records (idempotency_key,user_id,scope,result,created_at) VALUES ($1,$2,$3,NULL,now()) ON CONFLICT (idempotency_key) DO NOTHING', [key, userId, scope]);
    return (r.rowCount ?? 0) > 0;
  }
  async storeIdempotentResult(key: string, scope: string, result: unknown): Promise<void> {
    await this.pool.query('UPDATE idempotency_records SET result=$1::jsonb WHERE idempotency_key=$2 AND scope=$3', [JSON.stringify(result), key, scope]);
  }
}
