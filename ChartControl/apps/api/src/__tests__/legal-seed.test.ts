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

  it('실주문이 열려 있는데 사업자 정보가 없으면 공개하지 않는다', async () => {
    const { repo, rows } = stubRepo();
    const r = await seedLegalDocuments(repo, { ...base, publish: true, companyInfo: '', liveOrdersEnabled: true });
    expect(r.published).toEqual([]);
    expect(r.blocked.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.publishedAt === null)).toBe(true);
  });

  it('실주문이 닫혀 있으면 사업자 정보가 없어도 공개한다', async () => {
    const { repo } = stubRepo();
    const r = await seedLegalDocuments(repo, { ...base, publish: true, companyInfo: '', liveOrdersEnabled: false });
    expect(r.published.length).toBeGreaterThan(0);
    expect(r.blocked).toEqual([]);
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
