import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename } from 'node:path';
import type { DB } from './sqlite';

/**
 * SQLite admin repository (docs PHASE5-12). Admin data separate from user data. Optimistic locking via
 * `version`. `admin_actions` is append-only (the app never updates/deletes it). No secrets stored.
 */
export interface AdminActionInput {
  actorUserId: string; actorRole: string; action: string; resource: string; resourceId?: string | null;
  targetUserId?: string | null; result: 'success' | 'failure'; riskLevel?: 'low' | 'medium' | 'high';
  ip?: string | null; correlationId?: string | null; before?: unknown; after?: unknown; reason?: string | null;
}

export class SqliteAdminRepo {
  constructor(private readonly db: DB, private readonly now: () => number = Date.now) {}

  // ---- append-only admin audit ----
  recordAction(a: AdminActionInput): void {
    this.db.prepare(
      `INSERT INTO admin_actions (id,actor_user_id,actor_role,action,resource,resource_id,target_user_id,result,risk_level,ip,correlation_id,before_json,after_json,reason,at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(randomUUID(), a.actorUserId, a.actorRole, a.action, a.resource, a.resourceId ?? null, a.targetUserId ?? null, a.result, a.riskLevel ?? 'low', a.ip ?? null, a.correlationId ?? null,
      a.before === undefined ? null : JSON.stringify(a.before), a.after === undefined ? null : JSON.stringify(a.after), a.reason ?? null, this.now());
  }
  listAudit(q: { actorId?: string; userId?: string; action?: string; resource?: string; result?: string; from?: number; to?: number; limit: number; offset: number }): unknown[] {
    const w: string[] = []; const p: unknown[] = [];
    if (q.actorId) { w.push('actor_user_id=?'); p.push(q.actorId); }
    if (q.userId) { w.push('target_user_id=?'); p.push(q.userId); }
    if (q.action) { w.push('action=?'); p.push(q.action); }
    if (q.resource) { w.push('resource=?'); p.push(q.resource); }
    if (q.result) { w.push('result=?'); p.push(q.result); }
    if (q.from) { w.push('at>=?'); p.push(q.from); }
    if (q.to) { w.push('at<=?'); p.push(q.to); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    p.push(q.limit, q.offset);
    return this.db.prepare(`SELECT id,actor_user_id,actor_role,action,resource,resource_id,target_user_id,result,risk_level,ip,correlation_id,reason,at FROM admin_actions ${where} ORDER BY at DESC LIMIT ? OFFSET ?`).all(...p);
  }

  /** Total matching audit rows, so the explorer shows a real count rather than "unknown". */
  countAudit(q: Parameters<SqliteAdminRepo['listAudit']>[0]): number {
    const w: string[] = []; const p: unknown[] = [];
    if (q.actorId) { w.push('actor_user_id=?'); p.push(q.actorId); }
    if (q.userId) { w.push('target_user_id=?'); p.push(q.userId); }
    if (q.action) { w.push('action=?'); p.push(q.action); }
    if (q.resource) { w.push('resource=?'); p.push(q.resource); }
    if (q.result) { w.push('result=?'); p.push(q.result); }
    if (q.from) { w.push('at>=?'); p.push(q.from); }
    if (q.to) { w.push('at<=?'); p.push(q.to); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    return Number((this.db.prepare(`SELECT COUNT(*) n FROM admin_actions ${where}`).get(...p) as { n: number }).n);
  }

  // ---- orders / positions (READ-ONLY; parameterized) ----
  /**
   * Admin order search.
   *
   * `GET /admin/orders` previously returned a hard-coded `[]` even though the `orders` table from
   * migration 0003 was right there — the route never queried its own data source. This is a SELECT
   * only: there is no admin write path to orders anywhere, by policy.
   *
   * `email` is joined in so the console can filter by user without exposing user ids as the only
   * handle. No credential material is selected (`credential_id` is deliberately omitted).
   */
  searchOrders(q: {
    q?: string;
    symbol?: string;
    side?: string;
    status?: string;
    type?: string;
    mode?: string;
    userId?: string;
    from?: number;
    to?: number;
    limit: number;
    offset: number;
  }): unknown[] {
    const w: string[] = [];
    const p: unknown[] = [];
    if (q.q) { w.push('(o.symbol LIKE ? OR o.internal_order_id LIKE ? OR u.email LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
    if (q.symbol) { w.push('o.symbol=?'); p.push(q.symbol); }
    if (q.side) { w.push('o.side=?'); p.push(q.side); }
    if (q.status) { w.push('o.status=?'); p.push(q.status); }
    if (q.type) { w.push('o.type=?'); p.push(q.type); }
    if (q.mode) { w.push('o.mode=?'); p.push(q.mode); }
    if (q.userId) { w.push('o.user_id=?'); p.push(q.userId); }
    if (q.from) { w.push('o.created_at>=?'); p.push(q.from); }
    if (q.to) { w.push('o.created_at<=?'); p.push(q.to); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    p.push(q.limit, q.offset);
    return this.db
      .prepare(
        `SELECT o.internal_order_id, o.client_order_id, o.exchange_order_id, o.correlation_id,
                o.user_id, u.email AS user_email, o.symbol, o.side, o.type, o.price, o.quantity,
                o.filled_quantity, o.status, o.mode, o.created_at, o.updated_at
         FROM orders o LEFT JOIN users u ON u.id = o.user_id
         ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...p);
  }

