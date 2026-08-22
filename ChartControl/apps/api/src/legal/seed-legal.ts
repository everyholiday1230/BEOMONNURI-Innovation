/*
   법적 문서 시딩.

   왜 필요한가
   ---------
   문서는 `docs/legal/*.md` 에 4개 언어로 이미 작성돼 있었지만, 데이터베이스에
   등록되지 않아 화면에서는 계속 "아직 공개되지 않았습니다" 가 나왔다. 그런데
   **회원가입에서는 이용약관과 개인정보처리방침에 동의를 받는다.** 동의가 가리키는
   문서가 없는 상태로 회원을 받고 있었다(실측: 라이브에서 4종 모두 not_published).

   등록을 사람 손에 맡기면, 배포마다 잊거나 언어 하나를 빠뜨린다. 그래서 부팅 때
   빠진 것만 채운다.

   설계 원칙
   -------
   ★★ 기본은 **초안까지만** 만든다. 공개(publish)는 취소할 수 없고 법적 약속이
     되므로, 사람이 읽고 결정해야 한다. `LEGAL_AUTOPUBLISH=true` 일 때만 공개한다.

   ★★ 실주문이 열려 있는데 사업자 정보가 없으면 **공개하지 않는다.** 약관에는
     사업자 정보를 적는 자리가 있고, 실거래를 제공하는 사업자가 자기 정보를 밝히지
     않는 문서는 게시하면 안 된다. 이 경우 초안만 만들고 이유를 로그에 남긴다.

   ★ 이미 같은 (종류·언어·버전) 이 있으면 건너뛴다. 재배포마다 초안이 쌓이면
     관리자 화면이 쓸 수 없게 된다.

   ★ 문서 본문의 회사 정보·문의 이메일은 토큰({{...}})으로 두고 환경변수로 채운다.
     문서에 값을 박아 두면 이메일이 바뀔 때 4개 언어 × 4종을 다시 고쳐야 한다.
*/

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEGAL_KINDS, type LegalKind, type PgLegalRepo } from '../db/legal-repo';

/** 문서를 등록할 언어. 화면 언어(en·ja·zh)와 사업자 소재지 언어(ko). */
export const SEED_LOCALES = ['ko', 'en', 'ja', 'zh'] as const;

export interface LegalSeedOptions {
  /** 공개까지 진행할지. 기본 false — 초안만 만든다. */
  publish: boolean;
  /** 문서 버전. 같은 버전이 이미 있으면 건너뛴다. */
  version: string;
  /** 문의 이메일 (SUPPORT_EMAIL). */
  supportEmail: string;
  /*
     서비스 이름 (BRAND_NAME).

     ★ 문서에 이름을 박아 두면 이름이 바뀔 때 16개 파일을 다시 손봐야 하고,
       화면에는 새 이름인데 약관에는 옛 이름이 남는다.
  */
  brandName?: string;
  /** 사업자 정보 한 문단. 비어 있으면 실주문이 열린 상태에서는 공개하지 않는다. */
  companyInfo: string;
  /** 실주문이 열려 있는가. 공개 판정에만 쓴다. */
  liveOrdersEnabled: boolean;
  /** 문서 디렉터리 (테스트에서 교체). */
  docsDir?: string;
}

export interface LegalSeedResult {
  created: string[];
  published: string[];
  skipped: string[];
  blocked: string[];
  missingFiles: string[];
}

/** 문서 제목 — 각 파일의 첫 번째 `# 제목` 을 그대로 쓴다. */
function titleOf(body: string, fallback: string): string {
  const first = body.split('\n').find((l) => l.startsWith('# '));
  return (first ? first.slice(2) : fallback).trim().slice(0, 200);
}

/**
 * 기본 문서 디렉터리.
 *
 * CWD 에 의존하지 않는다 — `tsx src/index.ts` · `node dist/index.js` · 테스트 러너가
 * 각각 다른 CWD 에서 돌기 때문이다. 이 파일 위치에서 위로 올라가며 찾는다.
 */
export function resolveDocsDir(explicit?: string): string | null {
  if (explicit) return existsSync(explicit) ? resolve(explicit) : null;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 7; i += 1) {
    const candidate = join(dir, 'docs', 'legal');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 빠진 문서를 등록한다.
 *
 * 오류를 던지지 않는다 — 문서 등록이 실패해도 서비스는 떠야 한다. 대신 결과를
 * 돌려주고 호출자가 로그로 남긴다. 조용히 실패하면 아무도 모른다.
 */
export async function seedLegalDocuments(
  repo: PgLegalRepo,
  opts: LegalSeedOptions,
): Promise<LegalSeedResult> {
  const out: LegalSeedResult = { created: [], published: [], skipped: [], blocked: [], missingFiles: [] };
  const docsDir = resolveDocsDir(opts.docsDir);
  if (!docsDir) {
    out.missingFiles.push('docs/legal (디렉터리를 찾지 못했다)');
    return out;
  }

  /* 사업자 정보가 없는데 실주문이 열려 있으면 공개하지 않는다. */
  const companyMissing = opts.companyInfo.trim().length === 0;
  const publishBlockedByCompany = opts.publish && companyMissing && opts.liveOrdersEnabled;

  const existing = await repo.list(500).catch(() => []);
  const has = (kind: string, locale: string, version: string) =>
    existing.some((d) => d.kind === kind && d.locale === locale && d.version === version);
  const published = await repo.publishedKinds().catch(() => []);
  const isPublished = (kind: string, locale: string) =>
    published.some((p) => p.kind === kind && p.locale === locale);

  for (const kind of LEGAL_KINDS) {
    for (const locale of SEED_LOCALES) {
      const key = `${kind}/${locale}`;
      const path = join(docsDir, `${kind}-${locale}.md`);
      if (!existsSync(path)) { out.missingFiles.push(key); continue; }
      if (has(kind, locale, opts.version)) { out.skipped.push(`${key} v${opts.version}`); continue; }

      let body = await readFile(path, 'utf8');
      body = body
        .split('{{BRAND_NAME}}').join(opts.brandName?.trim() || 'ChartControl AI')
        .split('{{SUPPORT_EMAIL}}').join(opts.supportEmail || '(문의 이메일 미설정)')
        .split('{{COMPANY_INFO}}').join(
          companyMissing
            ? '사업자 정보는 확정 후 이 자리에 게시합니다.'
            : opts.companyInfo,
        );

      const doc = await repo.createDraft({
        kind: kind as LegalKind,
        locale,
        version: opts.version,
        title: titleOf(body, `${kind} (${locale})`),
        body,
        effectiveAt: Date.now(),
        actorId: null,
      }).catch((e: unknown) => { out.missingFiles.push(`${key} 생성 실패: ${(e as Error).message}`); return null; });
      if (!doc) continue;
      out.created.push(key);

      if (!opts.publish) continue;
      if (publishBlockedByCompany) { out.blocked.push(`${key} (사업자 정보 없음 + 실주문 열림)`); continue; }
      if (isPublished(kind, locale)) { out.skipped.push(`${key} 이미 공개된 버전 있음`); continue; }
      await repo.publish(doc.id)
        .then(() => out.published.push(key))
        .catch((e: unknown) => out.blocked.push(`${key} 공개 실패: ${(e as Error).message}`));
    }
  }
  return out;
}
