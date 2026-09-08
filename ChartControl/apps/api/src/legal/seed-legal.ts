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

   ★★ 실주문이 열려 있는데 **문의 창구가 하나도 없으면 공개하지 않는다.**
     문제가 생겼을 때 연락할 방법이 없는 약관을 게시하면 안 된다. 이 경우 초안만
     만들고 이유를 로그에 남긴다.

     운영 방침: 사업자등록번호·전화번호는 게시하지 않고, 문의는 게시판(#/help)과
     이메일로 받는다. 그래서 공개를 막는 조건은 사업자 정보가 아니라 문의 창구다.
     COMPANY_INFO 를 나중에 채우면 그 문단이 약관 끝에 덧붙는다.

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

/**
 * 문서를 등록할 언어. 화면 언어와 동일하게 유지한다(en·ja·zh).
 *
 * ★★ 한국어(ko)를 제외했다 (운영 결정).
 *
 *   화면 언어에 한국어가 없으므로(src/locales 에 ko 사전이 없다) 약관만 한국어로
 *   내보내면 서비스 언어와 문서 언어가 어긋난다. 나중에 한국어를 지원하게 되면
 *   화면 사전과 함께 여기에 'ko' 를 다시 넣고 docs/legal/*-ko.md 를 되살린다.
 *
 * ★ 이미 공개된 한국어 문서 행은 이 목록에서 빼도 **DB 에 남는다.** 파일이
 *   없으면 새로 시딩되지 않을 뿐이다 — 기존 행 정리는 운영자가 별도로 한다.
 */

/**
 * 문서 본문이 스스로 밝힌 시행일·판번호를 읽는다.
 *
 * ★ 영어·중국어 표기를 모두 읽는다. 일본어·환불·보안 문서에는 이 줄이 아예 없어
 *   null 을 돌려준다 — 없는 것을 "0" 이나 오늘 날짜로 바꾸지 않는다.
 */
export function readBodyVersionStamp(
  body: string,
): { raw: string; isoDate: string } | null {
  const MONTHS: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  /* 영어: "Effective: 5 September 2026 · Version 1.1" */
  const en = /Effective:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})[^\n]*/.exec(body);
  if (en) {
    const m = MONTHS[(en[2] ?? '').toLowerCase()];
    if (m) {
      const d = Number(en[1]);
      return {
        raw: en[0].trim(),
        isoDate: `${en[3]}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      };
    }
  }
  /* 중국어: "生效日期：2026 年 9 月 5 日 · 版本 1.1" */
  const zh = /生效日期：\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日[^\n]*/.exec(body);
  if (zh) {
    return {
      raw: zh[0].trim(),
      isoDate: `${zh[1]}-${String(Number(zh[2])).padStart(2, '0')}-${String(Number(zh[3])).padStart(2, '0')}`,
    };
  }
  return null;
}

export const SEED_LOCALES = ['en', 'ja', 'zh'] as const;

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
  /*
     사업자 정보 한 문단(선택).

     비어 있어도 공개를 막지 않는다 — 문의는 게시판으로 받는 방침이다. 값이 있으면
     약관 끝의 문의 창구 문단 뒤에 그대로 붙는다.
  */
  companyInfo: string;
  /** 실주문이 열려 있는가. 공개 판정에만 쓴다. */
  liveOrdersEnabled: boolean;
  /** 문서 디렉터리 (테스트에서 교체). */
  docsDir?: string;
}

export interface LegalSeedResult {
  created: string[];
  published: string[];
  /** 파일 내용이 바뀌어 초안 본문을 다시 맞춘 문서. */
  refreshed: string[];
  skipped: string[];
  /**
   * 본문 표기와 배포 라벨이 어긋난 문서들.
   *
   * ★ 게시를 막지는 않지만 반드시 로그에 남긴다 — 조용히 넘어가면 아무도 모른다.
   */
  versionMismatch: string[];
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
  const out: LegalSeedResult = { created: [], published: [], refreshed: [], skipped: [], versionMismatch: [], blocked: [], missingFiles: [] };
  const docsDir = resolveDocsDir(opts.docsDir);
  if (!docsDir) {
    out.missingFiles.push('docs/legal (디렉터리를 찾지 못했다)');
    return out;
  }

  /*
     문의 창구 문단.

     ★★ 전에는 사업자 정보(COMPANY_INFO)가 없으면 실주문이 열린 상태에서 약관을
       공개하지 않았다. 운영 방침이 바뀌었다 — 사업자등록번호·전화번호를 게시하지
       않고, 문의는 게시판으로 받는다. 그래서 공개를 막는 조건에서 사업자 정보를
       뺀다. 대신 **문의 창구가 하나라도 있는지**는 확인한다. 창구가 전혀 없는
       약관을 공개하면 사용자는 문제가 생겨도 연락할 방법이 없다.

     ★ COMPANY_INFO 를 나중에 채우면 그 문단이 그대로 덧붙는다(지우지 않았다).
  */
  const companyInfo = opts.companyInfo.trim();
  const boardPath = '#/help';
  const contactInfo = [
    companyInfo ? `---\n\n${companyInfo}` : '',
  ].filter(Boolean).join('\n\n');

  /* 창구가 없으면(이메일도, 게시판 안내도 없음) 공개하지 않는다. */
  const noContactChannel = opts.supportEmail.trim().length === 0;
  const publishBlockedNoContact = opts.publish && noContactChannel && opts.liveOrdersEnabled;

  const existing = await repo.list(500).catch(() => []);
  const published = await repo.publishedKinds().catch(() => []);
  /*
     ★★ **버전까지 본다.**

       예전에는 종류·언어만 봤다. 그래서 한 번 공개된 뒤에는 LEGAL_VERSION 을 올려도
       새 버전이 절대 공개되지 않았다 — 시딩이 초안만 15개 만들고 "공개 0" 으로
       끝났고, 화면에는 계속 옛 약관이 나갔다. 실제로 그 상태를 겪었다:
       파일을 고치고 버전을 올리고 배포했는데 `/api/legal/terms` 가 여전히
       2026-08-22 본문을 돌려줬다.

       "이미 공개된 문서는 손대지 않는다" 는 규칙은 **같은 버전**에 대한 것이다.
       개정판을 새 버전으로 올리는 것은 그 규칙이 막으려던 일(동의한 내용을 몰래
       바꾸는 것)이 아니라, 정반대로 그 규칙이 요구하는 절차다.

     ★ 이전 버전은 그대로 남는다(repo.publish 가 최신 공개본을 가리키게 한다).
       동의 이력은 버전을 함께 기록하므로 과거 동의가 지워지지 않는다.
  */
  const isPublished = (kind: string, locale: string) =>
    published.some((p) => p.kind === kind && p.locale === locale && p.version === opts.version);

  for (const kind of LEGAL_KINDS) {
    for (const locale of SEED_LOCALES) {
      const key = `${kind}/${locale}`;
      const path = join(docsDir, `${kind}-${locale}.md`);
      if (!existsSync(path)) { out.missingFiles.push(key); continue; }
      /*
         같은 (종류·언어·버전) 이 이미 있는 경우.

         ★★ 전에는 그냥 건너뛰었다. 그래서 초안이 먼저 만들어진 배포에서
           LEGAL_AUTOPUBLISH=true 를 켜도 **아무것도 공개되지 않았다** —
           운영자는 공개됐다고 믿는데 사용자에게는 여전히 '미게시' 로 보인다.
           실제로 겪었다(생성 0 · 공개 0 · 건너뜀 16).

         ★ 그래서 문서를 새로 만들지는 않되, 공개가 요청됐고 아직 공개된 것이
           없으면 **기존 초안을 공개한다.**
      */
      let body = await readFile(path, 'utf8');
      body = body
        .split('{{BRAND_NAME}}').join(opts.brandName?.trim() || 'ChartControl AI')
        .split('{{SUPPORT_EMAIL}}').join(opts.supportEmail || '(문의 이메일 미설정)')
        .split('{{BOARD_PATH}}').join(boardPath)
        .split('{{CONTACT_INFO}}').join(contactInfo)
        /* 예전 문서에 남아 있을 수 있는 토큰 — 값이 있으면 그것을, 없으면 빈 문단. */
        .split('{{COMPANY_INFO}}').join(companyInfo);
      const title = titleOf(body, `${kind} (${locale})`);

      /*
         같은 (종류·언어·버전) 이 이미 있는 경우.

         ★★ 전에는 그냥 건너뛰었다. 그래서 초안이 먼저 만들어진 배포에서
           LEGAL_AUTOPUBLISH=true 를 켜도 **아무것도 공개되지 않았다** —
           운영자는 공개됐다고 믿는데 사용자에게는 여전히 '미게시' 로 보인다.
           실제로 겪었다(생성 0 · 공개 0 · 건너뜀 16).

         ★★ 그리고 파일 내용이 그동안 바뀌었을 수 있다. 낡은 초안을 그대로 공개하면
           **틀린 약관이 게시된다.** 실제로 겪었다 — 영어·일본어·중국어 문서에
           한국어 자리표시자가 그대로 게시됐다. 그래서 공개 전에 본문을 맞춘다.

         ★ 이미 공개된 문서는 손대지 않는다. 게시된 약관은 되돌릴 수 없는 약속이고,
           본문을 몰래 바꾸면 사용자가 동의한 내용과 달라진다. 그 경우 LEGAL_VERSION
           을 올려 새 버전으로 만들어야 한다.
      */
      const already = existing.find(
        (d) => d.kind === kind && d.locale === locale && d.version === opts.version,
      );
      if (already) {
        if (isPublished(kind, locale)) { out.skipped.push(`${key} 이미 공개됨`); continue; }
        if (already.body !== body || already.title !== title) {
          const fixed = await repo.updateDraft(already.id, { title, body })
            .then(() => true)
            .catch((e: unknown) => { out.blocked.push(`${key} 초안 갱신 실패: ${(e as Error).message}`); return false; });
          if (!fixed) continue;
          out.refreshed.push(key);
        }
        if (!opts.publish) { out.skipped.push(`${key} v${opts.version}`); continue; }
        if (publishBlockedNoContact) { out.blocked.push(`${key} (문의 창구 없음 + 실주문 열림)`); continue; }
        await repo.publish(already.id)
          .then(() => out.published.push(`${key} (기존 초안)`))
          .catch((e: unknown) => out.blocked.push(`${key} 공개 실패: ${(e as Error).message}`));
        continue;
      }

      /*
         ★★ 본문이 스스로 밝힌 시행일·판번호를 읽어, 배포 라벨과 **어긋나면 알린다.**

           문서 본문에는 `Effective: 5 September 2026 · Version 1.1` 같은 줄이 있는데,
           우리가 동의 기록에 남기는 버전은 배포 환경변수(LEGAL_VERSION)에서 온다.
           둘이 어긋나면 고객은 "Version 1.1" 을 읽고 우리는 그 동의를 `2026-08-22` 로
           기록한다 — 실제로 그 상태였다.

         ★ 게시를 **거부하지는 않는다.** 문서마다 시행일이 다르고(약관 9/5, 개인정보
           8/10) 일부는 표기가 아예 없어, 단일 라벨과 전부 일치시키는 것은 불가능하다.
           거부하면 전 문서가 막힌다. 그래서 드러내고 넘어간다 — 조용히 넘어가는 것과
           다르다.

         ★ 증거 자체는 보존된다. 동의는 document_id 로 기록되고 게시본은 덮어쓸 수
           없다(repo.updateDraft 가 ALREADY_PUBLISHED 로 거부한다). 어긋나는 것은
           **라벨**이고 텍스트가 아니다.
      */
      const bodyStamp = readBodyVersionStamp(body);
      if (bodyStamp && !opts.version.startsWith(bodyStamp.isoDate)) {
        out.versionMismatch.push(
          `${key}: 본문 "${bodyStamp.raw}" (시행 ${bodyStamp.isoDate}) ↔ 배포 라벨 "${opts.version}"`,
        );
      }

      const doc = await repo.createDraft({
        kind: kind as LegalKind,
        locale,
        version: opts.version,
        title,
        body,
        effectiveAt: Date.now(),
        actorId: null,
      }).catch((e: unknown) => { out.missingFiles.push(`${key} 생성 실패: ${(e as Error).message}`); return null; });
      if (!doc) continue;
      out.created.push(key);

      if (!opts.publish) continue;
      if (publishBlockedNoContact) { out.blocked.push(`${key} (문의 창구 없음 + 실주문 열림)`); continue; }
      if (isPublished(kind, locale)) { out.skipped.push(`${key} 이미 공개된 버전 있음`); continue; }
      await repo.publish(doc.id)
        .then(() => out.published.push(key))
        .catch((e: unknown) => out.blocked.push(`${key} 공개 실패: ${(e as Error).message}`));
    }
  }
  return out;
}
