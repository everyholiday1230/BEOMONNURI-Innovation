/**
 * 공지 저장소 (Postgres).
 *
 * 왜 sqlite 구현이 없는가
 * ---------------------
 * 공지는 관리자만 작성하고, 관리자 화면은 Postgres 배포에서만 쓴다.
 * sqlite 는 단일 사용자 개발용이고 그때는 공지를 쓸 일이 없다.
 * 필요해지면 추가하되, 지금 없는 것을 있는 것처럼 만들지 않는다.
 *
 * ★ 시각은 DB 가 정한다 (now()).
 * 애플리케이션 시계를 쓰면 서버가 여러 대일 때 순서가 뒤바뀐다.
 */

import { randomUUID } from 'node:crypto';

import type { Pool } from 'pg';

export interface NoticeRow {
  id: string;
  title: string;
  body: string;
  category: string;
  status: 'draft' | 'published' | 'archived';
  pinned: boolean;
  publishAt: number | null;
  expiresAt: number | null;
  locale: string;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
  publishedAt: number | null;
}

export interface NoticeInput {
  title: string;
  body?: string;
  category?: string;
  pinned?: boolean;
  /** epoch ms. 미래면 예약 게시. */
  publishAt?: number | null;
  expiresAt?: number | null;
  locale?: string;
}

type DbRow = {
  id: string;
  title: string;
  body: string;
  category: string;
  status: NoticeRow['status'];
  pinned: boolean;
  publish_at: Date | null;
  expires_at: Date | null;
  locale: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
};

function toMs(v: Date | null): number | null {
  return v ? v.getTime() : null;
}

function map(r: DbRow): NoticeRow {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    category: r.category,
    status: r.status,
    pinned: r.pinned,
    publishAt: toMs(r.publish_at),
    expiresAt: toMs(r.expires_at),
    locale: r.locale,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: r.created_at.getTime(),
    updatedAt: r.updated_at.getTime(),
    publishedAt: toMs(r.published_at),
  };
}

/** epoch ms → Date. 0·NaN 은 null 로 본다(값 없음과 1970년을 구분한다). */
function toDate(ms: number | null | undefined): Date | null {
  if (ms === null || ms === undefined) return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n);
}

const COLS = `id, title, body, category, status, pinned, publish_at, expires_at, locale,
              created_by, updated_by, created_at, updated_at, published_at`;

export class PgNoticeRepo {
  constructor(private readonly pool: Pool) {}

  /** 관리자 목록. 상태 무관하게 전부, 최근 수정 순. */
  async listAll(limit = 100): Promise<NoticeRow[]> {
    const r = await this.pool.query<DbRow>(
      `SELECT ${COLS} FROM notices ORDER BY updated_at DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    return r.rows.map(map);
  }

  /**
   * 사용자 화면용. **지금 보여야 하는 것만** 돌려준다.
   *
   * 조건을 DB 에서 판단한다 — 애플리케이션에서 걸러내면 조회 지점마다
   * 규칙을 반복해야 하고, 한 곳만 빠뜨리면 초안이나 만료된 공지가 노출된다.
   */
  async listVisible(locale?: string, limit = 50): Promise<NoticeRow[]> {
    const params: unknown[] = [Math.min(Math.max(limit, 1), 200)];
    let localeClause = '';
    if (locale) {
      params.push(locale);
      localeClause = ` AND locale = $${params.length}`;
    }
    const r = await this.pool.query<DbRow>(
      `SELECT ${COLS} FROM notices
        WHERE status = 'published'
          AND (publish_at IS NULL OR publish_at <= now())
          AND (expires_at IS NULL OR expires_at > now())
          ${localeClause}
        ORDER BY pinned DESC, COALESCE(publish_at, created_at) DESC
        LIMIT $1`,
      params,
    );
    return r.rows.map(map);
  }

  async get(id: string): Promise<NoticeRow | null> {
    const r = await this.pool.query<DbRow>(`SELECT ${COLS} FROM notices WHERE id = $1`, [id]);
    return r.rowCount ? map(r.rows[0]!) : null;
  }

  /** 초안으로 만든다. 작성과 게시를 분리해 실수로 즉시 공개되는 것을 막는다. */
  async create(input: NoticeInput, actorId: string | null): Promise<NoticeRow> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO notices (id, title, body, category, status, pinned, publish_at, expires_at, locale,
                            created_by, updated_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$9, now(), now())`,
      [
        id,
        input.title,
        input.body ?? '',
        input.category ?? 'notice',
        Boolean(input.pinned),
        toDate(input.publishAt),
        toDate(input.expiresAt),
        input.locale ?? 'en',
        actorId,
      ],
    );
    return (await this.get(id))!;
  }

  /**
   * 내용 수정. 상태는 바꾸지 않는다 — 게시/보관은 별도 동작이다.
   *
   * 상태 변경을 여기에 섞으면 "제목만 고치려다 실수로 게시" 가 가능해진다.
   */
  async update(id: string, input: NoticeInput, actorId: string | null): Promise<NoticeRow | null> {
    const r = await this.pool.query(
      `UPDATE notices
          SET title = $2, body = $3, category = $4, pinned = $5,
              publish_at = $6, expires_at = $7, locale = $8,
              updated_by = $9, updated_at = now()
        WHERE id = $1`,
      [
        id,
        input.title,
        input.body ?? '',
        input.category ?? 'notice',
        Boolean(input.pinned),
        toDate(input.publishAt),
        toDate(input.expiresAt),
        input.locale ?? 'en',
        actorId,
      ],
    );
    if (!r.rowCount) return null;
    return this.get(id);
  }

  /**
   * 게시.
   *
   * published_at 을 남긴다 — 언제 공개됐는지는 나중에 확인해야 할 사실이다.
   * 이미 게시된 것을 다시 게시하면 published_at 을 갱신하지 않는다(최초 시각 보존).
   */
  async publish(id: string, actorId: string | null): Promise<NoticeRow | null> {
    const r = await this.pool.query(
      `UPDATE notices
          SET status = 'published',
              published_at = COALESCE(published_at, now()),
              updated_by = $2, updated_at = now()
        WHERE id = $1`,
      [id, actorId],
    );
    if (!r.rowCount) return null;
    return this.get(id);
  }

  /**
   * 보관(내림).
   *
   * 삭제하지 않는다. 공지는 전체 사용자에게 나간 기록이므로 지우면
   * "그때 무엇을 공지했는지" 를 확인할 수 없다.
   */
  async archive(id: string, actorId: string | null): Promise<NoticeRow | null> {
    const r = await this.pool.query(
      `UPDATE notices SET status = 'archived', updated_by = $2, updated_at = now() WHERE id = $1`,
      [id, actorId],
    );
    if (!r.rowCount) return null;
    return this.get(id);
  }

  /** 초안으로 되돌린다. 잘못 게시한 것을 즉시 내릴 때 쓴다. */
  async unpublish(id: string, actorId: string | null): Promise<NoticeRow | null> {
    const r = await this.pool.query(
      `UPDATE notices SET status = 'draft', updated_by = $2, updated_at = now() WHERE id = $1`,
      [id, actorId],
    );
    if (!r.rowCount) return null;
    return this.get(id);
  }
}
