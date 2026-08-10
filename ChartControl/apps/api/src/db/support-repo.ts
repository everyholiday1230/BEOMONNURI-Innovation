/**
 * 고객 지원 티켓 저장소 (Postgres).
 *
 * 핵심 안전 규칙
 * ------------
 * 내부 메모(internal=true)는 **고객에게 절대 노출되지 않는다**. 그 조건을
 * 호출자가 기억해야 하는 구조로 두면 언젠가 빠뜨린다 — 되돌릴 수 없는 사고다.
 * 그래서 조회 함수를 두 개로 나눈다:
 *
 *   getForCustomer()  내부 메모를 SQL 에서 제외한다. 선택지가 없다.
 *   getForStaff()     전부 반환한다.
 *
 * 함수 이름이 곧 대상 독자다. 잘못 쓰면 이름이 어색해지므로 리뷰에서 걸린다.
 */

import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

export type TicketStatus = 'open' | 'pending' | 'resolved';
export type TicketPriority = 'low' | 'medium' | 'high';

export interface TicketRow {
  id: string;
  userId: string | null;
  userEmail: string | null;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  assignedTo: string | null;
  createdAt: number;
  updatedAt: number;
  resolvedAt: number | null;
  /** 대화 수. 목록에서 "답변이 있었나" 를 보여주는 데 쓴다. */
  messageCount?: number;
}

export interface MessageRow {
  id: string;
  ticketId: string;
  authorUserId: string | null;
  authorSide: 'customer' | 'staff';
  body: string;
  internal: boolean;
  createdAt: number;
}

type DbTicket = {
  id: string;
  user_id: string | null;
  user_email: string | null;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  assigned_to: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
  message_count?: string;
};

type DbMessage = {
  id: string;
  ticket_id: string;
  author_user_id: string | null;
  author_side: 'customer' | 'staff';
  body: string;
  internal: boolean;
  created_at: Date;
};

function mapTicket(r: DbTicket): TicketRow {
  return {
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    subject: r.subject,
    status: r.status,
    priority: r.priority,
    category: r.category,
    assignedTo: r.assigned_to,
    createdAt: r.created_at.getTime(),
    updatedAt: r.updated_at.getTime(),
    resolvedAt: r.resolved_at ? r.resolved_at.getTime() : null,
    ...(r.message_count !== undefined ? { messageCount: Number(r.message_count) } : {}),
  };
}

function mapMessage(r: DbMessage): MessageRow {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    authorUserId: r.author_user_id,
    authorSide: r.author_side,
    body: r.body,
    internal: r.internal,
    createdAt: r.created_at.getTime(),
  };
}

const T_COLS = `id, user_id, user_email, subject, status, priority, category,
                assigned_to, created_at, updated_at, resolved_at`;
const M_COLS = `id, ticket_id, author_user_id, author_side, body, internal, created_at`;

