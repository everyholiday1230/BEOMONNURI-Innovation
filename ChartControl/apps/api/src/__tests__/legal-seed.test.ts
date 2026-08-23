/*
   법적 문서 시딩 테스트.

   실제 데이터베이스 없이 저장소를 대역으로 세워 판정만 검증한다. 여기서 확인하는
   것은 "문서를 잘 읽는가" 가 아니라 **공개해도 되는 상황인지 가리는 규칙** 이다 —
   공개는 되돌릴 수 없으므로 그 판정이 틀리면 사고가 된다.
*/

import { describe, it, expect } from 'vitest';
import { seedLegalDocuments, resolveDocsDir, SEED_LOCALES } from '../legal/seed-legal';
import { LEGAL_KINDS, type PgLegalRepo } from '../db/legal-repo';

interface Row { id: string; kind: string; locale: string; version: string; title: string; body: string; publishedAt: number | null }

/** 메모리 대역 저장소. PgLegalRepo 의 시딩이 쓰는 네 메서드만 흉내낸다. */
function stubRepo(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  let n = 0;
  const repo = {
    async list() { return rows as unknown as Awaited<ReturnType<PgLegalRepo['list']>>; },
    async publishedKinds() {
      return rows.filter((r) => r.publishedAt !== null)
        .map((r) => ({ kind: r.kind, locale: r.locale, version: r.version, publishedAt: r.publishedAt }));
    },
    async createDraft(input: { kind: string; locale: string; version: string; title: string; body: string }) {
      n += 1;
      const row: Row = { id: `doc-${n}`, ...input, publishedAt: null };
      rows.push(row);
      return row as unknown as Awaited<ReturnType<PgLegalRepo['createDraft']>>;
    },
    /* 파일 내용이 바뀌면 시더가 초안 본문을 다시 맞춘다 — 그 경로를 재현한다. */
    async updateDraft(id: string, input: { title?: string; body?: string }) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error('DOC_NOT_FOUND');
      if (row.publishedAt !== null) throw new Error('ALREADY_PUBLISHED');
      if (input.title !== undefined) row.title = input.title;
      if (input.body !== undefined) row.body = input.body;
      return row as unknown as Awaited<ReturnType<PgLegalRepo['updateDraft']>>;
    },
    async publish(id: string) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error('DOC_NOT_FOUND');
      row.publishedAt = Date.now();
      return row as unknown as Awaited<ReturnType<PgLegalRepo['publish']>>;
    },
  };
  return { repo: repo as unknown as PgLegalRepo, rows };
}

const base = {
  version: 'test-1',
  supportEmail: 'support@example.com',
  companyInfo: '',
  liveOrdersEnabled: false,
};

