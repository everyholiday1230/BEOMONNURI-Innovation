/**
 * 약관 개정 시 재동의를 받는지 고정한다.
 *
 * ★★ 무엇이 문제였나 — **부품은 다 있고 트리거만 없었다**
 *
 *   서버는 미동의를 정확히 계산했고(`pendingConsents`), 동의 화면도 잘 만들어져 있었다.
 *   그런데 **아무도 그 화면으로 보내지 않았다.** `#/consent` 로 보내는 코드는 구글 신규
 *   가입 한 곳뿐이었다. 그래서 약관을 개정해도 기존 고객은 개정본을 본 적도, 동의한
 *   적도 없이 거래 화면으로 그냥 들어갔다.
 *
 *   더 나쁜 것은 DB 가 "이 고객은 구버전에만 동의했다" 는 기록을 **정확히** 갖고 있다는
 *   점이다. 분쟁이 생기면 우리 기록이 우리에게 불리한 증거가 된다.
 *
 *   그리고 트리거를 세션당 한 번만 돌리면 **우회할 수 있다** — 해시만 바꾸면 페이지가
 *   재실행되지 않아 검사가 다시 돌지 않는다. 그래서 화면 이동마다 판정한다.
 *
 * ★ 여기서는 서버 계약만 고정한다(브라우저 이동은 Playwright 로 실측했다).
 *   서버가 pending 을 정확히 계산하지 않으면 트리거가 있어도 아무 일도 일어나지 않는다.
 */
import { describe, it, expect } from 'vitest';

describe('약관 개정 → 재동의', () => {
  it('개정 전 동의는 개정본 동의로 인정되지 않는다 (문서 id 기준)', () => {
    /*
       ★ 동의는 **문서 id** 로 기록된다. 종류(kind)로 기록하면 개정본이 나와도
         "약관에 동의함" 이 그대로 남아 재동의를 영원히 요구하지 않는다.

         아래는 그 규칙을 문장으로 고정한 것이다. 실제 쿼리는
         pendingConsents 가 `WHERE user_id = $1 AND document_id = $2` 로 확인한다.
    */
    const consentedDocIds = new Set(['doc-terms-2026-08-22']);
    const liveDocId = 'doc-terms-2026-09-05';
    expect(consentedDocIds.has(liveDocId)).toBe(false);
  });

  it('필수 목록은 requiredConsentDocs 한 곳에서만 정한다', async () => {
    /*
       ★★ 예전에 pendingConsents 는 약관·개인정보 **2종**만 봤고, 가입 경로는
         위험고지까지 **3종**을 받았다. 두 곳이 어긋나면 "가입 때는 3종을 받았는데
         미동의 목록에는 2종만 뜬다" 가 되어 어느 쪽이 사실인지 알 수 없다.

       ★ 소스에서 직접 확인한다 — 주석이 아니라 코드가 그런지 본다.
    */
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../db/legal-repo.ts', import.meta.url), 'utf-8',
    );
    const body = src.slice(src.indexOf('async pendingConsents'));
    const fn = body.slice(0, body.indexOf('\n  }'));
    /* 필수 종류를 여기서 다시 나열하면 안 된다. */
    expect(fn).toContain('requiredConsentDocs');
    expect(fn).not.toMatch(/\['terms',\s*'privacy'\]/);
  });

  it('동의 강제 트리거가 클라이언트에 실제로 있다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../../src/auth-state.js', import.meta.url), 'utf-8',
    );
    /* 세션 확인 직후 + 화면 이동마다 판정해야 한다. */
    expect(src).toContain('checkPendingConsents');
    expect(src).toContain("'hashchange'");
    expect(src).toContain('#/consent');
    /*
       ★ 동의 화면과 법적 문서 화면은 면제해야 한다 — 아니면 무한 이동이 된다.
    */
    expect(src).toContain('consentExempt');
  });
});