export class PgSupportRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * 티켓 생성. 첫 메시지를 함께 남긴다.
   *
   * 트랜잭션으로 묶는 이유: 티켓만 만들어지고 본문이 없으면 운영자가 "무슨
   * 문의인지 알 수 없는 빈 티켓" 을 받는다. 둘은 하나의 사실이다.
   */
  async create(input: {
    userId: string | null;
    userEmail: string | null;
    subject: string;
    body: string;
    category?: string;
    priority?: TicketPriority;
  }): Promise<TicketRow> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const id = randomUUID();
      await client.query(
        `INSERT INTO support_tickets (id, user_id, user_email, subject, status, priority, category, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'open',$5,$6, now(), now())`,
        [id, input.userId, input.userEmail, input.subject, input.priority ?? 'medium', input.category ?? 'general'],
      );
      await client.query(
        `INSERT INTO support_messages (id, ticket_id, author_user_id, author_side, body, internal, created_at)
         VALUES ($1,$2,$3,'customer',$4,FALSE, now())`,
        [randomUUID(), id, input.userId, input.body],
      );
      await client.query('COMMIT');
      return (await this.getTicket(id))!;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** 관리자 목록. 열린 것 먼저, 그다음 최근 갱신 순. */
  async listAll(opts: { status?: TicketStatus; limit?: number } = {}): Promise<TicketRow[]> {
    const params: unknown[] = [Math.min(Math.max(opts.limit ?? 100, 1), 500)];
    let where = '';
    if (opts.status) {
      params.push(opts.status);
      where = ` WHERE t.status = $${params.length}`;
    }
    const r = await this.pool.query<DbTicket>(
      `SELECT ${T_COLS.split(',').map((c) => 't.' + c.trim()).join(', ')},
              (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id) AS message_count
         FROM support_tickets t${where}
        ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                 t.updated_at DESC
        LIMIT $1`,
      params,
    );
    return r.rows.map(mapTicket);
  }

  /** 사용자 본인의 티켓만. */
  async listForUser(userId: string, limit = 50): Promise<TicketRow[]> {
    const r = await this.pool.query<DbTicket>(
      `SELECT ${T_COLS.split(',').map((c) => 't.' + c.trim()).join(', ')},
              (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id AND m.internal = FALSE) AS message_count
         FROM support_tickets t
        WHERE t.user_id = $1
        ORDER BY t.updated_at DESC
        LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 200)],
    );
    return r.rows.map(mapTicket);
  }

  async getTicket(id: string): Promise<TicketRow | null> {
    const r = await this.pool.query<DbTicket>(`SELECT ${T_COLS} FROM support_tickets WHERE id = $1`, [id]);
    return r.rowCount ? mapTicket(r.rows[0]!) : null;
  }

  /**
   * 고객이 보는 대화. **내부 메모는 SQL 에서 제외된다.**
   *
   * 필터를 인수로 받지 않는다 — 실수로 true 를 넘길 여지를 없앤다.
   */
  async getForCustomer(ticketId: string, userId: string): Promise<{ ticket: TicketRow; messages: MessageRow[] } | null> {
    const ticket = await this.getTicket(ticketId);
    // 남의 티켓을 ID 만으로 열 수 없다. 소유 확인을 저장소에서 한다 —
    // 라우트에서만 확인하면 다른 호출 경로가 생길 때 빠뜨린다.
    if (!ticket || ticket.userId !== userId) return null;
    const r = await this.pool.query<DbMessage>(
      `SELECT ${M_COLS} FROM support_messages
        WHERE ticket_id = $1 AND internal = FALSE
        ORDER BY created_at ASC`,
      [ticketId],
    );
    return { ticket, messages: r.rows.map(mapMessage) };
  }

  /** 운영자가 보는 대화. 내부 메모까지 전부. */
  async getForStaff(ticketId: string): Promise<{ ticket: TicketRow; messages: MessageRow[] } | null> {
    const ticket = await this.getTicket(ticketId);
    if (!ticket) return null;
    const r = await this.pool.query<DbMessage>(
      `SELECT ${M_COLS} FROM support_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [ticketId],
    );
    return { ticket, messages: r.rows.map(mapMessage) };
  }

  /**
   * 메시지 추가.
   *
   * 티켓의 updated_at 을 함께 올린다 — 목록 정렬이 "최근 갱신" 이므로
   * 갱신하지 않으면 새 답변이 온 티켓이 목록 아래에 묻힌다.
   *
   * 상태도 함께 움직인다:
   *   고객이 답하면 'open'    (우리가 볼 차례)
   *   운영자가 답하면 'pending' (고객이 볼 차례)
   * 종료된 티켓에 새 메시지가 오면 다시 열린다 — 종료 후 추가 문의가
   * 조용히 묻히면 고객은 답을 못 받는다.
   */
  async addMessage(input: {
    ticketId: string;
    authorUserId: string | null;
    authorSide: 'customer' | 'staff';
    body: string;
    internal?: boolean;
  }): Promise<MessageRow | null> {
    const exists = await this.getTicket(input.ticketId);
    if (!exists) return null;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const id = randomUUID();
      await client.query(
        `INSERT INTO support_messages (id, ticket_id, author_user_id, author_side, body, internal, created_at)
         VALUES ($1,$2,$3,$4,$5,$6, now())`,
        [id, input.ticketId, input.authorUserId, input.authorSide, input.body, Boolean(input.internal)],
      );

      /*
         내부 메모는 상태를 바꾸지 않는다. 운영자끼리 메모를 남긴 것으로
         "고객 답변 대기" 가 되면 실제로 답장하지 않았는데 처리된 것처럼 보인다.
      */
      if (input.internal) {
        await client.query('UPDATE support_tickets SET updated_at = now() WHERE id = $1', [input.ticketId]);
      } else {
        const nextStatus = input.authorSide === 'customer' ? 'open' : 'pending';
        await client.query(
          `UPDATE support_tickets
              SET status = $2, updated_at = now(),
                  resolved_at = NULL
            WHERE id = $1`,
          [input.ticketId, nextStatus],
        );
      }
      await client.query('COMMIT');
      const r = await this.pool.query<DbMessage>(`SELECT ${M_COLS} FROM support_messages WHERE id = $1`, [id]);
      return r.rowCount ? mapMessage(r.rows[0]!) : null;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /** 상태 변경 (운영자). 종료 시각을 남긴다. */
  async setStatus(id: string, status: TicketStatus): Promise<TicketRow | null> {
    const r = await this.pool.query(
      `UPDATE support_tickets
          SET status = $2,
              resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE NULL END,
              updated_at = now()
        WHERE id = $1`,
      [id, status],
    );
    if (!r.rowCount) return null;
    return this.getTicket(id);
  }

  async setPriority(id: string, priority: TicketPriority): Promise<TicketRow | null> {
    const r = await this.pool.query(
      'UPDATE support_tickets SET priority = $2, updated_at = now() WHERE id = $1',
      [id, priority],
    );
    if (!r.rowCount) return null;
    return this.getTicket(id);
  }

  /** 담당자 지정. null 이면 배정 해제. */
  async assign(id: string, staffUserId: string | null): Promise<TicketRow | null> {
    const r = await this.pool.query(
      'UPDATE support_tickets SET assigned_to = $2, updated_at = now() WHERE id = $1',
      [id, staffUserId],
    );
    if (!r.rowCount) return null;
    return this.getTicket(id);
  }

  /** 상태별 건수. 관리자 화면 KPI 에 쓴다. */
  async counts(): Promise<Record<TicketStatus, number>> {
    const r = await this.pool.query<{ status: TicketStatus; n: string }>(
      'SELECT status, COUNT(*) AS n FROM support_tickets GROUP BY status',
    );
    const out: Record<TicketStatus, number> = { open: 0, pending: 0, resolved: 0 };
    for (const row of r.rows) out[row.status] = Number(row.n);
    return out;
  }
}
