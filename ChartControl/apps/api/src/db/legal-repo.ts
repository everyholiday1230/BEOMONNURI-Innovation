/**
 * 법적 문서 저장소 (이용약관 · 개인정보처리방침 · 위험 고지 · 보안 안내).
 *
 * 불변식
 * -----
 * 1. **게시된 문서는 수정하지 않는다.** 문구를 바꾸려면 새 버전을 만든다.
 *    이미 동의한 사람이 무엇에 동의했는지가 남아야 한다.
 * 2. **초안은 사용자에게 보이지 않는다.** 작성 중인 문서가 공개되면 그것이
 *    우리 약관이 된다.
 * 3. **동의 기록은 추가만 한다.** 수정·삭제 경로를 만들지 않는다.
 * 4. **본문은 HTML 로 저장하지 않는다.** 화면이 마크다운 부분집합만 렌더한다 —
 *    HTML 을 그대로 넣으면 관리자 계정이 침해될 때 XSS 경로가 된다.
 */

import type { Pool, PoolClient } from 'pg';

export type LegalKind = 'terms' | 'privacy' | 'risk' | 'security' | 'refund';

export const LEGAL_KINDS: readonly LegalKind[] = ['terms', 'privacy', 'risk', 'security', 'refund'];

export interface LegalDoc {
  id: string;
  kind: LegalKind;
  locale: string;
  version: string;
  title: string;
  body: string;
  effectiveAt: number | null;
  publishedAt: number | null;
  createdAt: number;
  createdBy: string | null;
  updatedAt: number;
}

export interface ConsentRecord {
  id: string;
  userId: string;
  documentId: string;
  kind: string;
  version: string;
  agreedAt: number;
}

const COLS = `id, kind, locale, version, title, body,
              effective_at, published_at, created_at, created_by, updated_at`;

function ms(v: unknown): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function toDoc(r: Record<string, unknown>): LegalDoc {
  return {
    id: String(r.id),
    kind: String(r.kind) as LegalKind,
    locale: String(r.locale),
    version: String(r.version),
    title: String(r.title),
    body: String(r.body),
    effectiveAt: ms(r.effective_at),
    publishedAt: ms(r.published_at),
    createdAt: ms(r.created_at) ?? 0,
    createdBy: r.created_by === null || r.created_by === undefined ? null : String(r.created_by),
    updatedAt: ms(r.updated_at) ?? 0,
  };
}

