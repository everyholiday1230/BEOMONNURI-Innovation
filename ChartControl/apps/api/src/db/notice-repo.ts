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
  /*
     팝업으로 띄울지. 기본 false.

     ★ 전부 띄우면 이용자가 닫는 데 익숙해져 중요한 공지도 읽지 않는다.
       그래서 공지마다 운영자가 정한다.
  */
  popup: boolean;
  /** 'info'(배너) | 'warning'(팝업) | 'critical'(명시적으로 닫아야 사라짐) */
  severity: 'info' | 'warning' | 'critical';
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
  popup?: boolean;
  severity?: 'info' | 'warning' | 'critical';
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
  popup: boolean;
  severity: 'info' | 'warning' | 'critical';
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
    popup: r.popup === true,
    /*
       ★ 알 수 없는 값은 'info'(가장 약한 표시)로 떨어진다. DB 제약이 세 값만
         허용하므로 여기 오지 않지만, 제약이 없는 배포에서도 화면이 깨지지 않게 한다.
    */
    severity: r.severity === 'critical' ? 'critical' : r.severity === 'warning' ? 'warning' : 'info',
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
              created_by, updated_by, created_at, updated_at, published_at, popup, severity`;

/**
 * 긴급도 정규화.
 *
 * ★★ 모르는 값을 'critical' 로 올리지 않는다 — 운영자가 의도하지 않은 공지가
 *   닫을 수 없는 팝업이 되면 이용자가 화면을 쓸 수 없다.
 * ★ 반대로 오타를 조용히 'info' 로 떨어뜨리면 긴급 공지가 배너로 지나간다.
 *   그래서 DB 에 CHECK 제약을 함께 두었다(0028) — 여기서 걸러지기 전에 저장이 실패한다.
 */
function normalizeSeverity(v: unknown): 'info' | 'warning' | 'critical' {
  return v === 'critical' ? 'critical' : v === 'warning' ? 'warning' : 'info';
}

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

  /**
   * 이 이용자가 **아직 읽지 않은** 팝업 공지.
   *
   * ★★ 읽음을 서버에서 판정한다. 로컬 저장이면 기기를 바꿀 때마다 같은 팝업이
   *   다시 뜬다 — 이미 읽은 이용자에게 반복해서 보여주면 그 다음부터는 내용을
   *   보지 않고 닫는다.
   *
   * ★ 상한을 둔다. 오래 쌓인 팝업 공지 20개가 한꺼번에 뜨면 화면을 쓸 수 없다.
   *   가장 긴급하고 최신인 것부터 준다.
   */
  async listUnreadPopups(userId: string, locale?: string, limit = 3): Promise<NoticeRow[]> {
    const params: unknown[] = [userId, Math.min(Math.max(limit, 1), 10)];
    let localeClause = '';
    if (locale) {
      params.push(locale);
      localeClause = ` AND n.locale = $${params.length}`;
    }
    const r = await this.pool.query<DbRow>(
      `SELECT ${COLS.split(', ').map((x) => `n.${x.trim()}`).join(', ')}
         FROM notices n
         LEFT JOIN notice_reads nr ON nr.notice_id = n.id AND nr.user_id = $1
        WHERE n.popup
          AND n.status = 'published'
          AND (n.publish_at IS NULL OR n.publish_at <= now())
          AND (n.expires_at IS NULL OR n.expires_at > now())
          AND nr.notice_id IS NULL
          ${localeClause}
        /*
           ★ 긴급한 것부터. critical 이 info 뒤에 밀리면 상한(limit)에 잘려
             가장 중요한 공지가 표시되지 않는다.
        */
        ORDER BY CASE n.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                 COALESCE(n.published_at, n.publish_at, n.created_at) DESC
        LIMIT $2`,
      params,
    );
    return r.rows.map(map);
  }

  /**
   * 읽음으로 표시한다.
   *
   * ★ 같은 공지를 두 번 닫아도 오류가 아니다(ON CONFLICT). 이용자가 두 기기에서
   *   동시에 닫을 수 있다.
   * ★ 존재하지 않는 공지 id 면 외래키가 막는다 — 조용히 성공하지 않는다.
   */
  async markRead(userId: string, noticeId: string): Promise<boolean> {
    try {
      await this.pool.query(
        `INSERT INTO notice_reads (user_id, notice_id) VALUES ($1, $2)
         ON CONFLICT (user_id, notice_id) DO NOTHING`,
        [userId, noticeId],
      );
      return true;
    } catch {
      /*
         ★ 없는 공지를 읽음 처리하려 한 경우다(외래키 위반). false 를 준다 —
           성공으로 위장하면 화면이 팝업을 닫고, 다음 로그인에 또 뜬다.
      */
      return false;
    }
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
                            created_by, updated_by, created_at, updated_at, popup, severity)
       VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,$8,$9,$9, now(), now(), $10, $11)`,
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
        /*
           ★ 기본값은 팝업 아님 / info 다. 운영자가 명시해야 팝업이 된다 —
             실수로 모든 공지가 튀어나오면 이용자가 닫는 데 익숙해진다.
        */
        Boolean(input.popup),
        normalizeSeverity(input.severity),
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
              updated_by = $9, updated_at = now(),
              popup = $10, severity = $11
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
        Boolean(input.popup),
        normalizeSeverity(input.severity),
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