  /** Total matching orders, so the table can show a real count instead of "unknown". */
  countOrders(q: Parameters<SqliteAdminRepo['searchOrders']>[0]): number {
    const w: string[] = [];
    const p: unknown[] = [];
    if (q.q) { w.push('(o.symbol LIKE ? OR o.internal_order_id LIKE ? OR u.email LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
    if (q.symbol) { w.push('o.symbol=?'); p.push(q.symbol); }
    if (q.side) { w.push('o.side=?'); p.push(q.side); }
    if (q.status) { w.push('o.status=?'); p.push(q.status); }
    if (q.type) { w.push('o.type=?'); p.push(q.type); }
    if (q.mode) { w.push('o.mode=?'); p.push(q.mode); }
    if (q.userId) { w.push('o.user_id=?'); p.push(q.userId); }
    if (q.from) { w.push('o.created_at>=?'); p.push(q.from); }
    if (q.to) { w.push('o.created_at<=?'); p.push(q.to); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    return Number(
      (this.db
        .prepare(`SELECT COUNT(*) n FROM orders o LEFT JOIN users u ON u.id = o.user_id ${where}`)
        .get(...p) as { n: number }).n,
    );
  }

  /** Admin position search — SELECT only; no close/leverage/margin write path exists. */
  searchPositions(q: { q?: string; symbol?: string; side?: string; userId?: string; limit: number; offset: number }): unknown[] {
    const w: string[] = [];
    const p: unknown[] = [];
    if (q.q) { w.push('(p.symbol LIKE ? OR u.email LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`); }
    if (q.symbol) { w.push('p.symbol=?'); p.push(q.symbol); }
    if (q.side) { w.push('p.side=?'); p.push(q.side); }
    if (q.userId) { w.push('p.user_id=?'); p.push(q.userId); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    p.push(q.limit, q.offset);
    return this.db
      .prepare(
        `SELECT p.id, p.user_id, u.email AS user_email, p.symbol, p.side, p.size, p.entry_price,
                p.mark_price, p.liquidation_price, p.leverage, p.margin_mode, p.unrealized_pnl, p.updated_at
         FROM positions p LEFT JOIN users u ON u.id = p.user_id
         ${where} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...p);
  }

  countPositions(q: Parameters<SqliteAdminRepo['searchPositions']>[0]): number {
    const w: string[] = [];
    const p: unknown[] = [];
    if (q.q) { w.push('(p.symbol LIKE ? OR u.email LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`); }
    if (q.symbol) { w.push('p.symbol=?'); p.push(q.symbol); }
    if (q.side) { w.push('p.side=?'); p.push(q.side); }
    if (q.userId) { w.push('p.user_id=?'); p.push(q.userId); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    return Number(
      (this.db
        .prepare(`SELECT COUNT(*) n FROM positions p LEFT JOIN users u ON u.id = p.user_id ${where}`)
        .get(...p) as { n: number }).n,
    );
  }

  // ---- AI ops (READ-ONLY; parameterized) ----
  /**
   * AI run list.
   *
   * `GET /admin/ai/usage` reported only a provider name even though `ai_runs`, `ai_usage_records` and
   * `ai_tool_calls` (migration 0004) were populated. Prompt/response text is deliberately NOT selected:
   * an operator must not be able to read a user's conversation from the console. Token counts, cost,
   * model, fallback and tool-call COUNT are the operational signal.
   */
  searchAiRuns(q: { q?: string; provider?: string; model?: string; status?: string; statusIn?: readonly string[]; userId?: string; from?: number; to?: number; limit: number; offset: number }): unknown[] {
    const w: string[] = [];
    const p: unknown[] = [];
    if (q.q) { w.push('(r.model LIKE ? OR r.provider LIKE ? OR u.email LIKE ? OR r.correlation_id LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
    if (q.provider) { w.push('r.provider=?'); p.push(q.provider); }
    if (q.model) { w.push('r.model=?'); p.push(q.model); }
    if (q.status) { w.push('r.status=?'); p.push(q.status); }
    // Status FAMILY filter (used by /admin/ai/errors). Placeholders are generated from the array LENGTH,
    // so the caller's strings are still bound parameters and never interpolated into the SQL.
    if (q.statusIn && q.statusIn.length > 0) { w.push(`r.status IN (${q.statusIn.map(() => '?').join(',')})`); p.push(...q.statusIn); }
    if (q.userId) { w.push('r.user_id=?'); p.push(q.userId); }
    if (q.from) { w.push('r.created_at>=?'); p.push(q.from); }
    if (q.to) { w.push('r.created_at<=?'); p.push(q.to); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    p.push(q.limit, q.offset);
    return this.db
      .prepare(
        `SELECT r.id, r.user_id, u.email AS user_email, r.provider, r.model, r.prompt_version,
                r.fallback_used, r.status, r.correlation_id, r.created_at,
                (SELECT COUNT(*) FROM ai_tool_calls tc WHERE tc.run_id = r.id) AS tool_calls,
                (SELECT SUM(input_tokens) FROM ai_usage_records ur WHERE ur.correlation_id = r.correlation_id) AS input_tokens,
                (SELECT SUM(output_tokens) FROM ai_usage_records ur WHERE ur.correlation_id = r.correlation_id) AS output_tokens,
                (SELECT SUM(estimated_cost_micros) FROM ai_usage_records ur WHERE ur.correlation_id = r.correlation_id) AS estimated_cost_micros
         FROM ai_runs r LEFT JOIN users u ON u.id = r.user_id
         ${where} ORDER BY r.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...p);
  }

  countAiRuns(q: Parameters<SqliteAdminRepo['searchAiRuns']>[0]): number {
    const w: string[] = [];
    const p: unknown[] = [];
    if (q.q) { w.push('(r.model LIKE ? OR r.provider LIKE ? OR u.email LIKE ? OR r.correlation_id LIKE ?)'); p.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
    if (q.provider) { w.push('r.provider=?'); p.push(q.provider); }
    if (q.model) { w.push('r.model=?'); p.push(q.model); }
    if (q.status) { w.push('r.status=?'); p.push(q.status); }
    if (q.statusIn && q.statusIn.length > 0) { w.push(`r.status IN (${q.statusIn.map(() => '?').join(',')})`); p.push(...q.statusIn); }
    if (q.userId) { w.push('r.user_id=?'); p.push(q.userId); }
    if (q.from) { w.push('r.created_at>=?'); p.push(q.from); }
    if (q.to) { w.push('r.created_at<=?'); p.push(q.to); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    return Number(
      (this.db.prepare(`SELECT COUNT(*) n FROM ai_runs r LEFT JOIN users u ON u.id = r.user_id ${where}`).get(...p) as { n: number }).n,
    );
  }

  /** Aggregate AI usage. Returns nulls (not zeros) when there is nothing recorded. */
  aiUsageSummary(): Record<string, number | null> {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS records, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
                SUM(estimated_cost_micros) AS estimated_cost_micros, SUM(actual_cost_micros) AS actual_cost_micros,
                SUM(fallback_used) AS fallback_count
         FROM ai_usage_records`,
      )
      .get() as Record<string, number | null>;
    return row;
  }

  // ---- exchange / gateway (READ-ONLY; no secret material selected) ----
  /**
   * Exchange connection list.
   *
   * `credential_id` is exposed only as a masked tail so an operator can correlate rows, and the
   * `exchange_credentials` table (which holds the encrypted secret) is never joined.
   */
  searchExchangeConnections(q: { limit: number; offset: number }): unknown[] {
    return this.db
      .prepare(
        `SELECT ec.id, ec.user_id, u.email AS user_email, ec.mode, ec.status,
                ec.created_at, ec.updated_at,
                '…' || substr(ec.credential_id, -4) AS credential_ref
         FROM exchange_connections ec LEFT JOIN users u ON u.id = ec.user_id
         ORDER BY ec.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .all(q.limit, q.offset);
  }

  countExchangeConnections(): number {
    return Number((this.db.prepare('SELECT COUNT(*) n FROM exchange_connections').get() as { n: number }).n);
  }

  /** Private websocket session health, aggregated. Nulls mean "nothing recorded", not "zero". */
  gatewaySummary(): Record<string, number | string | null> {
    const ws = this.db
      .prepare(
        `SELECT COUNT(*) AS sessions,
                SUM(CASE WHEN status='connected' THEN 1 ELSE 0 END) AS connected,
                SUM(reconnects) AS reconnects,
                MAX(connected_at) AS last_connected_at,
                MAX(disconnected_at) AS last_disconnected_at
         FROM exchange_websocket_sessions`,
      )
      .get() as Record<string, number | null>;
    return ws;
  }

  // ---- users (parameterized; SQLi-safe) ----
  searchUsers(q: { q?: string; status?: string; role?: string; limit: number; offset: number }): unknown[] {
    const w: string[] = []; const p: unknown[] = [];
    if (q.q) { w.push('email LIKE ?'); p.push(`%${q.q}%`); }
    if (q.status) { w.push('status=?'); p.push(q.status); }
    if (q.role) { w.push('role=?'); p.push(q.role); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    p.push(q.limit, q.offset);
    return this.db.prepare(`SELECT id,email,role,status,mfa_enabled,created_at,updated_at FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...p);
  }
  countUsers(q: { q?: string; status?: string; role?: string }): { total: number; byStatus: Record<string, number>; byRole: Record<string, number> } {
    const w: string[] = []; const p: unknown[] = [];
    if (q.q) { w.push('email LIKE ?'); p.push(`%${q.q}%`); }
    if (q.status) { w.push('status=?'); p.push(q.status); }
    if (q.role) { w.push('role=?'); p.push(q.role); }
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    // One grouped scan so the breakdowns always add up to the total.
    const rows = this.db.prepare(`SELECT status, role, COUNT(*) n FROM users ${where} GROUP BY status, role`).all(...p) as { status: string; role: string; n: number }[];
    let total = 0; const byStatus: Record<string, number> = {}; const byRole: Record<string, number> = {};
    for (const r of rows) {
      const n = Number(r.n);
      total += n;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + n;
      byRole[r.role] = (byRole[r.role] ?? 0) + n;
    }
    return { total, byStatus, byRole };
  }
  getUser(id: string): { id: string; email: string; role: string; status: string; mfa_enabled: number } | undefined {
    return this.db.prepare('SELECT id,email,role,status,mfa_enabled,created_at,updated_at FROM users WHERE id=?').get(id) as never;
  }
  userStats(id: string): Record<string, number> {
    const one = (sql: string) => { try { return Number((this.db.prepare(sql).get(id) as { n: number }).n); } catch { return 0; } };
    return {
      sessions: one('SELECT COUNT(*) n FROM sessions WHERE user_id=?'),
      aiConversations: one('SELECT COUNT(*) n FROM ai_conversations WHERE user_id=?'),
      aiSignals: one('SELECT COUNT(*) n FROM ai_signals WHERE user_id=?'),
      orders: one('SELECT COUNT(*) n FROM orders WHERE user_id=?'),
      exchangeCredentials: one('SELECT COUNT(*) n FROM exchange_credentials WHERE user_id=? AND revoked_at IS NULL'),
    };
  }
  activeSuperAdminIds(): string[] {
    return (this.db.prepare("SELECT id FROM users WHERE role='SUPER_ADMIN' AND status='active'").all() as { id: string }[]).map((r) => r.id);
  }
  setUserStatus(id: string, status: 'active' | 'disabled'): boolean {
    return this.db.prepare('UPDATE users SET status=?, updated_at=? WHERE id=?').run(status, this.now(), id).changes > 0;
  }
  setUserRole(id: string, role: string): boolean {
    return this.db.prepare('UPDATE users SET role=?, updated_at=? WHERE id=?').run(role, this.now(), id).changes > 0;
  }
  revokeUserSessions(id: string): number {
    return this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id).changes;
  }

  /**
   * 2단계 인증 자격 삭제 (SQLite 개발 백엔드).
   *
   * ★ 운영은 Postgres 를 강제하므로(repository-factory) 이 구현은 개발·테스트용이다.
   *   그래도 인터페이스를 만족해야 하고, 개발 중에도 같은 동작이어야 한다 —
   *   두 백엔드가 다르게 동작하면 개발에서 통과한 것이 운영에서 깨진다.
   *
   * ★ credential 과 users.mfa_enabled 를 함께 바꾼다. 하나만 바꾸면
   *   "MFA 필요한데 검증할 secret 이 없는" 상태가 되어 로그인이 영구히 막힌다.
   */
  /**
   * 회원 삭제 + 법정 보관분 분리 보관 (SQLite 개발 백엔드).
   *
   * ★ 운영은 Postgres 를 강제한다(repository-factory 가 fail-closed). 이 구현은
   *   개발·테스트용이지만 **동작이 같아야** 한다 — 두 백엔드가 다르면 개발에서
   *   통과한 삭제가 운영에서 다르게 끝난다.
   *
   * ★ 분리 보관 테이블이 없는 개발 DB 가 있을 수 있다(SQLite 마이그레이션은
   *   0011 까지만 있다). 그 경우 **삭제를 진행하지 않고 null 을 돌려준다.**
   *   보관하지 못하는 상태에서 지우면 방침이 보관하겠다고 한 자료가 사라진다.
   */
  deleteUserWithRetention(input: {
    userId: string;
    requestedBy: 'self' | 'admin';
    actorUserId?: string | null;
    actorEmail?: string | null;
    reason: string;
  }): { deleted: boolean; retainedConsents: number; retainedOrders: number } | null {
    const hasTable = (name: string): boolean => {
      const r = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
      return Boolean(r);
    };
    // 보관할 곳이 없으면 지우지 않는다(위 주석).
    if (!hasTable('retained_legal_consents') || !hasTable('retained_orders') || !hasTable('user_deletion_records')) {
      return null;
    }

    const tx = this.db.transaction((arg: typeof input) => {
      const row = this.db.prepare('SELECT id, email FROM users WHERE id=?').get(arg.userId) as { id: string; email: string } | undefined;
      if (!row) return null;

      const fiveYears = this.now() + 5 * 365 * 24 * 60 * 60 * 1000;

      let consents = 0;
      if (hasTable('user_legal_consents')) {
        const rows = this.db.prepare('SELECT user_id, kind, version, agreed_at FROM user_legal_consents WHERE user_id=?').all(arg.userId) as Array<Record<string, unknown>>;
        const ins = this.db.prepare(
          `INSERT INTO retained_legal_consents (id, former_user_id, former_email, kind, version, agreed_at, retained_at, retention_reason, purge_after)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        );
        for (const r of rows) {
          ins.run(randomUUID(), arg.userId, row.email, r.kind, r.version, r.agreed_at, this.now(), 'privacy policy 1 - consent proof - 5 years', fiveYears);
          consents += 1;
        }
      }

      let orders = 0;
      if (hasTable('orders')) {
        const rows = this.db.prepare(
          `SELECT internal_order_id, exchange_order_id, symbol, side, type, price, quantity,
                  filled_quantity, status, mode, created_at FROM orders WHERE user_id=?`,
        ).all(arg.userId) as Array<Record<string, unknown>>;
        const ins = this.db.prepare(
          `INSERT INTO retained_orders (id, former_user_id, former_email, internal_order_id, exchange_order_id,
             symbol, side, type, price, quantity, filled_quantity, status, mode, ordered_at,
             retained_at, retention_reason, purge_after)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        );
        for (const r of rows) {
          ins.run(randomUUID(), arg.userId, row.email, r.internal_order_id, r.exchange_order_id,
            r.symbol, r.side, r.type, r.price, r.quantity, r.filled_quantity, r.status, r.mode, r.created_at,
            this.now(), 'privacy policy 1 - trade history - 5 years', fiveYears);
          orders += 1;
        }
      }

      // ★ 계정을 지우기 전에 처리 기록을 남긴다.
      this.db.prepare(
        `INSERT INTO user_deletion_records (id, former_user_id, former_email, requested_by,
           actor_user_id, actor_email, reason, retained_consents, retained_orders, deleted_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(randomUUID(), arg.userId, row.email, arg.requestedBy, arg.actorUserId ?? null,
        arg.actorEmail ?? null, arg.reason, consents, orders, this.now());

      const changes = this.db.prepare('DELETE FROM users WHERE id=?').run(arg.userId).changes;
      return { deleted: changes > 0, retainedConsents: consents, retainedOrders: orders };
    });

    return tx(input) as { deleted: boolean; retainedConsents: number; retainedOrders: number } | null;
  }

  /*
     ---- 관리자 노트 (SQLite 개발 백엔드) ----

     ★ 운영은 Postgres 를 강제하지만(repository-factory) 인터페이스를 만족해야
       하고 개발에서도 같은 동작이어야 한다.
     ★ 테이블이 없으면(SQLite 마이그레이션은 0011 까지) 빈 결과·실패를 돌려준다.
       조용히 성공으로 답하면 저장된 줄 알고 넘어간다.
  */
  private hasNotesTable(): boolean {
    return Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_user_notes'").get());
  }

  listUserNotes(userId: string): Array<{ id: string; body: string; author_email: string | null; created_at: string | number; updated_at: string | number }> {
    if (!this.hasNotesTable()) return [];
    return this.db.prepare(
      'SELECT id, body, author_email, created_at, updated_at FROM admin_user_notes WHERE user_id=? ORDER BY created_at DESC LIMIT 200',
    ).all(userId) as Array<{ id: string; body: string; author_email: string | null; created_at: string | number; updated_at: string | number }>;
  }

  addUserNote(input: { userId: string; authorUserId: string; authorEmail: string; body: string }): { id: string } | null {
    if (!this.hasNotesTable()) return null;
    const body = String(input.body ?? '').trim();
    if (!body || body.length > 4000) return null;
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO admin_user_notes (id, user_id, author_user_id, author_email, body, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(id, input.userId, input.authorUserId, input.authorEmail, body, this.now(), this.now());
    return { id };
  }

  deleteUserNote(input: { noteId: string; userId: string }): boolean {
    if (!this.hasNotesTable()) return false;
    // ★ user_id 를 조건에 넣는다 — id 만으로 지우면 남의 노트를 지울 수 있다.
    return this.db.prepare('DELETE FROM admin_user_notes WHERE id=? AND user_id=?')
      .run(input.noteId, input.userId).changes > 0;
  }

  /** 이메일 변경 (SQLite 개발 백엔드). 동작은 Postgres 쪽과 같아야 한다. */
  setUserEmail(input: { userId: string; email: string }): 'ok' | 'taken' | 'not_found' {
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!email) return 'not_found';
    // 중복은 결과로 다룬다(오류로 흘리면 500 이 되고 원인을 알 수 없다).
    const dup = this.db.prepare('SELECT id FROM users WHERE lower(email)=? AND id<>?').get(email, input.userId);
    if (dup) return 'taken';
    // ★ email_verified 를 되돌린다 — 새 주소는 아직 증명되지 않았다.
    const changes = this.db.prepare('UPDATE users SET email=?, email_verified=0 WHERE id=?')
      .run(email, input.userId).changes;
    return changes > 0 ? 'ok' : 'not_found';
  }

  clearUserMfa(id: string): boolean {
    const tx = this.db.transaction((uid: string) => {
      const changes = this.db.prepare('DELETE FROM mfa_credentials WHERE user_id=?').run(uid).changes;
      // 진행 중 챌린지도 지운다(남기면 예전 시도가 유효한 채로 남는다).
      try { this.db.prepare('DELETE FROM mfa_challenges WHERE user_id=?').run(uid); } catch { /* 테이블 없을 수 있다 */ }
      this.db.prepare('UPDATE users SET mfa_enabled=0 WHERE id=?').run(uid);
      return changes > 0;
    });
    return tx(id) as boolean;
  }

  // ---- feature flags (optimistic lock + history) ----
  seedFlag(key: string, enabled: boolean, description: string): void {
    this.db.prepare('INSERT OR IGNORE INTO feature_flags (id,key,enabled,description,version,updated_at) VALUES (?,?,?,?,0,?)').run(randomUUID(), key, enabled ? 1 : 0, description, this.now());
  }
  listFlags(): unknown[] { return this.db.prepare('SELECT id,key,enabled,description,expires_at,version,updated_by,updated_at FROM feature_flags ORDER BY key').all(); }
  updateFlag(id: string, enabled: boolean, reason: string, version: number, by: string, corr?: string): { ok: boolean; conflict?: boolean } {
    const cur = this.db.prepare('SELECT enabled,version FROM feature_flags WHERE id=?').get(id) as { enabled: number; version: number } | undefined;
    if (!cur) return { ok: false };
    if (cur.version !== version) return { ok: false, conflict: true };
    this.db.prepare('UPDATE feature_flags SET enabled=?, version=version+1, updated_by=?, updated_at=? WHERE id=? AND version=?').run(enabled ? 1 : 0, by, this.now(), id, version);
    this.db.prepare('INSERT INTO feature_flag_history (id,flag_id,before_enabled,after_enabled,reason,changed_by,correlation_id,at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), id, cur.enabled, enabled ? 1 : 0, reason, by, corr ?? null, this.now());
    return { ok: true };
  }

  // ---- kill switches (optimistic lock + history; fail-closed read handled by caller) ----
  seedKill(scope: string, target: string | null, active: boolean): void {
    this.db.prepare('INSERT OR IGNORE INTO kill_switches (id,scope,target,active,version,updated_at) VALUES (?,?,?,?,0,?)').run(randomUUID(), scope, target, active ? 1 : 0, this.now());
  }
  listKill(): unknown[] { return this.db.prepare('SELECT id,scope,target,active,allow_cancel_reduce,reason,expires_at,version,updated_by,updated_at FROM kill_switches ORDER BY scope').all(); }
  getKill(id: string): { id: string; scope: string; active: number; version: number } | undefined { return this.db.prepare('SELECT id,scope,active,version FROM kill_switches WHERE id=?').get(id) as never; }
  updateKill(id: string, active: boolean, reason: string, version: number, by: string, corr?: string): { ok: boolean; conflict?: boolean } {
    const cur = this.db.prepare('SELECT active,version FROM kill_switches WHERE id=?').get(id) as { active: number; version: number } | undefined;
    if (!cur) return { ok: false };
    if (cur.version !== version) return { ok: false, conflict: true };
    this.db.prepare('UPDATE kill_switches SET active=?, reason=?, version=version+1, updated_by=?, updated_at=? WHERE id=? AND version=?').run(active ? 1 : 0, reason, by, this.now(), id, version);
    this.db.prepare('INSERT INTO kill_switch_history (id,kill_switch_id,before_active,after_active,reason,changed_by,correlation_id,at) VALUES (?,?,?,?,?,?,?,?)').run(randomUUID(), id, cur.active, active ? 1 : 0, reason, by, corr ?? null, this.now());
    return { ok: true };
  }

  // ---- incidents (optimistic lock + events) ----
  createIncident(i: { title: string; description: string; severity: string; service: string; impact?: string; by: string }): string {
    const id = randomUUID(); const t = this.now();
    this.db.prepare('INSERT INTO incidents (id,title,description,severity,service,status,impact,version,detected_at,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,?,?,?,?)')
      .run(id, i.title, i.description, i.severity, i.service, 'OPEN', i.impact ?? null, t, i.by, t, t);
    this.db.prepare('INSERT INTO incident_events (id,incident_id,kind,note,actor,at) VALUES (?,?,?,?,?,?)').run(randomUUID(), id, 'created', i.title, i.by, t);
    return id;
  }
  listIncidents(): unknown[] { return this.db.prepare('SELECT id,title,severity,service,status,owner,version,acknowledged_at,acknowledged_by,detected_at,created_at,updated_at FROM incidents ORDER BY created_at DESC LIMIT 200').all(); }
  getIncident(id: string): { id: string; status: string; version: number } | undefined { return this.db.prepare('SELECT id,status,version FROM incidents WHERE id=?').get(id) as never; }
  updateIncident(id: string, patch: Record<string, string | undefined>, version: number, by: string): { ok: boolean; conflict?: boolean } {
    const cur = this.db.prepare('SELECT version FROM incidents WHERE id=?').get(id) as { version: number } | undefined;
    if (!cur) return { ok: false };
    if (cur.version !== version) return { ok: false, conflict: true };
    const cols = ['status', 'severity', 'owner', 'root_cause', 'mitigation', 'resolution'] as const;
    const map: Record<string, string | undefined> = { status: patch.status, severity: patch.severity, owner: patch.owner, root_cause: patch.rootCause, mitigation: patch.mitigation, resolution: patch.resolution };
    const set = cols.filter((c) => map[c] !== undefined).map((c) => `${c}=?`);
    const vals = cols.filter((c) => map[c] !== undefined).map((c) => map[c]);
    this.db.prepare(`UPDATE incidents SET ${[...set, 'version=version+1', 'updated_at=?'].join(', ')} WHERE id=? AND version=?`).run(...vals, this.now(), id, version);
    this.db.prepare('INSERT INTO incident_events (id,incident_id,kind,note,actor,at) VALUES (?,?,?,?,?,?)').run(randomUUID(), id, 'update', patch.note ?? patch.status ?? 'update', by, this.now());
    return { ok: true };
  }

  // ---- release gates (optimistic lock + evidence) ----
  seedGate(g: { key: string; phase: string; description: string; status: string; productionRequired: boolean; owner?: string; exitCriteria?: string }): void {
    this.db.prepare('INSERT OR IGNORE INTO release_gates (id,gate_key,phase,description,owner,exit_criteria,status,production_required,version,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?)')
      .run(randomUUID(), g.key, g.phase, g.description, g.owner ?? null, g.exitCriteria ?? null, g.status, g.productionRequired ? 1 : 0, this.now());
  }
  listGates(): unknown[] { return this.db.prepare('SELECT id,gate_key,phase,description,owner,exit_criteria,status,production_required,reason,approved_by,expires_at,version,updated_at FROM release_gates ORDER BY phase,gate_key').all(); }
  getGate(id: string): { id: string; status: string; production_required: number; version: number } | undefined { return this.db.prepare('SELECT id,status,production_required,version FROM release_gates WHERE id=?').get(id) as never; }
  hasEvidence(id: string): boolean { return Number((this.db.prepare('SELECT COUNT(*) n FROM release_gate_evidence WHERE gate_id=?').get(id) as { n: number }).n) > 0; }
  updateGate(id: string, status: string, version: number, by: string, opts: { reason?: string; expiresAt?: number; evidencePath?: string }): { ok: boolean; conflict?: boolean } {
    const cur = this.db.prepare('SELECT version FROM release_gates WHERE id=?').get(id) as { version: number } | undefined;
    if (!cur) return { ok: false };
    if (cur.version !== version) return { ok: false, conflict: true };
    if (opts.evidencePath) this.db.prepare('INSERT INTO release_gate_evidence (id,gate_id,evidence_path,added_by,at) VALUES (?,?,?,?,?)').run(randomUUID(), id, opts.evidencePath, by, this.now());
    this.db.prepare('UPDATE release_gates SET status=?, reason=?, approved_by=?, expires_at=?, version=version+1, updated_at=? WHERE id=? AND version=?')
      .run(status, opts.reason ?? null, by, opts.expiresAt ?? null, this.now(), id, version);
    return { ok: true };
  }

  // =========================================================================
  // Prompt 5 / B7 — admin operational contracts
  // =========================================================================

  // ---- ADM-API-13 security summary + account unlock ----

  /**
   * Security posture, AGGREGATE COUNTS ONLY.
   *
   * Nothing that could identify or reconstruct a credential is selected. `mfa_credentials` is touched
   * only through `COUNT`/`SUM`, so no encrypted secret, pending secret, otpauth URI, QR payload or
   * recovery-code hash can reach a response derived from this method — the columns are never in the
   * projection at all. `users.password_hash` is likewise never selected.
   *
   * A count that cannot be computed is reported as `null` and named in `unavailable`, never as 0: a
   * fabricated "0 locked accounts" is a clean bill of health for the platform's security posture, which
   * is the single worst place to guess.
   */
  securitySummary(): Record<string, unknown> {
    const t = this.now();
    const dayAgo = t - 24 * 60 * 60 * 1000;
    const n = (sql: string, ...p: unknown[]): number =>
      Number((this.db.prepare(sql).get(...p) as { n: number }).n);
    const nullable = (sql: string, ...p: unknown[]): number | null => {
      try { return n(sql, ...p); } catch { return null; }
    };

    const usersTotal = n('SELECT COUNT(*) n FROM users');
    const mfaCredentialsEnabled = nullable('SELECT COUNT(*) n FROM mfa_credentials WHERE enabled=1');

    // `auth.login` outcomes live in the Phase-2 audit log as a JSON `meta.result`. Counted with
    // json_extract rather than a LIKE over the blob so a message that merely CONTAINS the word cannot be
    // miscounted as an outcome.
    const loginCount = (result: string) =>
      nullable(
        "SELECT COUNT(*) n FROM audit_logs WHERE action='auth.login' AND at>=? AND json_extract(meta,'$.result')=?",
        dayAgo,
        result,
      );

    return {
      generatedAt: t,
      source: {
        tables: ['users', 'mfa_credentials', 'mfa_challenges', 'sessions', 'account_lockouts', 'audit_logs', 'admin_actions'],
        scope: 'LOCAL_DB',
        aggregatesOnly: true,
      },
      users: {
        total: usersTotal,
        active: n("SELECT COUNT(*) n FROM users WHERE status='active'"),
        disabled: n("SELECT COUNT(*) n FROM users WHERE status='disabled'"),
        statusLocked: n("SELECT COUNT(*) n FROM users WHERE status='locked'"),
        adminRoles: n("SELECT COUNT(*) n FROM users WHERE role IN ('SUPPORT','ANALYST','ADMIN','SUPER_ADMIN')"),
      },
      mfa: {
        // Two different facts, reported separately on purpose: the `users.mfa_enabled` flag and an
        // actually-activated credential can disagree, and collapsing them would hide that.
        usersFlagged: n('SELECT COUNT(*) n FROM users WHERE mfa_enabled=1'),
        credentialsEnabled: mfaCredentialsEnabled,
        pendingEnrollments: nullable('SELECT COUNT(*) n FROM mfa_credentials WHERE pending_secret_encrypted IS NOT NULL'),
        adoptionPct:
          mfaCredentialsEnabled === null || usersTotal === 0
            ? null
            : Math.round((mfaCredentialsEnabled / usersTotal) * 1000) / 10,
        pendingChallenges: nullable('SELECT COUNT(*) n FROM mfa_challenges WHERE expires_at>?', t),
      },
      lockouts: {
        activeNow: n('SELECT COUNT(*) n FROM account_lockouts WHERE locked_until>?', t),
        expired: n('SELECT COUNT(*) n FROM account_lockouts WHERE locked_until>0 AND locked_until<=?', t),
        withFailuresNotLocked: n('SELECT COUNT(*) n FROM account_lockouts WHERE fails>0 AND locked_until<=?', t),
        clearedByAdmin: n('SELECT COUNT(*) n FROM account_lockouts WHERE cleared_at IS NOT NULL'),
      },
      sessions: {
        active: n('SELECT COUNT(*) n FROM sessions WHERE expires_at>?', t),
        expiredNotReaped: n('SELECT COUNT(*) n FROM sessions WHERE expires_at<=?', t),
        distinctUsers: n('SELECT COUNT(DISTINCT user_id) n FROM sessions WHERE expires_at>?', t),
      },
      logins24h: {
        failed: loginCount('failure'),
        rateLimited: loginCount('ratelimited'),
        succeeded: loginCount('success'),
        disabledBlocked: loginCount('disabled'),
      },
      adminActions24h: {
        total: n('SELECT COUNT(*) n FROM admin_actions WHERE at>=?', dayAgo),
        failures: n("SELECT COUNT(*) n FROM admin_actions WHERE at>=? AND result='failure'", dayAgo),
        highRisk: n("SELECT COUNT(*) n FROM admin_actions WHERE at>=? AND risk_level='high'", dayAgo),
      },
      // Signals this deployment genuinely does not record. Named so the UI shows "not measured" rather
      // than a healthy zero.
      unavailable: ['totpReplayBlocked', 'recoveryCodeRedemptions', 'stepUpVerifications', 'securityAlerts'],
    };
  }

  /**
   * Accounts with lockout state. NO MFA material: the projection is the user id, the e-mail, the failure
   * counters and the timestamps. `mfa_credentials` is not joined.
   */
  listLockouts(q: { state: 'active' | 'expired' | 'any'; limit: number; offset: number }): unknown[] {
    const t = this.now();
    const p: unknown[] = [];
    let where = '';
    if (q.state === 'active') { where = 'WHERE l.locked_until>?'; p.push(t); }
    else if (q.state === 'expired') { where = 'WHERE l.locked_until>0 AND l.locked_until<=?'; p.push(t); }
    p.push(q.limit, q.offset);
    return this.db
      .prepare(
        `SELECT l.user_id, u.email AS user_email, u.status AS user_status, l.fails, l.first_fail_at,
                l.locked_until, l.source, l.version, l.updated_at, l.cleared_at, l.cleared_by
         FROM account_lockouts l LEFT JOIN users u ON u.id = l.user_id
         ${where} ORDER BY l.locked_until DESC, l.user_id ASC LIMIT ? OFFSET ?`,
      )
      .all(...p);
  }

  countLockouts(state: 'active' | 'expired' | 'any'): number {
    const t = this.now();
    if (state === 'active') return Number((this.db.prepare('SELECT COUNT(*) n FROM account_lockouts WHERE locked_until>?').get(t) as { n: number }).n);
    if (state === 'expired') return Number((this.db.prepare('SELECT COUNT(*) n FROM account_lockouts WHERE locked_until>0 AND locked_until<=?').get(t) as { n: number }).n);
    return Number((this.db.prepare('SELECT COUNT(*) n FROM account_lockouts').get() as { n: number }).n);
  }

  /**
   * Clear a lockout.
   *
   * The row is UPDATED (zeroed + `cleared_at`/`cleared_by`) rather than deleted, so the fact that an
   * admin cleared a containment control survives as evidence next to the admin audit entry.
   *
   * `changed:false` is returned honestly when there was nothing to clear. Reporting a no-op as success
   * would teach an operator that the button always works, which is exactly when they stop checking.
   */
  clearLockout(userId: string, actorUserId: string): { changed: boolean; before: { fails: number; lockedUntil: number } | null } {
    const cur = this.db
      .prepare('SELECT fails, locked_until FROM account_lockouts WHERE user_id=?')
      .get(userId) as { fails: number; locked_until: number } | undefined;
    if (!cur) return { changed: false, before: null };
    if (cur.fails === 0 && cur.locked_until === 0) {
      return { changed: false, before: { fails: 0, lockedUntil: 0 } };
    }
    this.db
      .prepare(
        `UPDATE account_lockouts SET fails=0, locked_until=0, version=version+1, updated_at=?,
                cleared_at=?, cleared_by=? WHERE user_id=?`,
      )
      .run(this.now(), this.now(), actorUserId, userId);
    return { changed: true, before: { fails: cur.fails, lockedUntil: cur.locked_until } };
  }

  // ---- ADM-API-12 reports ----

  /**
   * Compute a report from a SERVER-CHOSEN aggregate query set.
   *
   * The caller passes an already-allowlisted `type` (see `ADMIN_REPORT_TYPES`); this method never
   * interpolates a caller string into SQL and never falls through to a "generic" report. Every figure is
   * a COUNT/SUM over a table that already exists — no data is invented, and a table that is missing is
   * reported in `unavailable` rather than as a zero.
   */
  computeReport(type: string, window: { from: number; to: number }): { data: Record<string, unknown>; tables: string[]; rowCount: number; unavailable: string[] } {
    const unavailable: string[] = [];
    const n = (label: string, sql: string, ...p: unknown[]): number | null => {
      try { return Number((this.db.prepare(sql).get(...p) as { n: number }).n); } catch { unavailable.push(label); return null; }
    };
    const s = (label: string, sql: string, ...p: unknown[]): number | null => {
      try { const v = (this.db.prepare(sql).get(...p) as { v: number | null }).v; return v === null ? null : Number(v); } catch { unavailable.push(label); return null; }
    };
    const { from, to } = window;

    switch (type) {
      case 'daily_operations': {
        const data = {
          usersTotal: n('users', 'SELECT COUNT(*) n FROM users'),
          usersCreatedInWindow: n('users', 'SELECT COUNT(*) n FROM users WHERE created_at>=? AND created_at<=?', from, to),
          activeSessions: n('sessions', 'SELECT COUNT(*) n FROM sessions WHERE expires_at>?', this.now()),
          ordersInWindow: n('orders', 'SELECT COUNT(*) n FROM orders WHERE created_at>=? AND created_at<=?', from, to),
          adminActionsInWindow: n('admin_actions', 'SELECT COUNT(*) n FROM admin_actions WHERE at>=? AND at<=?', from, to),
          incidentsOpen: n('incidents', "SELECT COUNT(*) n FROM incidents WHERE status IN ('OPEN','INVESTIGATING')"),
          notificationsInWindow: n('notifications', 'SELECT COUNT(*) n FROM notifications WHERE created_at>=? AND created_at<=?', from, to),
        };
        return { data, tables: ['users', 'sessions', 'orders', 'admin_actions', 'incidents', 'notifications'], rowCount: Object.keys(data).length, unavailable };
      }
      case 'trading_activity': {
        const byStatus = (() => {
          try {
            return this.db
              .prepare('SELECT status, COUNT(*) AS count FROM orders WHERE created_at>=? AND created_at<=? GROUP BY status ORDER BY status')
              .all(from, to);
          } catch { unavailable.push('orders'); return []; }
        })();
        const byMode = (() => {
          try {
            return this.db
              .prepare('SELECT mode, COUNT(*) AS count FROM orders WHERE created_at>=? AND created_at<=? GROUP BY mode ORDER BY mode')
              .all(from, to);
          } catch { return []; }
        })();
        const data = {
          ordersInWindow: n('orders', 'SELECT COUNT(*) n FROM orders WHERE created_at>=? AND created_at<=?', from, to),
          ordersByStatus: byStatus,
          ordersByMode: byMode,
          executionsInWindow: n('executions', 'SELECT COUNT(*) n FROM executions WHERE at>=? AND at<=?', from, to),
          openPositions: n('positions', 'SELECT COUNT(*) n FROM positions'),
          distinctSymbols: n('orders', 'SELECT COUNT(DISTINCT symbol) n FROM orders WHERE created_at>=? AND created_at<=?', from, to),
          // Stated rather than derived: this deployment has no live order path at all (B4).
          liveOrdersExecuted: 0,
          liveOrderPathNote: 'no live submit endpoint exists in this deployment',
        };
        return { data, tables: ['orders', 'executions', 'positions'], rowCount: Object.keys(data).length, unavailable };
      }
      case 'ai_cost': {
        const data = {
          runsInWindow: n('ai_runs', 'SELECT COUNT(*) n FROM ai_runs WHERE created_at>=? AND created_at<=?', from, to),
          errorRunsInWindow: n('ai_runs', "SELECT COUNT(*) n FROM ai_runs WHERE status='error' AND created_at>=? AND created_at<=?", from, to),
          fallbackRunsInWindow: n('ai_runs', 'SELECT COUNT(*) n FROM ai_runs WHERE fallback_used=1 AND created_at>=? AND created_at<=?', from, to),
          inputTokens: s('ai_usage_records', 'SELECT SUM(input_tokens) v FROM ai_usage_records WHERE at>=? AND at<=?', from, to),
          outputTokens: s('ai_usage_records', 'SELECT SUM(output_tokens) v FROM ai_usage_records WHERE at>=? AND at<=?', from, to),
          estimatedCostMicros: s('ai_usage_records', 'SELECT SUM(estimated_cost_micros) v FROM ai_usage_records WHERE at>=? AND at<=?', from, to),
          actualCostMicros: s('ai_usage_records', 'SELECT SUM(actual_cost_micros) v FROM ai_usage_records WHERE at>=? AND at<=?', from, to),
          toolCallsInWindow: n('ai_tool_calls', 'SELECT COUNT(*) n FROM ai_tool_calls WHERE at>=? AND at<=?', from, to),
        };
        return { data, tables: ['ai_runs', 'ai_usage_records', 'ai_tool_calls'], rowCount: Object.keys(data).length, unavailable };
      }
      case 'security_posture': {
        const t = this.now();
        const data = {
          mfaCredentialsEnabled: n('mfa_credentials', 'SELECT COUNT(*) n FROM mfa_credentials WHERE enabled=1'),
          usersTotal: n('users', 'SELECT COUNT(*) n FROM users'),
          lockoutsActive: n('account_lockouts', 'SELECT COUNT(*) n FROM account_lockouts WHERE locked_until>?', t),
          failedLoginsInWindow: n('audit_logs', "SELECT COUNT(*) n FROM audit_logs WHERE action='auth.login' AND json_extract(meta,'$.result')='failure' AND at>=? AND at<=?", from, to),
          activeSessions: n('sessions', 'SELECT COUNT(*) n FROM sessions WHERE expires_at>?', t),
          highRiskAdminActionsInWindow: n('admin_actions', "SELECT COUNT(*) n FROM admin_actions WHERE risk_level='high' AND at>=? AND at<=?", from, to),
          disabledAccounts: n('users', "SELECT COUNT(*) n FROM users WHERE status='disabled'"),
        };
        return { data, tables: ['users', 'mfa_credentials', 'account_lockouts', 'audit_logs', 'sessions', 'admin_actions'], rowCount: Object.keys(data).length, unavailable };
      }
      case 'compliance_audit': {
        const byResult = (() => {
          try { return this.db.prepare('SELECT result, COUNT(*) AS count FROM admin_actions WHERE at>=? AND at<=? GROUP BY result ORDER BY result').all(from, to); }
          catch { unavailable.push('admin_actions'); return []; }
        })();
        const gates = (() => {
          try { return this.db.prepare('SELECT status, COUNT(*) AS count FROM release_gates GROUP BY status ORDER BY status').all(); }
          catch { unavailable.push('release_gates'); return []; }
        })();
        const data = {
          adminActionsInWindow: n('admin_actions', 'SELECT COUNT(*) n FROM admin_actions WHERE at>=? AND at<=?', from, to),
          adminActionsByResult: byResult,
          authAuditEntriesInWindow: n('audit_logs', 'SELECT COUNT(*) n FROM audit_logs WHERE at>=? AND at<=?', from, to),
          incidentsInWindow: n('incidents', 'SELECT COUNT(*) n FROM incidents WHERE created_at>=? AND created_at<=?', from, to),
          incidentsAcknowledged: n('incidents', 'SELECT COUNT(*) n FROM incidents WHERE acknowledged_at IS NOT NULL'),
          releaseGatesByStatus: gates,
          killSwitchesActive: n('kill_switches', 'SELECT COUNT(*) n FROM kill_switches WHERE active=1'),
        };
        return { data, tables: ['admin_actions', 'audit_logs', 'incidents', 'release_gates', 'kill_switches'], rowCount: Object.keys(data).length, unavailable };
      }
      default:
        // Unreachable: the caller validates against the allowlist first. Throwing rather than returning an
        // empty report keeps a future caller from inventing a "generic" report by accident.
        throw new Error(`unknown report type`);
    }
  }

  /** Persist a computed report as an immutable snapshot. There is no update or delete path. */
  insertReport(r: { type: string; data: Record<string, unknown>; source: Record<string, unknown>; rowCount: number; from: number; to: number; by: string }): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO admin_reports (id, report_type, source_json, data_json, row_count, window_from, window_to, generated_by, generated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(id, r.type, JSON.stringify(r.source), JSON.stringify(r.data), r.rowCount, r.from, r.to, r.by, this.now());
    return id;
  }

  listReports(q: { type?: string; limit: number; offset: number }): unknown[] {
    const p: unknown[] = [];
    let where = '';
    if (q.type) { where = 'WHERE report_type=?'; p.push(q.type); }
    p.push(q.limit, q.offset);
    // `data_json` is deliberately NOT in the list projection: a list is a list, and the payload is fetched
    // by id. Tie-broken by id so LIMIT/OFFSET paging is a total order.
    return this.db
      .prepare(
        `SELECT id, report_type, row_count, window_from, window_to, generated_by, generated_at, source_json
         FROM admin_reports ${where} ORDER BY generated_at DESC, id ASC LIMIT ? OFFSET ?`,
      )
      .all(...p);
  }

  countReports(type?: string): number {
    if (type) return Number((this.db.prepare('SELECT COUNT(*) n FROM admin_reports WHERE report_type=?').get(type) as { n: number }).n);
    return Number((this.db.prepare('SELECT COUNT(*) n FROM admin_reports').get() as { n: number }).n);
  }

  getReport(id: string): { id: string; report_type: string; row_count: number; window_from: number | null; window_to: number | null; generated_by: string; generated_at: number; source_json: string; data_json: string } | undefined {
    return this.db.prepare('SELECT * FROM admin_reports WHERE id=?').get(id) as never;
  }

  // ---- ADM-API-15 backup status (READ-ONLY) ----

  /**
   * What is ACTUALLY knowable about this deployment's durability, and nothing else.
   *
   * The store is SQLite. File presence/size/mtime, the journal mode and the last applied migration are
   * real and are reported. Managed-Postgres backup, PITR, retention, encryption-at-rest and restore
   * drills are NOT knowable from here, so they are `null` + named in `unavailable` — never a fabricated
   * "OK". The release gate's own status is read from `release_gates` so the report cannot claim a gate is
   * passed when the gate row says otherwise.
   *
   * Only the file NAME is exposed, not its absolute path: the console has no operational need for the
   * host's directory layout.
   */
  /**
   * Real facts about the database FILE.
   *
   * Only the basename is reported: the console has no operational need for the host's directory layout,
   * and an absolute path is gratuitous information for anyone who reaches the screen. A `:memory:`
   * database is reported as in-memory with `present:false` — which is the honest answer for "is there a
   * file to back up?" — rather than as a missing file (an error) or a present one (a lie).
   */
  private sqliteFileInfo(): { name: string; inMemory: boolean; present: boolean; sizeBytes: number | null; modifiedAt: number | null; error: string | null } {
    const path = this.db.name;
    if (!path || path === ':memory:' || path === '') {
      return { name: ':memory:', inMemory: true, present: false, sizeBytes: null, modifiedAt: null, error: null };
    }
    const name = basename(path);
    try {
      const st = statSync(path);
      return { name, inMemory: false, present: true, sizeBytes: st.size, modifiedAt: Math.round(st.mtimeMs), error: null };
    } catch (e) {
      // A path that cannot be stat'ed is reported as NOT PRESENT with the reason — never as a size of 0.
      return { name, inMemory: false, present: false, sizeBytes: null, modifiedAt: null, error: (e as { code?: string }).code ?? 'STAT_FAILED' };
    }
  }

  backupStatus(): Record<string, unknown> {
    const fileInfo = this.sqliteFileInfo();
    const pragma = (name: string): unknown => {
      try { return (this.db.pragma(name, { simple: true }) as unknown) ?? null; } catch { return null; }
    };
    const lastMigration = (() => {
      try {
        const r = this.db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1').get() as { version: string; applied_at: number } | undefined;
        return r ?? null;
      } catch { return null; }
    })();
    const migrationCount = (() => {
      try { return Number((this.db.prepare('SELECT COUNT(*) n FROM schema_migrations').get() as { n: number }).n); } catch { return null; }
    })();
    const gate = (() => {
      try {
        const r = this.db.prepare("SELECT gate_key, status, production_required FROM release_gates WHERE gate_key='backup-restore-pitr'").get() as { gate_key: string; status: string; production_required: number } | undefined;
        return r ? { key: r.gate_key, status: r.status, productionRequired: r.production_required === 1 } : null;
      } catch { return null; }
    })();

    const journalMode = pragma('journal_mode');
    return {
      generatedAt: this.now(),
      engine: 'sqlite',
      engineNote: "this deployment's datastore is SQLite; managed Postgres is not connected",
      managedPostgres: 'Not Connected',
      file: {
        name: fileInfo.name,
        inMemory: fileInfo.inMemory,
        present: fileInfo.present,
        sizeBytes: fileInfo.sizeBytes,
        modifiedAt: fileInfo.modifiedAt,
        statError: fileInfo.error,
      },
      pragmas: {
        journalMode: journalMode ?? null,
        // WAL is a property of the journal mode; an in-memory database reports `memory`, which is neither
        // WAL nor a failure — so this is a three-state answer, not a boolean guess.
        walEnabled: journalMode === null ? null : String(journalMode).toLowerCase() === 'wal',
        pageSize: pragma('page_size'),
        foreignKeys: pragma('foreign_keys'),
        userVersion: pragma('user_version'),
      },
      migrations: { last: lastMigration, appliedCount: migrationCount },
      backup: {
        lastBackupAt: null,
        schedule: null,
        retentionDays: null,
        encryptionAtRest: null,
        pitr: null,
        lastRestoreDrillAt: null,
        offsiteCopy: null,
      },
      unavailable: ['lastBackupAt', 'schedule', 'retentionDays', 'encryptionAtRest', 'pitr', 'lastRestoreDrillAt', 'offsiteCopy', 'managedPostgresBackup'],
      restore: {
        supported: false,
        reason: 'DISABLED_BY_POLICY',
        note: 'no restore endpoint exists; executing a restore from the console is out of scope',
      },
      releaseGate: gate,
      readOnly: true,
    };
  }

  // ---- ADM-API-07 gateway metrics / ADM-API-08 local mock gateway control ----

  /** Idempotent seed of the single local-mock control row. */
  seedMockGateway(id = 'local-mock'): void {
    this.db
      .prepare('INSERT OR IGNORE INTO mock_gateway_state (id,status,version,updated_at) VALUES (?,?,0,?)')
      .run(id, 'MOCK_IDLE', this.now());
  }

  mockGatewayState(id = 'local-mock'): Record<string, unknown> | null {
    const r = this.db
      .prepare('SELECT id,status,resync_count,reconnect_count,last_resync_at,last_reconnect_at,version,updated_by,updated_at FROM mock_gateway_state WHERE id=?')
      .get(id) as Record<string, unknown> | undefined;
    return r ?? null;
  }

  /**
   * Apply a control action to the LOCAL MOCK gateway row.
   *
   * This changes a row in this database. It does not, and cannot, reach an exchange or a real gateway
   * process — the route says so in its response rather than letting the word "reconnect" imply otherwise.
   */
  applyMockGatewayAction(action: 'resync' | 'reconnect', version: number, by: string, id = 'local-mock'): { ok: boolean; conflict?: boolean; state?: Record<string, unknown> } {
    const cur = this.db.prepare('SELECT version FROM mock_gateway_state WHERE id=?').get(id) as { version: number } | undefined;
    if (!cur) return { ok: false };
    if (cur.version !== version) return { ok: false, conflict: true };
    const t = this.now();
    if (action === 'resync') {
      this.db
        .prepare("UPDATE mock_gateway_state SET status='MOCK_RESYNCED', resync_count=resync_count+1, last_resync_at=?, version=version+1, updated_by=?, updated_at=? WHERE id=? AND version=?")
        .run(t, by, t, id, version);
    } else {
      this.db
        .prepare("UPDATE mock_gateway_state SET status='MOCK_RECONNECTED', reconnect_count=reconnect_count+1, last_reconnect_at=?, version=version+1, updated_by=?, updated_at=? WHERE id=? AND version=?")
        .run(t, by, t, id, version);
    }
    return { ok: true, state: this.mockGatewayState(id) ?? undefined };
  }

  /**
   * Websocket stream metrics from the LOCAL `exchange_websocket_sessions` table only.
   *
   * No real gateway host is contacted. Staleness is computed against the newest recorded timestamp, and
   * is `null` — not `true` — when there is nothing recorded: an EMPTY table is not a stale one, and
   * conflating them teaches the UI to ignore the flag.
   */
  gatewayMetrics(staleThresholdMs = 60_000): Record<string, unknown> {
    const t = this.now();
    const agg = this.db
      .prepare(
        `SELECT COUNT(*) AS sessions,
                SUM(CASE WHEN status='connected' THEN 1 ELSE 0 END) AS connected,
                SUM(CASE WHEN status='disconnected' THEN 1 ELSE 0 END) AS disconnected,
                SUM(reconnects) AS reconnects,
                MAX(connected_at) AS last_connected_at,
                MAX(disconnected_at) AS last_disconnected_at,
                COUNT(DISTINCT user_id) AS distinct_users
         FROM exchange_websocket_sessions`,
      )
      .get() as Record<string, number | null>;
    const byStatus = this.db
      .prepare('SELECT status, COUNT(*) AS count FROM exchange_websocket_sessions GROUP BY status ORDER BY status')
      .all();

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
      freshness: {
        ageMs,
        staleThresholdMs,
        // `null` = nothing recorded, so staleness is undecidable. Not `false` (which would claim fresh)
        // and not `true` (which would claim stale data exists).
        stale: ageMs === null ? null : ageMs > staleThresholdMs,
        state: ageMs === null ? 'EMPTY' : ageMs > staleThresholdMs ? 'STALE' : 'FRESH',
      },
      mockGateway: this.mockGatewayState(),
      // Metrics the market-gateway service exposes on its own /metrics endpoint, which this BFF does not
      // proxy and must not fabricate.
      unavailable: ['messageRate', 'duplicateMessages', 'gapFill', 'queueDepth', 'backPressure', 'circuitBreaker', 'subscribedSymbols'],
      readOnly: true,
    };
  }

  // ---- ADM-API-09 incident acknowledgement ----

  /**
   * Acknowledge an incident.
   *
   * Acknowledgement is separate from STATUS: an incident can be acknowledged while still OPEN, so this is
   * not squeezed into the state machine. A second ack is honestly reported as `changed:false` and does NOT
   * bump the version — bumping it would invalidate every other console's version for a no-op.
   */
  ackIncident(id: string, version: number, by: string, note?: string): { ok: boolean; conflict?: boolean; changed?: boolean; acknowledgedAt?: number; acknowledgedBy?: string; version?: number } {
    const cur = this.db
      .prepare('SELECT version, acknowledged_at, acknowledged_by FROM incidents WHERE id=?')
      .get(id) as { version: number; acknowledged_at: number | null; acknowledged_by: string | null } | undefined;
    if (!cur) return { ok: false };
    if (cur.version !== version) return { ok: false, conflict: true };
    if (cur.acknowledged_at !== null) {
      return { ok: true, changed: false, acknowledgedAt: cur.acknowledged_at, acknowledgedBy: cur.acknowledged_by ?? undefined, version: cur.version };
    }
    const t = this.now();
    this.db
      .prepare('UPDATE incidents SET acknowledged_at=?, acknowledged_by=?, version=version+1, updated_at=? WHERE id=? AND version=?')
      .run(t, by, t, id, version);
    this.db
      .prepare('INSERT INTO incident_events (id,incident_id,kind,note,actor,at) VALUES (?,?,?,?,?,?)')
      .run(randomUUID(), id, 'acknowledged', note ?? null, by, t);
    return { ok: true, changed: true, acknowledgedAt: t, acknowledgedBy: by, version: cur.version + 1 };
  }

  // ---- ADM-API-11 AI policy ----

  /** Idempotent seed of the single policy row. `live_execution_enabled` is 0 and the DB CHECK keeps it 0. */
  seedAiPolicy(id = 'default'): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO ai_policy (id, live_execution_enabled, max_output_tokens, daily_cost_limit_micros, allowed_tools_json, version, updated_at)
         VALUES (?,0,?,?,?,0,?)`,
      )
      .run(id, 1024, 0, '[]', this.now());
  }

  getAiPolicy(id = 'default'): Record<string, unknown> | null {
    const r = this.db
      .prepare(
        `SELECT id, live_execution_enabled, max_output_tokens, daily_cost_limit_micros, allowed_tools_json,
                system_prompt_digest, system_prompt_algo, system_prompt_len, prompt_version, version,
                updated_by, updated_at
         FROM ai_policy WHERE id=?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return r ?? null;
  }

  /**
   * Write the AI policy under an optimistic version.
   *
   * `promptDigest` is a digest the CALLER computed; the raw prompt is not a parameter of this method at
   * all, so there is no code path through the repository that could persist prompt text.
   */
  updateAiPolicy(
    input: { maxOutputTokens: number; dailyCostLimitMicros: number; allowedTools: string[]; promptDigest?: string; promptAlgo?: string; promptLen?: number; promptVersion?: string },
    version: number,
    by: string,
    opts: { reason?: string; correlationId?: string; id?: string } = {},
  ): { ok: boolean; conflict?: boolean; policy?: Record<string, unknown> } {
    const id = opts.id ?? 'default';
    const before = this.getAiPolicy(id);
    if (!before) return { ok: false };
    if (Number(before.version) !== version) return { ok: false, conflict: true };
    const t = this.now();
    this.db
      .prepare(
        `UPDATE ai_policy SET max_output_tokens=?, daily_cost_limit_micros=?, allowed_tools_json=?,
                system_prompt_digest=COALESCE(?, system_prompt_digest),
                system_prompt_algo=COALESCE(?, system_prompt_algo),
                system_prompt_len=COALESCE(?, system_prompt_len),
                prompt_version=COALESCE(?, prompt_version),
                version=version+1, updated_by=?, updated_at=?
         WHERE id=? AND version=?`,
      )
      .run(
        input.maxOutputTokens, input.dailyCostLimitMicros, JSON.stringify(input.allowedTools),
        input.promptDigest ?? null, input.promptAlgo ?? null, input.promptLen ?? null, input.promptVersion ?? null,
        by, t, id, version,
      );
    const after = this.getAiPolicy(id);
    this.db
      .prepare('INSERT INTO ai_policy_history (id,policy_id,before_json,after_json,reason,changed_by,correlation_id,at) VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), id, JSON.stringify(before), JSON.stringify(after), opts.reason ?? null, by, opts.correlationId ?? null, t);
    return { ok: true, policy: after ?? undefined };
  }

  countAiPolicyHistory(id = 'default'): number {
    return Number((this.db.prepare('SELECT COUNT(*) n FROM ai_policy_history WHERE policy_id=?').get(id) as { n: number }).n);
  }

  // ---- shared idempotency (reuses the 0003 `idempotency_records` table) ----

  /** Returns the stored outcome for a key in a scope, or null when the key is new. */
  findIdempotent(key: string, scope: string): { result: string | null; created_at: number } | null {
    const r = this.db
      .prepare('SELECT result, created_at FROM idempotency_records WHERE idempotency_key=? AND scope=?')
      .get(key, scope) as { result: string | null; created_at: number } | undefined;
    return r ?? null;
  }

  /**
   * Claim a key. Returns false when the key already exists, which is what makes a retry a no-op at the
   * DATA layer instead of depending on the route checking first.
   */
  claimIdempotent(key: string, scope: string, userId: string): boolean {
    try {
      this.db
        .prepare('INSERT INTO idempotency_records (idempotency_key,user_id,scope,result,created_at) VALUES (?,?,?,?,?)')
        .run(key, userId, scope, null, this.now());
      return true;
    } catch {
      return false; // PRIMARY KEY conflict — the key is already in use
    }
  }

  storeIdempotentResult(key: string, scope: string, result: unknown): void {
    this.db
      .prepare('UPDATE idempotency_records SET result=? WHERE idempotency_key=? AND scope=?')
      .run(JSON.stringify(result), key, scope);
  }
}