export class PgLegalRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * 사용자에게 보여줄 문서 하나.
   *
   * ★ 게시본만 돌려준다 (published_at IS NOT NULL).
   *
   * ★ 요청 언어에 게시본이 없으면 **영어로 대체**한다. 법적 문서가 없는 것보다
   *   읽을 수 있는 언어로라도 보여주는 편이 낫다 — 다만 화면이 "요청한 언어가
   *   아니다" 를 알려야 한다. 그래서 반환값의 locale 을 그대로 준다.
   */
  async liveFor(kind: LegalKind, locale: string): Promise<LegalDoc | null> {
    const q = `SELECT ${COLS} FROM legal_documents
               WHERE kind = $1 AND locale = $2 AND published_at IS NOT NULL
               ORDER BY published_at DESC LIMIT 1`;
    const first = await this.pool.query(q, [kind, locale]);
    if (first.rows[0]) return toDoc(first.rows[0] as Record<string, unknown>);

    // 언어 태그의 앞부분으로 한 번 더 시도한다 ('ko-KR' → 'ko').
    const base = locale.split('-')[0];
    if (base && base !== locale) {
      const second = await this.pool.query(q, [kind, base]);
      if (second.rows[0]) return toDoc(second.rows[0] as Record<string, unknown>);
    }

    if (locale !== 'en') {
      const fallback = await this.pool.query(q, [kind, 'en']);
      if (fallback.rows[0]) return toDoc(fallback.rows[0] as Record<string, unknown>);
    }
    return null;
  }

  /** 게시된 문서 종류 목록. 런칭 점검이 "무엇이 빠졌는지" 를 알 때 쓴다. */
  async publishedKinds(): Promise<Array<{ kind: string; locale: string; version: string; publishedAt: number | null }>> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT ON (kind, locale) kind, locale, version, published_at
       FROM legal_documents WHERE published_at IS NOT NULL
       ORDER BY kind, locale, published_at DESC`,
    );
    return rows.map((r) => ({
      kind: String(r.kind), locale: String(r.locale), version: String(r.version),
      publishedAt: ms(r.published_at),
    }));
  }

  /** 관리자 목록 — 초안 포함. */
  async list(limit = 100): Promise<LegalDoc[]> {
    const { rows } = await this.pool.query(
      `SELECT ${COLS} FROM legal_documents ORDER BY kind, locale, created_at DESC LIMIT $1`,
      [Math.min(Math.max(1, limit), 500)],
    );
    return rows.map((r) => toDoc(r as Record<string, unknown>));
  }

  async byId(id: string): Promise<LegalDoc | null> {
    const { rows } = await this.pool.query(`SELECT ${COLS} FROM legal_documents WHERE id = $1`, [id]);
    return rows[0] ? toDoc(rows[0] as Record<string, unknown>) : null;
  }

  /**
   * 초안 작성.
   *
   * ★ 게시하지 않는다 (published_at 은 NULL). 게시는 별도 동작이다 —
   *   작성 중인 법적 문서가 실수로 공개되면 그것이 우리 약관이 된다.
   */
  async createDraft(input: {
    kind: LegalKind; locale: string; version: string;
    title: string; body: string; effectiveAt?: number | null; actorId?: string | null;
  }): Promise<LegalDoc> {
    const { rows } = await this.pool.query(
      `INSERT INTO legal_documents (kind, locale, version, title, body, effective_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLS}`,
      [
        input.kind, input.locale, input.version, input.title, input.body,
        input.effectiveAt ? new Date(input.effectiveAt) : null,
        input.actorId ?? null,
      ],
    );
    return toDoc(rows[0] as Record<string, unknown>);
  }

  /**
   * 초안 수정.
   *
   * ★ 이미 게시된 문서는 거부한다. 문구를 바꾸려면 새 버전을 만들어야 한다 —
   *   지난 버전을 덮어쓰면 누가 무엇에 동의했는지의 증거가 사라진다.
   */
  async updateDraft(id: string, input: {
    title?: string; body?: string; effectiveAt?: number | null;
  }): Promise<LegalDoc> {
    const cur = await this.byId(id);
    if (!cur) throw new Error('DOC_NOT_FOUND');
    if (cur.publishedAt !== null) throw new Error('ALREADY_PUBLISHED');

    const { rows } = await this.pool.query(
      `UPDATE legal_documents
          SET title = COALESCE($2, title),
              body = COALESCE($3, body),
              effective_at = COALESCE($4, effective_at),
              updated_at = now()
        WHERE id = $1 RETURNING ${COLS}`,
      [
        id,
        input.title ?? null,
        input.body ?? null,
        input.effectiveAt ? new Date(input.effectiveAt) : null,
      ],
    );
    return toDoc(rows[0] as Record<string, unknown>);
  }

  /** 게시. 되돌릴 수 없다 — 이미 본 사람이 있을 수 있다. */
  async publish(id: string): Promise<LegalDoc> {
    const cur = await this.byId(id);
    if (!cur) throw new Error('DOC_NOT_FOUND');
    if (cur.publishedAt !== null) throw new Error('ALREADY_PUBLISHED');
    if (!cur.body.trim()) throw new Error('EMPTY_BODY');

    const { rows } = await this.pool.query(
      `UPDATE legal_documents
          SET published_at = now(),
              -- 효력일을 정하지 않았으면 게시 시점부터 적용된다.
              effective_at = COALESCE(effective_at, now()),
              updated_at = now()
        WHERE id = $1 RETURNING ${COLS}`,
      [id],
    );
    return toDoc(rows[0] as Record<string, unknown>);
  }

  /**
   * 동의 기록.
   *
   * ★ 같은 문서에 두 번 동의하지 않는다 (UNIQUE). 중복은 예외가 아니라 무시다 —
   *   재시도는 오류가 아니다.
   *
   * ★ 게시되지 않은 문서에는 동의할 수 없다. 초안에 동의를 받으면 그 동의가
   *   무엇에 대한 것인지 불분명해진다.
   */
  async recordConsent(input: {
    userId: string; documentId: string; ip?: string | null;
    client?: PoolClient;
  }): Promise<ConsentRecord | null> {
    const q = input.client ?? this.pool;
    const doc = await q.query(
      `SELECT kind, version, published_at FROM legal_documents WHERE id = $1`,
      [input.documentId],
    );
    const row = doc.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error('DOC_NOT_FOUND');
    if (!row.published_at) throw new Error('NOT_PUBLISHED');

    const { rows } = await q.query(
      `INSERT INTO user_legal_consents (user_id, document_id, kind, version, ip)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, document_id) DO NOTHING
       RETURNING id, user_id, document_id, kind, version, agreed_at`,
      [input.userId, input.documentId, String(row.kind), String(row.version), input.ip ?? null],
    );
    if (!rows[0]) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      id: String(r.id), userId: String(r.user_id), documentId: String(r.document_id),
      kind: String(r.kind), version: String(r.version), agreedAt: ms(r.agreed_at) ?? 0,
    };
  }

  /** 이 사용자가 동의한 것들. 고객 문의 응대와 분쟁 대응에 쓴다. */
  async consentsOf(userId: string): Promise<ConsentRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT id, user_id, document_id, kind, version, agreed_at
         FROM user_legal_consents WHERE user_id = $1 ORDER BY agreed_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: String(r.id), userId: String(r.user_id), documentId: String(r.document_id),
      kind: String(r.kind), version: String(r.version), agreedAt: ms(r.agreed_at) ?? 0,
    }));
  }

  /**
   * 현재 게시본에 동의하지 않은 종류.
   *
   * 약관이 새 버전으로 바뀌면 다시 동의를 받아야 한다. 이 목록이 비어 있지
   * 않으면 화면이 재동의를 요구할 수 있다.
   */
  async pendingConsents(userId: string, locale: string): Promise<Array<{ kind: LegalKind; documentId: string; version: string }>> {
    const out: Array<{ kind: LegalKind; documentId: string; version: string }> = [];
    // 동의가 필요한 것은 약관과 개인정보처리방침이다. 위험 고지·보안 안내는 읽기 자료다.
    for (const kind of ['terms', 'privacy'] as const) {
      const doc = await this.liveFor(kind, locale);
      if (!doc) continue;
      const { rows } = await this.pool.query(
        `SELECT 1 FROM user_legal_consents WHERE user_id = $1 AND document_id = $2`,
        [userId, doc.id],
      );
      if (!rows[0]) out.push({ kind, documentId: doc.id, version: doc.version });
    }
    return out;
  }
}
