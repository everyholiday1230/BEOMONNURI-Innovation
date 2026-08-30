import { randomUUID } from 'node:crypto';

/*
   오류 제보(버그 리포트) 저장소 — PostgreSQL.

   고객이 제보하고 운영자가 확인하면 포인트를 지급한다. 모든 조회는 필요한 곳에서
   user_id 로 스코프한다(고객은 자기 것만, 운영자는 전체). 상태 전이는 open →
   confirmed | rejected 이며, 이미 처리된 건은 다시 처리하지 않는다(멱등).
*/

interface PgPoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export interface BugReportRow {
  id: string;
  userId: string;
  email?: string | null;
  title: string;
  body: string;
  area: string | null;
  status: 'open' | 'confirmed' | 'rejected';
  pointsAwarded: number;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const COLS = 'id,user_id,title,body,area,status,points_awarded,resolution,resolved_by,resolved_at,created_at,updated_at';

function mapRow(r: Record<string, unknown>): BugReportRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    email: r.email === undefined || r.email === null ? null : String(r.email),
    title: String(r.title),
    body: String(r.body),
    area: r.area === null || r.area === undefined ? null : String(r.area),
    status: String(r.status) as BugReportRow['status'],
    pointsAwarded: Number(r.points_awarded ?? 0),
    resolution: r.resolution === null || r.resolution === undefined ? null : String(r.resolution),
    resolvedBy: r.resolved_by === null || r.resolved_by === undefined ? null : String(r.resolved_by),
    resolvedAt: r.resolved_at === null || r.resolved_at === undefined ? null : Number(r.resolved_at),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export class PgBugReportRepo {
  constructor(private readonly pool: PgPoolLike) {}

  async create(userId: string, input: { title: string; body: string; area?: string | null }): Promise<BugReportRow> {
    const id = randomUUID();
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO bug_reports (id,user_id,title,body,area,status,points_awarded,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,'open',0,$6,$6)`,
      [id, userId, input.title.slice(0, 200), input.body.slice(0, 4000), input.area ? String(input.area).slice(0, 40) : null, now],
    );
    const r = await this.get(id);
    if (!r) throw new Error('bug report insert did not produce a row');
    return r;
  }

  async get(id: string): Promise<BugReportRow | null> {
    const r = await this.pool.query(`SELECT ${COLS} FROM bug_reports WHERE id=$1`, [id]);
    return r.rows[0] ? mapRow(r.rows[0]) : null;
  }

  async listByUser(userId: string, limit = 50): Promise<BugReportRow[]> {
    const r = await this.pool.query(
      `SELECT ${COLS} FROM bug_reports WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(Math.max(limit, 1), 200)],
    );
    return r.rows.map(mapRow);
  }

  async listAll(status: string | null, limit = 200): Promise<BugReportRow[]> {
    const params: unknown[] = [];
    let where = '';
    if (status) { params.push(status); where = `WHERE b.status=$${params.length}`; }
    params.push(Math.min(Math.max(limit, 1), 500));
    const r = await this.pool.query(
      `SELECT b.id,b.user_id,u.email,b.title,b.body,b.area,b.status,b.points_awarded,b.resolution,b.resolved_by,b.resolved_at,b.created_at,b.updated_at
         FROM bug_reports b LEFT JOIN users u ON u.id=b.user_id
        ${where} ORDER BY b.created_at DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows.map(mapRow);
  }

  async counts(): Promise<{ open: number; confirmed: number; rejected: number }> {
    const r = await this.pool.query(`SELECT status, COUNT(*)::int AS n FROM bug_reports GROUP BY status`);
    const out = { open: 0, confirmed: 0, rejected: 0 };
    for (const row of r.rows) {
      const s = String(row.status);
      if (s === 'open' || s === 'confirmed' || s === 'rejected') out[s] = Number(row.n);
    }
    return out;
  }

  /**
   * 처리(확인/반려). open 상태일 때만 전이한다(멱등: 이미 처리된 건은 changed:false).
   * 포인트 지급은 라우터가 담당하고, 여기서는 상태·지급액·사유만 기록한다.
   */
  async resolve(id: string, input: { status: 'confirmed' | 'rejected'; pointsAwarded: number; resolution: string | null; resolvedBy: string }): Promise<{ ok: boolean; changed: boolean; report?: BugReportRow }> {
    const now = Date.now();
    const r = await this.pool.query(
      `UPDATE bug_reports SET status=$2, points_awarded=$3, resolution=$4, resolved_by=$5, resolved_at=$6, updated_at=$6
         WHERE id=$1 AND status='open'`,
      [id, input.status, Math.max(0, Math.floor(input.pointsAwarded)), input.resolution, input.resolvedBy, now],
    );
    const report = (await this.get(id)) ?? undefined;
    if (!report) return { ok: false, changed: false };
    return { ok: true, changed: (r.rowCount ?? 0) > 0, report };
  }
}