describe('법적 문서 시딩', () => {
  it('문서 디렉터리를 CWD 와 무관하게 찾는다', () => {
    expect(resolveDocsDir()).not.toBeNull();
  });

  it('4종 × 4언어를 초안으로 만든다 (기본은 공개하지 않는다)', async () => {
    const { repo, rows } = stubRepo();
    const r = await seedLegalDocuments(repo, { ...base, publish: false });
    expect(r.missingFiles).toEqual([]);
    expect(r.created).toHaveLength(LEGAL_KINDS.length * SEED_LOCALES.length);
    expect(r.published).toEqual([]);
    expect(rows.every((x) => x.publishedAt === null)).toBe(true);
  });

  it('치환 토큰이 남지 않는다', async () => {
    const { repo, rows } = stubRepo();
    await seedLegalDocuments(repo, { ...base, publish: false, companyInfo: '상호: 테스트' });
    for (const row of rows) {
      expect(row.body).not.toContain('{{SUPPORT_EMAIL}}');
      expect(row.body).not.toContain('{{COMPANY_INFO}}');
      expect(row.title.length).toBeGreaterThan(0);
    }
    expect(rows.some((x) => x.body.includes('support@example.com'))).toBe(true);
  });

  it('같은 버전이 이미 있으면 다시 만들지 않는다', async () => {
    const { repo } = stubRepo();
    await seedLegalDocuments(repo, { ...base, publish: false });
    const again = await seedLegalDocuments(repo, { ...base, publish: false });
    expect(again.created).toEqual([]);
    expect(again.skipped.length).toBe(LEGAL_KINDS.length * SEED_LOCALES.length);
  });

  it('publish=true 면 공개한다', async () => {
    const { repo, rows } = stubRepo();
    const r = await seedLegalDocuments(repo, { ...base, publish: true, companyInfo: '상호: 테스트' });
    expect(r.published.length).toBe(LEGAL_KINDS.length * SEED_LOCALES.length);
    expect(rows.every((x) => x.publishedAt !== null)).toBe(true);
  });

  /*
     운영 방침이 바뀌었다 — 사업자등록번호·전화번호를 게시하지 않고 문의는
     게시판으로 받는다. 그래서 공개를 막는 기준은 사업자 정보가 아니라 '연락할
     방법이 있는가' 다.
  */
  it('사업자 정보가 없어도 문의 창구가 있으면 공개한다', async () => {
    const { repo } = stubRepo();
    const r = await seedLegalDocuments(repo, { ...base, publish: true, companyInfo: '', liveOrdersEnabled: true });
    expect(r.published.length).toBeGreaterThan(0);
    expect(r.blocked).toEqual([]);
  });

  it('★ 실주문이 열려 있는데 문의 창구가 하나도 없으면 공개하지 않는다', async () => {
    const { repo, rows } = stubRepo();
    const r = await seedLegalDocuments(repo, {
      ...base, publish: true, companyInfo: '', supportEmail: '', liveOrdersEnabled: true,
    });
    expect(r.published).toEqual([]);
    expect(r.blocked.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.publishedAt === null)).toBe(true);
  });

  it('실주문이 닫혀 있으면 창구가 없어도 초안 공개를 막지 않는다', async () => {
    const { repo } = stubRepo();
    const r = await seedLegalDocuments(repo, {
      ...base, publish: true, companyInfo: '', supportEmail: '', liveOrdersEnabled: false,
    });
    expect(r.published.length).toBeGreaterThan(0);
    expect(r.blocked).toEqual([]);
  });

  /*
     실제로 겪은 문제: 초안이 먼저 만들어진 배포에서 LEGAL_AUTOPUBLISH=true 를 켜도
     '생성 0 · 공개 0 · 건너뜀 16' 이 나오고 사용자에게는 계속 '미게시' 로 보였다.
     운영자는 공개됐다고 믿는데 실제로는 아무것도 공개되지 않는 상태였다.
  */
  it('★ 같은 버전 초안이 이미 있으면, 새로 만들지 않고 그 초안을 공개한다', async () => {
    const { repo, rows } = stubRepo([
      { id: 'draft-terms-ko', kind: 'terms', locale: 'ko', version: 'v1', title: 't', body: 'b', publishedAt: null },
    ]);
    const r = await seedLegalDocuments(repo, { ...base, version: 'v1', publish: true, companyInfo: '' });
    /* 새 문서를 만들지 않는다 — 재배포마다 초안이 쌓이면 관리자 화면을 쓸 수 없다. */
    expect(r.created).not.toContain('terms/ko');
    expect(rows.filter((x) => x.kind === 'terms' && x.locale === 'ko')).toHaveLength(1);
    /* 그러나 공개는 된다. */
    expect(rows.find((x) => x.id === 'draft-terms-ko')?.publishedAt).not.toBeNull();
    expect(r.published.some((x) => x.startsWith('terms/ko'))).toBe(true);
  });

  it('공개를 요청하지 않았으면 기존 초안을 건드리지 않는다', async () => {
    const { repo, rows } = stubRepo([
      { id: 'draft-terms-ko', kind: 'terms', locale: 'ko', version: 'v1', title: 't', body: 'b', publishedAt: null },
    ]);
    const r = await seedLegalDocuments(repo, { ...base, version: 'v1', publish: false, companyInfo: '' });
    expect(rows.find((x) => x.id === 'draft-terms-ko')?.publishedAt).toBeNull();
    expect(r.skipped.some((x) => x.startsWith('terms/ko'))).toBe(true);
  });

  it('이미 공개된 종류·언어는 다시 공개하지 않는다', async () => {
    const { repo } = stubRepo([
      { id: 'old', kind: 'terms', locale: 'ko', version: 'old-1', title: 't', body: 'b', publishedAt: 1 },
    ]);
    const r = await seedLegalDocuments(repo, { ...base, publish: true, companyInfo: '상호: 테스트' });
    expect(r.published).not.toContain('terms/ko');
    expect(r.skipped.some((x) => x.startsWith('terms/ko'))).toBe(true);
  });
});
